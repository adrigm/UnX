# Building UnX on Windows

Install Visual Studio with the Desktop development with C++ workload, the
MSVC x86/x64 compiler, ATL, and a Windows 10/11 SDK. Visual Studio 2022 and
2026 toolsets are supported by the build script. The output is a Win32 DLL,
even on a 64-bit system.

Run from PowerShell, providing the legacy Special K `dxgi.dll` installed with
UnX. This is not the Windows system DLL or a current Special K release.

```powershell
.\scripts\build.ps1 -SpecialKDll 'J:\SteamLibrary\steamapps\common\FINAL FANTASY FFX&FFX-2 HD Remaster\dxgi.dll'
```

The script detects Visual Studio, selects its installed platform toolset,
generates a private import library from that DLL's exports, builds UnX, and
checks that the imported C++ symbols are present in that Special K binary.
It does not execute the supplied DLL and does not modify the game folder.
The ImGui 1.50 headers are included under `third_party/` with their license
and pinned upstream source revision.

The results are `artifacts/Win32/Release/unx.dll`, `unx.pdb`, and `unx.map`.
Keep the PDB and map with the DLL for crash analysis. `-Configuration Debug` and
`-PlatformToolset v143` can override the defaults. Build outputs and the
generated import library are ignored by Git.

To build inside Visual Studio, run the script once to create
`artifacts/deps/dxgi.lib`, open `UnX.sln`, choose x86, and select an installed
platform toolset in the project settings. The project defaults to v143;
the script automatically selects v145 on Visual Studio 2026.

The compiled plugin still requires the legacy Special K runtime. A successful
build and import check do not verify in-game behavior; that requires testing
the resulting DLL with the installed game.

## Tests

Run the scanner, PE validation, and memory access tests from PowerShell:

```powershell
.\scripts\test.ps1
```

The script uses the installed Visual Studio x86 compiler and Python 3.10 or
newer. It writes test executables under `artifacts/tests/`. The Python check
reads the signatures directly from the C++ sources and verifies synthetic
cases with moved code, changed relocation operands, duplicate matches, and
truncated instructions.

To also check every signature against the installed game and any local
`*_LAUnaware.bak` backups:

```powershell
.\scripts\test.ps1 -GameDirectory 'J:\SteamLibrary\steamapps\common\FINAL FANTASY FFX&FFX-2 HD Remaster'
```

This reads the PE executable sections and reports signature counts, RVAs, and
file hashes. It does not launch or modify any game files. A unique signature
and passing unit tests still require an in-game test of speed changes and
the affected hotkeys.
