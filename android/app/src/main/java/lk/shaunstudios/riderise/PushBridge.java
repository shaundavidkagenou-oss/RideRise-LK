package lk.shaunstudios.riderise;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import android.webkit.WebView;

import com.google.android.gms.tasks.OnCompleteListener;
import com.google.android.gms.tasks.Task;
import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

import java.lang.ref.WeakReference;

/**
 * Bridge between Firebase Cloud Messaging and the bundled web client.
 *
 * <p>Only the Gradle build compiles this class (the SDK-free pipeline in
 * {@code scripts/build_apk.sh} has no Play Services). {@code MainActivity.NativeBridge}
 * reaches it reflectively, so a single MainActivity still builds in both pipelines; when the
 * class is absent the JS call is a no-op and the app runs exactly as before.
 *
 * <p>Token flow: {@code web_app/app.js} calls {@code RRAndroid.requestPushToken()} after
 * sign-in → this class asks Firebase for the registration token → the token is handed back
 * through {@code window.RR.onPushToken(token)} → the web layer POSTs it to {@code /api/devices}
 * with the rider's bearer token. The native side never holds a session credential.
 */
public final class PushBridge {

    private static final String TAG = "RideRisePush";

    /** Shared with MainActivity.NativeBridge.getPushToken(); keep the names in sync. */
    static final String PREFS = "riderise_push";
    static final String KEY_TOKEN = "fcm_token";

    private static WeakReference<WebView> activeWebView = new WeakReference<WebView>(null);

    private PushBridge() {
    }

    /** Remember the WebView that should receive token callbacks. */
    public static void attach(WebView webView) {
        activeWebView = new WeakReference<WebView>(webView);
    }

    public static void detach(WebView webView) {
        WebView current = activeWebView.get();
        if (current == null || current == webView) {
            activeWebView = new WeakReference<WebView>(null);
        }
    }

    /** Last token seen by this install, or an empty string before the first successful fetch. */
    public static String getToken(Context context) {
        return prefs(context).getString(KEY_TOKEN, "");
    }

    /** Called by RideRiseMessagingService.onNewToken and by requestToken(). */
    static void storeToken(Context context, String token) {
        if (token == null || token.isEmpty()) return;
        prefs(context).edit().putString(KEY_TOKEN, token).apply();
    }

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /**
     * Ask Firebase for the current registration token and hand it to the web layer.
     *
     * <p>Invoked from {@code MainActivity.NativeBridge.requestPushToken()} through reflection:
     * {@code getMethod("requestToken", WebView.class, Context.class)}.
     */
    public static void requestToken(final WebView webView, Context context) {
        if (context == null) return;
        if (webView != null) attach(webView);
        final Context appContext = context.getApplicationContext();

        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(
                    new OnCompleteListener<String>() {
                        @Override
                        public void onComplete(Task<String> task) {
                            if (!task.isSuccessful() || task.getResult() == null) {
                                Log.w(TAG, "FCM token request failed", task.getException());
                                return;
                            }
                            String token = task.getResult();
                            storeToken(appContext, token);
                            deliver(token);
                        }
                    });
        } catch (Throwable unavailable) {
            // No google-services.json / no Play Services on the device: push stays off.
            Log.w(TAG, "Firebase Messaging unavailable in this build", unavailable);
        }
    }

    /** Hand a token to the web app, which registers it with the backend. */
    public static void deliver(String token) {
        if (token == null || token.isEmpty()) return;
        final String js = "window.RR && window.RR.onPushToken && window.RR.onPushToken("
                + JSONObject.quote(token) + ")";
        WebView webView = activeWebView.get();
        if (webView == null) return;
        webView.post(new Runnable() {
            @Override
            public void run() {
                WebView target = activeWebView.get();
                if (target == null) return;
                try {
                    target.evaluateJavascript(js, null);
                } catch (Exception err) {
                    Log.w(TAG, "Could not deliver the FCM token to the web layer", err);
                }
            }
        });
    }

    /**
     * Call when the rider signs out so this device stops receiving pushes.
     * The server-side row is removed by {@code DELETE /api/devices} from the web layer.
     */
    public static void forget(Context context) {
        prefs(context).edit().remove(KEY_TOKEN).apply();
        try {
            FirebaseMessaging.getInstance().deleteToken();
        } catch (Throwable err) {
            Log.w(TAG, "deleteToken failed", err);
        }
    }
}
