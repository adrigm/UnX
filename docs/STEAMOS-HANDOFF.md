# SteamOS test handoff — UnX Manager 1.0.0

Read this entire document before changing the game. It is for a new Codex session
with no previous conversation, no `gh`, and possibly no Git or Node.js. Test the
released manager and its mod on the user's actual **SteamOS** machine, investigate
failures, and leave a working installation with the user's preferences. Do the
work; do not stop at suggesting tests.

## Context and exact release

- Repository: <https://github.com/adrigm/UnX>, our maintained fork of Kaldaien's UnX.
  Do not request integration into the abandoned upstream repository.
- Release: <https://github.com/adrigm/UnX/releases/tag/v1.0.0>.
- Manager **1.0.0**, bundled mod **0.9.2.1**, legacy Special K **0.8.60.2**.
- Released source: `42f0a508108a981d19146ce61e3b86d08e68ca32`.
- Game: **Final Fantasy X/X-2 HD Remaster**, Steam app **359870**. Examined Windows
  Steam build: **25501027**. Record the actual local build before testing.
- Package: `UnX-Manager-1.0.0-linux-x86_64.AppImage`.
- SHA256: `075346f9abaa49001de4431c21efed26fdd38274c67b4095da1c7d96a437ba4e`.
- Successful build: <https://github.com/adrigm/UnX/actions/runs/40005154844>.

Already established: four native C++ tests, 20 installer tests on each packaging
OS, and packaged GUI startup on Windows and Ubuntu/Xvfb. Reports contained 125
settings, six categories, 125 rendered controls and an available payload. The
114-file payload has the same Win32 plugin on both OSes. On Windows, the user
confirmed repeated speed cycles and controller reconnect without the warning.

**Still unproved: real SteamOS gameplay/input, normal AppImage/FUSE startup on this
device, handheld usability and individual gameplay options.** A build, green GUI
smoke test or saved INI values do not prove these.

The native fix resolves moved FFX tick/audio and other targets using signatures;
the old fixed address crashed the updated game when changing speed. A selective
filter removes only Special K's exact "Problematic XInput software detected
(infinite haptic feedback loop), please restart the Steam client." warning,
preserving its recursion guard. Another fix keeps per-game language overrides
separate from the master preference. Preserve these fixes.

## 1. Prepare SteamOS without system changes

Use **Desktop Mode**, as the current normal user. Inspect `/etc/os-release`,
`uname -m`, `XDG_SESSION_TYPE`, display availability, free space and available tools.
Do not assume the username is `deck`, the session is X11, or the game is on internal
storage. The release requires x86_64.

SteamOS has an image-managed system. Use the writable home directory. Do not use
`apt`, host `pacman`, `sudo npm`, `steamos-readonly disable`, or replace system
Wine/Proton. No administrator password is needed for this setup. Keep Steam Input
enabled for the handheld controls and use the user's current Proton first.

Download these files into a dedicated directory. No GitHub login, Git, Node or
`gh` is required:

```bash
mkdir -p "$HOME/UnX-SteamOS/handoff"
cd "$HOME/UnX-SteamOS/handoff"
UNX_RELEASE_URL='https://github.com/adrigm/UnX/releases/download/v1.0.0'
for UNX_FILE in STEAMOS-HANDOFF.md steamos-test-setup.sh STEAMOS-HANDOFF-SHA256SUMS.txt; do
  curl --fail --location --retry 3 --output "$UNX_FILE" "$UNX_RELEASE_URL/$UNX_FILE" || break
done
sha256sum -c STEAMOS-HANDOFF-SHA256SUMS.txt
```

If `curl` is absent, use `wget -O FILE URL`. If neither exists, download the same
files from the release page in the desktop browser. Verify with `sha256sum`.
Do not execute partial downloads or ignore a checksum failure. Read the script,
then run it explicitly; do not pipe a download into a shell:

```bash
bash steamos-test-setup.sh --dev-tools --github-cli
source "${UNX_TEST_ROOT:-$HOME/UnX-SteamOS}/unx-test-env.sh"
node --version
npm --version
gh --version
```

The script pins and verifies the AppImage, manifest, source snapshot, official
Node.js **24.22.1** Linux x64 and GitHub CLI **2.103.1**. Tools go only under
`$UNX_TEST_ROOT/tools`; `PATH` changes only when sourcing the environment file.
Default workspace: `$HOME/UnX-SteamOS`. Use `export UNX_TEST_ROOT=/absolute/path`
to select another dedicated directory before running if needed. It can be rerun, preserving source
edits and results. It does not install the mod, run the game, authenticate or
modify Steam, prefixes or launch options. Keep this downloaded guide outside the
source snapshot: the published commit predates the guide and setup script.

| Environment variable | Meaning |
| --- | --- |
| `UNX_TEST_ROOT` | Workspace, downloads, tools, setup logs and results |
| `UNX_TEST_SOURCE` | Released source snapshot, **not a Git checkout** |
| `UNX_TEST_APPIMAGE` | Verified published AppImage |
| `UNX_TEST_MANIFEST` | Verified release payload manifest |
| `UNX_TEST_RESULTS` | Evidence and persistent progress directory |

Git is unnecessary for initial tests. Do not assume `gh repo clone` installs Git.
Public reads/downloads need no authentication. If fixes require repository writes,
use existing authenticated tools or have the user complete `gh auth login --web`.
Do not copy Windows credentials or record tokens. Without Git, keep the editable
snapshot and use GitHub's REST API through `gh api` if necessary. Inspect remote
branch/HEAD before creating commits.

If native debugging tools are actually needed, inspect `git`, `python3`, `gdb`,
`strace`, `distrobox` and `podman` first. They are optional. If Distrobox and its
rootless backend are already available, install packages in a dedicated development
container. An Arch container can use its own `pacman`; invoke it through
`distrobox enter unx-dev -- ...` so it cannot target the host. If unavailable,
continue with portable tools and Proton logs. Do not disable SteamOS protections
to obtain an optional debugger.

## 2. Establish a baseline and protect saves

Create `$UNX_TEST_RESULTS/PROGRESS.md` immediately. After each group record the
current step, next command, actual paths, changes and evidence filenames. Do not
rely on chat memory surviving a mode switch or reconnect.

Record SteamOS, hardware, native resolution/scaling, Steam, selected Proton,
Steam Input profile, exact launch options and any existing UnX/foreign proxy DLL.
Keep Proton unchanged for the baseline. Check `df -h "$UNX_TEST_ROOT"` before builds.

Find `appmanifest_359870.acf` through Steam's `libraryfolders.vdf` or the manager.
Common roots: `~/.local/share/Steam`, `~/.steam/steam`, Flatpak Steam under
`~/.var/app/com.valvesoftware.Steam`. Other libraries may be under `/run/media/...`;
read their manifests rather than guessing an SD card name. The game directory
contains both `FFX.exe` and `FFX-2.exe`.

Find the **existing** `steamapps/compatdata/359870/pfx`, checking both the game's
library and Steam's primary library, and resolve symlinks. The v1.0.0 backend looks
beside the game's library: a prefix in another library is an important test case,
not a reason to create blind symlinks. If genuinely missing, run the unmodified
game once through Steam, close it and retry detection. Do not delete `compatdata`
or create a second Wine prefix.

With the game/launcher closed, independently back up the actual saves, original
mod INIs/proxy files, prefix `user.reg` and exact Steam launch options. **Manager
restore points cover managed mod files, not saved games.** Locate the game's save
directory under the prefix user's Documents, commonly
`SQUARE ENIX/FINAL FANTASY X&X-2 HD Remaster`, and inspect relevant
`Steam/userdata/*/359870` data. Resolve Documents symlinks; copying a link alone
does not back up its target. Copy actual contents into a new timestamped backup
directory and record SHA256 values. Do not overwrite prior backups. Steam Cloud
is not a substitute; do not change its settings routinely. Use a disposable save
copy/new slot for cheats and never overwrite the original.

Start the game normally through Steam before installing if possible. Record menu
and test-save loading, then close normally. An existing mod is not a clean baseline.
Preserve the setup before considering Steam's Verify integrity command.

## 3. Test the manager before changing the game

Launch the AppImage normally from this real desktop and preserve stdout/stderr.
Check the window, folder picker, sidebar, scrolling, buttons and confirmations at
native resolution/scaling; the handheld target includes 1280x800. Six categories
plus setup/tools must be accessible. Search should find AP, Seymour and voices.
The "Make it feel like your game" promotional block was intentionally removed.

Close any manager window first. Its automated startup test needs no Node and
uses an isolated profile:

```bash
UNX_SMOKE_REPORT="$UNX_TEST_RESULTS/smoke-normal.json" \
  "$UNX_TEST_APPIMAGE" --smoke-test \
  > "$UNX_TEST_RESULTS/smoke-normal.log" 2>&1
UNX_SMOKE_EXIT=$?
printf 'exit=%s\n' "$UNX_SMOKE_EXIT"
cat "$UNX_TEST_RESULTS/smoke-normal.json"
```

Expect exit 0, `success: true`, `platform: linux`, `packaged: true`, `settings: 125`,
`categories: 6`, `renderedControls: 125`, `payloadAvailable: true`. No report means
failure. A real desktop/display session is required. Do not run as root or through
Proton.

If normal launch specifically fails because of FUSE, repeat with
`APPIMAGE_EXTRACT_AND_RUN=1` and **different report/log names**. Label this extraction
fallback: it does not validate normal FUSE startup. Do not install FUSE system
packages or add unrelated Chromium flags as the first workaround. The current
electron-builder wrapper already adds `--no-sandbox` on Linux; neither mode proves
sandboxed execution.

For actual UI tests, launch without `--smoke-test`. Use computer/browser tools
available on this SteamOS session. Windows `@oai/sky` from the earlier machine
is not a Linux automation method. If interactive control is unavailable, complete
independent automated checks and diagnostics, then state the exact manual action
needed. Do not invent gameplay results or stop everything because one input path
is missing.

Run the temporary-file backend tests separately:

```bash
cd "$UNX_TEST_SOURCE/launcher"
npm ci --ignore-scripts
npm test
```

Expect **20 passing tests** at the release commit. `--ignore-scripts` is enough
for backend tests and avoids Electron's postinstall download. UI development needs
normal `npm ci` later.

## 4. Install and confirm real injection

Select the real detected folder and test Browse too. Preserve the user's values,
close game/launcher and apply the bundled package. A foreign `dxgi.dll` must be
reported as a conflict; do not force an overwrite. Record warnings and backup ID.

Pass criteria: **Ready to play**, 114 payload files checked with no missing/modified
critical runtime files, manager record and a restore point. In the existing
prefix's `user.reg`, only these app sections should receive
`"dxgi"="native,builtin"`:

```text
Software\\Wine\\AppDefaults\\FFX.exe\\DllOverrides
Software\\Wine\\AppDefaults\\FFX-2.exe\\DllOverrides
Software\\Wine\\AppDefaults\\FFX&X-2_Will.exe\\DllOverrides
```

Do not add a global override or permanently mask a detection failure with
`WINEDLLOVERRIDES`. Record and fix the underlying problem. Close the game normally
before prefix writes so Wine/Proton cannot overwrite registry changes on exit.

Start through Play and the original Steam launcher, not `wine FFX.exe`. Require
fresh `logs/UnX.log`, the correct plugin, resolved signatures and successful hook
setup. Inspect available Special K logs. A running game without the mod injected
is not a successful install.

## 5. Gameplay and configuration matrix

Record **PASS**, **FAIL** or **NOT TESTED** per case, with evidence. Keep Proton and
test save consistent. Restart when applying settings and never modify installation
files with a game/launcher running.

| Case | Actions and evidence |
| --- | --- |
| FFX speed | Maximum 8, step 2, **Disable custom speed timing OFF** (`DisableTimingHacks=false`). Use **Ctrl+Shift+H** or configured mod combo for at least three complete 1x→2x→4x→8x→1x cycles in field, menus and battle. Confirm visible speed and fresh `[Speed Hack] Speed=2.0x`, `4.0x`, `8.0x`, `1.0x` entries plus successful hook/audio transitions. Do not confuse original game boosters with UnX. |
| Audio recovery | At default 8x dialogue threshold, synchronization skipping is expected. Back at 1x, audio/dialogue must normalize. Record crashes, stalls or hook failures. |
| Integrated controls | Keep Steam Input enabled. Test navigation, gameplay, mod combo and supported rumble. Default `Select+L2+Cross` maps to **Back/View+LT+A** with XInput labels. Read actual config first. |
| External controller | Connect/reconnect during FFX, then test input and speed again. No modal "Problematic XInput software" warning or lost controls. Record whether rumble works; missing external hardware is NOT TESTED. |
| Full-party AP | Enable **Entire party earns AP**, finish a battle and inspect AP for eligible members who did not act. Compare disabled on the disposable save. A written INI alone is insufficient. |
| Sensor | Enable **Permanent Sensor** and inspect enemy details without a Sensor weapon; disable and compare. |
| Seymour | Appropriate disposable save/scenario: enable **Playable Seymour**, verify party availability and battle. Never save over original. Mark a missing scenario as untested. |
| Language separation | Master English, FFX Japanese override, FFX-2 inherit. Restart each: FFX Japanese, FFX-2 English. Exit normally; master must stay English. Change language through the in-game menu and repeat for persistence regression. |
| Language meaning | In `UnX_Language.ini`, **`us` forces English**, **`jp` Japanese**, **`en` follows game language**, empty override inherits. Text/subtitles follow Steam's game language. Test voices, videos and SFX separately where assets allow. |
| FFX-2 / Eternal Calm | Launch from Steam launcher; startup, controls, video/audio and language separation. Custom speed, AP, Seymour and Sensor are **FFX-specific**, not requirements for these executables. |
| Persistence | Close/reopen manager and game; values, language separation and integrity survive. |
| Running-game guard | Applying a test change with game/launcher open must be rejected without modifying files. Close normally and repeat successfully. Do not bypass guard. |
| Recovery | Change a harmless setting, restore its backup and verify value/files. Repair, then managed uninstall/reinstall only after backups. Unrelated files and saves must survive. Finish installed with original preferences. |
| Libraries / Gaming Mode | Test the real available SSD/SD/Flatpak and native screen. Unavailable paths are NOT TESTED. A non-Steam shortcut for the manager is a Linux app: do not force Proton for it. The game still uses Proton. |

Gaming Mode may end the desktop agent connection. Save progress/commands before
switching and resume from `PROGRESS.md` after reconnecting.

## 6. Diagnose failures and retain evidence

Preserve original launch options. If empty, temporarily use `PROTON_LOG=1 %command%`.
If nonempty, add the assignment without losing the existing wrapper/options;
inspect the composed command. Never replace a custom launch command blindly.

Proton normally writes `~/steam-359870.log`; `PROTON_LOG_DIR` can redirect it. Copy
the log into each case directory before the next run replaces it. Collect fresh
`logs/UnX.log`, Special K logs, AppImage output, manager diagnostics, file hashes,
game build, Proton and exact repro. Keep diagnostics/saves local; release assets
are not for machine logs or game files. Restore original launch options afterwards.

Separate failures by layer: AppImage/FUSE/dependencies, GUI, Steam/prefix discovery,
registry overrides, actual DLL loading, signature/hook resolution, speed/audio,
controller recursion and language persistence. Fixing one does not establish the
next. Do not erase a prefix to hide a failed test.

For native crashes, Valve documents `PROTON_WAIT_ATTACH=1` and the per-app runtime
via `STEAM_COMPAT_LAUNCHER_SERVICE=proton`. Use these if logs are insufficient,
keeping the same prefix, DLL hash and matching symbols. No host Wine substitution.

| Area | Source |
| --- | --- |
| Speed/AP/Sensor/Seymour and signatures | `UnX/cheat.cpp`, scanner helpers |
| Selective XInput warning filter | `UnX/compatibility.cpp`, `UnX/specialk_warning.h` |
| Language precedence | `UnX/config.cpp`, `UnX/language_preferences.h` |
| Libraries/prefix discovery | `launcher/main/services/steam.cjs` |
| Install/registry/verify/restore/remove | `launcher/main/services/installer.cjs`, `transactions.cjs`, `ini.cjs`, `payload.cjs` |
| English controls and INI mappings | `launcher/shared/settings-schema.json`, `launcher/docs/SETTINGS.md` |
| Renderer and IPC | `launcher/renderer/`, `launcher/main/main.cjs`, `launcher/preload/` |

## 7. Fix/build workflow if necessary

Reproduce with the released snapshot first. For a patch inspect remote branch
`fix/steam-25501027-speed` and own-fork PR #1 before choosing a branch. Do not
overwrite newer work or move the published `v1.0.0` tag. App strings remain English.

To develop the manager, run normal `npm ci` in `launcher/`. Its postinstall installs
the pinned Electron. Extract the **verified** AppImage with `--appimage-extract`
inside a new workspace directory. Locate `resources/payload/` with `manifest.json`
and `payload.zip`; copy these verified resources into the snapshot's
`launcher/payload/` for `npm start`, `npm run smoke` or `npm run build:linux`.
Preserve the downloaded release as baseline. Compare the embedded manifest with
the downloaded `payload-manifest.json`.

The plugin is a **Win32 MSVC DLL on Linux too**. Building the Linux manager does
not rebuild it. Native changes require the Windows CI job / `scripts/build.ps1`;
do not replace Special K or substitute an ELF/Mingw build. Workflow:
`.github/workflows/build-launcher.yml`. Relevant `fix/**` / `feature/**` pushes
build the plugin and both packages. Check default-branch dispatch availability
before relying on `gh workflow run --ref ...`.

If needed, retrieve corrected CI DLLs with authenticated `gh run download`, then
prepare the payload using `node scripts/prepare-launcher-payload.cjs --plugin
/absolute/path/to/unx.dll`. Run meaningful tests and repeat the failing SteamOS
gameplay case. Do not replace published v1.0.0 binaries; report the tested patch
and proposed next release separately.

## 8. Exit criteria and report

Write a Markdown report in `$UNX_TEST_RESULTS`: environment, real game/prefix
paths, original/final settings, backups, package/DLL hashes, matrix results with
evidence filenames, changes and remaining gaps. Distinguish manager tests from
real gameplay. State whether the needed game/save/controller/display was available.

Leave original Steam launch options restored, original saves intact, no needless
running game processes, and working UnX with the user's preferences. If a failure
prevents this, preserve a recoverable setup and explain its precise state rather
than reporting success. No upstream requests or public log uploads are required.

## Primary references

- [Valve SteamOS Desktop FAQ](https://help.steampowered.com/en/faqs/view/671A-4453-E8D2-323C): Desktop Mode, user software and system image.
- [AppImage FUSE troubleshooting](https://docs.appimage.org/user-guide/troubleshooting/fuse.html): extraction-and-run.
- [GitHub CLI release](https://github.com/cli/cli/releases/tag/v2.103.1) and [Node.js 24 downloads](https://nodejs.org/dist/v24.22.1/): portable tools pinned by setup.
- [Proton runtime options](https://github.com/ValveSoftware/Proton#runtime-config-options): logs and environment.
- [Proton Linux debugging](https://github.com/ValveSoftware/Proton/blob/proton_11.0/docs/DEBUGGING-LINUX.md): debugger and per-app runtime.
- [Steam Input player guide](https://partner.steamgames.com/doc/features/steam_controller/getting_started_for_players): controller translation/configuration.
