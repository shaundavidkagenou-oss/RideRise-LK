package lk.shaunstudios.riderise;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.media.AudioManager;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.ConsoleMessage;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

/**
 * RideRise LK — Android shell by Shaun David Studios.
 *
 * The full Phase 1 application (design system, feed, stunt library, bike questionnaire,
 * guilds, catalog, events, moderation) runs inside this WebView from bundled assets.
 * Native bridges expose only what a browser cannot do itself: the Android share sheet,
 * the system file picker, notification permission, and a configurable API endpoint.
 */
public class MainActivity extends Activity {

    private static final String TAG = "RideRiseLK";
    private static final String PREFS = "riderise_prefs";
    private static final String KEY_API_BASE = "api_base_url";
    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_NOTIFICATIONS = 1002;
    private static final int REQ_MICROPHONE = 1003;
    private static final int REQ_LOCATION = 1004;
    private static final String APP_ASSET_URL = "file:///android_asset/webapp/index.html";

    private WebView webView;
    private ProgressBar progressBar;
    private ImageView splashLogo;
    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingAudioRequest;
    private GeolocationPermissions.Callback pendingGeoCallback;
    private String pendingGeoOrigin;
    private long lastBackPressedAt = 0L;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF07090E);

        webView = new WebView(this);
        webView.setBackgroundColor(0xFF07090E);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        // The bundled UI is served from file:// and calls the configured HTTPS API, so the
        // WebView must be allowed to make cross-origin requests from local app assets.
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setGeolocationEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " RideRiseLK/1.0 (Android)");
        CookieManager.getInstance().setAcceptCookie(true);

        webView.addJavascriptInterface(new NativeBridge(), "RRAndroid");
        webView.setWebViewClient(new RideRiseWebViewClient());
        webView.setWebChromeClient(new RideRiseWebChromeClient());

        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        splashLogo = new ImageView(this);
        try {
            Bitmap badge = BitmapFactory.decodeStream(getAssets().open("webapp/assets/brand/riderise_logo.png"));
            splashLogo.setImageBitmap(badge);
        } catch (Exception e) {
            Log.w(TAG, "Splash badge unavailable", e);
        }
        splashLogo.setAlpha(0.96f);
        FrameLayout.LayoutParams logoParams = new FrameLayout.LayoutParams(420, 420);
        logoParams.gravity = android.view.Gravity.CENTER;
        root.addView(splashLogo, logoParams);

        progressBar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progressBar.setMax(100);
        progressBar.setProgress(0);
        FrameLayout.LayoutParams progressParams = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 8);
        progressParams.gravity = android.view.Gravity.TOP;
        progressBar.setVisibility(View.GONE);
        root.addView(progressBar, progressParams);

        setContentView(root);
        webView.loadUrl(APP_ASSET_URL);
    }

    private final class RideRiseWebViewClient extends WebViewClient {
        @Override
        public void onPageFinished(WebView view, String url) {
            super.onPageFinished(view, url);
            // Fade the native splash out once the bundled app has painted.
            splashLogo.animate().alpha(0f).setDuration(320).withEndAction(new Runnable() {
                @Override
                public void run() {
                    splashLogo.setVisibility(View.GONE);
                }
            }).start();
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String scheme = uri.getScheme() == null ? "" : uri.getScheme();
            String host = uri.getHost() == null ? "" : uri.getHost();

            if ("file".equals(scheme) && host.equals("")) {
                return false; // bundled application assets
            }
            if ("https".equals(scheme) || "http".equals(scheme)) {
                // Never navigate the WebView away from the bundled app: open externally.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception e) {
                    Toast.makeText(MainActivity.this, "No app can open this link", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
            return true; // block javascript:, intent:, content: and unknown schemes
        }
    }

    private final class RideRiseWebChromeClient extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            if (newProgress < 100) {
                progressBar.setVisibility(View.VISIBLE);
                progressBar.setProgress(newProgress);
            } else {
                progressBar.setVisibility(View.GONE);
            }
        }

        @Override
        public boolean onConsoleMessage(ConsoleMessage message) {
            Log.d(TAG, message.message() + " @" + message.sourceId() + ":" + message.lineNumber());
            return true;
        }

        /**
         * Grant microphone capture only to the bundled application assets, and only after
         * the rider has approved the Android runtime permission. Remote pages never receive
         * camera or microphone access through this shell.
         */
        @Override
        public void onPermissionRequest(final PermissionRequest request) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    boolean trusted = isBundledOrigin(request.getOrigin());
                    boolean wantsAudio = false;
                    for (String resource : request.getResources()) {
                        if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) {
                            wantsAudio = true;
                        }
                    }
                    if (!trusted || !wantsAudio) {
                        request.deny();
                        return;
                    }
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
                    } else {
                        pendingAudioRequest = request;
                        requestPermissions(new String[] { Manifest.permission.RECORD_AUDIO }, REQ_MICROPHONE);
                    }
                }
            });
        }

        /** Geolocation is only offered to the bundled app, and only with an explicit tap. */
        @Override
        public void onGeolocationPermissionsShowPrompt(final String origin, final GeolocationPermissions.Callback callback) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (!isBundledOrigin(Uri.parse(origin))) {
                        callback.invoke(origin, false, false);
                        return;
                    }
                    if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                        callback.invoke(origin, true, false);
                        return;
                    }
                    pendingGeoCallback = callback;
                    pendingGeoOrigin = origin;
                    requestPermissions(
                            new String[] { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION },
                            REQ_LOCATION);
                }
            });
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(null);
            }
            filePathCallback = callback;

            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("image/*");
            try {
                startActivityForResult(Intent.createChooser(intent, "Select a bicycle or profile photo"), REQ_FILE_CHOOSER);
                return true;
            } catch (Exception e) {
                filePathCallback = null;
                Toast.makeText(MainActivity.this, "No file picker available", Toast.LENGTH_SHORT).show();
                return false;
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            if (filePathCallback == null) {
                super.onActivityResult(requestCode, resultCode, data);
                return;
            }
            Uri[] results = null;
            if (resultCode == Activity.RESULT_OK && data != null && data.getData() != null) {
                results = new Uri[] { data.getData() };
            }
            filePathCallback.onReceiveValue(results);
            filePathCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQ_MICROPHONE) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (pendingAudioRequest != null) {
                if (granted) {
                    pendingAudioRequest.grant(new String[] { PermissionRequest.RESOURCE_AUDIO_CAPTURE });
                } else {
                    pendingAudioRequest.deny();
                }
                pendingAudioRequest = null;
            }
            if (!granted) {
                Toast.makeText(this, "Microphone denied. Voice and walkie-talkie need microphone access.", Toast.LENGTH_LONG).show();
            }
            return;
        }
        if (requestCode == REQ_LOCATION) {
            boolean granted = false;
            for (int result : grantResults) {
                if (result == PackageManager.PERMISSION_GRANTED) granted = true;
            }
            if (pendingGeoCallback != null) {
                pendingGeoCallback.invoke(pendingGeoOrigin, granted, false);
                pendingGeoCallback = null;
                pendingGeoOrigin = null;
            }
            if (!granted) {
                Toast.makeText(this, "Location denied. Guild map sharing stays off.", Toast.LENGTH_LONG).show();
            }
            return;
        }
        if (requestCode == REQ_NOTIFICATIONS) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            Toast.makeText(
                    this,
                    granted
                            ? "Notifications allowed. Register your FCM token with the backend to receive event reminders."
                            : "Notifications declined — you can enable them later in Android settings.",
                    Toast.LENGTH_LONG).show();
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    @Override
    public void onBackPressed() {
        // Hash-routed single page app: step back through history before exiting.
        webView.evaluateJavascript(
                "(function(){ if (window.history.length > 1) { window.history.back(); return 'back'; } return 'exit'; })()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        boolean atRoot = value != null && value.contains("exit");
                        if (!atRoot) {
                            return;
                        }
                        long now = System.currentTimeMillis();
                        if (now - lastBackPressedAt < 2000) {
                            finish();
                        } else {
                            lastBackPressedAt = now;
                            Toast.makeText(MainActivity.this, R.string.back_to_exit, Toast.LENGTH_SHORT).show();
                        }
                    }
                });
    }

    /** Only file:// assets bundled inside the APK may use device capture APIs. */
    private boolean isBundledOrigin(Uri origin) {
        if (origin == null) return false;
        String scheme = origin.getScheme();
        return "file".equals(scheme) && (origin.getHost() == null || origin.getHost().isEmpty() || "localhost".equals(origin.getHost()));
    }

    /**
     * Route call audio to a connected Bluetooth headset where Android exposes it.
     * WebView does not implement setSinkId, so this is the supported native path.
     * Returns true when a SCO route was requested.
     */
    private boolean requestBluetoothAudioRoute() {
        try {
            AudioManager audio = (AudioManager) getSystemService(AUDIO_SERVICE);
            if (audio == null) return false;
            audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                if (checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
                    return false;
                }
            }
            audio.startBluetoothSco();
            audio.setBluetoothScoOn(true);
            return true;
        } catch (Exception e) {
            Log.w(TAG, "Bluetooth audio routing unavailable", e);
            return false;
        }
    }

    private boolean releaseBluetoothAudioRoute() {
        try {
            AudioManager audio = (AudioManager) getSystemService(AUDIO_SERVICE);
            if (audio == null) return false;
            audio.stopBluetoothSco();
            audio.setBluetoothScoOn(false);
            audio.setMode(AudioManager.MODE_NORMAL);
            return true;
        } catch (Exception e) {
            Log.w(TAG, "Bluetooth audio release failed", e);
            return false;
        }
    }

    /** Minimal, whitelisted native bridge. No reflection, no file system or credential access. */
    private final class NativeBridge {
        @JavascriptInterface
        public String getApiBase() {
            SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
            return prefs.getString(KEY_API_BASE, "");
        }

        @JavascriptInterface
        public void setApiBase(String url) {
            if (url == null) return;
            String clean = url.trim();
            if (!clean.startsWith("https://") && !clean.startsWith("http://")) return;
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_API_BASE, clean).apply();
        }

        @JavascriptInterface
        public void shareText(String title, String text) {
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("text/plain");
            send.putExtra(Intent.EXTRA_SUBJECT, title == null ? "RideRise LK" : title);
            send.putExtra(Intent.EXTRA_TEXT, text == null ? "" : text);
            startActivity(Intent.createChooser(send, "Share via"));
        }

        @JavascriptInterface
        public boolean routeAudioToBluetooth() {
            return requestBluetoothAudioRoute();
        }

        @JavascriptInterface
        public boolean resetAudioRoute() {
            return releaseBluetoothAudioRoute();
        }

        @JavascriptInterface
        public boolean requestNotificationPermission() {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
                    return true;
                }
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQ_NOTIFICATIONS);
                    }
                });
                return false;
            }
            return true; // pre-Android 13 has no runtime notification permission
        }

        @JavascriptInterface
        public String getPlatformInfo() {
            return "{\"platform\":\"android\",\"sdk\":" + Build.VERSION.SDK_INT
                    + ",\"versionName\":\"" + BuildConfigVersion.NAME + "\"}";
        }

        @JavascriptInterface
        public void openExternal(String url) {
            if (url == null) return;
            if (url.startsWith("https://") || url.startsWith("http://")) {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            }
        }
    }

    /** Version metadata mirrored into Java (kept in sync by scripts/build_apk.sh). */
    static final class BuildConfigVersion {
        static final String NAME = "1.0.0";
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("RRAndroid");
            webView.destroy();
        }
        super.onDestroy();
    }
}
