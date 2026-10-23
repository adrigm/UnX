# Offline payload and native packages

The launcher bundles the original UnX runtime and the corrected Win32 plugin.
The installation payload is assembled from the official
[UnX 0.9.1.9 distribution](https://github.com/Kaldaien/UnX/releases/download/unx_091/UnX_0_9_1_9.7z),
the package selected by upstream `version.ini`. Its archive is 13,967,265 bytes
and has SHA256:

```text
33808990207e76fd5a946bf1334563f0c41ba834490f77affce5f5bd1608ec83
```

`launcher/payload-manifest.json` is the reviewed input lock. It pins that URL,
archive size/hash, and all 117 original file sizes/hashes. The preparation
script verifies the archive before invoking 7-Zip, then verifies the complete
extracted inventory. Changing the source archive requires an explicit lock
update. The script never reads an installed game directory.

The runtime payload retains 114 stock files: Special K 0.8.60.2 `dxgi.dll`,
stock `ReShade32.dll`, all four `default_*.ini` files, controller glyphs, title
texture, calibration utility, and the texture-directory marker files. It
excludes the three upstream PDB files and replaces only `unx.dll` with the
corrected plugin. Stock ReShade is retained because `default_dxgi.ini` imports
it. Existing active INI files, user mods, saves, and Steam game executables
never enter the package.

This supports an offline mod installation into an existing Steam game. The
Microsoft runtime prerequisites remain system prerequisites: x86 VC++ v14
(`MSVCP140`, `VCRUNTIME140`, `CONCRT140`, `VCOMP140`, plus UCRT) and the legacy
x86 DirectX components `D3DCOMPILER_43.dll` and `d3dx9_43.dll`. They are absent
from the upstream archive and are not taken from the packaging computer. On
Linux, the game still uses the Win32 plugin and runtime under Steam Proton;
the AppImage is the Linux launcher. Neither package contains the game itself.

## Local preparation

Use Node.js 24, the dependencies locked by `launcher/package-lock.json`, and
Visual Studio C++ desktop tools for compiling the plugin on Windows.

```powershell
cd launcher
npm ci
cd ..
node scripts/prepare-launcher-payload.cjs --extract-only artifacts/launcher-baseline
./scripts/build.ps1 -SpecialKDll ./artifacts/launcher-baseline/dxgi.dll
node scripts/prepare-launcher-payload.cjs --plugin artifacts/Win32/Release/unx.dll
```

The first command needs network access to retrieve the pinned archive unless
it is already cached in `artifacts/launcher-cache/`. To prepare from an offline
copy, add `--baseline-archive /path/to/UnX_0_9_1_9.7z`; its size/hash must still
match. `--output /path/to/directory` overrides the normal `launcher/payload`
output. `--extract-only` produces verified original runtime files for the
compiler and does not create an installation ZIP.

The generated resources are:

- `launcher/payload/payload.zip`: game-relative stock assets and corrected DLL.
- `launcher/payload/manifest.json`: mod version, Steam app ID, ZIP size/hash,
  individual file sizes/hashes, and source/binary provenance.

The ZIP has fixed entry dates and permissions. The script reopens it and
verifies every file before emitting the resources. Both files are ignored by
Git and included by electron-builder through `extraResources`; end users do
not need 7-Zip, Node.js, or network access to install the bundled mod.

```powershell
cd launcher
npm run build:win
```

On a Linux host with the same payload prepared:

```sh
cd launcher
npm ci
node ../scripts/prepare-launcher-payload.cjs --plugin ../artifacts/Win32/Release/unx.dll
npm run build:linux
```

Outputs go to `artifacts/launcher/`. The Windows target is a portable `.exe`;
the Linux target is a real x64 `.AppImage`, built on Linux. See the official
[electron-builder target documentation](https://www.electron.build/docs/)
and [AppImage documentation](https://www.electron.build/v26/docs/appimage/).
Packages are unsigned unless a separate, explicitly authorized signing step
is added. No automatic updater or release publication is configured.

## GitHub Actions

`Build UnX Manager` runs on relevant source pushes to `fix/**` and `feature/**`
branches. It can also be dispatched manually after the workflow is available
on the repository's default branch. It first builds the Win32 DLL from the
selected checkout on Windows,
using the pinned official Special K binary only to generate its import
library. Native checks run before the DLL is uploaded as a workflow artifact.

The Windows/Linux packaging matrix downloads that same compiled DLL, runs the
launcher tests, prepares the verified offline payload, and builds the native
portable target on its respective host. Each package gets a SHA256 sidecar
and the generated payload manifest. Linux output is checked for ELF and the
AppImage type-2 signature; Windows output is checked for the PE executable
signature. These format checks supplement the build and unit tests; manual
gameplay and desktop-launch checks remain separate.

The workflow uses read-only repository permissions, disables package-manager
cache uploads, and specifies `--publish never`. It writes only runner-local
build outputs and GitHub Actions artifacts, retained for 14 days. It does not
create/edit releases, push commits, upload upstream assets, or require a
private draft release. Download the `unx-manager-windows-x64` and
`unx-manager-linux-x64` artifacts for review.
