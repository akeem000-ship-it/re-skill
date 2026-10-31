# Android app

A WebView app around the web build (`../web`), so the game installs and runs like a native app: full screen,
touch pad (d-pad left, A / B right, Select / Start top right in landscape), Bluetooth / USB controllers, sound,
the battery save kept on the phone.

The APK holds **no ROM**. On first launch it asks for your own `Mario Golf (USA).gbc` (the system file picker),
keeps a private copy in the app's storage and starts straight away from then on. (`-PbundleRom` puts
`../rom/*.gbc` into the APK instead; never share such an APK.)

## Build

Needs JDK 17+, Gradle 8.9+ and the Android SDK (platform 34, build-tools 34):

```bash
sdkmanager --sdk_root=$HOME/android-sdk "platforms;android-34" "build-tools;34.0.0"
cd android && ANDROID_HOME=$HOME/android-sdk gradle assembleDebug
# -> app/build/outputs/apk/debug/MarioGolfGBC-debug.apk   (debug-signed: install with adb install, or open it on the phone)
```

`python3 tools/make_android_icons.py` redraws the launcher icon (a flag on a green, drawn from shapes).
`node web/tests/app_flow.mjs` checks the app's page flow in headless Chromium (first launch picks the ROM, the
second starts at once, the touch pad drives the menus).
