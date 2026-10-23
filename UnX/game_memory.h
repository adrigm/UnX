#ifndef UNX_GAME_MEMORY_H
#define UNX_GAME_MEMORY_H

#include <Windows.h>
#include <cstring>
#include <limits>

#include "signature_scan.h"

namespace unx { namespace game_memory {

inline bool
HasMemoryAccess (const void* address, size_t length, bool write)
{
  if (address == nullptr || length == 0)
    return false;

  uintptr_t cursor = reinterpret_cast <uintptr_t> (address);
  if (length > (std::numeric_limits <uintptr_t>::max) () - cursor)
    return false;
  const uintptr_t end = cursor + length;

  while (cursor < end)
  {
    MEMORY_BASIC_INFORMATION info = { };
    if (VirtualQuery (reinterpret_cast <void*> (cursor), &info, sizeof info) == 0 ||
        info.State != MEM_COMMIT || (info.Protect & (PAGE_GUARD | PAGE_NOACCESS)))
      return false;

    const DWORD protection = info.Protect & 0xff;
    const bool writable = protection == PAGE_READWRITE ||
                          protection == PAGE_WRITECOPY ||
                          protection == PAGE_EXECUTE_READWRITE ||
                          protection == PAGE_EXECUTE_WRITECOPY;
    const bool readable = writable || protection == PAGE_READONLY ||
                                     protection == PAGE_EXECUTE_READ;
    if (write ? ! writable : ! readable)
      return false;

    const uintptr_t region = reinterpret_cast <uintptr_t> (info.BaseAddress);
    if (info.RegionSize > (std::numeric_limits <uintptr_t>::max) () - region)
      return false;
    const uintptr_t next = region + info.RegionSize;
    if (next <= cursor)
      return false;
    cursor = next < end ? next : end;
  }

  return true;
}

inline bool IsReadable (const void* address, size_t length)
{ return HasMemoryAccess (address, length, false); }

inline bool IsWritable (const void* address, size_t length)
{ return HasMemoryAccess (address, length, true); }

struct ExecutableImage {
  uint8_t*                base;
  IMAGE_NT_HEADERS32*      headers;
  IMAGE_SECTION_HEADER*   sections;
  size_t                  size;
};

inline bool
GetImage (HMODULE module, ExecutableImage& image)
{
  image = { };
  uint8_t* base = reinterpret_cast <uint8_t*> (module);
  if (! IsReadable (base, sizeof (IMAGE_DOS_HEADER)))
    return false;
  IMAGE_DOS_HEADER* dos = reinterpret_cast <IMAGE_DOS_HEADER*> (base);
  if (dos->e_magic != IMAGE_DOS_SIGNATURE || dos->e_lfanew < sizeof *dos ||
      dos->e_lfanew > 0x100000)
    return false;

  IMAGE_NT_HEADERS32* headers =
    reinterpret_cast <IMAGE_NT_HEADERS32*> (base + dos->e_lfanew);
  if (! IsReadable (headers, sizeof *headers) ||
      headers->Signature != IMAGE_NT_SIGNATURE ||
      headers->FileHeader.Machine != IMAGE_FILE_MACHINE_I386 ||
      headers->OptionalHeader.Magic != IMAGE_NT_OPTIONAL_HDR32_MAGIC ||
      headers->FileHeader.SizeOfOptionalHeader < sizeof (IMAGE_OPTIONAL_HEADER32) ||
      headers->OptionalHeader.SizeOfImage < headers->OptionalHeader.SizeOfHeaders ||
      headers->OptionalHeader.SizeOfImage > 0x20000000 ||
      headers->FileHeader.NumberOfSections == 0)
    return false;

  IMAGE_SECTION_HEADER* sections = IMAGE_FIRST_SECTION (headers);
  const size_t section_offset = reinterpret_cast <uint8_t*> (sections) - base;
  const size_t section_bytes = sizeof *sections * headers->FileHeader.NumberOfSections;
  if (section_offset > headers->OptionalHeader.SizeOfHeaders ||
      section_bytes > headers->OptionalHeader.SizeOfHeaders - section_offset ||
      ! IsReadable (sections, section_bytes))
    return false;

  image.base     = base;
  image.headers  = headers;
  image.sections = sections;
  image.size     = headers->OptionalHeader.SizeOfImage;
  return true;
}

inline bool
GetExecutableImage (ExecutableImage& image)
{
  return GetImage (GetModuleHandle (nullptr), image);
}

inline bool
IsWritableImageAddress (const void* address, size_t length)
{
  ExecutableImage image;
  if (! GetExecutableImage (image) || ! IsWritable (address, length))
    return false;

  const uintptr_t pointer = reinterpret_cast <uintptr_t> (address);
  const uintptr_t base = reinterpret_cast <uintptr_t> (image.base);
  if (pointer < base || pointer - base >= image.size ||
      length > image.size - (pointer - base))
    return false;

  const size_t rva = pointer - base;
  for (unsigned int index = 0; index < image.headers->FileHeader.NumberOfSections; ++index)
  {
    const IMAGE_SECTION_HEADER& section = image.sections [index];
    const size_t size = section.Misc.VirtualSize;
    if ((section.Characteristics & IMAGE_SCN_MEM_WRITE) &&
        rva >= section.VirtualAddress && rva - section.VirtualAddress < size &&
        length <= size - (rva - section.VirtualAddress))
      return true;
  }

  return false;
}

inline SignatureMatch
FindUniqueExecutableSignature (const uint8_t* bytes, const char* mask, size_t length)
{
  SignatureMatch result = { nullptr, 0 };
  ExecutableImage image;
  if (! GetExecutableImage (image) || bytes == nullptr || length == 0)
    return result;

  for (unsigned int index = 0; index < image.headers->FileHeader.NumberOfSections; ++index)
  {
    const IMAGE_SECTION_HEADER& section = image.sections [index];
    const size_t rva = section.VirtualAddress;
    const size_t size = section.Misc.VirtualSize;
    if (! (section.Characteristics & IMAGE_SCN_MEM_EXECUTE) ||
        rva >= image.size || size > image.size - rva ||
        length > size || ! IsReadable (image.base + rva, size))
      continue;

    const SignatureMatch match = ScanSignature (image.base + rva, size, bytes, mask, length);
    if (match.count != 0)
    {
      result.address = result.count == 0 ? match.address : nullptr;
      result.count += match.count;
      if (result.count != 1)
        result.address = nullptr;
    }
  }

  return result;
}

} }

#endif
