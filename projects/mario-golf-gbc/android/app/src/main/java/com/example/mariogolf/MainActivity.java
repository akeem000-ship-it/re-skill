package com.example.mariogolf;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;

/** The web build (assets/web) full screen in a WebView, served from https://appassets.androidplatform.net/assets/
 *  (a secure origin, so the AudioWorklet and crypto.subtle work). The ROM is the user's own: the page asks for it on
 *  first launch and hands it over (saveRom); it is kept in the app's private files and served at
 *  /assets/rom/mario_golf.gbc, where the page looks for it (a ROM bundled at build time with -PbundleRom also works). */
public class MainActivity extends Activity {
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private WebView web;
    private ValueCallback<Uri[]> pick;            // the page's "Choose ROM" file input, waiting for a file

    private File romFile() { return new File(getFilesDir(), "mario_golf.gbc"); }

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                      // the battery save lives in localStorage
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " MarioGolfWrapper");
        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/rom/", path -> romResponse())
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                return loader.shouldInterceptRequest(r.getUrl());
            }
        });
        // <input type=file>: the system file picker (any type: .gbc has no MIME type)
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (pick != null) pick.onReceiveValue(null);
                pick = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE); i.setType("*/*");
                try { startActivityForResult(Intent.createChooser(i, "Choose your Mario Golf ROM (.gbc)"), 1); }
                catch (Exception e) { pick = null; cb.onReceiveValue(null); return false; }
                return true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "MGolfApp");
        setContentView(web);
        immersive();
        if (android.os.Build.VERSION.SDK_INT >= 28)
            getWindow().getAttributes().layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        web.loadUrl(ORIGIN + "/assets/web/index.html");
    }

    /** The saved ROM, else one bundled in the assets, else 404 (the page then shows its ROM picker). */
    private WebResourceResponse romResponse() {
        try {
            InputStream in = romFile().exists() ? new FileInputStream(romFile()) : getAssets().open("rom/mario_golf.gbc");
            return new WebResourceResponse("application/octet-stream", null, in);
        } catch (Exception e) {
            WebResourceResponse r = new WebResourceResponse("text/plain", "utf-8", null);
            r.setStatusCodeAndReasonPhrase(404, "Not Found");
            return r;
        }
    }

    private class Bridge {
        /** The ROM the user picked (base64), kept so the next launch starts straight away. */
        @JavascriptInterface public void saveRom(String base64) {
            try (FileOutputStream o = new FileOutputStream(romFile())) { o.write(android.util.Base64.decode(base64, android.util.Base64.DEFAULT)); }
            catch (Exception e) { /* the game still runs; it asks again next time */ }
        }
        @JavascriptInterface public void forgetRom() { romFile().delete(); }
    }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req != 1 || pick == null) return;
        Uri u = res == RESULT_OK && data != null ? data.getData() : null;
        pick.onReceiveValue(u == null ? null : new Uri[] { u });
        pick = null;
    }

    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }
    @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) immersive(); }

    // ---- Bluetooth / USB controllers: buttons and the hat / left stick to the page as a bit mask (web/js/gamepad.js:
    // bits 0 A, 1 B, 2 Select, 3 Start, 4 Right, 5 Left, 6 Up, 7 Down) ----
    private int padMask = 0, axisMask = 0, sentMask = -1;
    private void pushMask() {
        final int m = padMask | axisMask;
        if (m == sentMask) return;
        sentMask = m;
        web.post(() -> web.evaluateJavascript("window.__padmask=" + m + ";", null));
    }
    private static int bitFor(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_BUTTON_A: case KeyEvent.KEYCODE_BUTTON_X: return 1;
            case KeyEvent.KEYCODE_BUTTON_B: case KeyEvent.KEYCODE_BUTTON_Y: return 2;
            case KeyEvent.KEYCODE_BUTTON_SELECT: case KeyEvent.KEYCODE_BUTTON_L1: return 4;
            case KeyEvent.KEYCODE_BUTTON_START: case KeyEvent.KEYCODE_BUTTON_R1: return 8;
            case KeyEvent.KEYCODE_DPAD_RIGHT: return 16;
            case KeyEvent.KEYCODE_DPAD_LEFT: return 32;
            case KeyEvent.KEYCODE_DPAD_UP: return 64;
            case KeyEvent.KEYCODE_DPAD_DOWN: return 128;
        }
        return 0;
    }
    @Override public boolean dispatchKeyEvent(KeyEvent e) {
        int src = e.getSource();
        boolean pad = (src & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD || (src & InputDevice.SOURCE_DPAD) == InputDevice.SOURCE_DPAD
                   || (src & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK;
        int bit = bitFor(e.getKeyCode());
        if (pad && bit != 0) {
            if (e.getAction() == KeyEvent.ACTION_DOWN) padMask |= bit; else if (e.getAction() == KeyEvent.ACTION_UP) padMask &= ~bit;
            pushMask(); return true;
        }
        return super.dispatchKeyEvent(e);
    }
    @Override public boolean dispatchGenericMotionEvent(MotionEvent e) {
        if ((e.getSource() & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK && e.getAction() == MotionEvent.ACTION_MOVE) {
            float x = e.getAxisValue(MotionEvent.AXIS_HAT_X), y = e.getAxisValue(MotionEvent.AXIS_HAT_Y);
            if (Math.abs(x) < 0.5f && Math.abs(y) < 0.5f) { x = e.getAxisValue(MotionEvent.AXIS_X); y = e.getAxisValue(MotionEvent.AXIS_Y); }
            axisMask = (x > 0.5f ? 16 : 0) | (x < -0.5f ? 32 : 0) | (y < -0.5f ? 64 : 0) | (y > 0.5f ? 128 : 0);
            pushMask(); return true;
        }
        return super.dispatchGenericMotionEvent(e);
    }

    @Override protected void onPause() {               // write a pending cartridge save before the WebView's timers stop
        web.evaluateJavascript("window.__flushSave && window.__flushSave();", null);
        super.onPause(); web.onPause();
    }
    @Override protected void onResume() { super.onResume(); web.onResume(); }
}
