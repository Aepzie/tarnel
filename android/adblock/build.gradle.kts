plugins {
    kotlin("jvm")
}

group = "org.velabrowser.vela"
version = "0.1.0"

kotlin {
    jvmToolchain(17)
}

dependencies {
    testImplementation(kotlin("test"))
    testImplementation(platform("org.junit:junit-bom:5.11.4"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform {
        if (!project.hasProperty("benchmark")) excludeTags("benchmark")
    }
    maxHeapSize = "1g"
    val listsDir = (project.findProperty("adblockLists") as String?) ?: System.getenv("VELA_ADBLOCK_LISTS") ?: ""
    systemProperty("adblock.lists", listsDir)
    testLogging {
        events("failed", "skipped")
        showStandardStreams = project.hasProperty("benchmark")
        exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL
    }
}
