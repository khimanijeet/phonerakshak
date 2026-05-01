package com.example.phonerakshak

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Detects SIM card changes. If the configured SIM fingerprint is non-null and
 * the current one differs, send the emergency contact an SMS containing the
 * current location (best-effort), record an alert in the backend, and push the
 * new location.
 */
class SimChangeReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val prefs = Prefs(context)
        if (!prefs.isConfigured()) return

        val current = SimUtils.currentFingerprint(context) ?: return
        val saved = prefs.simFingerprint

        if (saved == null) {
            prefs.simFingerprint = current
            Log.i(TAG, "Recorded initial SIM fingerprint")
            return
        }

        if (saved == current) return

        Log.w(TAG, "SIM CHANGED: saved=$saved current=$current")
        prefs.simFingerprint = current

        val emergency = prefs.emergencyNumber ?: return
        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val loc = LocationHelper.getCurrentLocation(context)
                val locPart = if (loc != null) {
                    "Location: ${LocationHelper.mapsLink(loc.latitude, loc.longitude)}"
                } else {
                    "Location unavailable."
                }
                val text = "ALERT: SIM changed on your phone.\nNew SIM: $current\n$locPart"
                withContext(Dispatchers.Main) {
                    SmsUtils.sendSms(context, emergency, text)
                }

                if (prefs.hasBackend()) {
                    val client = BackendClient(prefs.backendUrl)
                    val meta = JSONObject().apply {
                        put("oldSim", saved)
                        put("newSim", current)
                    }
                    client.postAlert(
                        prefs.deviceId,
                        "sim_change",
                        "SIM changed: $saved → $current",
                        meta
                    )
                    if (loc != null) {
                        client.postLocation(
                            prefs.deviceId,
                            loc.latitude,
                            loc.longitude,
                            loc.accuracy,
                            "sim_change"
                        )
                    }
                }

                // SIM change is the strongest "phone is being stolen" signal
                // — capture the Wi-Fi too so the user has a router to chase.
                WifiSnapshotter.capture(context, "sim_change")
            } finally {
                pendingResult.finish()
            }
        }
    }

    companion object {
        private const val TAG = "SimChangeReceiver"
    }
}
