package com.example.phonerakshak

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Auto-starts the foreground service after the device boots and, when the
 * user has enabled it, fires a one-shot boot-recovery status report so the
 * owner can see the device came back online (battery, network, last known
 * location). Heavy work is offloaded to a background thread via
 * [goAsync] so the receiver does not block the system on boot.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != "android.intent.action.QUICKBOOT_POWERON"
        ) return

        val prefs = Prefs(context)
        if (!prefs.isConfigured()) {
            Log.i(TAG, "Boot received but app not configured; skipping start")
            return
        }

        Log.i(TAG, "Boot received — starting PhoneRakshakService")
        PhoneRakshakService.start(context)

        if (!prefs.bootRecoveryEnabled) {
            Log.i(TAG, "Boot recovery is disabled by user — no report sent")
            return
        }

        // Network + SMS calls must run off the main thread. goAsync() keeps
        // the broadcast alive until pendingResult.finish() is called.
        val pendingResult = goAsync()
        val appContext = context.applicationContext
        Thread({
            try {
                BootRecoveryReporter.report(appContext)
            } catch (e: Exception) {
                Log.w(TAG, "Boot recovery reporter crashed: ${e.message}")
            } finally {
                pendingResult.finish()
            }
        }, "BootRecoveryReporter").start()
    }

    companion object {
        private const val TAG = "BootReceiver"
    }
}
