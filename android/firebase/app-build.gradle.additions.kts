// Reference additions for a Gradle build (NOT compiled by scripts/build_apk.sh).
// Paste into app/build.gradle.kts, underneath the existing `plugins` block.
//
// Verified against current Android Studio templates at the time of writing; after syncing,
// let Android Studio's "Upgrade dependencies" resolve newer versions if it offers them.

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")          // only needed if you add Kotlin sources
    id("com.google.gms.google-services")        // Firebase: reads app/google-services.json
}

android {
    namespace = "lk.shaunstudios.riderise"
    compileSdk = 35

    defaultConfig {
        applicationId = "lk.shaunstudios.riderise"
        minSdk = 24
        targetSdk = 34                     // match the shipped manifest; raise after testing
        versionCode = 2
        versionName = "2.0.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // Bundle the same client assets the SDK-free pipeline ships, so both builds stay identical.
    sourceSets["main"].assets.srcDirs("src/main/assets")
}

tasks.register<Copy>("syncWebApp") {
    from(rootProject.file("../web_app"))
    into(layout.projectDirectory.dir("src/main/assets/webapp"))
}
// tasks.named("preBuild") { dependsOn("syncWebApp") }

dependencies {
    // Firebase Cloud Messaging
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging")

    // Optional, if you also want native Google Sign-In in the app (see docs/SETUP_GUIDE.md §4)
    // implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    // implementation("com.google.firebase:firebase-auth")
    // implementation("androidx.credentials:credentials:1.3.0")
    // implementation("androidx.credentials:credentials-play-services-auth:1.3.0")
    // implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
}
