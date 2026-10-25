package lk.shaunstudios.riderise;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Receives Firebase Cloud Messaging messages for the Gradle build.
 *
 * <p>Two delivery shapes are handled:
 * <ul>
 *   <li><b>Notification payload</b> (what {@code backend/phase2/core.js} sends): while the app is
 *       in the background Play Services displays it with the channel, icon and colour declared in
 *       {@code AndroidManifest.xml}. Tapping it opens {@code MainActivity} with the
 *       {@code deep_link} extra, which the WebView shell turns into a route change.</li>
 *   <li><b>Foreground</b>: no system notification is shown automatically, so
 *       {@link #onMessageReceived(RemoteMessage)} builds the same notification itself.</li>
 * </ul>
 *
 * <p>Still untested in this repository: no Android SDK or device is available in the
 * development sandbox, so this class has not been compiled by Gradle or run on a phone.
 */
public class RideRiseMessagingService extends FirebaseMessagingService {

    private static final String TAG = "RideRiseFCM";
    private static final int REQUEST_OPEN = 4211;

    private static int nextNotificationId = 1000;

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        // Cache it: the WebView may not be alive yet. requestToken() re-delivers on next launch.
        PushBridge.storeToken(this, token);
        PushBridge.deliver(token);
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);

        RemoteMessage.Notification notification = message.getNotification();
        Map<String, String> data = message.getData();

        String title = notification != null ? notification.getTitle() : null;
        String body = notification != null ? notification.getBody() : null;
        if (title == null || title.isEmpty()) title = data.get("title");
        if (body == null || body.isEmpty()) body = data.get("body");
        if (title == null || title.isEmpty()) title = getString(R.string.app_name);

        String deepLink = data.get("deep_link");
        if (deepLink == null || deepLink.isEmpty()) {
            // Server default for system/security notices — see backend/phase2/admin.js.
            deepLink = "#/notifications";
        }

        show(title, body == null ? "" : body, deepLink);
    }

    private void show(String title, String body, String deepLink) {
        MainActivity.ensureNotificationChannel(this);

        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra(MainActivity.EXTRA_DEEP_LINK, deepLink);

        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentIntent = PendingIntent.getActivity(this, REQUEST_OPEN, open, flags);

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, MainActivity.NOTIFICATION_CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
            builder.setPriority(Notification.PRIORITY_HIGH);
        }

        builder.setSmallIcon(R.drawable.ic_notification)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setAutoCancel(true)
                .setContentIntent(contentIntent)
                .setCategory(Notification.CATEGORY_MESSAGE)
                .setColor(0xFFFF6B00);

        NotificationManager manager =
                (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && !manager.areNotificationsEnabled()) {
            Log.i(TAG, "Notification not shown: the rider has notifications off");
            return;
        }

        try {
            manager.notify(nextNotificationId++, builder.build());
        } catch (SecurityException denied) {
            // Android 13+: POST_NOTIFICATIONS not granted yet.
            Log.w(TAG, "Notification permission missing", denied);
        }
    }
}
