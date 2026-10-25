package lk.shaunstudios.riderise;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
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
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.lang.reflect.Method;

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

    /**
     * FCM notification channel id. The server targets this channel
     * (backend/phase2/core.js: android.notification.channel_id) and the Gradle manifest
     * declares it as com.google.firebase.messaging.default_notification_channel_id.
     */
    public static final String NOTIFICATION_CHANNEL_ID = "riderise_default";

    /**
     * Intent extra carrying an in-app route such as "#/notifications". Play Services copies
     * FCM data keys into the launch intent, so a tapped notification opened from the
     * background carries "deep_link" without any native parsing step.
     */
    public static final String EXTRA_DEEP_LINK = "deep_link";
    /**
     * The bundled UI is served over a virtual HTTPS origin instead of file://.
     *
     * Firebase Authentication (and browser storage generally) needs a real, secure origin:
     * from file:// the WebView reports "Origin: null", localStorage can be evicted between
     * launches and Firebase's persisted sign-in is unreliable. Serving the same bundled
     * files from https://appassets.androidplatform.net keeps everything inside the APK while
     * giving the WebView the same origin semantics as the hosted app.
     */
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String ASSET_ORIGIN = "https://" + ASSET_HOST;
    private static final String APP_ASSET_URL = ASSET_ORIGIN + "/index.html";
    private static final String WEBAPP_ASSET_DIR = "webapp";

    private WebView webView;
    private ProgressBar progressBar;
    private ImageView splashLogo;
    private ValueCallback<Uri[]> filePathCallback;
    private PermissionRequest pendingAudioRequest;
    private GeolocationPermissions.Callback pendingGeoCallback;
    private String pendingGeoOrigin;
    private String pendingDeepLink;
    private long lastBackPressedAt = 0L;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Create the channel before any push can arrive, so the server's channel_id resolves
        // even on a cold start triggered by a notification.
        ensureNotificationChannel(this);
        Intent launch = getIntent();
        if (launch != null) pendingDeepLink = launch.getStringExtra(EXTRA_DEEP_LINK);

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
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (uri != null && "https".equals(uri.getScheme()) && ASSET_HOST.equals(uri.getHost())) {
                return serveBundledAsset(uri);
            }
            return super.shouldInterceptRequest(view, request);
        }

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
            // A notification tap that launched the app is applied once the web app is ready.
            deliverDeepLink();
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            String scheme = uri.getScheme() == null ? "" : uri.getScheme();
            String host = uri.getHost() == null ? "" : uri.getHost();

            if ("file".equals(scheme) && host.equals("")) {
                return false; // legacy bundled asset URL, kept for older builds
            }
            if ("https".equals(scheme) && ASSET_HOST.equals(host)) {
                return false; // bundled application assets served by shouldInterceptRequest
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

    private static String assetMimeType(String path) {
        String lower = path.toLowerCase(java.util.Locale.US);
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js")) return "application/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".ttf")) return "font/ttf";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".wav")) return "audio/wav";
        if (lower.endsWith(".mp4")) return "video/mp4";
        if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text/plain";
        return "application/octet-stream";
    }

    /**
     * Maps a request on the virtual origin to a file inside assets/webapp.
     * Returns null when the request is not for the bundled origin (let WebView handle it).
     */
    private WebResourceResponse serveBundledAsset(Uri uri) {
        if (uri == null) return null;
        String path = uri.getPath();
        if (path == null || path.isEmpty() || "/".equals(path)) {
            path = "/index.html";
        }
        if (path.contains("..")) {
            return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden",
                    new java.util.HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
        }
        String assetPath = WEBAPP_ASSET_DIR + path;
        InputStream stream = null;
        try {
            stream = getAssets().open(assetPath);
        } catch (IOException notFound) {
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                    new java.util.HashMap<String, String>(),
                    new ByteArrayInputStream("Not found".getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        }
        java.util.HashMap<String, String> headers = new java.util.HashMap<String, String>();
        headers.put("Cache-Control", "no-cache");
        // Same-origin document loads never need CORS, but the virtual origin is also used by
        // workers and XHR back into the app shell, so keep it consistent with the API server.
        headers.put("X-Content-Type-Options", "nosniff");
        return new WebResourceResponse(assetMimeType(path), "UTF-8", 200, "OK", headers, stream);
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
                            ? getString(R.string.notifications_requested)
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
        if ("https".equals(scheme)) {
            return ASSET_HOST.equals(origin.getHost());
        }
        return "file".equals(scheme)
                && (origin.getHost() == null || origin.getHost().isEmpty() || "localhost".equals(origin.getHost()));
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

    /**
     * Server address compiled into this build (res/values/deployment.xml, written by
     * scripts/build_apk.sh from config/deployment.config.json). Empty when the studio has not
     * set one, in which case a fresh install asks the rider for an address.
     */
    private String builtInApiBase() {
        String value;
        try {
            value = getString(R.string.default_api_base);
        } catch (Exception e) {
            return "";
        }
        if (value == null) return "";
        value = value.trim();
        while (value.endsWith("/")) value = value.substring(0, value.length() - 1);
        return value;
    }

    /** Minimal, whitelisted native bridge. No reflection, no file system or credential access. */
    private final class NativeBridge {
        /**
         * The address the app should call. A rider's own choice (SharedPreferences) wins;
         * otherwise the address baked into the build is used, so a downloaded app is ready
         * to register with no setup screen.
         */
        @JavascriptInterface
        public String getApiBase() {
            SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
            String saved = prefs.getString(KEY_API_BASE, "");
            if (saved != null && saved.trim().length() > 0) return saved.trim();
            return builtInApiBase();
        }

        /** The address baked into this build (used by Settings to offer "reset to built-in"). */
        @JavascriptInterface
        public String getDefaultApiBase() {
            return builtInApiBase();
        }

        @JavascriptInterface
        public void setApiBase(String url) {
            if (url == null) return;
            String clean = url.trim();
            if (!clean.startsWith("https://") && !clean.startsWith("http://")) return;
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_API_BASE, clean).apply();
        }

        /** Forget a rider's override and fall back to the address compiled into the build. */
        @JavascriptInterface
        public void resetApiBase() {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(KEY_API_BASE).apply();
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

        /**
         * Asks Firebase for the FCM registration token. Implemented by PushBridge, which only
         * exists in the Gradle build: the SDK-free APK (no Play Services) resolves nothing and
         * stays exactly as it was. Reflection keeps one MainActivity for both pipelines.
         */
        @JavascriptInterface
        public void requestPushToken() {
            try {
                Class<?> bridge = Class.forName("lk.shaunstudios.riderise.PushBridge");
                Method request = bridge.getMethod("requestToken", WebView.class, Context.class);
                request.invoke(null, webView, getApplicationContext());
            } catch (ClassNotFoundException noFirebase) {
                Log.i(TAG, "Push disabled: this build has no Firebase Messaging (SDK-free APK)");
            } catch (Throwable err) {
                Log.w(TAG, "FCM token request failed", err);
            }
        }

        /** Last cached FCM token (empty string when push has never registered). */
        @JavascriptInterface
        public String getPushToken() {
            // Same file/keys as PushBridge.PREFS / PushBridge.KEY_TOKEN.
            SharedPreferences prefs = getSharedPreferences("riderise_push", MODE_PRIVATE);
            return prefs.getString("fcm_token", "");
        }

        @JavascriptInterface
        public String getPlatformInfo() {
            return "{\"platform\":\"android\",\"sdk\":" + Build.VERSION.SDK_INT
                    + ",\"versionName\":\"" + appVersionName() + "\"}";
        }

        @JavascriptInterface
        public void openExternal(String url) {
            if (url == null) return;
            if (url.startsWith("https://") || url.startsWith("http://")) {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            }
        }
    }

    /** Version name straight from the installed package, so it can never drift from the build. */
    private String appVersionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "unknown";
        }
    }

    /** Reuse the running task when a notification is tapped (android:launchMode="singleTop"). */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent == null) return;
        String link = intent.getStringExtra(EXTRA_DEEP_LINK);
        if (link == null || link.isEmpty()) return;
        pendingDeepLink = link;
        deliverDeepLink();
    }

    /**
     * Applies a pending notification route inside the WebView. Only in-app hash routes are
     * accepted, so a crafted notification cannot navigate the shell to a remote page.
     */
    private void deliverDeepLink() {
        if (pendingDeepLink == null || pendingDeepLink.isEmpty() || webView == null) return;
        String link = pendingDeepLink;
        pendingDeepLink = null;
        String hash = link.startsWith("#") ? link.substring(1) : link;
        if (!hash.startsWith("/")) {
            Log.w(TAG, "Ignoring notification deep link that is not an in-app route: " + link);
            return;
        }
        String quoted = "\"" + hash.replace("\\", "\\\\").replace("\"", "\\\"")
                .replace("\n", "").replace("\r", "") + "\"";
        webView.evaluateJavascript("location.hash = " + quoted, null);
    }

    /**
     * Declares the notification channel the server targets. Plain android.app APIs, so the
     * SDK-free APK calls the same method and gets the same channel.
     */
    public static void ensureNotificationChannel(Context context) {
        if (context == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager =
                (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(NOTIFICATION_CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                context.getString(R.string.notification_channel_name),
                NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription(context.getString(R.string.notification_channel_description));
        channel.enableVibration(true);
        manager.createNotificationChannel(channel);
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
