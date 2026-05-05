package com.example.phonerakshak

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/** Auto-starts the foreground service after device boot. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action == Intent.ACTION_BOOT_COMPLETED ||
            action == "android.intent.action.QUICKBOOT_POWERON"
        ) {
            val prefs = Prefs(context)
            if (prefs.isConfigured()) {
                Log.i(TAG, "Boot received — scheduling SyncWorker")
                SyncWorker.schedule(context)
                if (prefs.trackingMode > 0) {
                    Log.i(TAG, "Tracking mode active, starting PhoneRakshakService")
                    PhoneRakshakService.start(context)
                }
            } else {
                Log.i(TAG, "Boot received but app not configured; skipping start")
            }
        }
    }

    companion object {
        private const val TAG = "BootReceiver"
    }
}
