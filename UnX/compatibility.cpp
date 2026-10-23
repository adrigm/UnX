/**
 * This file is part of UnX.
 *
 * UnX is free software : you can redistribute it
 * and/or modify it under the terms of the GNU General Public License
 * as published by The Free Software Foundation, either version 3 of
 * the License, or (at your option) any later version.
 *
 * UnX is distributed in the hope that it will be useful,
 *
 * But WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with UnX.
 *
 *   If not, see <http://www.gnu.org/licenses/>.
 *
**/
#define NOMINMAX

#include <Windows.h>

#include "config.h"

#include "hook.h"
#include "log.h"
#include "game_memory.h"
#include "specialk_warning.h"

#include <algorithm>
#include <intrin.h>

LPVOID __UNX_base_img_addr = nullptr;
LPVOID __UNX_end_img_addr  = nullptr;

namespace {

using SpecialKWarning_pfn = void (__cdecl *)(const wchar_t*);
SpecialKWarning_pfn original_specialk_warning = nullptr;
unx::game_memory::ExecutableImage warning_injector = { };

bool
IsInjectorCode (const void* address, size_t length)
{
  const uintptr_t pointer = reinterpret_cast <uintptr_t> (address);
  const uintptr_t base = reinterpret_cast <uintptr_t> (warning_injector.base);
  if (pointer < base || pointer - base >= warning_injector.size ||
      length > warning_injector.size - (pointer - base))
    return false;

  const size_t rva = pointer - base;
  for (unsigned int index = 0;
       index < warning_injector.headers->FileHeader.NumberOfSections; ++index)
  {
    const IMAGE_SECTION_HEADER& section = warning_injector.sections [index];
    const size_t size = section.Misc.VirtualSize;
    if ((section.Characteristics & IMAGE_SCN_MEM_EXECUTE) &&
        rva >= section.VirtualAddress && rva - section.VirtualAddress < size &&
        length <= size - (rva - section.VirtualAddress))
      return true;
  }
  return false;
}

void __cdecl
FilterSpecialKWarning (const wchar_t* text)
{
  if (unx::compatibility::SuppressLegacyXInputWarning (
        text, IsInjectorCode (_ReturnAddress (), 1)))
  {
    static volatile LONG logged = FALSE;
    if (! InterlockedCompareExchange (&logged, TRUE, FALSE))
      dll_log->Log (L"[Input Compat] Suppressed legacy XInput haptic popup; Special K recursion protection remains active.");
    return;
  }

  original_specialk_warning (text);
}

} // namespace

void
UNX_InitInputCompatibility (HMODULE injector)
{
  using namespace unx::game_memory;
  if (! GetImage (injector, warning_injector))
    return;

  // The legacy engine queues this warning through an internal cdecl function,
  // then displays it as an ImGui modal. It does not call MessageBox. Locate the
  // queue entry point through the exact warning literal and its call sites.
  const uint8_t* literal = nullptr;
  size_t literal_count = 0;
  for (unsigned int index = 0;
       index < warning_injector.headers->FileHeader.NumberOfSections; ++index)
  {
    const IMAGE_SECTION_HEADER& section = warning_injector.sections [index];
    const size_t rva = section.VirtualAddress;
    const size_t size = section.Misc.VirtualSize;
    if ((section.Characteristics & (IMAGE_SCN_MEM_EXECUTE | IMAGE_SCN_MEM_WRITE)) ||
        ! (section.Characteristics & IMAGE_SCN_MEM_READ) ||
        rva >= warning_injector.size || size > warning_injector.size - rva ||
        ! IsReadable (warning_injector.base + rva, size))
      continue;

    const auto found = ScanSignature (
      warning_injector.base + rva, size,
      reinterpret_cast <const uint8_t*> (unx::compatibility::legacy_xinput_warning),
      nullptr, sizeof unx::compatibility::legacy_xinput_warning);
    if (found.count != 0)
    {
      literal = literal_count == 0 ? found.address : nullptr;
      literal_count += found.count;
    }
  }

  if (literal_count != 1 || literal == nullptr)
  {
    dll_log->Log (L"[Input Compat] Haptic popup filter unavailable: warning literal matches=%u.",
                  static_cast <unsigned int> (literal_count));
    return;
  }

  uint8_t* target = nullptr;
  size_t call_count = 0;
  bool consistent = true;
  const uint32_t literal_address = reinterpret_cast <uint32_t> (literal);
  for (unsigned int index = 0;
       index < warning_injector.headers->FileHeader.NumberOfSections; ++index)
  {
    const IMAGE_SECTION_HEADER& section = warning_injector.sections [index];
    const size_t rva = section.VirtualAddress;
    const size_t size = section.Misc.VirtualSize;
    if (! (section.Characteristics & IMAGE_SCN_MEM_EXECUTE) ||
        rva >= warning_injector.size || size > warning_injector.size - rva ||
        size < 17 || ! IsReadable (warning_injector.base + rva, size))
      continue;

    uint8_t* begin = warning_injector.base + rva;
    for (size_t offset = 0; offset <= size - 17; ++offset)
    {
      uint8_t* callsite = begin + offset;
      // add esp,12; push <exact warning>; call rel32; add esp,4; pop edi
      static const uint8_t context [] = {
        0x83, 0xc4, 0x0c, 0x68, 0, 0, 0, 0, 0xe8,
        0, 0, 0, 0, 0x83, 0xc4, 0x04, 0x5f
      };
      if (ScanSignature (callsite, sizeof context, context,
                         "xxxx????x????xxxx", sizeof context).count != 1)
        continue;
      uint32_t operand = 0;
      memcpy (&operand, callsite + 4, sizeof operand);
      if (operand != literal_address)
        continue;

      int32_t displacement = 0;
      memcpy (&displacement, callsite + 9, sizeof displacement);
      const int64_t destination =
        static_cast <int64_t> (reinterpret_cast <uintptr_t> (callsite + 13)) + displacement;
      if (destination < 0 || destination > UINT32_MAX)
      {
        consistent = false;
        continue;
      }
      uint8_t* candidate = reinterpret_cast <uint8_t*> (
        static_cast <uintptr_t> (destination));
      ++call_count;
      if (! IsInjectorCode (candidate, 29) || ! IsReadable (candidate, 29) ||
          (target != nullptr && target != candidate))
        consistent = false;
      else
        target = candidate;
    }
  }

  // Validate the queue function's SEH prologue and stack frame before relying
  // on the source-confirmed void __cdecl(const wchar_t*) ABI.
  static const uint8_t prologue [] = {
    0x66, 0x90, 0x55, 0x8b, 0xec, 0x6a, 0xff, 0x68, 0, 0, 0, 0,
    0x64, 0xa1, 0, 0, 0, 0, 0x50, 0x64, 0x89, 0x25, 0, 0, 0, 0,
    0x83, 0xec, 0x18
  };
  if (! consistent || call_count < 3 || call_count > 4 || target == nullptr ||
      ScanSignature (target, sizeof prologue, prologue,
                     "xxxxxxxx????xxxxxxxxxxxxxxxxx", sizeof prologue).count != 1)
  {
    dll_log->Log (L"[Input Compat] Haptic popup filter unavailable: call sites=%u, consistent=%i.",
                  static_cast <unsigned int> (call_count), consistent);
    return;
  }

  const MH_STATUS created = UNX_CreateFuncHook (
    L"Special K XInput warning filter", target, FilterSpecialKWarning,
    reinterpret_cast <void**> (&original_specialk_warning));
  if (created != MH_OK || original_specialk_warning == nullptr)
  {
    dll_log->Log (L"[Input Compat] Could not create haptic popup filter (status=%i, original=%p).",
                  created, reinterpret_cast <void*> (original_specialk_warning));
    return;
  }

  const MH_STATUS enabled = UNX_EnableHook (target);
  dll_log->Log (L"[Input Compat] Legacy haptic warning filter at %p: status=%i; XInput hooks and rumble settings preserved.",
                target, enabled);
}

void*
__stdcall
UNX_Scan (const void* pattern, size_t len, const void* mask)
{
  return UNX_ScanAligned (pattern, len, mask);
}

void*
__stdcall
UNX_ScanAlignedEx (const void* pattern, size_t len, const void* mask, void* after, int align)
{
  uint8_t* base_addr =
    reinterpret_cast <uint8_t *> (GetModuleHandle (nullptr));

  MEMORY_BASIC_INFORMATION minfo;
  VirtualQuery (base_addr, &minfo, sizeof minfo);

           base_addr = static_cast <uint8_t *> (minfo.BaseAddress);//AllocationBase;
  uint8_t* end_addr  = static_cast <uint8_t *> (minfo.BaseAddress) + minfo.RegionSize;

  size_t pages = 0;

  // Account for possible overflow in 32-bit address space in very rare (address randomization) cases
  uint8_t* const PAGE_WALK_LIMIT = 
    base_addr + static_cast <uintptr_t>(1UL << 27) > base_addr ?
                                                     base_addr + static_cast      <uintptr_t>( 1UL << 27) :
                                                                 reinterpret_cast <uint8_t *>(~0UL      );

  //
  // For practical purposes, let's just assume that all valid games have less than 256 MiB of
  //   committed executable image data.
  //
  while (VirtualQuery (end_addr, &minfo, sizeof minfo) && end_addr < PAGE_WALK_LIMIT)
  {
    if (minfo.Protect & PAGE_NOACCESS || (! (minfo.Type & MEM_IMAGE)))
      break;

    pages += VirtualQuery (end_addr, &minfo, sizeof minfo);

    end_addr =
      static_cast <uint8_t *> (minfo.BaseAddress) + minfo.RegionSize;
  } 

  if (end_addr > PAGE_WALK_LIMIT)
  {
    static bool warned = false;

    if (! warned)
    {
      dll_log->Log ( L"[ Sig Scan ] Module page walk resulted in end addr. out-of-range: %ph",
                      end_addr );
      dll_log->Log ( L"[ Sig Scan ]  >> Restricting to %ph",
                      PAGE_WALK_LIMIT );
      warned = true;
    }

    end_addr =
      static_cast <uint8_t *> (PAGE_WALK_LIMIT);
  }

  __UNX_base_img_addr = base_addr;
  __UNX_end_img_addr  = end_addr;

  uint8_t* begin = std::max (static_cast <uint8_t *> (after) + align, base_addr);
  uint8_t* it    = begin;
  size_t   idx   = 0;

  while (it < end_addr)
  {
    VirtualQuery (it, &minfo, sizeof minfo);

    // Bail-out once we walk into an address range that is not resident, because
    //   it does not belong to the original executable.
    if (minfo.RegionSize == 0)
      break;

    uint8_t* next_rgn =
     (uint8_t *)minfo.BaseAddress + minfo.RegionSize;

    if ( (! (minfo.Type    & MEM_IMAGE))  ||
         (! (minfo.State   & MEM_COMMIT)) ||
             minfo.Protect & PAGE_NOACCESS )
    {
      it    = next_rgn;
      idx   = 0;
      begin = it;

      continue;
    }

    // Do not search past the end of the module image!
    if (next_rgn >= end_addr)
      break;

    while (it < next_rgn)
    {
      uint8_t* scan_addr = it;

      bool match = (*scan_addr == static_cast <const uint8_t *> (pattern) [idx]);

      // For portions we do not care about... treat them
      //   as matching.
      if (mask != nullptr && (! static_cast <const uint8_t *> (mask) [idx]))
        match = true;

      if (match)
      {
        if (++idx == len)
        {
          if ((reinterpret_cast <uintptr_t> (begin) % align) == 0)
          {
            return
              static_cast <void *> (begin);
          }

          else
          {
            begin += idx;
            begin += align - (reinterpret_cast <uintptr_t> (begin) % align);

            it     = begin;
            idx    = 0;
          }
        }

        else
          ++it;
      }

      else
      {
        // No match?!
        if (it > end_addr - len)
          break;

        begin += idx;
        begin += align - (reinterpret_cast <uintptr_t> (begin) % align);

        it  = begin;
        idx = 0;
      }
    }
  }

  return nullptr;
}

void*
__stdcall
UNX_ScanAligned (const void* pattern, size_t len, const void* mask, int align)
{
  return UNX_ScanAlignedEx (pattern, len, mask, nullptr, align);
}

void
UNX_FlushInstructionCache ( LPCVOID base_addr,
                            size_t  code_size )
{
  FlushInstructionCache ( GetCurrentProcess (),
                            base_addr,
                              code_size );
}

void
UNX_InjectMachineCode ( LPVOID  base_addr,
                        void   *new_code,
                        size_t  code_size,
                        DWORD   permissions,
                        void   *old_code = nullptr )
{
  __try {
    DWORD dwOld =
      PAGE_NOACCESS;

    if ( VirtualProtect ( base_addr,   code_size,
                          permissions, &dwOld )   )
    {
      if (old_code != nullptr) memcpy (old_code, base_addr, code_size);
                               memcpy (base_addr, new_code, code_size);

      VirtualProtect ( base_addr, code_size,
                       dwOld,     &dwOld );

      return;
    }
  }

  __except ( ( GetExceptionCode () == EXCEPTION_ACCESS_VIOLATION ) ? 
               EXCEPTION_EXECUTE_HANDLER : EXCEPTION_CONTINUE_SEARCH )
  {
    //assert (false);

    // Bad memory address, just discard the write attempt
    //
    //   This isn't atomic; if we fail, it's possible we wrote part
    //     of the data successfully - consider an undo mechanism.
    //
  }

  UNX_FlushInstructionCache (base_addr, code_size);
}
