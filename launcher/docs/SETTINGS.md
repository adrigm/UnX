# Settings catalog audit

`launcher/shared/settings-schema.json` contains **125 settings**: **62 active UnX settings** and **63 relevant legacy Special K settings**. All labels, descriptions, and choice labels are English. Internal INI names and shortcut tokens retain the spelling consumed by the mod.

The catalog was checked against the current `UnX/config.cpp`, `config.h`, `input.cpp`, `input.h`, `language.cpp`, `window.cpp`, and `parameter.h`, the installed default INIs, and the matching legacy Special K source at [commit 9e51df0](https://github.com/SpecialKO/SpecialK/tree/9e51df067e46b5cb45da08b224f51fd1059b9785). Every listed Special K section/key has a `ConfigEntry` registration in that source. Every UnX parameter registration is either included or explicitly excluded below.

## Coverage

| Category | Settings |
| --- | ---: |
| Gameplay | 7 |
| Languages | 12 |
| Input | 36 |
| Display | 16 |
| Textures | 16 |
| Advanced | 38 |

| INI file | Settings |
| --- | ---: |
| `UnX_Booster.ini` | 6 |
| `UnX.ini` | 12 |
| `UnX_Language.ini` | 12 |
| `UnX_Gamepad.ini` | 32 |
| `dxgi.ini` | 63 |

The UnX catalog includes all eight configurable keyboard shortcuts, all eleven controller combinations, twelve DirectInput button mappings, all three master language selectors, and all nine executable-specific language selectors. The six standard installed controller icon packs are listed. Custom icon packs discovered in the resource folder should also be offered without renaming their directory values.

Special K coverage concentrates on windowing, presentation, frame pacing, cursor handling, controller integration, texture cache controls, and four useful diagnostic settings. This is not a complete editor for the entire Special K framework: unrelated graphics APIs, SLI profiles, overlay telemetry, global injection, and Steam internals remain outside this catalog.

## Serialization and defaults

Each setting has a stable `id`, `category`, English `label` and `description`, a `type` (`boolean`, `number`, `select`, or `text`), a typed `default`, and an exact `file` / `section` / `key` destination. Select options use `{ "value": ..., "label": ... }`; values may be numbers or strings. Serialize booleans as `true` or `false`, numeric choices as their numeric INI values, and text as a single line. Do not translate INI keys or key tokens.

Existing values take precedence over defaults, except for the Linux texture-cache compatibility policy described below. Apply defaults only to missing settings or after an explicit reset. Preserve unknown keys, comments, casing, encodings, and existing custom values. All entries use `restartRequired: true`: the launcher edits files for the next game start. A live game may overwrite its INIs on exit.

Defaults match the distributed configuration and current runtime behavior where practical. These deliberate differences from zero-INI compiled defaults are relevant:

| Setting | Launcher default | Compiled fallback or legacy behavior |
| --- | --- | --- |
| Master asset languages | `en` (use game language) | `jp`; only `us` and `jp` actually patch assets |
| Texture cache | Windows: `true`; Linux: forced `false` | `false` in `config.h`; original distributed defaults enable it. UnX 0.10.0 also forces it off at runtime under Wine/Proton |
| Bypass Intel | `false` | `true` in `config.h`; distributed defaults explicitly recommend disabling this old override |
| Party AP | `false` | The local user's `true` is a preference, not the product default |
| Controller F2 combination | `Select+Circle` | The loader has a copy/paste bug assigning the fallback string to `gamepad.f1` when F2 is missing; explicitly writing every combination avoids that missing-key path |

On Linux, the manager writes `Cache=false` for both `UnX.Textures` and the
legacy `Textures.D3D11` cache entry. The plugin enforces the same policy under
Wine/Proton and persists the UnX setting as false. This avoids the reproduced
SteamOS startup crash while preserving the requested texture-injection value.
Windows retains its configured cache value. The Special K upstream updater is
disabled as an installation invariant rather than exposed as a preference.

The catalog does not increase the active speed when the game starts. FFX still starts at 1x; the maximum and step configure subsequent shortcut presses. FFX-2 and Eternal Calm do not implement the custom FFX speed hook, party AP, Sensor, or Seymour options.

Numeric ranges are launcher guardrails for normal use, not a claim that the legacy engine clamps every possible hand-edited INI value. Speed defaults remain 8x maximum, 2x steps, and dialogue skipping at 8x. A threshold above the maximum keeps dialogue synchronization during ordinary speed cycling.

## Language behavior

`us` means English assets and `jp` means Japanese assets. The distributed `en` value is intentionally retained as **Use game language**: it is not an English-asset override. Any value other than `us` or `jp`, including an explicitly empty master value, causes no asset patch. `parameter.h` checks key presence rather than nonempty content, so a present empty master value does not fall back to Japanese.

The executable-specific sections are exactly `FFX.exe`, `FFX-2.exe`, and `FFX&X-2_Will.exe`. Empty executable-specific values inherit the master. Steam chooses text and subtitle language; UnX's selectors change voice, sound effect, and video asset paths only.

The launcher build fixes a legacy scope bug: saved master preferences and game overrides are now stored separately from the effective asset language. Startup and unrelated configuration saves preserve the master, even when an executable override is active. The in-game **Language (This Game)** menu edits only the current executable override and offers **Inherit Master**, **Game Language**, **English**, and **Japanese**. Shared defaults are edited in the launcher. Existing `jp`, `us`, `en`, empty, and other no-patch legacy values keep their previous loading behavior. Regression tests exercise the same persistence helper used by `UNX_SaveConfig`, including another game inheriting the master after an overridden game saves.

## Keyboard and controller input

Keyboard strings join the exact parser tokens `Ctrl`, `Alt`, and `Shift` with one key using `+`, such as `Ctrl+Shift+H` or `Ctrl+Shift+Delete`. The loader also recognizes `F1` through `F24`, `Plus`, `Minus`, `Print Screen`, `Scroll Lock`, and `Pause Break`; other key names come from Windows' keyboard naming API. Preserve existing localized physical-key names rather than translating them. Input strings must fit the legacy 128-wide-character parser buffer; cap them at 127 characters or fewer.

Controller strings join recognized button tokens with `+`. The parser accepts these case-insensitive aliases:

| Physical input | Accepted tokens |
| --- | --- |
| Face south | `A`, `Cross` |
| Face east | `B`, `Circle` |
| Face west | `X`, `Square` |
| Face north | `Y`, `Triangle` |
| Left shoulder | `LB`, `L1` |
| Right shoulder | `RB`, `R1` |
| Left trigger | `LT`, `L2` |
| Right trigger | `RT`, `R2` |
| Left stick click | `LS`, `L3` |
| Right stick click | `RS`, `R3` |
| Menu | `Start` |
| Back | `Back`, `Select` |
| D-pad | `Up`, `Down`, `Left`, `Right` |

`Guide`, `Home`, and `Unused` appear in legacy UI naming arrays but are not parsed as configurable combination tokens. An empty controller combination disables that action. Combinations require the specified button set; extra simultaneously held digital buttons can prevent a match. Trigger combinations use the mod's existing trigger thresholds.

DirectInput mappings are one-based button numbers, with the source defaults `X=1`, `A=2`, `B=3`, `Y=4`, `LB=5`, `RB=6`, `LT=7`, `RT=8`, `Back=9`, `Start=10`, `LS=11`, and `RS=12`. The supported launcher choices are 1 through 16. Higher numbers overlap the old axis encoding; negative axis mappings are not applied by the active DirectInput remapping path. These mappings do not remap native XInput button assignments.

`GamepadSlot=-1` currently resolves to XInput slot 0. `SlotReassignment` should contain a permutation of `0,1,2,3`. `PlaceholderMask` uses bits 1, 2, 4, and 8 for those four slots. Keep Special K's XInput integration enabled to retain UnX controller combinations. The dedicated haptic-warning compatibility filter has no user-facing INI toggle and does not require disabling controller support or vibration.

`Ctrl+Shift+Q` is a hardcoded quickload action in the source, not a persisted configurable keybind; it is documented here rather than offered as a fake setting. The same applies to transient current speed, time-stop state, free-look state, one-shot kickstart, and soft reset: their configurable shortcuts are in the catalog, but the action state is not an INI setting.

## Dependencies and precedence

- `FixBackgroundInput` is forcibly disabled when `FastExit=false`.
- DirectInput button mapping requires both UnX `RemapDirectInput=true` and Special K DirectInput hooks.
- Controller artwork requires texture replacement and the chosen resource files.
- Do not enable both `ForceFullscreen` and `ForceWindowed`, or both cursor confinement and forced release.
- Flip-discard presentation requires at least two back buffers; `-1` means leave the game count unchanged.
- Texture cache minimum targets must not exceed their maximum targets, and minimum eviction batches must not exceed maximum batches.
- The INI cursor timeout is in seconds even though a legacy `ConfigEntry` description says milliseconds: the source multiplies the loaded float by 1000 and divides it by 1000 when saving. Zero keeps the cursor hidden while automatic management is enabled.
- UnX applies its texture resource folder, cache, injection, and dump values through Special K exports during initialization. Duplicate `Textures.D3D11` controls for those same four values are intentionally omitted to avoid conflicting controls.

## Excluded obsolete, inert, and internal keys

| File / key | Reason |
| --- | --- |
| `UnX.ini [UnX.Display] EnableFullscreen` | Not registered or loaded by the current UnX code; use the Special K window controls |
| `UnX.ini [UnX.Render] FlipMode` | Not registered or loaded; use `Render.DXGI/UseFlipDiscard` |
| `UnX.ini [UnX.Stutter] Reduce` | Removed legacy setting with no current consumer |
| `UnX.ini [UnX.Input] BlockLeftAlt`, `BlockLeftCtrl`, `BlockAllKeys` | Their load calls are commented out and there is no active behavior to configure |
| `UnX.ini [UnX.Input] BlockWindows` | Loaded into a field with no active runtime consumer |
| `UnX.ini [UnX.Input] FourFingerSalute` | Its condition is commented out; the real soft-reset controller combination remains configurable |
| `UnX.ini [UnX.Input] FilterIME` | Loaded and saved, but the current code never consults the field |
| `UnX_Gamepad.ini [Gamepad.Type] UsesXInput` | Legacy input translation was disabled in 0.9.2; the loaded value does not alter `gamepad.legacy` |
| `UnX.ini [UnX.System] Version` | Written version metadata, not a feature preference |
| `UnX.ini [UnX.System] Injector` | Runtime injector path is supplied by the loader and overwrites this diagnostic field |
| `dxgi.ini [Input.XInput] DisableRumble` | Explicitly deprecated in the bundled engine; use `[Input.Gamepad] DisableRumble` |
| `dxgi.ini [Input.Cursor] FixSynapticTouchpadScroll` | Misspelled legacy default entry; the engine registration uses `FixSynapticsTouchpadScroll` |
| `dxgi.ini [Import.UnX] ...` | Installer invariant: `Architecture=Win32`, `Filename=unx.dll`, `Role=PlugIn`, `When=PlugIn`; not user preferences |
| `dxgi.ini [API.Hook] ...` | The shipped mod requires its D3D11 path; unrelated API routing is outside this game-specific catalog |
| `dxgi.ini [SpecialK.System] Version` / `[API.Hook] LastKnown` | Engine-generated metadata |

Keep these keys intact in existing user files. Exclusion means the launcher does not advertise them as working settings, not that it should delete them.

## Complete mapping

The JSON is authoritative. This table provides a compact audit trail of every persisted setting. An asterisk marks an advanced setting. All settings require the next game start.

| ID | INI file | Section / key | Default |
| --- | --- | --- | --- |
| `gameplay.partyAp` | `UnX_Booster.ini` | `Boost.FFX / EntirePartyEarnsAP` | `false` |
| `gameplay.sensor` | `UnX_Booster.ini` | `Boost.FFX / GrantPermanentSensor` | `false` |
| `gameplay.seymour` * | `UnX_Booster.ini` | `Fun.FFX / PlayableSeymour` | `false` |
| `gameplay.maxSpeed` | `UnX_Booster.ini` | `SpeedHack.FFX / MaxSpeed` | `8` |
| `gameplay.speedStep` | `UnX_Booster.ini` | `SpeedHack.FFX / SpeedStep` | `2` |
| `gameplay.skipDialogAtSpeed` | `UnX_Booster.ini` | `SpeedHack.FFX / SkipDialogAtSpeed` | `8` |
| `gameplay.disableTimingHacks` * | `UnX.ini` | `UnX.Compatibility / DisableTimingHacks` | `false` |
| `language.voice` | `UnX_Language.ini` | `Language.Master / Voice` | `"en"` |
| `language.soundEffects` | `UnX_Language.ini` | `Language.Master / SoundEffects` | `"en"` |
| `language.video` | `UnX_Language.ini` | `Language.Master / Video` | `"en"` |
| `language.ffx.voice` * | `UnX_Language.ini` | `FFX.exe / Voice` | `""` |
| `language.ffx.soundEffects` * | `UnX_Language.ini` | `FFX.exe / SoundEffects` | `""` |
| `language.ffx.video` * | `UnX_Language.ini` | `FFX.exe / Video` | `""` |
| `language.ffx2.voice` * | `UnX_Language.ini` | `FFX-2.exe / Voice` | `""` |
| `language.ffx2.soundEffects` * | `UnX_Language.ini` | `FFX-2.exe / SoundEffects` | `""` |
| `language.ffx2.video` * | `UnX_Language.ini` | `FFX-2.exe / Video` | `""` |
| `language.eternalCalm.voice` * | `UnX_Language.ini` | `FFX&X-2_Will.exe / Voice` | `""` |
| `language.eternalCalm.soundEffects` * | `UnX_Language.ini` | `FFX&X-2_Will.exe / SoundEffects` | `""` |
| `language.eternalCalm.video` * | `UnX_Language.ini` | `FFX&X-2_Will.exe / Video` | `""` |
| `input.remapDirectInput` | `UnX.ini` | `UnX.Input / RemapDirectInput` | `true` |
| `input.gamepadSlot` | `UnX.ini` | `UnX.Input / GamepadSlot` | `-1` |
| `input.fastExit` | `UnX.ini` | `UnX.Input / FastExit` | `true` |
| `input.fixBackgroundInput` * | `UnX.ini` | `UnX.Input / FixBackgroundInput` | `false` |
| `input.trapAltTab` * | `UnX.ini` | `UnX.Input / TrapAltTab` | `false` |
| `input.controllerIcons` | `UnX_Gamepad.ini` | `Gamepad.Type / TextureSet` | `"PlayStation_Glossy"` |
| `input.directInput.x` * | `UnX_Gamepad.ini` | `Gamepad.Remap / XInput_X` | `1` |
| `input.directInput.a` * | `UnX_Gamepad.ini` | `Gamepad.Remap / XInput_A` | `2` |
| `input.directInput.b` * | `UnX_Gamepad.ini` | `Gamepad.Remap / XInput_B` | `3` |
| `input.directInput.y` * | `UnX_Gamepad.ini` | `Gamepad.Remap / XInput_Y` | `4` |
| `input.directInput.lb` * | `UnX_Gamepad.ini` | `Gamepad.Remap / XInput_LB` | `5` |
| `input.directInput.rb` * | `UnX_Gamepad.ini` | `Gamepad.Remap / XInput_RB` | `6` |
| `input.directInput.lt` * | `UnX_Gamepad.ini` | `Gamepad.Remap / XInput_LT` | `7` |
| `input.directInput.rt` * | `UnX_Gamepad.ini` | `Gamepad.Remap / XInput_RT` | `8` |
| `input.directInput.back` * | `UnX_Gamepad.ini` | `Gamepad.Remap / XInput_Back` | `9` |
| `input.directInput.start` * | `UnX_Gamepad.ini` | `Gamepad.Remap / XInput_Start` | `10` |
| `input.directInput.ls` * | `UnX_Gamepad.ini` | `Gamepad.Remap / XInput_LS` | `11` |
| `input.directInput.rs` * | `UnX_Gamepad.ini` | `Gamepad.Remap / XInput_RS` | `12` |
| `input.keyboard.speed` | `UnX_Gamepad.ini` | `UNX.Keybinds / CycleSpeedBoost` | `"Ctrl+Shift+H"` |
| `input.keyboard.kickstart` | `UnX_Gamepad.ini` | `UNX.Keybinds / KickStart` | `"Ctrl+Alt+Shift+K"` |
| `input.keyboard.timeStop` | `UnX_Gamepad.ini` | `UNX.Keybinds / ToggleTimeStop` | `"Ctrl+Shift+P"` |
| `input.keyboard.freeLook` | `UnX_Gamepad.ini` | `UNX.Keybinds / ToggleFreeLook` | `"Ctrl+Shift+F"` |
| `input.keyboard.sensor` | `UnX_Gamepad.ini` | `UNX.Keybinds / TogglePermanentSensor` | `"Ctrl+Shift+S"` |
| `input.keyboard.partyAp` | `UnX_Gamepad.ini` | `UNX.Keybinds / ToggleFullPartyAP` | `"Ctrl+Shift+A"` |
| `input.keyboard.vsync` | `UnX_Gamepad.ini` | `UNX.Keybinds / ToggleVSYNC` | `"Ctrl+Shift+V"` |
| `input.keyboard.softReset` | `UnX_Gamepad.ini` | `UNX.Keybinds / SoftReset` | `"Ctrl+Shift+Delete"` |
| `input.controller.speed` | `UnX_Gamepad.ini` | `Gamepad.PC / SpeedBoost` | `"Select+L2+Cross"` |
| `input.controller.kickstart` | `UnX_Gamepad.ini` | `Gamepad.PC / KickStart` | `"L1+L2+Up"` |
| `input.controller.f1` | `UnX_Gamepad.ini` | `Gamepad.PC / F1` | `"Select+Cross"` |
| `input.controller.f2` | `UnX_Gamepad.ini` | `Gamepad.PC / F2` | `"Select+Circle"` |
| `input.controller.f3` | `UnX_Gamepad.ini` | `Gamepad.PC / F3` | `"Select+Square"` |
| `input.controller.f4` | `UnX_Gamepad.ini` | `Gamepad.PC / F4` | `"Select+L1"` |
| `input.controller.f5` | `UnX_Gamepad.ini` | `Gamepad.PC / F5` | `"Select+R1"` |
| `input.controller.escape` | `UnX_Gamepad.ini` | `Gamepad.PC / ESC` | `"L2+R2+Select"` |
| `input.controller.fullscreen` | `UnX_Gamepad.ini` | `Gamepad.PC / Fullscreen` | `"L2+L3"` |
| `input.controller.softReset` | `UnX_Gamepad.ini` | `Gamepad.PC / SoftReset` | `"L1+L2+R1+R2+Select+Start"` |
| `input.controller.screenshot` | `UnX_Gamepad.ini` | `Gamepad.Steam / Screenshot` | `"Select+R3"` |
| `display.disableDpiScaling` | `UnX.ini` | `UnX.Display / DisableDPIScaling` | `true` |
| `advanced.bypassIntel` * | `UnX.ini` | `UnX.Render / BypassIntel` | `false` |
| `textures.resourceRoot` | `UnX.ini` | `UnX.Textures / ResourceRoot` | `"UnX_Res"` |
| `textures.inject` | `UnX.ini` | `UnX.Textures / Inject` | `true` |
| `textures.cache` | `UnX.ini` | `UnX.Textures / Cache` | Windows: `true`; Linux: `false` (forced) |
| `textures.dump` * | `UnX.ini` | `UnX.Textures / Dump` | `false` |
| `sk.window.borderless` | `dxgi.ini` | `Window.System / Borderless` | `false` |
| `sk.window.fillScreen` | `dxgi.ini` | `Window.System / Fullscreen` | `false` |
| `sk.window.center` | `dxgi.ini` | `Window.System / Center` | `false` |
| `sk.window.renderInBackground` | `dxgi.ini` | `Window.System / RenderInBackground` | `false` |
| `sk.window.muteInBackground` | `dxgi.ini` | `Window.System / MuteInBackground` | `false` |
| `sk.window.rememberPosition` | `dxgi.ini` | `Window.System / PersistentDragPos` | `false` |
| `sk.window.fixMouseCoords` | `dxgi.ini` | `Window.System / FixMouseCoords` | `false` |
| `sk.window.preventScreensaver` | `dxgi.ini` | `Window.System / DisableScreensaver` | `false` |
| `sk.window.overrideResolution` | `dxgi.ini` | `Window.System / OverrideRes` | `"0x0"` |
| `sk.window.offsetX` * | `dxgi.ini` | `Window.System / XOffset` | `"0.0%"` |
| `sk.window.offsetY` * | `dxgi.ini` | `Window.System / YOffset` | `"0.0%"` |
| `sk.window.alwaysOnTop` | `dxgi.ini` | `Window.System / AlwaysOnTop` | `0` |
| `sk.window.confineCursor` | `dxgi.ini` | `Window.System / ConfineCursor` | `false` |
| `sk.window.unconfineCursor` | `dxgi.ini` | `Window.System / UnconfineCursor` | `false` |
| `sk.display.forceFullscreen` | `dxgi.ini` | `Display.Output / ForceFullscreen` | `false` |
| `sk.display.forceWindowed` | `dxgi.ini` | `Display.Output / ForceWindowed` | `false` |
| `sk.framerate.target` | `dxgi.ini` | `Render.FrameRate / TargetFPS` | `0` |
| `sk.framerate.vsync` | `dxgi.ini` | `Render.FrameRate / PresentationInterval` | `0` |
| `sk.framerate.backBuffers` * | `dxgi.ini` | `Render.FrameRate / BackBufferCount` | `4` |
| `sk.framerate.preRender` * | `dxgi.ini` | `Render.FrameRate / PreRenderLimit` | `4` |
| `sk.framerate.refreshRate` * | `dxgi.ini` | `Render.FrameRate / RefreshRate` | `-1` |
| `sk.framerate.waitForVblank` * | `dxgi.ini` | `Render.FrameRate / WaitForVBLANK` | `false` |
| `sk.framerate.sleeplessRender` * | `dxgi.ini` | `Render.FrameRate / SleeplessRenderThread` | `false` |
| `sk.framerate.sleeplessWindow` * | `dxgi.ini` | `Render.FrameRate / SleeplessWindowThread` | `false` |
| `sk.dxgi.flipDiscard` * | `dxgi.ini` | `Render.DXGI / UseFlipDiscard` | `true` |
| `sk.dxgi.safeFullscreen` * | `dxgi.ini` | `Render.DXGI / SafeFullscreenMode` | `true` |
| `sk.dxgi.allowTearing` * | `dxgi.ini` | `Render.DXGI / AllowTearingInDWM` | `false` |
| `sk.dxgi.enhancedDepth` * | `dxgi.ini` | `Render.DXGI / Use64BitDepthStencil` | `false` |
| `sk.dxgi.rehookPresent` * | `dxgi.ini` | `Render.DXGI / RehookPresent` | `false` |
| `sk.dxgi.scaling` | `dxgi.ini` | `Render.DXGI / Scaling` | `"DontCare"` |
| `sk.dxgi.swapchainWait` * | `dxgi.ini` | `Render.DXGI / SwapChainWait` | `0` |
| `sk.dxgi.minResolution` * | `dxgi.ini` | `Render.DXGI / MinRes` | `"0x0"` |
| `sk.dxgi.maxResolution` * | `dxgi.ini` | `Render.DXGI / MaxRes` | `"0x0"` |
| `sk.dxgi.exceptionMode` * | `dxgi.ini` | `Render.DXGI / ExceptionMode` | `"DontCare"` |
| `sk.textures.maxEntries` * | `dxgi.ini` | `Textures.Cache / MaxEntries` | `8192` |
| `sk.textures.minEntries` * | `dxgi.ini` | `Textures.Cache / MinEntries` | `128` |
| `sk.textures.maxMemory` * | `dxgi.ini` | `Textures.Cache / MaxSizeInMiB` | `2048` |
| `sk.textures.minMemory` * | `dxgi.ini` | `Textures.Cache / MinSizeInMiB` | `384` |
| `sk.textures.maxEvict` * | `dxgi.ini` | `Textures.Cache / MaxEvict` | `256` |
| `sk.textures.minEvict` * | `dxgi.ini` | `Textures.Cache / MinEvict` | `32` |
| `sk.textures.ignoreNonMipmapped` * | `dxgi.ini` | `Textures.Cache / IgnoreNonMipmapped` | `false` |
| `sk.textures.allowStaging` * | `dxgi.ini` | `Textures.Cache / AllowStaging` | `false` |
| `sk.textures.preciseHash` * | `dxgi.ini` | `Textures.D3D11 / PreciseHash` | `false` |
| `sk.textures.keepFormat` * | `dxgi.ini` | `Textures.D3D11 / InjectionKeepsFormat` | `true` |
| `sk.textures.generateMipmaps` * | `dxgi.ini` | `Textures.D3D11 / GenerateMipmaps` | `false` |
| `sk.textures.dumpFirstLoad` * | `dxgi.ini` | `Textures.General / DumpOnFirstLoad` | `false` |
| `sk.input.xinputEnabled` | `dxgi.ini` | `Input.XInput / Enable` | `true` |
| `sk.input.xinputRehook` * | `dxgi.ini` | `Input.XInput / Rehook` | `false` |
| `sk.input.disablePs4Hid` | `dxgi.ini` | `Input.Gamepad / DisablePS4HID` | `false` |
| `sk.input.hapticUi` | `dxgi.ini` | `Input.Gamepad / AllowHapticUI` | `false` |
| `sk.input.disableRumble` | `dxgi.ini` | `Input.Gamepad / DisableRumble` | `false` |
| `sk.input.directInputEnabled` * | `dxgi.ini` | `Input.Gamepad / EnableDirectInput8` | `true` |
| `sk.input.hidEnabled` * | `dxgi.ini` | `Input.Gamepad / EnableHID` | `true` |
| `sk.input.uiSlot` | `dxgi.ini` | `Input.XInput / UISlot` | `0` |
| `sk.input.placeholders` * | `dxgi.ini` | `Input.XInput / PlaceholderMask` | `0` |
| `sk.input.slotReassignment` * | `dxgi.ini` | `Input.XInput / SlotReassignment` | `"0,1,2,3"` |
| `sk.cursor.manage` | `dxgi.ini` | `Input.Cursor / Manage` | `true` |
| `sk.cursor.keyboardActivates` | `dxgi.ini` | `Input.Cursor / KeyboardActivates` | `false` |
| `sk.cursor.timeout` | `dxgi.ini` | `Input.Cursor / Timeout` | `0` |
| `sk.system.crashHandler` * | `dxgi.ini` | `SpecialK.System / UseCrashHandler` | `true` |
| `sk.system.logLevel` * | `dxgi.ini` | `SpecialK.System / LogLevel` | `0` |
| `sk.system.traceLibraries` * | `dxgi.ini` | `SpecialK.System / TraceLoadLibrary` | `true` |
| `sk.system.initDelay` * | `dxgi.ini` | `SpecialK.System / InitDelay` | `250` |
