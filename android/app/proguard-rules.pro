# RideRise LK — R8 rules.
#
# Minification is disabled by default (see app/build.gradle.kts); these rules keep the
# WebView JS bridge and the FCM entry points intact if a studio build turns it on.
-keepclassmembers class lk.shaunstudios.riderise.MainActivity$NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class lk.shaunstudios.riderise.PushBridge { *; }
-keep class lk.shaunstudios.riderise.RideRiseMessagingService { *; }
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**
