pluginManagement {
    repositories {
        google()
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

rootProject.name = "vela-android"

include(":app")

// The pure-Kotlin ad-blocking engine lives in its own module and is picked up once it exists.
if (file("adblock/build.gradle.kts").exists()) {
    include(":adblock")
}
