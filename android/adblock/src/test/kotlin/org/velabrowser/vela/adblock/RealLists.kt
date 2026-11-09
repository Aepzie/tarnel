package org.velabrowser.vela.adblock

import java.io.File
import org.junit.jupiter.api.Assumptions.assumeTrue

/**
 * Real filter lists are not committed. Point `-PadblockLists=<dir>` (or env `VELA_ADBLOCK_LISTS`)
 * at a directory containing easylist.txt / easyprivacy.txt (and optionally peterlowe.txt).
 */
internal object RealLists {
    val dir: File? = System.getProperty("adblock.lists")?.takeIf { it.isNotBlank() }?.let(::File)

    fun file(name: String): File? = dir?.resolve(name)?.takeIf { it.isFile }

    fun requireAll(): List<String> {
        val easylist = file("easylist.txt")
        val easyprivacy = file("easyprivacy.txt")
        assumeTrue(easylist != null && easyprivacy != null, "real lists not available (set -PadblockLists=<dir>)")
        return listOfNotNull(easylist, easyprivacy, file("peterlowe.txt")).map { it.readText() }
    }
}
