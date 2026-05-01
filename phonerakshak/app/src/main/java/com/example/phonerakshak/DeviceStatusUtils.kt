package com.example.phonerakshak

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.Build

/**
 * Read-only helpers for the device's battery and network state.
 * Used by the boot-recovery reporter so the user can see fresh
 * status the moment the phone comes back online.
 */
object DeviceStatusUtils {

    data class BatteryStatus(val percent: Int?, val charging: Boolean)

    /** Returns battery percentage and charging state, or nulls if unknown. */
    fun currentBattery(context: Context): BatteryStatus {
        // Preferred path: BatteryManager (API 21+).
        val bm = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        var pct: Int? = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        if (pct != null && pct < 0) pct = null

        // Fallback to the sticky battery broadcast.
        val intent: Intent? = context.registerReceiver(
            null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)
        )
        if (pct == null && intent != null) {
            val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
            val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
            if (level >= 0 && scale > 0) pct = (level * 100) / scale
        }

        val charging = when {
            intent == null -> false
            else -> {
                val s = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
                s == BatteryManager.BATTERY_STATUS_CHARGING ||
                    s == BatteryManager.BATTERY_STATUS_FULL
            }
        }
        return BatteryStatus(pct, charging)
    }

    /** Returns "wifi", "cellular", "ethernet", "vpn" or "none". */
    fun currentNetworkType(context: Context): String {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            ?: return "unknown"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val net = cm.activeNetwork ?: return "none"
            val caps = cm.getNetworkCapabilities(net) ?: return "none"
            return when {
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
                caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "vpn"
                else -> "other"
            }
        }
        @Suppress("DEPRECATION")
        val info = cm.activeNetworkInfo ?: return "none"
        @Suppress("DEPRECATION")
        return when (info.type) {
            ConnectivityManager.TYPE_WIFI -> "wifi"
            ConnectivityManager.TYPE_MOBILE -> "cellular"
            ConnectivityManager.TYPE_ETHERNET -> "ethernet"
            ConnectivityManager.TYPE_VPN -> "vpn"
            else -> "other"
        }
    }
}
