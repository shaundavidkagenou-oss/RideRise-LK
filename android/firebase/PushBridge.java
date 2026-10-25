package lk.shaunstudios.riderise;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;
import android.webkit.WebView;

import com.google.firebase.messaging.FirebaseMessaging;

import org.json.JSONObject;

/**
 * Reference bridge between Firebase Messaging and the bundled web client.
 *
 * Not compiled or executed in the development sandbox. Add it to your Gradle project and
 * expose the two methods from MainActivity's NativeBridge:
 *
 * <pre>
 *   private final PushBridge pushBridge = new PushBridge(this, webView);   // after webView exists
 *
 *   &#64;JavascriptInterface
 *   public void requestPushToken() { pushBridge.requestToken(); }
 *
 *   &#64;JavascriptInterface
 *   public String getPushToken() { return pushBridge.getToken(); }
 * </pre>
 *
 * The web client (web_app/app.js) calls {@code RRAndroid.requestPushToken()} after sign-in and
 * receives the token through {@code window.RR.onPushToken(token)}, which POSTs it to
 * {@code /api/devices} with the rider's bearer token. Keeping the registration in the web
 * layer means the native side never has to hold a session token.
 */
public final class PushBridge {

    private static final String TAG = "RideRisePush";
    private static final String PREFS = "riderise_push";
    private static final String KEY_TOKEN = "fcm_token";

    private final Context context;
    private final WebView webView;

    public PushBridge(Context context, WebView webView) {
        this.context = context.getApplicationContext();
        this.webView = webView;
    }

    private SharedPreferences prefs() {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Last token seen by the app, or an empty string before the first fetch completes. */
    public String getToken() {
        return prefs().getString(KEY_TOKEN, "");
    }

    public void cacheToken(String token) {
        if (token == null || token.isEmpty()) return;
        prefs().edit().putString(KEY_TOKEN, token).apply();
    }

    /** Ask Firebase for the current token and push it to the web layer. */
    public void requestToken() {
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful() || task.getResult() == null) {
                Log.w(TAG, "FCM token request failed", task.getException());
                return;
            }
            String token = task.getResult();
            cacheToken(token);
            deliver(token);
        });
    }

    /** Hand the token to the web app, which registers it with the backend. */
    public void deliver(String token) {
        if (webView == null || token == null || token.isEmpty()) return;
        String quoted;
        try {
            quoted = JSONObject.quote(token);
        } catch (Exception e) {
            return;
        }
        String js = "window.RR && window.RR.onPushToken && window.RR.onPushToken(" + quoted + ")";
        webView.post(() -> {
            try {
                webView.evaluateJavascript(js, null);
            } catch (Exception e) {
                Log.w(TAG, "Could not deliver the FCM token to the web layer", e);
            }
        });
    }

    /** Call from MainActivity when the rider signs out, so this device stops receiving pushes. */
    public void forget() {
        String token = getToken();
        prefs().edit().remove(KEY_TOKEN).apply();
        if (!token.isEmpty()) {
            FirebaseMessaging.getInstance().deleteToken();
        }
    }
}
