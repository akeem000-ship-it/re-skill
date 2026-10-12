# Android wrapper (proof of concept)

A WebView app that bundles `../web` and your own ROM dump from `../rom/*.gbc` into the APK at build time
(nothing from the game is committed). Build with the Android SDK (platform 34, build-tools 34) and Gradle 8.9+:

```bash
python3 tools/recomp.py              # optional: the statically translated game (web/gen/game.js), else the core interprets
cd android && ANDROID_HOME=/path/to/sdk gradle assembleDebug
# -> app/build/outputs/apk/debug/app-debug.apk
```

The page detects the wrapper (user agent `MarioTennisWrapper`) and shows the touch controls: d-pad, A, B and
START. The same controls appear in any browser on a touch device, or with `index.html?touch`.
