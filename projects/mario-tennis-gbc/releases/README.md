# MTenn3D releases

`MTenn3D-0.36.25-shareable.apk`: the Android app (version 0.36.25) with **no game data inside**. It holds only this
project's own code and fonts: no ROM, nothing generated from one (no `web/gen/`), no private character mods.

On first start, tap the file box and pick your own legal dump of *Mario Tennis* (USA) for Game Boy Color (`.gbc`, SHA-1
`414ba58340a27fc27b127bc01455b32764151ff0`). The app checks it, keeps it on the phone (it is never uploaded) and starts
with it by itself after that. The game runs on the project's JavaScript port of the cartridge's code, with no
emulated Game Boy (no CPU, the picture from its own renderer, the sound from its own synthesiser), reading the
graphics, sound and text from your ROM.

What's new: `web/whatsnew.md`. Built with `cd android && gradle assembleDebug` with `rom/`, `web/gen/` and `web/mods/`
moved out of the tree.

`MTenn3D-0.36.25-windows-shareable.exe`: the same for Windows 10 and 11 (64-bit), with **no game data inside** either. Run it
and the game picker opens in a window of its own (Microsoft Edge's app mode; Chrome if there is no Edge; nothing is installed). Pick
each game's ROM once (Mario Tennis as above; Mario Golf (USA) for its half) and it starts with it by itself after that. Keyboard:
arrows, Z = A, X = B, Enter = Start, Backspace = Select, Space held = fast; a controller works too; **Esc** shows the button bar
(what Back does on the phone). Saves and settings stay in `%LOCALAPPDATA%\MTenn3D`; recordings and pictures go to
`Downloads\MTenn3D`. It is not signed, so Windows may warn the first time ("More info", then "Run anyway"). Built with
`tools/winapp/build.sh 0.36.25 shareable`.
