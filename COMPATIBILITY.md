# Steam 2026 compatibility

Version: 0.9.2.1. Target: Windows Win32 UnX with the legacy Special K 0.8.60.2
runtime, Steam app 359870, build 25501027.

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

## Validation

Validation performed on 2026-10-23:

- Release Win32 compilation with MSVC 14.51, toolset v145, and Windows SDK 10.
- Imported Special K/ImGui symbols checked against the installed legacy runtime.
- C++ scanner and Windows memory-protection tests compiled with `/W4 /WX`.
- Ten actual source signatures checked for relocation, movement, ambiguity,
  truncation, and changed fixed bytes.
- All applicable signatures matched exactly once in both current executables
  and the locally available earlier FFX/FFX-2 executables.
- Interactive FFX gameplay testing confirmed repeated x1/x2/x4/x8/x1 cycles
  without a crash. Logs confirmed successful hook and audio-patch transitions.

FFX-2 gameplay and every individual cheat have not been exhaustively tested.
These checks establish compatibility with the examined executables; later game
updates still need validation. The test scripts read local game files without
executing or modifying them. Game binaries, saves, and machine-specific logs
are not included in this repository or its release package.
