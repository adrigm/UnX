# Steam 2026 and SteamOS compatibility

Version: **0.10.0**. The Win32 plugin uses the legacy Special K **0.8.60.2**
runtime, Steam app **359870**, build **25501027**, on Windows or under Steam
Proton. The accompanying manager is **1.0.1**.

## SteamOS startup fix

SteamOS testing reproduced an FFX startup crash with the legacy texture cache
enabled. The same installation started successfully with `Cache=false` and
`Inject=true`, including after repair and reinstallation. The user confirmed
that the successful sessions ended by manual closure. This establishes the
working configuration for that environment; it does not prove the underlying
texture-resource lifetime failure has been fixed inside Special K.

UnX 0.10.0 detects Wine/Proton at runtime through `wine_get_version` in
`ntdll.dll` and forces only the legacy texture cache off before passing its
value to Special K. It also persists `UnX.Textures/Cache=false` under Wine.
Texture injection and the other texture options retain their requested values.
Native Windows continues to use its configured cache value. Manager 1.0.1
applies the matching Linux compatibility setting when writing configuration.

The plugin no longer starts the legacy Special K upstream updater. The manager
also disables its automatic update frequency, preventing an offer to replace
this fork with an older upstream distribution. The bundled `dxgi.dll` remains
the pinned legacy runtime; no replacement runtime is downloaded.

See [release notes and the validation matrix](docs/RELEASE-0.10.0.md).

## Speed crash

The previous FFX hook used RVA `0x420C00`. In the updated executable this address
is inside a ten-byte `MOV` beginning at `0x420BFB`. Enabling the hook overwrote
part of that instruction and caused the access violation reported at
`FFX.exe+0x420BFB`. The audio-skip patch also pointed to a displaced function.

| Target | Earlier executable RVA | Build 25501027 RVA |
| --- | --- | --- |
| Game tick | `0x420C00` | `0x420AE0` |
| Audio synchronization | `0x30AEC0` | `0x30ADD0` |
| Menu | `0x3C8650` | `0x3C86E0` |
| Time-stop setter | `0x421B40` | `0x421A20` |
| Battle death branch | `0x392930` | `0x392910` |
| Load mode | `0x421870` | `0x421750` |
| Load flag setter | `0x248890` | `0x2486E0` |

The implementation resolves code by unique signatures in executable PE
sections. Missing or ambiguous signatures leave the affected feature disabled.
FFX-2 debug, party, and death globals are obtained from instruction operands
and validated inside writable game-image memory. FFX data ranges that remained
unchanged in this update are also checked before use.

Speed changes check MinHook results, share the multiplier atomically, and apply
the three-byte audio patch only when its state changes. The audio patch verifies
the original bytes, retains suspended thread handles, checks instruction
pointers, restores page permissions, and flushes the instruction cache.

## Controller warning

The legacy runtime queues an ImGui warning when it detects recursive XInput
haptic feedback. UnX filters this exact message from Special K:

> Problematic XInput software detected (infinite haptic feedback loop), please restart the Steam client.

The filter locates the internal warning function through its unique read-only
message, executable call sites that agree on the target, and a verified function
prologue. Only the exact text from callers inside the injector is discarded;
other warnings use the original queue. The existing haptic recursion guard,
controller hooks, and rumble settings remain active.

## Earlier Windows validation

The following validation was performed on 2026-10-23 for the preceding
0.9.2.1 build. These results explain the retained compatibility work; they are
not a claim of interactive Windows gameplay testing of the new 0.10.0 DLL:

- Release Win32 compilation with MSVC 14.51, toolset v145, and Windows SDK 10.
- Imported Special K/ImGui symbols checked against the installed legacy runtime.
- C++ scanner and Windows memory-protection tests compiled with `/W4 /WX`.
- Ten actual source signatures checked for relocation, movement, ambiguity,
  truncation, and changed fixed bytes.
- All applicable signatures matched exactly once in both current executables
  and the locally available earlier FFX/FFX-2 executables.
- Interactive FFX gameplay testing confirmed repeated x1/x2/x4/x8/x1 cycles
  without a crash. Logs confirmed successful hook and audio-patch transitions.
- Selective warning-filter checks cover the exact message, other warnings,
  partial and extended messages, null text, and callers outside Special K.
- The final DLL loaded its warning hook successfully (`status=0`). Connecting
  the controller reached the selective filter; interactive testing confirmed
  that the popup was absent and the controller continued to work. The same
  final build was also checked in memory at x8: its multiplier was `8.0`, the
  resolved tick hook was active, and the resolved audio entry contained the
  intended three-byte skip instruction.

FFX-2 gameplay and every individual cheat have not been exhaustively tested.
These checks establish compatibility with the examined executables; later game
updates still need validation. The test scripts read local game files without
executing or modifying them. Game binaries, saves, and machine-specific logs
are not included in this repository or its release package.
