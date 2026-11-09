import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

/**
 * Release signing is resolved from (first match wins):
 *  1. environment: VELA_KEYSTORE_FILE, VELA_KEYSTORE_PASSWORD, VELA_KEY_ALIAS, VELA_KEY_PASSWORD (CI)
 *  2. a properties file (storeFile, storePassword, keyAlias, keyPassword) named by
 *     -Pvela.signing=<path> or the VELA_SIGNING_PROPERTIES environment variable (local builds)
 * With neither present the release APK is built unsigned.
 */
data class ReleaseSigning(val storeFile: File, val storePassword: String, val keyAlias: String, val keyPassword: String)

fun releaseSigning(): ReleaseSigning? {
    val env = System.getenv()
    val envFile = env["VELA_KEYSTORE_FILE"]?.takeIf { it.isNotBlank() }
    if (envFile != null) {
        val file = file(envFile)
        val storePassword = env["VELA_KEYSTORE_PASSWORD"].orEmpty()
        val alias = env["VELA_KEY_ALIAS"].orEmpty()
        if (file.exists() && storePassword.isNotEmpty() && alias.isNotEmpty()) {
            return ReleaseSigning(file, storePassword, alias, env["VELA_KEY_PASSWORD"]?.ifEmpty { null } ?: storePassword)
        }
    }
    val propsPath = (findProperty("vela.signing") as String?) ?: env["VELA_SIGNING_PROPERTIES"]
    val propsFile = propsPath?.let { file(it) }?.takeIf { it.exists() } ?: return null
    val props = Properties().apply { propsFile.inputStream().use { load(it) } }
    val store = props.getProperty("storeFile")?.let { path ->
        File(path).let { if (it.isAbsolute) it else File(propsFile.parentFile, path) }
    } ?: return null
    return ReleaseSigning(
        storeFile = store,
        storePassword = props.getProperty("storePassword") ?: return null,
        keyAlias = props.getProperty("keyAlias") ?: return null,
        keyPassword = props.getProperty("keyPassword") ?: props.getProperty("storePassword"),
    )
}

val signing = releaseSigning()

android {
    namespace = "org.velabrowser.vela"
    compileSdk = 37

    defaultConfig {
        applicationId = "org.velabrowser.vela"
        minSdk = 29
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
    }

    signingConfigs {
        if (signing != null) {
            create("release") {
                storeFile = signing.storeFile
                storePassword = signing.storePassword
                keyAlias = signing.keyAlias
                keyPassword = signing.keyPassword
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources.excludes += setOf("/META-INF/{AL2.0,LGPL2.1}", "/META-INF/*.version", "DebugProbesKt.bin", "kotlin-tooling-metadata.json")
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = false
        disable += setOf("GradleDependency", "NewerVersionAvailable", "AndroidGradlePluginVersion", "OldTargetApi")
    }

    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.webkit)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.graphics)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)

    testImplementation(libs.junit)
}
