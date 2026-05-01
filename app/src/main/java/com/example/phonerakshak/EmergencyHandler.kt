package com.example.phonerakshak

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Emergency Mode:
 *   - Sounds the alarm at full volume for 60 seconds.
 *   - Sends an SMS to the configured emergency contact with a Google Maps
 *     link to the current location.
 *   - Pushes a Maps link + alert + location to the backend (if configured).
 *
 * Triggered from the in-app panic button OR remotely via the admin
 * dashboard's "Emergency Mode" command.
 */
object EmergencyHandler {

    private const val TAG = "EmergencyHandler"

    fun trigger(context: Context, source: String) {
        Log.w(TAG, "EMERGENCY triggered (source=$source)")
        AlarmPlayer.playForSeconds(context, 60)

        val prefs = Prefs(context)
        val emergency = prefs.emergencyNumber

        CoroutineScope(Dispatchers.IO).launch {
            val loc = try {
                LocationHelper.getCurrentLocation(context)
            } catch (e: Exception) {
                Log.w(TAG, "loc failed: ${e.message}")
                null
            }

            val locText = if (loc != null) {
                "Location: ${LocationHelper.mapsLink(loc.latitude, loc.longitude)}"
            } else {
                "Location unavailable."
            }
            val text = "EMERGENCY from PhoneRakshak.\n$locText"

            if (!emergency.isNullOrBlank()) {
                withContext(Dispatchers.Main) {
                    SmsUtils.sendSms(context, emergency, text)
                }
            }

            if (prefs.hasBackend()) {
                val client = BackendClient(prefs.backendUrl)
                client.postAlert(
                    prefs.deviceId,
                    "emergency",
                    "Emergency Mode triggered ($source)"
                )
                if (loc != null) {
                    client.postLocation(
                        prefs.deviceId,
                        loc.latitude,
                        loc.longitude,
                        loc.accuracy,
                        "emergency"
                    )
                    prefs.lastKnownLocation =
                        "${loc.latitude},${loc.longitude},${loc.accuracy},${System.currentTimeMillis()}"
                }
            }
        }
    }
}
