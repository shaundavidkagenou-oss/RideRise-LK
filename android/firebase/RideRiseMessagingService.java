package lk.shaunstudios.riderise;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * Reference Firebase Messaging service for the Gradle build.
 *
 * Not compiled or executed in the development sandbox — review it with the rest of your
 * Gradle app. The server already strips private content when the rider keeps previews off,
 * so this class only has to display what it is given and open the right screen on tap.
 */
public class RideRiseMessagingService extends FirebaseMessagingService {

    public static final String CHANNEL_ID = "riderise_default";
    private static final String CHANNEL_NAME = "RideRise LK updates";

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel(this);
    }

    /** Create the channel the server targets; safe to call repeatedly. */
    public static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;

        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_DEFAULT
        );
        // Private messages must never render as a floating heads-up by default.
        channel.setDescription("Friend requests, guild invites, event reminders and studio news.");
        channel.enableVibration(true);
        manager.createNotificationChannel(channel);
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        if (message.getNotification() == null) {
            // Data-only message: the server currently sends a notification payload, so this
            // branch only runs if you switch to data-only delivery.
            return;
        }

        String title = message.getNotification().getTitle();
        String body = message.getNotification().getBody();
        String deepLink = message.getData().get("deep_link");
        if (deepLink == null) deepLink = "";

        Intent intent = new Intent(this, MainActivity.class);
        intent.putExtra("deep_link", deepLink);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(
                this,
                deepLink.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // The small icon must be a white-on-transparent drawable; add @drawable/ic_notification
        // to your project (see AndroidManifest.additions.xml).
        int icon = getResources().getIdentifier("ic_notification", "drawable", getPackageName());
        if (icon == 0) icon = android.R.drawable.ic_dialog_info;

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(icon)
                .setContentTitle(title == null ? "RideRise LK" : title)
                .setContentText(body == null ? "" : body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body == null ? "" : body))
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
                .setContentIntent(pending);

        NotificationManagerCompat manager = NotificationManagerCompat.from(this);
        try {
            // Android 13+ requires POST_NOTIFICATIONS; MainActivity asks for it at runtime.
            manager.notify((int) (System.currentTimeMillis() % Integer.MAX_VALUE), builder.build());
        } catch (SecurityException ignored) {
            // Permission revoked between checks — drop the notification rather than crash.
        }
    }

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        PushBridge cache = new PushBridge(this, null);
        cache.cacheToken(token);
        // The web layer registers the token with the backend after sign-in, where the session
        // token lives (see web_app/app.js → window.RR.onPushToken).
    }
}
