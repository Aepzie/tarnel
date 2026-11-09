package org.velabrowser.vela.ui.brand

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/**
 * The Android logo is generated from the desktop's src/shared/brand-mark.ts by android/scripts/brand-mark.mjs.
 * Fails when brand-mark.ts changed and the generator was not re-run (`./gradlew :app:syncBrandMark`).
 */
class BrandMarkSyncTest {
    private val source: String? = generateSequence(File("").absoluteFile) { it.parentFile }
        .map { File(it, "src/shared/brand-mark.ts") }
        .firstOrNull { it.isFile }
        ?.readText()

    private fun constant(name: String): String =
        Regex("export const $name\\s*=\\s*'([^']+)'").find(source!!)?.groupValues?.get(1) ?: error("$name missing")

    @Test
    fun generatedMarkMatchesDesktopSource() {
        assumeTrue("desktop sources not checked out", source != null)
        val hint = "run ./gradlew :app:syncBrandMark"
        assertEquals(hint, constant("BRAND_CAP_PATH"), BrandMark.CAP_PATH)
        assertEquals(hint, constant("BRAND_BODY_PATH"), BrandMark.BODY_PATH)
        assertEquals(hint, constant("BRAND_ACCENT").removePrefix("#").lowercase(), "%06x".format(BrandMark.ACCENT and 0xFFFFFF))
        val drawable = generateSequence(File("").absoluteFile) { it.parentFile }
            .map { File(it, "app/src/main/res/drawable/ic_vela_mark.xml") }
            .first { it.isFile }
            .readText()
        assertTrue(hint, drawable.contains(BrandMark.CAP_PATH) && drawable.contains(BrandMark.BODY_PATH))
    }
}
