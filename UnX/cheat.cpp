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

#define _CRT_SECURE_NO_WARNINGS

#include "config.h"
#include "cheat.h"
#include "window.h"
#include "hook.h"
#include "log.h"
#include "game_memory.h"
#include "game_signatures.h"

#include <Windows.h>
#include <cstdint>
#include <atomic>
#include <float.h>
#include <vector>

extern wchar_t* UNX_GetExecutableName (void);
       void     UNX_SetSensor         (bool state);

unx_gametype_t game_type = GAME_INVALID;


struct unx_ffx2_memory_s {
  struct debug_s {
    struct {
      uint8_t allies;           // 0x9F78B8
      uint8_t enemies;          // 0x9F78B9
    } invincible;

    uint8_t unknown [4];        // 0x9F78BA

    struct {
      uint8_t enemies;          // 0x9F78BE
      uint8_t monsters;         // 0x9F78BF
    } control;

    uint8_t unknown1 [5];       // 0x9F78C0

    uint8_t mp_zero;            // 0x9F78C5
    uint8_t unknown2 [5];       // 0x9F78C6

    uint8_t debug_output;       // 0x9F78CB

    struct {
      uint8_t always_critical;  // 0x9F78CC
      uint8_t critical;         // 0x9F78CD
      uint8_t probability_100;  // 0x9F78CE
      uint8_t unknown3 [2];     // 0x9F78CF
      uint8_t damage_random;    // 0x9F78D1
      uint8_t damage_1;         // 0x9F78D2
      uint8_t damage_9999;      // 0x9F78D3
      uint8_t damage_99999;     // 0x9F78D4
    } damage;

    struct {
      uint8_t always_drop_rare; // 0x9F78D5
      uint8_t exp_100x;         // 0x9F78D6
      uint8_t gil_100x;         // 0x9F78D7
    } reward;

    uint8_t unknown4;           // 0x9F78D8

    uint8_t always_oversoul;    // 0x9F78D9

    uint8_t unknown5 [10];      // 0x9F78DA

    uint8_t first_attack;       // 0x9F78E4 (0xFF = OFF)
  } *debug_flags = nullptr;

  struct party_s {
    uint32_t unknown0;

    struct {
      uint32_t HP;
      uint32_t MP;
      uint8_t  strength;
      uint8_t  defense;
      uint8_t  magic;
      uint8_t  magic_defense;
      uint8_t  agility;
      uint8_t  accurcy;
      uint8_t  evasion;
      uint8_t  luck;
    } modifiers;

    struct {
      uint32_t current;
      uint32_t next_level;
    } exp;

    struct {
      struct {
        uint32_t HP;
        uint32_t MP;
      } current;

      struct {
        uint32_t HP;
        uint32_t MP;
      } max;
    } vitals;

    uint8_t unknown1;

    struct {
      uint8_t strength;
      uint8_t defense;
      uint8_t magic;
      uint8_t magic_defense;
      uint8_t agility;
      uint8_t accuracy;
      uint8_t evasion;
      uint8_t luck;
    } attributes;

    uint32_t unknown_blob [18];
  } *party = nullptr;
} ffx2;



struct unx_ffx_memory_s {
  struct {
    enum offset_t {
      PartyBase  = 0x0D32060,
      InBattle   = 0x1F10EA0,
      GainedAp   = 0x1F10EC4,
      Debug      = 0x0D2A8F8,
      BattleTrio = 0x0F3F7A4
    };
  } offsets;

  struct {
    enum character_t {
      Tidus   = 0,
      Yuna    = 1,
      Auron   = 2,
      Kimahri = 3,
      Wakka   = 4,
      Lulu    = 5,
      Rikku   = 6,
      Seymour = 7
    };
  } characters;


  struct debug_s {
    struct {
      uint8_t enemies;                  // 0D2A8F8
      uint8_t party;                    // 0D2A8F9
    } invincible;

    struct {
      uint8_t enemies;                  // 0D2A8FA
      uint8_t unk3;                     // 0D2A8FB
      uint8_t camera;                   // 0D2A8FC
    } control;

    uint8_t unk4;                       // 0D2A8FD
    uint8_t unk5;                       // 0D2A8FE
    uint8_t unk6;                       // 0D2A8FF
    uint8_t unk7;                       // 0D2A900
    uint8_t unk8;                       // 0D2A901
    uint8_t unk9;                       // 0D2A902
    uint8_t unk10;                      // 0D2A903
    uint8_t unk11;                      // 0D2A904
    uint8_t unk12;                      // 0D2A905
    uint8_t unk13;                      // 0D2A906
    uint8_t unk14;                      // 0D2A907
    uint8_t unk15;                      // 0D2A908
    uint8_t unk16;                      // 0D2A909
    uint8_t unk17;                      // 0D2A90A
    uint8_t unk18;                      // 0D2A90B

    struct {
      uint8_t always_overdrive;         // 0D2A90C
      uint8_t always_critical;          // 0D2A90D
      uint8_t always_deal_1;            // 0D2A90E
      uint8_t always_deal_10000;        // 0D2A90F
      uint8_t always_deal_99999;        // 0D2A910
    } damage;

    struct {
      uint8_t always_rare_drop;         // 0D2A911
      uint8_t ap_100x;                  // 0D2A912
      uint8_t gil_100x;                 // 0D2A913
    } reward;

    uint8_t unk27;                      // 0D2A914
    uint8_t permanent_sensor;           // 0D2A915
    uint8_t unk28;                      // 0D2A916
    uint8_t unk29;                      // 0D2A917
  } *debug_flags = nullptr;

  struct party_s {
    struct {
      uint32_t HP;
      uint32_t MP;
      uint8_t  strength;
      uint8_t  defense;
      uint8_t  magic;
      uint8_t  magic_defense;
      uint8_t  agility;
      uint8_t  luck;
      uint8_t  evasion;
      uint8_t  accuracy;
    } base;

    struct {
      uint32_t total;
      uint32_t current;
    } AP;

    struct {
      struct {
        uint32_t HP;
        uint32_t MP;
      } current;

      struct {
        uint32_t HP;
        uint32_t MP;
      } max;
    } vitals;

    uint8_t  in_party;

    struct {
      uint8_t  weapon;
      uint8_t  armor;
    } equipment;

    struct {
      uint8_t  strength;
      uint8_t  defense;
      uint8_t  magic;
      uint8_t  magic_defense;
      uint8_t  agility;
      uint8_t  luck;
      uint8_t  evasion;
      uint8_t  accuracy;
    } current;

    uint8_t  unknown2;

    struct {
      uint8_t  mode;
      uint8_t  level;
      uint8_t  max;
    } overdrive;

    struct {
      uint8_t  banked;
      uint8_t  total;
    } sphere_level;

    uint8_t  unknown3;

    uint32_t skill_flags;

    struct {
      uint32_t battles;
      uint32_t kills;
    } record;

    uint8_t  unknown_blob [76];
  } *party = nullptr;

  struct battle_s {
    uint8_t  participation;
  } *battle = nullptr;

  struct battle_trio_s {
    uint32_t hp0;
    uint32_t hp1;
    uint8_t  unknown [136];
  } *trio = nullptr;

  struct ap_s {
    uint8_t  earn;
  } *ap = nullptr;
} ffx;

struct {
  DWORD sensor   = 0;
  DWORD party_ap = 0;
  DWORD speed    = 0;
} last_changed;


#include <windows.h>
#include <tlhelp32.h>
#include <queue>

std::queue <DWORD>
UNX_SuspendAllOtherThreads (void)
{
  std::queue <DWORD> threads;

  HANDLE hSnap =
    CreateToolhelp32Snapshot (TH32CS_SNAPTHREAD, 0);

  if (hSnap != INVALID_HANDLE_VALUE)
  {
    THREADENTRY32 tent;
    tent.dwSize = sizeof THREADENTRY32;

    if (Thread32First (hSnap, &tent))
    {
      do
      {
        if ( tent.dwSize >= FIELD_OFFSET (THREADENTRY32, th32OwnerProcessID) +
                                  sizeof (tent.th32OwnerProcessID) )
        {
          if ( tent.th32ThreadID       != GetCurrentThreadId  () &&
               tent.th32OwnerProcessID == GetCurrentProcessId () )
          {
            HANDLE hThread =
              OpenThread (THREAD_ALL_ACCESS, FALSE, tent.th32ThreadID);

            if (hThread != nullptr)
            {
              if (SuspendThread (hThread) != static_cast <DWORD> (-1))
                threads.push (tent.th32ThreadID);
              CloseHandle   (hThread);
            }
          }
        }

        tent.dwSize = sizeof (tent);
      } while (Thread32Next (hSnap, &tent));
    }

    CloseHandle (hSnap);
  }

  return threads;
}

void
UNX_ResumeThreads (std::queue <DWORD> threads)
{
  while (! threads.empty ())
  {
    DWORD tid = threads.front ();

    HANDLE hThread =
      OpenThread (THREAD_ALL_ACCESS, FALSE, tid);

    if (hThread != nullptr)
    {
      ResumeThread (hThread);
      CloseHandle  (hThread);
    }

    threads.pop ();
  }
}


#include "log.h"
std::atomic <float> __UNX_speed_mod (1.0f);
std::atomic <bool>  __UNX_skip_cutscenes (false);

extern LPVOID __UNX_base_img_addr;

using FFX_GameTick_pfn          = void (__cdecl *)(float);
      FFX_GameTick_pfn
      UNX_FFX_GameTick_Original = nullptr;

void __cdecl UNX_FFX_GameTick (float fSpeed);

namespace {

SRWLOCK speed_lock = SRWLOCK_INIT;

struct speed_lock_guard {
  speed_lock_guard  () { AcquireSRWLockExclusive (&speed_lock); }
  ~speed_lock_guard () { ReleaseSRWLockExclusive (&speed_lock); }
};

struct ffx_speed_targets_s {
  uint8_t* tick = nullptr;
  uint8_t* audio = nullptr;
  uint8_t  audio_original [3] = { };
  bool     hook_created = false;
  bool     hook_enabled = false;
} speed_targets;

using FFX_Menu_pfn = int (__cdecl *)(int);
struct {
  FFX_Menu_pfn menu = nullptr;
  uint8_t* timestop = nullptr;
  uint8_t* kill_branch = nullptr;
  uint8_t* ffx2_death = nullptr;
} cheat_targets;

using namespace unx::game_signatures;
const uint8_t skip_audio [] = { 0xc2, 0x08, 0x00 };

// Keep thread handles until they are resumed. Do all vector allocation before
// suspending anything: a stopped thread could otherwise own the CRT heap lock.
class audio_thread_pause {
  struct thread_s { HANDLE handle; bool suspended; };
  std::vector <thread_s> threads;

public:
  bool safe = false;

  explicit audio_thread_pause (const uint8_t* patch)
  {
    HANDLE snapshot = CreateToolhelp32Snapshot (TH32CS_SNAPTHREAD, 0);
    if (snapshot == INVALID_HANDLE_VALUE)
      return;

    THREADENTRY32 entry = { };
    entry.dwSize = sizeof entry;
    bool complete = Thread32First (snapshot, &entry) != FALSE;
    if (complete) do {
      if (entry.th32OwnerProcessID == GetCurrentProcessId () &&
          entry.th32ThreadID != GetCurrentThreadId ())
      {
        HANDLE thread = OpenThread (THREAD_SUSPEND_RESUME | THREAD_GET_CONTEXT |
                                    THREAD_QUERY_INFORMATION, FALSE, entry.th32ThreadID);
        if (thread == nullptr)
        {
          // Threads which exited after the snapshot need no suspension.
          if (GetLastError () != ERROR_INVALID_PARAMETER)
            complete = false;
        }
        else
          threads.push_back ({ thread, false });
      }
      entry.dwSize = sizeof entry;
    } while (Thread32Next (snapshot, &entry));
    if (GetLastError () != ERROR_NO_MORE_FILES)
      complete = false;
    CloseHandle (snapshot);

    if (! complete)
      return;

    for (auto& thread : threads)
    {
      if (SuspendThread (thread.handle) == static_cast <DWORD> (-1))
        return;
      thread.suspended = true;

      CONTEXT context = { };
      context.ContextFlags = CONTEXT_CONTROL;
      if (! GetThreadContext (thread.handle, &context))
        return;

      const uintptr_t instruction = context.Eip;
      const uintptr_t address = reinterpret_cast <uintptr_t> (patch);
      // Never resume a thread in the middle of the replaced instructions.
      if (instruction >= address && instruction < address + sizeof skip_audio)
        return;
    }

    safe = true;
  }

  ~audio_thread_pause ()
  {
    for (auto& thread : threads)
    {
      if (thread.suspended)
        ResumeThread (thread.handle);
      CloseHandle (thread.handle);
    }
  }
};

bool
SetAudioSkip (bool skip)
{
  const bool was_skipped = __UNX_skip_cutscenes.load ();
  if (skip == was_skipped)
    return true;
  if (speed_targets.audio == nullptr)
    return false;

  const uint8_t* expected = was_skipped ? skip_audio : speed_targets.audio_original;
  const uint8_t* replacement = skip ? skip_audio : speed_targets.audio_original;
  bool success = false;
  DWORD failure = ERROR_SUCCESS;
  {
    audio_thread_pause paused (speed_targets.audio);
    if (paused.safe && unx::game_memory::IsReadable (speed_targets.audio, sizeof skip_audio) &&
        memcmp (speed_targets.audio, expected, sizeof skip_audio) == 0)
    {
      DWORD protection = 0;
      if (VirtualProtect (speed_targets.audio, sizeof skip_audio,
                          PAGE_EXECUTE_READWRITE, &protection))
      {
        memcpy (speed_targets.audio, replacement, sizeof skip_audio);
        __UNX_skip_cutscenes.store (skip);
        success = FlushInstructionCache (GetCurrentProcess (), speed_targets.audio,
                                         sizeof skip_audio) != FALSE;
        if (! success)
          failure = GetLastError ();
        DWORD discarded = 0;
        if (! VirtualProtect (speed_targets.audio, sizeof skip_audio, protection, &discarded))
        {
          failure = GetLastError ();
          success = false;
        }
      }
      else
        failure = GetLastError ();
    }
  }

  // Log after resuming threads, since a suspended thread may hold the log lock.
  dll_log->Log (L"[Speed Hack] Audio skip %s: %s (error=%lu)",
                skip ? L"on" : L"off", success ? L"applied" : L"unavailable", failure);
  return success;
}

void
InitSpeedTargets (void)
{
  speed_lock_guard lock;
  using namespace unx::game_memory;
  const SignatureMatch tick =
    FindUniqueExecutableSignature (tick_signature, tick_mask, sizeof tick_signature);
  const SignatureMatch audio =
    FindUniqueExecutableSignature (audio_signature, nullptr, sizeof audio_signature);

  dll_log->Log (L"[Speed Hack] GameTick=%p (matches=%zu), AudioSync=%p (matches=%zu)",
                tick.address, tick.count, audio.address, audio.count);

  // Both signatures start at a verified PUSH EBP / MOV EBP,ESP prologue.
  if (audio.address != nullptr && memcmp (audio.address, audio_signature, 3) == 0)
  {
    speed_targets.audio = audio.address;
    memcpy (speed_targets.audio_original, audio.address, sizeof speed_targets.audio_original);
  }

  if (tick.address != nullptr && memcmp (tick.address, tick_signature, 3) == 0)
  {
    const MH_STATUS status = UNX_CreateFuncHook (L"FFX_GameTick", tick.address,
                 UNX_FFX_GameTick, reinterpret_cast <LPVOID*> (&UNX_FFX_GameTick_Original));
    if (status == MH_OK && UNX_FFX_GameTick_Original != nullptr)
    {
      speed_targets.tick = tick.address;
      speed_targets.hook_created = true;
    }
    else
      dll_log->Log (L"[Speed Hack] GameTick hook creation failed (%d); speed boost disabled", status);
  }
}

template <typename T>
T*
ResolveWritableOperand (const unx::game_memory::SignatureMatch& match,
                        size_t offset, size_t length)
{
  if (match.address == nullptr)
    return nullptr;
  uint32_t address = 0;
  memcpy (&address, match.address + offset, sizeof address);
  T* target = reinterpret_cast <T*> (static_cast <uintptr_t> (address));
  return unx::game_memory::IsWritableImageAddress (target, length) ? target : nullptr;
}

void
InitAdditionalFFXTargets (void)
{
  using namespace unx::game_memory;
  const SignatureMatch menu =
    FindUniqueExecutableSignature (menu_signature, nullptr, sizeof menu_signature);
  const SignatureMatch timestop =
    FindUniqueExecutableSignature (timestop_signature, timestop_mask, sizeof timestop_signature);
  const SignatureMatch kill =
    FindUniqueExecutableSignature (kill_signature, nullptr, sizeof kill_signature);

  cheat_targets.menu = reinterpret_cast <FFX_Menu_pfn> (menu.address);
  cheat_targets.timestop = ResolveWritableOperand <uint8_t> (timestop, 7, 1);
  if (cheat_targets.timestop != nullptr)
  {
    const uint8_t* second = ResolveWritableOperand <uint8_t> (timestop, 23, 1);
    if (second != cheat_targets.timestop + 1)
      cheat_targets.timestop = nullptr;
  }
  cheat_targets.kill_branch = kill.address;
  dll_log->Log (L"[Cheat Code] Menu=%p, TimeStop=%p, KillBranch=%p",
                menu.address, cheat_targets.timestop, kill.address);
}

void
InitFFX2Targets (void)
{
  using namespace unx::game_memory;
  const SignatureMatch debug = FindUniqueExecutableSignature (
    ffx2_debug_signature, ffx2_debug_mask, sizeof ffx2_debug_signature);
  const SignatureMatch party = FindUniqueExecutableSignature (
    ffx2_party_signature, ffx2_party_mask, sizeof ffx2_party_signature);
  const SignatureMatch death = FindUniqueExecutableSignature (
    ffx2_death_signature, ffx2_death_mask, sizeof ffx2_death_signature);

  ffx2.debug_flags = ResolveWritableOperand <unx_ffx2_memory_s::debug_s> (
    debug, 2, sizeof *ffx2.debug_flags);
  ffx2.party = ResolveWritableOperand <unx_ffx2_memory_s::party_s> (
    party, 5, sizeof *ffx2.party * 8);
  cheat_targets.ffx2_death = ResolveWritableOperand <uint8_t> (death, 2, sizeof (uint32_t));
  dll_log->Log (L"[Cheat Code] FFX-2 Debug=%p, Party=%p, Death=%p",
                ffx2.debug_flags, ffx2.party, cheat_targets.ffx2_death);
}

bool
SetKillBranch (bool bypass)
{
  uint8_t* branch = cheat_targets.kill_branch;
  if (branch == nullptr || ! unx::game_memory::IsReadable (branch, sizeof kill_signature))
    return false;

  const uint8_t expected = bypass ? 0x7e : 0xeb;
  const uint8_t replacement = bypass ? 0xeb : 0x7e;
  // Only the one-byte condition changes; instruction boundaries and its short
  // displacement remain intact. Refuse to overwrite a third-party patch.
  if (*branch != expected || memcmp (branch + 1, kill_signature + 1, sizeof kill_signature - 1) != 0)
    return false;

  DWORD protection = 0;
  if (! VirtualProtect (branch, 1, PAGE_EXECUTE_READWRITE, &protection))
    return false;
  *branch = replacement;
  const bool flushed = FlushInstructionCache (GetCurrentProcess (), branch, 1) != FALSE;
  DWORD discarded = 0;
  const bool restored = VirtualProtect (branch, 1, protection, &discarded) != FALSE;
  return flushed && restored;
}

void
ApplySpeed (float speed)
{
  const bool enable = speed != 1.0f;
  if (enable != speed_targets.hook_enabled)
  {
    if (! enable)
      __UNX_speed_mod.store (1.0f);
    const MH_STATUS status = enable ? UNX_EnableHook (speed_targets.tick) :
                                     UNX_DisableHook (speed_targets.tick);
    if (status == MH_OK || (enable && status == MH_ERROR_ENABLED) ||
                          (! enable && status == MH_ERROR_DISABLED))
      speed_targets.hook_enabled = enable;
    else
    {
      dll_log->Log (L"[Speed Hack] GameTick %s failed (%d)", enable ? L"enable" : L"disable", status);
      speed = 1.0f;
    }
  }

  __UNX_speed_mod.store (speed);
  const float threshold = config.cheat.ffx.skip_dialog;
  SetAudioSkip (! config.cheat.ffx.disable_timing_hacks && _finite (threshold) && speed >= threshold);
  last_changed.speed = timeGetTime ();
  dll_log->Log (L"[Speed Hack] Speed=%.1fx, hook=%s, audio-skip=%s", speed,
                speed_targets.hook_enabled ? L"on" : L"off",
                __UNX_skip_cutscenes.load () ? L"on" : L"off");
}

} // namespace

void
UNX_SpeedStep (void)
{
  speed_lock_guard lock;
  if (game_type != GAME_FFX || ! speed_targets.hook_created)
    return;

  float speed = 1.0f;
  const float limit = config.cheat.ffx.max_speed;
  const float step = config.cheat.ffx.speed_step;
  const float current = __UNX_speed_mod.load ();
  if (! config.cheat.ffx.disable_timing_hacks &&
      _finite (limit) && limit > 1.0f && _finite (step) && step > 1.0f && current < limit)
  {
    const double next = static_cast <double> (current) * step;
    speed = next < limit ? static_cast <float> (next) : limit;
  }
  ApplySpeed (speed);
}

void
UNX_UpdateSpeedLimit (void)
{
  speed_lock_guard lock;
  if (game_type != GAME_FFX || ! speed_targets.hook_created)
    return;

  const float limit = config.cheat.ffx.max_speed;
  float speed = __UNX_speed_mod.load ();
  if (config.cheat.ffx.disable_timing_hacks || ! _finite (limit) || limit < 1.0f)
    speed = 1.0f;
  else if (speed > limit)
    speed = limit;
  ApplySpeed (speed);
}

void
__cdecl
UNX_FFX_GameTick (float fSpeed)
{
  if (UNX_FFX_GameTick_Original != nullptr)
    UNX_FFX_GameTick_Original (fSpeed * __UNX_speed_mod.load ());
}

#if 0
LPVOID FFX_LoadLevel_Original = nullptr;

__declspec (naked)
void
UNX_LoadLevel (char* szName)
{
  __asm { pushad
          pushfd
  }

  dll_log->Log ( L"[ FFXLevel ] FFX_LoadLevel (%hs)",
                   szName );

  __asm { popfd
          popad
          jmp FFX_LoadLevel_Original }
}
#endif

void
unx::CheatManager::Init (void)
{
  wchar_t* pwszShortName =
    UNX_GetExecutableName ();

  //
  // FFX
  //
  if (! _wcsicmp (pwszShortName, L"ffx.exe"))
  {
    dll_log->LogEx (true, L"[Cheat Code]  Setting up FFX Cheat Engine...");

    game_type = GAME_FFX;

    ffx.debug_flags =
      (unx_ffx_memory_s::debug_s *)
        ((intptr_t)__UNX_base_img_addr + ffx.offsets.Debug);

    ffx.party =
      (unx_ffx_memory_s::party_s *)
        ((intptr_t)__UNX_base_img_addr + ffx.offsets.PartyBase);

    ffx.battle =
      (unx_ffx_memory_s::battle_s *)
        ((intptr_t)__UNX_base_img_addr + ffx.offsets.InBattle);

    ffx.trio =
      (unx_ffx_memory_s::battle_trio_s *)
        ((intptr_t)__UNX_base_img_addr + ffx.offsets.BattleTrio);

    ffx.ap =
      (unx_ffx_memory_s::ap_s *)
        ((intptr_t)__UNX_base_img_addr + ffx.offsets.GainedAp);

    using unx::game_memory::IsWritableImageAddress;
    if (! IsWritableImageAddress (ffx.debug_flags, sizeof *ffx.debug_flags))
      ffx.debug_flags = nullptr;
    if (! IsWritableImageAddress (ffx.party, sizeof *ffx.party * 8))
      ffx.party = nullptr;
    if (! IsWritableImageAddress (ffx.battle, sizeof *ffx.battle * 8))
      ffx.battle = nullptr;
    if (! IsWritableImageAddress (ffx.trio, sizeof *ffx.trio * 3))
      ffx.trio = nullptr;
    if (! IsWritableImageAddress (ffx.ap, sizeof *ffx.ap * 8))
      ffx.ap = nullptr;
    if (ffx.debug_flags == nullptr || ffx.party == nullptr ||
        ffx.battle == nullptr || ffx.ap == nullptr)
      dll_log->Log (L"[Cheat Code] Invalid FFX data range; affected cheats disabled");

    InitSpeedTargets ();
    InitAdditionalFFXTargets ();

#if 0
    UNX_CreateFuncHook ( L"FFX_LoadLevel",
        (LPVOID)((intptr_t)__UNX_base_img_addr + 0x241F60),
                             UNX_LoadLevel,
                  (LPVOID *)&FFX_LoadLevel_Original);
    UNX_EnableHook ((LPVOID)((intptr_t)__UNX_base_img_addr + 0x241F60));
#endif

    UNX_SetSensor (config.cheat.ffx.permanent_sensor);

    SetTimer (unx::window.hwnd, CHEAT_TIMER_FFX, 33, nullptr);

    dll_log->LogEx (false, L" done!\n");
  }

  //
  // FFX-2
  //
  else if (! _wcsicmp (pwszShortName, L"ffx-2.exe"))
  {
    dll_log->LogEx (true, L"[Cheat Code]  Setting up FFX-2 Cheat Engine...");

    game_type = GAME_FFX2;

    InitFFX2Targets ();

    if (ffx2.debug_flags != nullptr)
      ffx2.debug_flags->debug_output = true;

    SetTimer (unx::window.hwnd, CHEAT_TIMER_FFX2, 33, nullptr);

    dll_log->LogEx (false, L" done!\n");
  }
}

void
unx::CheatManager::Shutdown (void)
{
}


void
UNX_SetPartyAP (bool state)
{
  last_changed.party_ap = timeGetTime ();

  config.cheat.ffx.entire_party_earns_ap = state;
}

void
UNX_TogglePartyAP (void)
{
  last_changed.party_ap = timeGetTime ();

  config.cheat.ffx.entire_party_earns_ap = (! config.cheat.ffx.entire_party_earns_ap);
}

void
UNX_ToggleFreeLook (void)
{
  if (game_type != GAME_FFX || ffx.debug_flags == nullptr)
    return;

  ffx.debug_flags->control.camera =
    (! ffx.debug_flags->control.camera);
}

void
UNX_SetSensor (bool state)
{
  if (config.cheat.ffx.permanent_sensor != state)
    last_changed.sensor = timeGetTime ();

  config.cheat.ffx.permanent_sensor = state;

  if (game_type == GAME_FFX && ffx.debug_flags != nullptr)
    ffx.debug_flags->permanent_sensor =
      (uint8_t)config.cheat.ffx.permanent_sensor;
}

void
UNX_ToggleSensor (void)
{
  if (game_type != GAME_FFX)
    return;

  UNX_SetSensor (! config.cheat.ffx.permanent_sensor);
}

void
UNX_TimeStop (void)
{
  if (game_type != GAME_FFX || cheat_targets.timestop == nullptr)
    return;

  if (unx::game_memory::IsWritableImageAddress (cheat_targets.timestop, 1))
    *cheat_targets.timestop = ! *cheat_targets.timestop;
}
// Quick Load
void
UNX_Quickie (void)
{
  if (game_type != GAME_FFX || cheat_targets.menu == nullptr)
    return;

  cheat_targets.menu (0x6);

  extern volatile ULONG schedule_load;
  InterlockedExchange (&schedule_load, TRUE);
}

bool
UNX_IsInBattle (void)
{
  if (game_type != GAME_FFX || ffx.party == nullptr || ffx.battle == nullptr)
    return false;

  for (int i = 0; i < 7; i++) {
    uint8_t state = ffx.party [i].in_party;

    if (state != 0x00 && state != 0x10) {
      if (ffx.battle [i].participation == 1)
        return true;
    }
  }

  return false;
}

bool
UNX_KillMeNow (void)
{
  switch (game_type)
  {
    case GAME_FFX:
    {
      if (UNX_IsInBattle ())
      {
        if (! SetKillBranch (true))
          return false;

        for (int i = 0; i < 8; i++) {
          ffx.party [i].vitals.current.HP = 0UL;
        }

        // Spawn thread to restore original instructions
        HANDLE restore_thread = CreateThread (nullptr, 0,
          [](LPVOID) ->
            DWORD
              {
                Sleep (5000UL);
                if (! SetKillBranch (false))
                  dll_log->Log (L"[Cheat Code] Could not restore the kill branch");
                return 0;
              },
            nullptr,
          0x00,
        nullptr );
        if (restore_thread == nullptr)
        {
          SetKillBranch (false);
          return false;
        }
        CloseHandle (restore_thread);

        return true;
      }

      extern volatile ULONG queue_death;
      InterlockedExchange (&queue_death, TRUE);
    } break;

    case GAME_FFX2:
    {
      if (ffx2.party == nullptr || cheat_targets.ffx2_death == nullptr)
        return false;
      for (int i = 0; i < 8; i++) {
        ffx2.party [i].vitals.current.HP = 0UL;
      }

      *cheat_targets.ffx2_death = 1;
      Sleep (33);
      *cheat_targets.ffx2_death = 0;
      Sleep (0);
    } break;
  }

  return true;
}

void
unx::CheatTimer_FFX (void)
{
  if (game_type != GAME_FFX)
    return;

  if (config.cheat.ffx.permanent_sensor)
    UNX_SetSensor (config.cheat.ffx.permanent_sensor);

  if (ffx.party == nullptr)
    return;

  if (config.cheat.ffx.playable_seymour) {
    ffx.party [ffx.characters.Seymour].in_party = 0x11;
  } else {
    ffx.party [ffx.characters.Seymour].in_party = 0x10;
  }

  if (config.cheat.ffx.entire_party_earns_ap && ffx.ap != nullptr && UNX_IsInBattle ()) {
      for (int i = 0; i < 7; i++) {
        uint8_t state = ffx.party [i].in_party;

        if (state != 0x00 && state != 0x10) {
          if (ffx.battle [i].participation != 1)
            ffx.battle [i].participation = 2;
        } else {
          ffx.battle [i].participation = 0;
        }
      }

      for (int i = 0; i < 7; i++) {
        uint8_t state = ffx.party [i].in_party;

        if (state != 0x00 && state != 0x10)
          ffx.ap [i].earn = 1;
        else
          ffx.ap [i].earn = 0;
      }

  }
}

void
unx::CheatTimer_FFX2 (void)
{
  if (game_type != GAME_FFX2 || ffx2.party == nullptr)
    return;
}

void
UNX_FFX2_UnitTest (void)
{
  if (game_type != GAME_FFX2 || ffx2.party == nullptr)
    return;

  //ffx2.party->exp.current != 0;
  //ffx2.party->vitals.current.HP <= ffx2.party_stats->vitals.max.HP;
  for (int i = 0; i < 3; i++) {
    dll_log->Log ( L"[UnitTest] %lu / %lu HP :: %lu / %lu MP",
                     ffx2.party [i].vitals.current.HP,
                     ffx2.party [i].vitals.max.HP,
                       ffx2.party [i].vitals.current.MP,
                       ffx2.party [i].vitals.max.MP );
  }
}


std::string
UNX_SummarizeCheats (DWORD dwTime)
{
  std::string summary = "";

  const DWORD status_duration = 2500UL;

  switch (game_type)
  {
    case GAME_FFX:
    {
      if (last_changed.party_ap > dwTime - status_duration)
      {
        summary += "Full Party AP:    ";
        summary += config.cheat.ffx.entire_party_earns_ap ?
                     "ON\n" : "OFF\n";
      }

      if (last_changed.sensor > dwTime - status_duration)
      {
        summary += "Permanent Sensor: ";
        summary += config.cheat.ffx.permanent_sensor ?
                     "ON\n" : "OFF\n";
      }

      if (last_changed.speed > dwTime - (status_duration * 2) && (! config.cheat.ffx.disable_timing_hacks))
      {
        char szGameSpeed [128] = { };

        sprintf ( szGameSpeed, "Game Speed:       %4.1fx\n",
                    __UNX_speed_mod.load () );
        summary += szGameSpeed;
      }

      const bool free_look = ffx.debug_flags != nullptr && ffx.debug_flags->control.camera;
      const bool timestop = cheat_targets.timestop != nullptr && *cheat_targets.timestop;
      const bool skip_cutscenes = __UNX_skip_cutscenes.load ();

      if (free_look || timestop || skip_cutscenes)
      {
        summary += "SPECIAL MODE:     ";

        if (free_look)
          summary += "(Free Look) ";

        if (timestop)
          summary += "(Timestop) ";

        if (skip_cutscenes)
          summary += "(Cutscene Skip) ";

        summary += "\n";
      }
    } break;

    default:
      break;
  }

  return summary;
}
