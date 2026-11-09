package org.velabrowser.vela

import android.app.Application
import org.velabrowser.vela.core.HistoryStore
import org.velabrowser.vela.core.SettingsStore

class VelaApp : Application() {
    val settings: SettingsStore by lazy { SettingsStore(this) }
    val history: HistoryStore by lazy { HistoryStore(this) }
}
