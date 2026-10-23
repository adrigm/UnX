# UnX 0.10.0 — SteamOS startup compatibility

Release date: 2026-10-23. Mod version **0.10.0**; companion **UnX Manager 1.0.1**.
The GitHub tag is `v0.10.0`. Manager and mod version numbers are independent.

## Changes

- **SteamOS / Wine / Proton startup:** the legacy Special K texture cache is
  forced off under Wine/Proton. This uses the configuration that allowed FFX
  to start during the SteamOS investigation. Texture injection remains
  available; its requested value is preserved.
- **Windows compatibility:** native Windows continues to honor its configured
  cache setting. The Wine check and compatibility policy do not replace the
  Windows defaults or the bundled graphics runtime.
- **Old updater removed:** UnX no longer launches the legacy Special K update
  check. The manager disables its automatic update frequency during install
  or update so it cannot offer an older upstream package over this fork.
  Obtain future updates from this repository's releases.
- **Manager configuration:** Linux installation and settings writes keep the
  UnX and Special K cache settings consistently off. The cache control explains
  the compatibility policy. Windows keeps the existing cache control and
  configured value. Updater configuration uses the same backup and rollback
  transaction as installation.
- **Version visibility:** the plugin resources, offline payload manifest and
  manager interface identify the mod as 0.10.0; native manager packages use
  version 1.0.1.

The pinned Special K 0.8.60.2 and ReShade runtime files are retained. The fix
avoids the failing cache path; it does not claim to repair Special K's internal
texture-resource lifetime handling.

## Updating

Close the game and its launcher, open the new manager and use **Update & apply
settings**. Existing configuration is merged and backed up. Linux's cache
setting is intentionally changed to `false`; texture injection and other
preferences are preserved unless changed in the manager. Saved games are not
part of the installation payload.

For manual DLL updates, back up the existing `unx.dll`, replace it with the
Win32 DLL from this release and retain the supplied legacy `dxgi.dll`. On
SteamOS, set `UnX.ini [UnX.Textures] Cache=false` and
`dxgi.ini [Textures.D3D11] Cache=false`. Leave `Inject` at the desired value.
Use the manager to apply the complete managed updater policy as well.

## Validation and limits

Publication requires successful Win32 compilation and native regression tests,
Windows and Linux manager tests and packaged startup checks, and an approved
SteamOS startup retest using the exact release DLL. The SteamOS retest result
is recorded in the reviewed pull request before merge and publication. The
publisher verifies the completed CI run, its source commit, the complete
payload and all reviewed asset hashes, then appends the exact CI link below.
Interactive Windows gameplay and the broader gameplay matrix remain separate
checks, as listed below.

The SteamOS investigation used SteamOS 3.8.28, Steam Proton 11, DXVK and game
build 25501027 in Desktop Mode. The successful startup configuration was
`Cache=false`, `Inject=true`. This was tested with the preceding mod binary
before the workaround was implemented in 0.10.0.

| Check | Result and scope |
| --- | --- |
| Earlier Windows Win32 build and native regression tests | Passed for 0.9.2.1; not evidence that 0.10.0 has received interactive Windows gameplay testing |
| Earlier Windows FFX speed transitions and controller-warning filter | Interactive checks passed for 0.9.2.1; retained implementation |
| SteamOS startup with legacy cache enabled | Failed in the investigation; reproduced startup crash |
| SteamOS startup with cache disabled and injection enabled | Passed; user confirmed working startup and manual closure |
| SteamOS repair, restore, uninstall and reinstall | Completed with the working local cache configuration; original release had a conservative INI hash-drift limitation during removal |
| Original manager backend tests | 20/20 passed on SteamOS for Manager 1.0.0 |
| Original installation integrity | 114/114 payload files verified on SteamOS |
| Windows interactive gameplay with exact 0.10.0 DLL | Pending |
| Full FFX speed/audio matrix, battles, AP, Sensor and Seymour | Pending; startup and partial speed logs do not establish complete gameplay coverage |
| FFX-2, Eternal Calm, external-controller reconnect/rumble, Gaming Mode and handheld display | Pending |

The root cause was narrowed to a texture object returned through the legacy
cache path; the dump was compatible with an object-lifetime failure but did
not establish a responsible component or a specific race. Disabling ReShade
alone did not resolve the crash.

No personal saves, machine-specific logs, game binaries or local configuration
are included in this release. The historical
[SteamOS handoff](STEAMOS-HANDOFF.md) and setup script retain their original
Manager 1.0.0 URLs and checksums; they remain a reproducible investigation
baseline rather than a downloader for this new release.
