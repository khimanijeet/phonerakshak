package com.example.phonerakshak

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject

class PhoneRakshakFcmService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.i(TAG, "Refreshed FCM token: $token")
        // If the user is already configured, we should upload the new token immediately
        val prefs = Prefs(this)
        if (prefs.isConfigured() && prefs.hasBackend()) {
            val client = BackendClient(prefs)
            CoroutineScope(Dispatchers.IO).launch {
                val newToken = client.registerDevice(
                    prefs.deviceId,
                    prefs.phoneNumber ?: "",
                    prefs.emergencyNumber ?: "",
                    android.os.Build.MODEL
                )
                if (newToken != null) {
                    prefs.jwtToken = newToken
                }
            }
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        Log.i(TAG, "FCM Message received from: ${message.from}")

        // Check if message contains a data payload (high priority data message)
        if (message.data.isNotEmpty()) {
            val commandId = message.data["commandId"]
            val type = message.data["type"]
            val timestamp = message.data["timestamp"]
            
            if (commandId == null || type == null) {
                Log.w(TAG, "Invalid FCM payload: missing commandId or type")
                return
            }

            Log.i(TAG, "FCM Payload -> type: $type, id: $commandId")
            
            val prefs = Prefs(this)
            
            // Deduplication Check
            if (prefs.executedCommandIds.contains(commandId)) {
                Log.i(TAG, "Command $commandId already executed, ignoring FCM.")
                return
            }

            // Acknowledge receipt instantly and execute
            CoroutineScope(Dispatchers.IO).launch {
                val client = BackendClient(prefs)
                
                // Construct the pending command
                val cmd = BackendClient.PendingCommand(id = commandId, type = type, params = null)
                
                Log.i(TAG, "Executing FCM command: $type")
                val result = runCatching { dispatch(cmd, prefs, client) }
                    .onFailure { Log.w(TAG, "FCM dispatch failed: ${it.message}") }
                    .getOrElse { "error: ${it.message}" }
                
                prefs.markCommandExecuted(commandId)
                val ackOk = client.ackCommand(prefs.deviceId, commandId, result)
                Log.i(TAG, "FCM Command Ack: $ackOk")
            }
        }
    }

    // This duplicates logic in CommandPoller for safety and speed when receiving FCM.
    // In a real refactor, this should be moved to a shared CommandExecutor class.
    private suspend fun dispatch(
        c: BackendClient.PendingCommand,
        prefs: Prefs,
        client: BackendClient
    ): String {
        return when (c.type.lowercase()) {
            "lock" -> {
                showLock(this, getString(R.string.lock_message))
                tryLockNow(this)
                "ok"
            }
            "alarm" -> {
                AlarmPlayer.playForSeconds(this, 60)
                "ok"
            }
            "stop_alarm" -> {
                AlarmPlayer.stop()
                "ok"
            }
            "locate" -> {
                val loc = LocationHelper.getCurrentLocation(this)
                if (loc != null) {
                    client.postLocation(
                        prefs.deviceId,
                        loc.latitude,
                        loc.longitude,
                        loc.accuracy,
                        "command"
                    )
                    prefs.lastKnownLocation =
                        "${loc.latitude},${loc.longitude},${loc.accuracy},${System.currentTimeMillis()}"
                    "ok"
                } else {
                    client.postAlert(prefs.deviceId, "locate_failed", "No GPS fix available")
                    "no_fix"
                }
            }
            "emergency" -> {
                EmergencyHandler.trigger(this, source = "remote")
                "ok"
            }
            else -> "unknown_command"
        }
    }

    private fun showLock(context: Context, message: String) {
        val i = Intent(context, LockScreenActivity::class.java).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_CLEAR_TASK or
                    Intent.FLAG_ACTIVITY_NO_HISTORY
            )
            putExtra(LockScreenActivity.EXTRA_MESSAGE, message)
        }
        context.startActivity(i)
    }

    private fun tryLockNow(context: Context) {
        try {
            val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            val admin = LockerAdminReceiver.componentName(context)
            if (dpm.isAdminActive(admin)) dpm.lockNow()
        } catch (_: Exception) {
        }
    }

    companion object {
        private const val TAG = "PhoneRakshakFcm"
    }
}
