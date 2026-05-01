package com.example.phonerakshak

import android.content.Context
import android.os.Build
import android.telephony.SmsManager
import android.util.Log
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Sends a one-shot "device just rebooted" status report to the registered
 * backend account, with an SMS fallback to the emergency contact when no
 * backend is configured.
 *
 * Privacy: only runs when the user has explicitly enabled
 * [Prefs.bootRecoveryEnabled] during setup. The payload contains battery
 * percentage, network type, and the last known location that was already
 * stored on the device — no new sensors are read at boot beyond battery and
 * network state.
 */
object BootRecoveryReporter {

    private const val TAG = "BootRecovery"

    /**
     * Gathers status and sends it. Safe to call from any thread, but the
     * network and SMS work should be invoked from a background thread (see
     * [BootReceiver]). Returns true if at least one channel succeeded.
     */
    fun report(context: Context): Boolean {
        val prefs = Prefs(context)

        if (!prefs.isConfigured()) {
            Log.i(TAG, "Skipping: app not configured")
            return false
        }
        if (!prefs.bootRecoveryEnabled) {
            Log.i(TAG, "Skipping: user has not enabled boot recovery")
            return false
        }

        val battery = DeviceStatusUtils.currentBattery(context)
        val network = DeviceStatusUtils.currentNetworkType(context)
        val loc = parseLocation(prefs.lastKnownLocation)
        // Try a fresh Wi-Fi capture first (in case the phone reconnected after
        // boot); otherwise fall back to whatever was last cached.
        val wifi = WifiUtils.current(context)
            ?.also { prefs.lastKnownWifi = it.toStorageString() }
            ?: WifiUtils.parse(prefs.lastKnownWifi)
        val ts = nowIso()

        var anySuccess = false

        // Primary channel: registered backend account (HTTPS).
        if (prefs.hasBackend()) {
            val client = BackendClient(prefs.backendUrl)
            val meta = JSONObject().apply {
                put("event", "boot_recovery")
                put("bootedAt", ts)
                battery.percent?.let { put("batteryPct", it) }
                put("batteryCharging", battery.charging)
                put("network", network)
                put("osVersion", Build.VERSION.RELEASE ?: "")
                put("deviceModel", Build.MODEL ?: "")
                if (loc != null) {
                    put("lat", loc.lat)
                    put("lng", loc.lng)
                    loc.accuracy?.let { put("accuracy", it) }
                    loc.timestamp?.let { put("locTimestamp", it) }
                }
                if (wifi != null) {
                    put("wifi", wifi.toJson())
                }
            }
            val ok = client.postAlert(
                deviceId = prefs.deviceId,
                type = "boot_recovery",
                message = humanMessage(battery, network, loc),
                meta = meta
            )
            if (ok) {
                anySuccess = true
                // Also push the cached location so the live map updates.
                if (loc != null) {
                    client.postLocation(
                        deviceId = prefs.deviceId,
                        lat = loc.lat,
                        lng = loc.lng,
                        accuracy = loc.accuracy?.toFloat(),
                        trigger = "boot_recovery"
                    )
                }
            } else {
                Log.w(TAG, "Backend boot-recovery alert failed")
            }
        }

        // Fallback channel: SMS to emergency contact if backend is missing or failed.
        val emergency = prefs.emergencyNumber
        if (!anySuccess && !emergency.isNullOrBlank()) {
            try {
                val sms = smsManager(context)
                val body = buildSmsBody(battery, network, loc, wifi)
                sms.sendTextMessage(emergency, null, body, null, null)
                Log.i(TAG, "Sent boot-recovery SMS to emergency contact")
                anySuccess = true
            } catch (e: Exception) {
                Log.w(TAG, "SMS fallback failed: ${e.message}")
            }
        }

        return anySuccess
    }

    private fun smsManager(context: Context): SmsManager {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(SmsManager::class.java)
        } else {
            @Suppress("DEPRECATION")
            SmsManager.getDefault()
        }
    }

    private data class Loc(
        val lat: Double,
        val lng: Double,
        val accuracy: Double?,
        val timestamp: Long?
    )

    /** Parse the "lat,lng,accuracy,ts" cache string written elsewhere in the app. */
    private fun parseLocation(raw: String?): Loc? {
        if (raw.isNullOrBlank()) return null
        val parts = raw.split(",")
        return try {
            val lat = parts[0].toDouble()
            val lng = parts[1].toDouble()
            val acc = parts.getOrNull(2)?.toDoubleOrNull()
            val ts = parts.getOrNull(3)?.toLongOrNull()
            Loc(lat, lng, acc, ts)
        } catch (_: Exception) {
            null
        }
    }

    private fun humanMessage(
        b: DeviceStatusUtils.BatteryStatus,
        net: String,
        loc: Loc?
    ): String {
        val bat = b.percent?.let { "$it%${if (b.charging) " (charging)" else ""}" } ?: "unknown"
        val locStr = loc?.let { "${"%.5f".format(it.lat)}, ${"%.5f".format(it.lng)}" } ?: "no last location"
        return "Device rebooted. Battery: $bat • Network: $net • Last location: $locStr"
    }

    private fun buildSmsBody(
        b: DeviceStatusUtils.BatteryStatus,
        net: String,
        loc: Loc?,
        wifi: WifiUtils.WifiSnapshot? = null
    ): String {
        val sb = StringBuilder("PhoneRakshak: device just rebooted.\n")
        sb.append("Battery: ").append(b.percent?.let { "$it%" } ?: "?")
        if (b.charging) sb.append(" (charging)")
        sb.append("\nNetwork: ").append(net)
        if (loc != null) {
            sb.append("\nLast location: https://maps.google.com/?q=")
                .append(loc.lat).append(",").append(loc.lng)
        } else {
            sb.append("\nNo last location stored.")
        }
        if (wifi != null && (wifi.ssid != null || wifi.bssid != null)) {
            sb.append("\nLast Wi-Fi: ")
                .append(wifi.ssid ?: "unknown")
                .append(wifi.bssid?.let { " ($it)" } ?: "")
        }
        return sb.toString()
    }

    private fun nowIso(): String {
        val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US)
        return fmt.format(Date())
    }
}
