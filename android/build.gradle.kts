// RideRise LK — root Gradle build.
//
// Toolchain versions are pinned here so a Firebase Cloud Messaging build is reproducible:
//   * Android Gradle Plugin 8.7.3  (needs Gradle 8.9+, JDK 17)
//   * Google services plugin 4.5.0 (Google's current release, AGP 7.3+)
// The Firebase SDK versions themselves live in app/build.gradle.kts (BoM 35.1.0).
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("com.google.gms.google-services") version "4.5.0" apply false
}
