package com.example.phonerakshak

import android.annotation.SuppressLint
import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import org.json.JSONObject

/**
 * Reads the device's currently connected Wi-Fi network: SSID, BSSID
 * (router MAC), signal strength, link speed and frequency band. The SSID
 * requires location permission to be granted on Android 8.1+, which the
 * app already requests for GPS use.
 *
 * Police can use the BSSID alone to identify the exact router the phone
 * was last connected to, which is far more accurate than GPS indoors.
 */
object WifiUtils {

    data class WifiSnapshot(
        val ssid: String?,
        val bssid: String?,
        val rssi: Int?,
        val linkSpeedMbps: Int?,
        val frequencyMhz: Int?,
        val capturedAt: Long
    ) {
        fun toJson(): JSONObject = JSONObject().apply {
            ssid?.let { put("ssid", it) }
            bssid?.let { put("bssid", it) }
            rssi?.let { put("rssi", it) }
            linkSpeedMbps?.let { put("linkSpeedMbps", it) }
            frequencyMhz?.let { put("frequencyMhz", it) }
            put("capturedAt", capturedAt)
        }
        fun toStorageString(): String = toJson().toString()

        /** Approximate human label, e.g. "Strong" / "Good" / "Weak". */
        fun signalQuality(): String {
            val r = rssi ?: return "unknown"
            return when {
                r >= -55 -> "excellent"
                r >= -67 -> "good"
                r >= -75 -> "fair"
                r >= -85 -> "weak"
                else -> "very weak"
            }
        }
    }

    /** Returns the active Wi-Fi connection or null if Wi-Fi is off / disconnected. */
    @SuppressLint("MissingPermission")
    fun current(context: Context): WifiSnapshot? {
        val wm = context.applicationContext
            .getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return null
        if (!wm.isWifiEnabled) return null

        val info = try {
            @Suppress("DEPRECATION")
            wm.connectionInfo
        } catch (_: Exception) {
            null
        } ?: return null

        if (info.networkId == -1) return null

        var ssid = info.ssid
            ?.removePrefix("\"")
            ?.removeSuffix("\"")
            ?.takeIf { it.isNotBlank() }
        if (ssid == "<unknown ssid>") ssid = null

        val bssid = info.bssid
            ?.takeIf { it.isNotBlank() && it != "02:00:00:00:00:00" }

        val rssi = info.rssi.takeIf { it > -127 }
        val link = info.linkSpeed.takeIf { it > 0 }
        val freq = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            info.frequency.takeIf { it > 0 }
        } else null

        if (ssid == null && bssid == null) return null
        return WifiSnapshot(ssid, bssid, rssi, link, freq, System.currentTimeMillis())
    }

    /** Reads a snapshot back from a JSON string previously written via [WifiSnapshot.toStorageString]. */
    fun parse(raw: String?): WifiSnapshot? {
        if (raw.isNullOrBlank()) return null
        return try {
            val o = JSONObject(raw)
            WifiSnapshot(
                ssid = o.optString("ssid", "").ifBlank { null },
                bssid = o.optString("bssid", "").ifBlank { null },
                rssi = if (o.has("rssi")) o.getInt("rssi") else null,
                linkSpeedMbps = if (o.has("linkSpeedMbps")) o.getInt("linkSpeedMbps") else null,
                frequencyMhz = if (o.has("frequencyMhz")) o.getInt("frequencyMhz") else null,
                capturedAt = o.optLong("capturedAt", System.currentTimeMillis())
            )
        } catch (_: Exception) {
            null
        }
    }
}
