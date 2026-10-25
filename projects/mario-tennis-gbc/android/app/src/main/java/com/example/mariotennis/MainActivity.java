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
    private android.webkit.ValueCallback<android.net.Uri[]> pick;   // the page's "load your ROM" file input, waiting for a file

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
            @Override public void onPageFinished(WebView v, String url) { pushCut(); pushGameMode(); }
        });
        // the page's <input type=file> (load your own ROM): open the system file picker. Any type, since .gbc has no MIME type.
        web.setWebChromeClient(new android.webkit.WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, android.webkit.ValueCallback<android.net.Uri[]> cb, FileChooserParams p) {
                if (pick != null) pick.onReceiveValue(null);
                pick = cb;
                android.content.Intent i = new android.content.Intent(android.content.Intent.ACTION_GET_CONTENT);
                i.addCategory(android.content.Intent.CATEGORY_OPENABLE); i.setType("*/*");
                try { startActivityForResult(android.content.Intent.createChooser(i, "Choose your Mario Tennis ROM (.gbc)"), 1); }
                catch (Exception e) { pick = null; cb.onReceiveValue(null); return false; }
                return true;
            }
        });
        web.addJavascriptInterface(new FileBridge(), "MTennApp");   // the page's REC button saves recordings through this
        setContentView(web);
        requestHighRefreshRate();
        immersive();
        // the camera cutout: draw under it (full screen) but tell the page its size, so the controls avoid it
        if (android.os.Build.VERSION.SDK_INT >= 28) {
            getWindow().getAttributes().layoutInDisplayCutoutMode = android.view.WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            web.setOnApplyWindowInsetsListener((v, insets) -> {
                android.view.DisplayCutout c = insets.getDisplayCutout();
                float d = getResources().getDisplayMetrics().density;
                cut = c == null ? new int[4] : new int[] { Math.round(c.getSafeInsetLeft() / d), Math.round(c.getSafeInsetTop() / d), Math.round(c.getSafeInsetRight() / d), Math.round(c.getSafeInsetBottom() / d) };
                pushCut();
                return v.onApplyWindowInsets(insets);
            });
        }
        web.loadUrl("https://appassets.androidplatform.net/assets/web/" + getString(R.string.start_page));   // (full.html#port: the port edition)
    }
    /** Saves a file from the page (base64) to Downloads/MTenn3D (recordings: and offers the share sheet); buzzes the phone. */
    private class FileBridge {
        @android.webkit.JavascriptInterface public void saveFile(String name, String base64) { save(name, base64, "application/octet-stream", true); }
        @android.webkit.JavascriptInterface public void saveImage(String name, String base64) { save(name, base64, "image/png", false); }
        @android.webkit.JavascriptInterface public void vibrate(int ms) {
            android.os.Vibrator v = (android.os.Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (v == null || !v.hasVibrator()) return;
            if (android.os.Build.VERSION.SDK_INT >= 26) v.vibrate(android.os.VibrationEffect.createOneShot(Math.max(1, Math.min(ms, 400)), android.os.VibrationEffect.DEFAULT_AMPLITUDE));
            else v.vibrate(Math.max(1, Math.min(ms, 400)));
        }
        private void save(String name, String base64, String mime, boolean share) {
            final byte[] data = android.util.Base64.decode(base64, android.util.Base64.DEFAULT);
            runOnUiThread(() -> {
                try {
                    android.net.Uri uri;
                    if (android.os.Build.VERSION.SDK_INT >= 29) {
                        android.content.ContentValues v = new android.content.ContentValues();
                        v.put(android.provider.MediaStore.Downloads.DISPLAY_NAME, name);
                        v.put(android.provider.MediaStore.Downloads.MIME_TYPE, mime);
                        v.put(android.provider.MediaStore.Downloads.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS + "/MTenn3D");
                        uri = getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                        try (java.io.OutputStream o = getContentResolver().openOutputStream(uri)) { o.write(data); }
                    } else {
                        java.io.File dir = getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS); dir.mkdirs();
                        java.io.File f = new java.io.File(dir, name);
                        try (java.io.FileOutputStream o = new java.io.FileOutputStream(f)) { o.write(data); }
                        uri = null;
                    }
                    android.widget.Toast.makeText(MainActivity.this, "Saved Downloads/MTenn3D/" + name, android.widget.Toast.LENGTH_LONG).show();
                    if (uri != null && share) {
                        android.content.Intent send = new android.content.Intent(android.content.Intent.ACTION_SEND);
                        send.setType("application/octet-stream"); send.putExtra(android.content.Intent.EXTRA_STREAM, uri);
                        send.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        startActivity(android.content.Intent.createChooser(send, "Share recording"));
                    }
                } catch (Exception e) {
                    android.widget.Toast.makeText(MainActivity.this, "Could not save: " + e.getMessage(), android.widget.Toast.LENGTH_LONG).show();
                }
            });
        }
    }
    @Override protected void onActivityResult(int req, int res, android.content.Intent data) {
        super.onActivityResult(req, res, data);
        if (req != 1 || pick == null) return;
        android.net.Uri u = res == RESULT_OK && data != null ? data.getData() : null;
        pick.onReceiveValue(u == null ? null : new android.net.Uri[] { u });
        pick = null;
    }
    private int[] cut = new int[4];
    private void pushCut() {
        final String js = "(function(){var s=document.documentElement.style;s.setProperty('--cut-l','" + cut[0] + "px');s.setProperty('--cut-t','" + cut[1]
                + "px');s.setProperty('--cut-r','" + cut[2] + "px');s.setProperty('--cut-b','" + cut[3] + "px');})();";
        web.post(() -> web.evaluateJavascript(js, null));
    }
    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
    }
    @Override public void onWindowFocusChanged(boolean f) { super.onWindowFocusChanged(f); if (f) immersive(); }
    /** A foldable's other screen (folding / unfolding), a turn, a new density: the game keeps running (the manifest takes these
     *  changes instead of restarting the activity); the bars are hidden again and the page gets the new screen's cutout. */
    @Override public void onConfigurationChanged(android.content.res.Configuration c) {
        super.onConfigurationChanged(c); immersive(); web.requestApplyInsets(); web.post(this::pushCut);
    }

    // ---- Bluetooth / USB controllers: forward buttons and sticks to the page as a bit mask ----
    private int padMask = 0, hatMask = 0, sentMask = -1;
    private void pushMask() {
        final int m = padMask | hatMask;
        if (m == sentMask) return;                        // joystick motion events arrive constantly; only changes matter
        sentMask = m;
        web.post(() -> web.evaluateJavascript("window.__padmask=" + m + ";", null));
    }
    private float sentX = 9, sentY = 9;
    private void pushStick(float x, float y) {
        if (Math.abs(x) < 0.12f && Math.abs(y) < 0.12f) { x = 0; y = 0; }    // (rest)
        if (Math.abs(x - sentX) < 0.02f && Math.abs(y - sentY) < 0.02f) return;  // motion events arrive constantly; small changes are dropped
        sentX = x; sentY = y; final String js = "window.__padstick=[" + x + "," + y + "];";
        web.post(() -> web.evaluateJavascript(js, null));
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
            pushMask(); pushStick(sx, sy); return true;           // the stick goes to the page as it is: web/js/stick.js reads it (STICK FEEL)
        }
        return super.dispatchGenericMotionEvent(e);
    }
    // ask for the display's highest refresh rate (e.g. 120 Hz) at the current resolution, so the page's
    // requestAnimationFrame (and the 3D view's smoothing between game frames) runs at it; the game itself
    // still steps at the Game Boy's ~60 Hz
    private void requestHighRefreshRate() {
        if (android.os.Build.VERSION.SDK_INT < 23) return;
        android.view.Display d = getWindowManager().getDefaultDisplay();
        android.view.Display.Mode cur = d.getMode(), best = cur;
        for (android.view.Display.Mode m : d.getSupportedModes())
            if (m.getPhysicalWidth() == cur.getPhysicalWidth() && m.getPhysicalHeight() == cur.getPhysicalHeight() && m.getRefreshRate() > best.getRefreshRate()) best = m;
        android.view.WindowManager.LayoutParams lp = getWindow().getAttributes();
        lp.preferredDisplayModeId = best.getModeId(); lp.preferredRefreshRate = best.getRefreshRate();
        getWindow().setAttributes(lp);
    }
    @Override public void onBackPressed() {           // keep the game running; Back shows / hides the page's button bar
        web.evaluateJavascript("window.__backPressed && window.__backPressed()", null);
    }
    @Override protected void onPause() {          // write a pending cartridge save before the WebView's timers stop
        web.evaluateJavascript("window.__flushSave && window.__flushSave(); window.__stopRec && window.__stopRec();", null);
        super.onPause(); web.onPause();
    }
    @Override protected void onResume() { super.onResume(); web.onResume(); pushGameMode(); }
    // Android's Game Mode (Samsung Game Booster's Performance / Battery profiles, Android 12+): passed to the page, which turns
    // its battery saver on in Battery mode (window.__gameMode: 1 standard, 2 performance, 3 battery, 4 custom)
    private void pushGameMode() {
        if (android.os.Build.VERSION.SDK_INT < 31) return;
        android.app.GameManager gm = getSystemService(android.app.GameManager.class);
        if (gm == null) return;
        final int m = gm.getGameMode();
        web.post(() -> web.evaluateJavascript("window.__gameMode && window.__gameMode(" + m + ")", null));
    }
}
