// Standalone build for the adblock engine (cd android/adblock && ./gradlew test).
// When the module is included into the app build as ":adblock", this file is ignored and the
// Kotlin plugin version comes from the app's root build/settings instead.
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
    plugins {
        kotlin("jvm") version "2.2.21"
    }
}

dependencyResolutionManagement {
    repositories {
        mavenCentral()
    }
}

rootProject.name = "adblock"
