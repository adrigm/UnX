# Offline payload and native packages

Manager **1.0.1** bundles the original UnX runtime and the corrected Win32
UnX **0.10.0** plugin. Mod and manager use separate version numbers.
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
is added. No automatic package updater is configured. Releases use the reviewed
publication workflow described below.

## GitHub Actions

`Build UnX Manager` runs on relevant source pushes to `fix/**` and `feature/**`
branches. It can also be dispatched manually after the workflow is available
on the repository's default branch. It first builds the Win32 DLL from the
selected checkout on Windows, using the pinned official Special K binary
only to generate its import library. Native checks run before the DLL is
uploaded as a workflow artifact.

The Windows/Linux packaging matrix downloads that same compiled DLL, runs the
launcher tests, prepares the verified offline payload, and builds the native
portable target on its respective host. Each package gets a SHA256 sidecar
and the generated payload manifest. Linux output is checked for ELF and the
AppImage type-2 signature; Windows output is checked for the PE executable
signature.

The matrix also starts the packaged applications, using
`node scripts/smoke-launcher.cjs --packaged` on Windows and
`xvfb-run -a node scripts/smoke-launcher.cjs --packaged` on Linux. These checks
execute the portable `.exe` or `.AppImage`, open its Electron window, and wait
for the renderer to report readiness. The process must exit successfully,
identify itself as packaged, find the bundled payload manifest, and render
the settings and categories expected by the shared schema. Reports are
written to `artifacts/launcher/smoke-<platform>-<timestamp>.json`. The test uses
an isolated temporary application profile and does not install into a real
game folder.

For local Windows verification after building, run:

```powershell
node scripts/smoke-launcher.cjs --packaged
```

For a Linux build host with Xvfb available, run:

```sh
xvfb-run -a node scripts/smoke-launcher.cjs --packaged
```

The Linux smoke test uses `APPIMAGE_EXTRACT_AND_RUN=1` to avoid requiring FUSE
on the build runner and requests `--no-sandbox` in CI. The current
electron-builder 26 default AppImage wrapper also adds `--no-sandbox` during
normal launches. These checks cover packaged application and renderer startup;
they do not validate FUSE mounting, sandboxed Linux execution, or an interactive
installation. Backend transaction tests use temporary synthetic game folders.
Separate testing on SteamOS reproduced the startup crash with the legacy
cache enabled and confirmed working startup with the cache off and injection
on. That test used the preceding DLL with a local configuration workaround.
The packaged smoke tests still do not establish game compatibility. The exact
0.10.0 release DLL was subsequently installed and launched through Steam Proton
11; the user confirmed visible, working startup, as recorded in
[PR #1](https://github.com/adrigm/UnX/pull/1). A complete gameplay matrix remains
pending; see [release notes](../../docs/RELEASE-0.10.0.md).

The workflow uses read-only repository permissions, disables package-manager
cache uploads, and specifies `--publish never`. It writes only runner-local
build outputs and GitHub Actions artifacts, retained for 14 days. It does not
create/edit releases, push commits, upload upstream assets, or require a
private draft release. Download the `unx-manager-windows-x64` and
`unx-manager-linux-x64` artifacts for review.

## Controlled release publication

The separate `publish-release.yml` workflow has `actions: read` and
`contents: write` only in its publishing job. It runs only when a commit on
`fix/steam-25501027-speed` changes `docs/publish-release.json`. It uses the
short-lived Actions job token; no token is embedded in the source or artifacts.

The strict request contains exactly `tag`, `mod_version`, `manager_version`,
`source_commit`, `build_run_id`, `sha256`, and `notes_path`. For this release,
the values are `v0.10.0`, `0.10.0`, `1.0.1`, the full tested source SHA, its
successful build-run ID, hashes of the seven assets, and
`docs/RELEASE-0.10.0.md`. The seven assets are the Windows executable and
sidecar, Linux AppImage and sidecar, `UnX-0.10.0.zip` and sidecar, and
`payload-manifest.json`.

Only the release request, `scripts/publish-release.py` and its dedicated
`tests/publish_release_test.py` may differ between the tested source commit and
the publishing commit. This permits a publication-tool correction while keeping
the tested product bytes unchanged. Product or workflow changes require a new
verified build. Before writing to the release API, the publisher verifies
that all workflow files at the tested source commit match the repository's
current default branch. Merge the reviewed source PR normally before sending
the request; do not squash away the tested source commit. The exact-release
SteamOS startup retest must be approved and recorded in the reviewed PR first.

Actions artifact API requests use the GitHub JSON media type to obtain a signed
redirect. Release-asset API downloads and redirected binary requests use
`application/octet-stream`; redirects never receive the job token.

The publisher downloads the three artifacts from the successful source build,
checks the reviewed bytes and complete payload inventory, and confirms that
Windows and Linux share the same manifest and compiled DLL. It creates a
draft, uploads and verifies all seven assets, then publishes it. An interrupted
run can reuse matching draft assets. Existing tags and assets are never moved
or overwritten. The release body includes the tested commit and CI-run link.
