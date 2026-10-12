package com.example.mariotennis;

import android.app.Activity;
import android.os.Bundle;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;

/** Serves the bundled web port from https://appassets.androidplatform.net/assets/ (a secure origin, so
 *  the AudioWorklet and crypto.subtle work) and shows it full screen with the page's touch controls. */
public class MainActivity extends Activity {
    private WebView web;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setUserAgentString(s.getUserAgentString() + " MarioTennisWrapper");
        final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                return loader.shouldInterceptRequest(r.getUrl());
            }
        });
        setContentView(web);
        immersive();
        web.loadUrl("https://appassets.androidplatform.net/assets/web/full.html");
    }
    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }
    @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) immersive(); }

    // ---- Bluetooth / USB controllers: forward buttons and sticks to the page as a bit mask ----
    private int padMask = 0, hatMask = 0, stickMask = 0, sentMask = -1;
    private void pushMask() {
        final int m = padMask | hatMask | stickMask;
        if (m == sentMask) return;                        // joystick motion events arrive constantly; only changes matter
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
            float hx = e.getAxisValue(MotionEvent.AXIS_HAT_X), hy = e.getAxisValue(MotionEvent.AXIS_HAT_Y);
            float sx = e.getAxisValue(MotionEvent.AXIS_X), sy = e.getAxisValue(MotionEvent.AXIS_Y);
            hatMask = (hx > 0.5f ? 16 : 0) | (hx < -0.5f ? 32 : 0) | (hy < -0.5f ? 64 : 0) | (hy > 0.5f ? 128 : 0);
            stickMask = 0;                                    // radial dead zone, eight 45-degree sectors (same rule as web/js/stick.js)
            float m = (float) Math.hypot(sx, sy);
            if (m >= 0.28f) { float nx = sx / m, ny = sy / m, c = 0.3827f;
                stickMask = (nx > c ? 16 : 0) | (nx < -c ? 32 : 0) | (ny < -c ? 64 : 0) | (ny > c ? 128 : 0); }
            pushMask(); return true;
        }
        return super.dispatchGenericMotionEvent(e);
    }
    @Override public void onBackPressed() { /* keep the game running; the page handles B */ }
    @Override protected void onPause() { super.onPause(); web.onPause(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); }
}
