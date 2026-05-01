package com.example.phonerakshak

import android.content.Context
import android.os.Build
import android.telephony.SmsManager
import android.util.Log

object SmsUtils {

    private const val TAG = "SmsUtils"

    fun sendSms(context: Context, to: String, text: String) {
        if (to.isBlank() || text.isBlank()) return
        try {
            val sms = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                context.getSystemService(SmsManager::class.java)
            } else {
                @Suppress("DEPRECATION")
                SmsManager.getDefault()
            }
            val parts = sms.divideMessage(text)
            sms.sendMultipartTextMessage(to, null, parts, null, null)
            Log.i(TAG, "Sent SMS to $to (${text.length} chars)")
        } catch (e: Exception) {
            Log.w(TAG, "sendSms failed: ${e.message}")
        }
    }
}
