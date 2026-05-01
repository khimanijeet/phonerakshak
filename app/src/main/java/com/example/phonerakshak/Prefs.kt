package com.example.phonerakshak

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import android.provider.Settings
import java.security.MessageDigest

/**
 * Local settings store. The PIN is stored as a SHA-256 hash; the raw PIN is
 * also stored so the SMS receiver can match commands like LOCK<PIN> without
 * any user interaction. Optional backend integration uses [deviceId].
 */
class Prefs(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    @SuppressLint("HardwareIds")
    val deviceId: String =
        Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ANDROID_ID
        ) ?: "unknown-device"

    var phoneNumber: String?
        get() = prefs.getString(KEY_PHONE, null)
        set(value) = prefs.edit().putString(KEY_PHONE, value).apply()

    var emergencyNumber: String?
        get() = prefs.getString(KEY_EMERGENCY, null)
        set(value) = prefs.edit().putString(KEY_EMERGENCY, value).apply()

    private var pinHash: String?
        get() = prefs.getString(KEY_PIN_HASH, null)
        set(value) = prefs.edit().putString(KEY_PIN_HASH, value).apply()

    var rawPinForCommands: String?
        get() = prefs.getString(KEY_PIN_RAW, null)
        set(value) = prefs.edit().putString(KEY_PIN_RAW, value).apply()

    /**
     * Coarse SIM fingerprint: "<operator>|<operatorName>|<countryIso>".
     * Compared against the current SIM in [SimChangeReceiver].
     */
    var simFingerprint: String?
        get() = prefs.getString(KEY_SIM_FP, null)
        set(value) = prefs.edit().putString(KEY_SIM_FP, value).apply()

    /**
     * Optional backend URL set at runtime in the dashboard. Falls back to the
     * build-time BACKEND_URL when blank. Always returns a value with no
     * trailing slash, or "" if neither is set.
     */
    var backendUrl: String
        get() {
            val saved = prefs.getString(KEY_BACKEND_URL, null)
            val raw = if (!saved.isNullOrBlank()) saved else BuildConfig.BACKEND_URL
            return raw.trim().trimEnd('/')
        }
        set(value) =
            prefs.edit().putString(KEY_BACKEND_URL, value.trim().trimEnd('/')).apply()

    fun hasBackend(): Boolean = backendUrl.isNotBlank()

    fun setPin(pin: String) {
        pinHash = sha256(pin)
        rawPinForCommands = pin
    }

    fun checkPin(pin: String): Boolean {
        val stored = pinHash ?: return false
        return stored == sha256(pin)
    }

    fun isConfigured(): Boolean =
        !emergencyNumber.isNullOrBlank() && !pinHash.isNullOrBlank()

    /** Last known location cached for the dashboard, in "lat,lng,accuracy,ts" format. */
    var lastKnownLocation: String?
        get() = prefs.getString(KEY_LAST_LOC, null)
        set(value) = prefs.edit().putString(KEY_LAST_LOC, value).apply()

    private fun sha256(s: String): String {
        val bytes = MessageDigest.getInstance("SHA-256").digest(s.toByteArray())
        return bytes.joinToString("") { "%02x".format(it) }
    }

    companion object {
        private const val FILE = "phonerakshak_prefs"
        private const val KEY_PHONE = "phone"
        private const val KEY_EMERGENCY = "emergency"
        private const val KEY_PIN_HASH = "pin_hash"
        private const val KEY_PIN_RAW = "pin_raw"
        private const val KEY_SIM_FP = "sim_fingerprint"
        private const val KEY_BACKEND_URL = "backend_url"
        private const val KEY_LAST_LOC = "last_known_location"
    }
}
