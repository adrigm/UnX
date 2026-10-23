# ***"Untitled" Project X***
Technical Fixes and Enhancements for ***Final Fantasy X | X-2 HD Remaster***

### UnX Manager for Windows and Linux

The new [UnX Manager](launcher/README.md) installs the complete mod runtime,
detects Steam libraries, and exposes 125 English-language configuration options.
It includes backups, restoration, repair, per-game language settings, shortcut
editing, and Steam launch controls. Portable `.exe` and `.AppImage` builds are
generated as reviewable artifacts; release publication remains manual.

### Steam 2026 compatibility fork

This fork fixes the FFX x2/x4/x8 speed-boost crash with Steam build `25501027`.
The updated executable moved the game-tick and audio functions. UnX now finds
their entry points with unique instruction signatures and checks hook and
memory operations before applying a patch. The affected quick-load, time-stop,
and cheat targets have also been updated.

The legacy Special K warning about an infinite XInput haptic-feedback loop is
filtered when connecting a controller. Its recursion protection remains active;
other warnings and the controller/rumble settings are preserved.

For an existing UnX installation, close the game, back up `unx.dll`, and replace
it with the Win32 DLL from this fork's release. Keep the legacy Special K
`dxgi.dll` supplied with UnX. Cycle FFX speed with **Ctrl+Shift+H** or your
configured controller shortcut.

See [build and test instructions](BUILD.md) and the
[compatibility and validation notes](COMPATIBILITY.md).

---

Originally envisioned as a quick-fix solution for a few technical problems in the otherwise excellent PC port of ***Final Fantasy X | X-2 HD Remaster***, this mod aims to customize some of the game's internal working systems such as cutscene skipping, UI and language selection. The "fix" part of the mod should still be very minimal, but there is still room to polish off many aspects of gameplay.

This mod is derived partially from work done on language selection by the Steam community; refer to `AUTHORS`. _If you find your name in there (Steam username) and would like to be credited differently, please let me know on Steam._

&nbsp;&nbsp;&nbsp;If you would like to donate for my work, I have a Pledgie campaign setup for this project.<br><br>
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<a href='https://pledgie.com/campaigns/31692'><img alt='Click here to lend your support to: &quot;Untitled&quot; Project X and make a donation at pledgie.com !' src='https://pledgie.com/campaigns/31692.png?skin_name=chrome' border='0' ></a>

<hr>

**NOTE:** _The code in this repository pertains only to ***unx.dll***._
>The source code for the ***dxgi.dll*** is in my [Special K repository](https://github.com/Kaldaien/SpecialK/). Compiling and distributing that project is complicated and I have not had time to simplify the process. If you wish to contribute to this project, you will have to contact me on Steam and I can walk you through getting that all done. It seems unlikely that anyone would need to work on that part of the project to contribute, it only handles non-game specific render stuff.
