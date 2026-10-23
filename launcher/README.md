# UnX Manager

Manager **1.0.1** bundles UnX **0.10.0**. It is a portable, English-language
installer and configuration editor for Untitled Project X and the Steam edition
of Final Fantasy X/X-2 HD Remaster.

## Use

1. Start `UnX-Manager-1.0.1-windows-x64.exe` on Windows, or mark the Linux
   AppImage executable and start it.
2. Select the detected Steam installation, or use **Browse** to choose the
   folder containing `FFX.exe` and `FFX-2.exe`.
3. Choose the settings you want. **Gameplay** includes full-party AP, playable
   Seymour, Sensor, and speed settings. **Languages** provides global and
   per-game choices for voices, videos and sound effects.
4. Close the game and select **Install & apply settings**. Existing installs
   show **Update & apply settings** or **Apply settings** as appropriate.
5. When the installation is ready, select **Play**.

The complete, verified mod runtime is bundled; installation does not require
an Internet connection. Steam and the game must already be installed. Windows
checks include the required **32-bit** DirectX and Visual C++ runtimes.

On Linux, the Windows game runs through Steam's selected Proton version. The
manager discovers native Steam, Flatpak Steam, and additional library folders.
It sets `dxgi` overrides for the game's three executables inside the existing
game-specific Proton prefix. If that prefix does not exist, run the game once
through Steam, close it, and install again. UnX 0.10.0 disables the legacy
texture cache under Wine/Proton while retaining texture injection. The manager applies this compatibility setting on Linux.
Windows keeps its existing texture-cache behavior. See the
[release and validation notes](../docs/RELEASE-0.10.0.md) for the SteamOS tests
and remaining gameplay coverage.

## Configuration and recovery

- 125 documented controls: 62 active UnX settings and 63 relevant Special K
  settings, with a search box and keyboard/controller shortcut editing.
- Existing INI comments, unknown keys, and UTF-16 encoding are preserved.
- Per-game language overrides stay separate from the master language.
- Changes remain in the workspace until applied. Switching installations or
  closing with unapplied changes requires an explicit choice.
- Installation and settings writes create local restore points under
  `.unx-manager/backups/` in the game folder. Failed writes roll back.
- **Backups & tools** provides verification, repair, restoration, diagnostics
  export, and removal of files owned by the manager.
- A foreign `dxgi.dll` is reported as a conflict and is not overwritten.
  Existing external modifications to owned files are protected during removal.
- The bundled legacy Special K updater is disabled so it cannot offer an older
  upstream package over this fork. Use this repository's releases for updates.
- Diagnostics are saved locally; the app does not upload them or saved games.

See [the settings reference](docs/SETTINGS.md) and
[package/build details](docs/PACKAGING.md).

## Develop

From `launcher/`, run `npm ci`. The postinstall step downloads the pinned
Electron runtime. Build the Win32 plugin using the repository's `BUILD.md`,
then prepare the offline payload from the repository root:

```powershell
node scripts/prepare-launcher-payload.cjs --plugin artifacts/Win32/Release/unx.dll
```

From `launcher/`:

```text
npm start
npm test
npm run smoke
npm run build:win
npm run build:linux
```

The AppImage must be built on Linux. The repository workflow builds both
platforms, tests the backend and packaged interfaces, and uploads artifacts
without publishing a GitHub release. Build outputs are under
`artifacts/launcher/`. An optional packaged GUI smoke test can be run from the
repository root with `node scripts/smoke-launcher.cjs --packaged` (use an X
display or Xvfb on Linux).

The renderer has no Node integration, uses context isolation, loads only
bundled files, and communicates through an explicit preload API. See
[packaging notes](docs/PACKAGING.md) for the Linux wrapper and validation limits.
