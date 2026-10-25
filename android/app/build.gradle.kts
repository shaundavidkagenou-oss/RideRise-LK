import groovy.json.JsonSlurper
import java.util.Properties

// =============================================================================
// RideRise LK — Android application module (Android Studio / Gradle build)
//
//   ./gradlew :app:assembleDebug      -> app/build/outputs/apk/debug/app-debug.apk
//   ./gradlew :app:assembleRelease    -> signed with the project's existing release key
//
// Firebase Cloud Messaging is the only Firebase product in this app. Analytics is
// deliberately NOT added: RideRise LK does not initialise it
// (docs/PHASE2_SECURITY_AND_PRIVACY.md), and adding it would start collecting usage data
// without a rider's knowledge.
// =============================================================================
plugins {
    id("com.android.application")
    // Reads android/app/google-services.json and initialises Firebase at app start.
    id("com.google.gms.google-services")
}

/* ------------------------------- brand config ------------------------------ */
// config/brand.config.json is the single source of truth for the package id and version;
// scripts/build_apk.sh reads the same file, so the two APK pipelines always match.
val brand = JsonSlurper().parse(rootProject.file("../config/brand.config.json")) as Map<*, *>

fun brandString(key: String): String =
    brand[key] as? String ?: error("config/brand.config.json is missing a string \"$key\"")

fun brandInt(key: String): Int =
    (brand[key] as? Number)?.toInt() ?: error("config/brand.config.json is missing a number \"$key\"")

val packageId = brandString("packageId")
val appVersionName = brandString("versionName")
val appVersionCode = brandInt("versionCode")

/* ------------------------- built-in server address ------------------------- */
// Same source of truth as the SDK-free pipeline (scripts/build_apk.sh): the address a rider's
// app connects to without any setup. Set it with:
//   npm run configure:apk -- --url https://api.yourdomain.lk
// Empty means the app asks for an address on first launch.
val deploymentConfigFile = rootProject.file("../config/deployment.config.json")
val builtInApiBase: String = if (deploymentConfigFile.isFile) {
    val deploy = JsonSlurper().parse(deploymentConfigFile) as Map<*, *>
    (deploy["apiBaseUrl"] as? String)?.trim()?.trimEnd('/') ?: ""
} else {
    ""
}
if (builtInApiBase.isNotEmpty() && !builtInApiBase.startsWith("https://")) {
    throw GradleException(
        "config/deployment.config.json apiBaseUrl must start with https:// (got \"$builtInApiBase\"). " +
            "The app blocks cleartext HTTP. Set it with: npm run configure:apk -- --url https://..."
    )
}

/* -------------------------------- signing ---------------------------------- */
// Reuses the release keystore created by scripts/build_apk.sh so a Gradle build can be
// installed over an existing APK. Both the keystore and its credentials are git-ignored.
// Order of preference: android/keystore.properties, then the credentials file written by
// the SDK-free pipeline. Without either, release builds fall back to the debug key (and
// say so) instead of silently shipping an unsigned/other-key APK.
val keystoreDir = rootProject.file("keystore")
val releaseKeystore = keystoreDir.resolve("riderise-release.keystore")
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.isFile) keystorePropertiesFile.inputStream().use { load(it) }
}
val pipelineCredentials = keystoreDir.resolve("KEYSTORE-CREDENTIALS.txt")
val pipelineStorePassword: String? = if (pipelineCredentials.isFile) {
    Regex("storepass/keypass:\\s*(\\S+)").find(pipelineCredentials.readText())?.groupValues?.get(1)
} else {
    null
}
val releaseStorePassword = keystoreProperties.getProperty("storePassword") ?: pipelineStorePassword
val releaseKeyAlias = keystoreProperties.getProperty("keyAlias") ?: "riderise"
val hasReleaseKey = releaseKeystore.isFile && !releaseStorePassword.isNullOrBlank()

/* ----------------------------- FCM configuration --------------------------- */
val googleServicesFile = project.file("google-services.json")

android {
    namespace = packageId
    compileSdk = 35

    defaultConfig {
        applicationId = packageId
        minSdk = 24          // Firebase BoM 35 requires API 24+
        targetSdk = 34       // unchanged from the shipped SDK-free APK
        versionCode = appVersionCode
        versionName = appVersionName
        // Compiled into the APK; MainActivity bridges it to the web layer as getApiBase().
        resValue("string", "default_api_base", builtInApiBase)
    }

    sourceSets.getByName("main") {
        // Shared with scripts/build_apk.sh — one set of icons, themes and strings.
        res.srcDirs("src/main/res", "../res")
        // src/main/assets/webapp is produced by rrSyncWebAssets below (git-ignored), exactly
        // the bundle the SDK-free pipeline puts in the APK.
        assets.srcDir("src/main/assets")
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = releaseKeystore
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseStorePassword
            }
        }
    }

    buildTypes {
        debug {
            // No applicationIdSuffix: google-services.json is issued for the exact package
            // name, and FCM rejects a client with a different one. Debug and release builds
            // therefore share the id (only one can be installed at a time).
            isDebuggable = true
        }
        release {
            isMinifyEnabled = false
            signingConfig = if (hasReleaseKey) {
                signingConfigs.getByName("release")
            } else {
                logger.warn(
                    "RideRise LK: no release keystore found (android/keystore/riderise-release.keystore " +
                        "+ credentials). The release variant will be signed with the DEBUG key; do not " +
                        "publish it. Run `npm run apk:release` once to create the project keystore."
                )
                signingConfigs.getByName("debug")
            }
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }

    packaging {
        resources.excludes += setOf("META-INF/DEPENDENCIES", "META-INF/*.kotlin_module")
    }
}

dependencies {
    // Firebase Cloud Messaging only. The BoM pins a tested set of versions.
    implementation(platform("com.google.firebase:firebase-bom:35.1.0"))
    implementation("com.google.firebase:firebase-messaging")
}

/* ------------------------- bundle the web application ---------------------- */
// Mirrors step 2 of scripts/build_apk.sh: web_app/ -> assets/webapp/.
// The destination is git-ignored, so the Gradle project never duplicates the client source.
val rrSyncWebAssets = tasks.register<Sync>("rrSyncWebAssets") {
    group = "build"
    description = "Copies web_app/ into app/src/main/assets/webapp before every build."
    from(rootProject.file("../web_app"))
    into(layout.projectDirectory.dir("src/main/assets/webapp"))
    exclude("**/*.map", "**/.DS_Store")
}

/* -------------------------- google-services.json check --------------------- */
// Fails with the exact fix instead of Google's generic "File google-services.json is
// missing" or a silent package-name mismatch, and warns when the Android app points at a
// different Firebase project than the API server.
val checkGoogleServices = tasks.register("checkGoogleServices") {
    group = "verification"
    description = "Validates android/app/google-services.json against the package id and server project."

    doLast {
        if (!googleServicesFile.isFile) {
            throw GradleException(
                """
                Missing android/app/google-services.json.

                1. https://console.firebase.google.com/project/rideriselk/settings/general
                2. Your apps -> the Android app with package "$packageId"
                3. Download google-services.json and save it as android/app/google-services.json

                The file is git-ignored: never commit it.
                """.trimIndent()
            )
        }

        val config = try {
            JsonSlurper().parse(googleServicesFile) as Map<*, *>
        } catch (err: Exception) {
            throw GradleException("android/app/google-services.json is not valid JSON: ${err.message}")
        }

        val projectInfo = config["project_info"] as? Map<*, *>
            ?: throw GradleException("android/app/google-services.json has no project_info block.")
        val projectId = projectInfo["project_id"] as? String ?: "(unknown)"

        val clients = (config["client"] as? List<*>) ?: emptyList<Any?>()
        val clientPackages = clients.mapNotNull { entry ->
            val clientInfo = (entry as? Map<*, *>)?.get("client_info") as? Map<*, *>
            val androidInfo = clientInfo?.get("android_client_info") as? Map<*, *>
            androidInfo?.get("package_name") as? String
        }
        if (packageId !in clientPackages) {
            throw GradleException(
                "google-services.json has no Android client for \"$packageId\" " +
                    "(found: ${clientPackages.joinToString().ifEmpty { "none" }}). " +
                    "Register the app with this exact package name in the Firebase console and re-download it."
            )
        }

        val envFile = rootProject.file("../.env")
        if (envFile.isFile) {
            val serverProject = envFile.readLines()
                .firstOrNull { it.trim().startsWith("FIREBASE_PROJECT_ID=") }
                ?.substringAfter("=")
                ?.trim()
                ?.trim('"', '\'')
                ?.takeIf { it.isNotEmpty() }
            if (serverProject != null && serverProject != projectId) {
                logger.warn(
                    "RideRise LK: google-services.json belongs to Firebase project \"$projectId\" but the " +
                        "server verifies tokens for \"$serverProject\". Device tokens would be rejected by " +
                        "FCM. Use the same project in both places."
                )
            }
        }

        logger.lifecycle("RideRise LK: google-services.json OK (project $projectId, package $packageId)")
    }
}

tasks.matching { it.name == "preBuild" }.configureEach {
    dependsOn(checkGoogleServices, rrSyncWebAssets)
}
