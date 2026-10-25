// RideRise LK — Android Studio / Gradle project settings.
//
// This folder is a self-contained Android project: `android/AndroidManifest.xml` and
// `android/res/` are shared with the SDK-free pipeline (`scripts/build_apk.sh`), so the
// two builds can never drift apart.
pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "RideRise-LK"
include(":app")
