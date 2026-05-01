package com.example.phonerakshak

import android.content.Context
import android.telephony.TelephonyManager

/** Builds a coarse SIM fingerprint that doesn't require privileged permissions. */
object SimUtils {

    fun currentFingerprint(context: Context): String? {
        val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as? TelephonyManager
            ?: return null

        // SIM_STATE_READY is the only state where these fields are populated.
        if (tm.simState != TelephonyManager.SIM_STATE_READY) return null

        val operator = tm.simOperator ?: ""          // MCC+MNC
        val operatorName = tm.simOperatorName ?: ""  // Carrier name
        val countryIso = tm.simCountryIso ?: ""

        if (operator.isEmpty() && operatorName.isEmpty() && countryIso.isEmpty()) {
            return null
        }
        return "$operator|$operatorName|$countryIso"
    }
}
