package com.example.phonerakshak

import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Listens for SMS messages and reacts to anti-theft commands:
 *   LOCK<PIN>      -> show lock activity + DevicePolicyManager.lockNow()
 *   LOC<PIN>       -> reply with Google Maps link, push to backend
 *   ALARM<PIN>     -> play loud alarm even in silent mode
 *   STOPALARM<PIN> -> stop the alarm
 *   SOS<PIN>       -> trigger Emergency Mode
 *
 * The PIN is the one configured in SetupActivity.
 */
class SmsCommandReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val prefs = Prefs(context)
        val pin = prefs.rawPinForCommands ?: return  // not configured yet

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        for (msg in messages) {
            val from = msg.originatingAddress ?: continue
            val body = (msg.messageBody ?: "").trim()
            Log.i(TAG, "SMS from $from: $body")

            when {
                body.equals("LOCK$pin", ignoreCase = true) ->
                    handleLock(context)

                body.equals("LOC$pin", ignoreCase = true) ->
                    handleLocate(context, from, prefs)

                body.equals("ALARM$pin", ignoreCase = true) ->
                    AlarmPlayer.playForSeconds(context, 60)

                body.equals("STOPALARM$pin", ignoreCase = true) ->
                    AlarmPlayer.stop()

                body.equals("SOS$pin", ignoreCase = true) ->
                    EmergencyHandler.trigger(context, source = "sms")
            }
        }
    }

    private fun handleLock(context: Context) {
        val lockIntent = Intent(context, LockScreenActivity::class.java).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TASK or
                    Intent.FLAG_ACTIVITY_NO_HISTORY
            )
            putExtra(
                LockScreenActivity.EXTRA_MESSAGE,
                context.getString(R.string.lock_message)
            )
        }
        context.startActivity(lockIntent)

        try {
            val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE)
                as DevicePolicyManager
            val admin = LockerAdminReceiver.componentName(context)
            if (dpm.isAdminActive(admin)) {
                dpm.lockNow()
            } else {
                Log.w(TAG, "Device admin not enabled; skipping lockNow()")
            }
        } catch (e: Exception) {
            Log.w(TAG, "lockNow failed: ${e.message}")
        }
    }

    private fun handleLocate(context: Context, sender: String, prefs: Prefs) {
        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val loc = LocationHelper.getCurrentLocation(context)
                val text = if (loc != null) {
                    "Location: ${LocationHelper.mapsLink(loc.latitude, loc.longitude)}"
                } else {
                    "Location unavailable (GPS off or permission missing)."
                }
                withContext(Dispatchers.Main) {
                    SmsUtils.sendSms(context, sender, text)
                }

                if (loc != null) {
                    prefs.lastKnownLocation =
                        "${loc.latitude},${loc.longitude},${loc.accuracy},${System.currentTimeMillis()}"
                    if (prefs.hasBackend()) {
                        BackendClient(prefs.backendUrl).postLocation(
                            prefs.deviceId,
                            loc.latitude,
                            loc.longitude,
                            loc.accuracy,
                            "sms"
                        )
                    }
                }
            } finally {
                pendingResult.finish()
            }
        }
    }

    companion object {
        private const val TAG = "SmsCommandReceiver"
    }
}
