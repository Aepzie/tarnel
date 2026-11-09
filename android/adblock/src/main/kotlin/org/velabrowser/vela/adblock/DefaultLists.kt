package org.velabrowser.vela.adblock

/** Default filter list subscriptions. Fetching and update scheduling are left to the app. */
object DefaultLists {
    const val EASYLIST = "https://easylist.to/easylist/easylist.txt"
    const val EASYPRIVACY = "https://easylist.to/easylist/easyprivacy.txt"
    const val PETER_LOWE =
        "https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=0&mimetype=plaintext"

    val urls: List<String> = listOf(EASYLIST, EASYPRIVACY, PETER_LOWE)
}
