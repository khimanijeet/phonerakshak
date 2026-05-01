package com.example.phonerakshak

import android.content.Context
import android.util.Log

/**
 * One-call helper that reads the current Wi-Fi connection, caches it
 * locally in [Prefs] and (best-effort) uploads it to the backend so the
 * admin dashboard can show "Last Known Wi-Fi" alongside GPS.
 *
 * Safe to call from any thread; the network upload is performed inline,
 * so call from a background coroutine / thread.
 */
object WifiSnapshotter {

    private const val TAG = "WifiSnapshotter"

    /** Captures + stores + uploads. Returns the snapshot, or null if no Wi-Fi. */
    fun capture(context: Context, trigger: String): WifiUtils.WifiSnapshot? {
        val snap = WifiUtils.current(context) ?: run {
            Log.i(TAG, "No active Wi-Fi to capture (trigger=$trigger)")
            return null
        }
        val prefs = Prefs(context)
        prefs.lastKnownWifi = snap.toStorageString()
        Log.i(TAG, "Captured Wi-Fi: ssid=${snap.ssid} bssid=${snap.bssid} rssi=${snap.rssi}")

        if (prefs.hasBackend()) {
            try {
                BackendClient(prefs.backendUrl).postWifi(prefs.deviceId, snap, trigger)
            } catch (e: Exception) {
                Log.w(TAG, "postWifi failed: ${e.message}")
            }
        }
        return snap
    }
}
