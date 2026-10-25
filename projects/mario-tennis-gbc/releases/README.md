# MTenn3D releases

`MTenn3D-0.35.75-shareable.apk`: the Android app (version 0.35.75) with **no game data inside**. It holds only this
project's own code and fonts: no ROM, nothing generated from one (no `web/gen/`), no private character mods.

On first start, tap the file box and pick your own legal dump of *Mario Tennis* (USA) for Game Boy Color (`.gbc`, SHA-1
`414ba58340a27fc27b127bc01455b32764151ff0`). The app checks it, keeps it on the phone (it is never uploaded) and starts
with it by itself after that. The game runs on the project's JavaScript port of the cartridge's code, with no
emulated Game Boy (no CPU, the picture from its own renderer, the sound from its own synthesiser), reading the
graphics, sound and text from your ROM.

What's new: `web/whatsnew.md`. Built with `cd android && gradle assembleDebug` with `rom/`, `web/gen/` and `web/mods/`
moved out of the tree.
