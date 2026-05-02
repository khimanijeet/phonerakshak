package com.example.phonerakshak

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Periodically polls the backend for queued commands (lock, alarm, locate,
 * emergency, stop_alarm) and dispatches them locally. Started by
 * [PhoneRakshakService] when a backend URL is configured.
 */
class CommandPoller(
    private val context: Context,
    private val baseIntervalMs: Long = 60_000L,
    private val fastIntervalMs: Long = 10_000L
) {

    private val job: Job = SupervisorJob()
    private val scope = CoroutineScope(Dispatchers.IO + job)
    
    // Tracks how many fast polls remain before decaying back to base interval
    private var fastPollsRemaining = 0

    fun start() {
        scope.launch {
            while (isActive) {
                try {
                    val receivedAny = pollOnce()
                    if (receivedAny) {
                        fastPollsRemaining = 6 // Poll fast for the next 60s
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "poll loop error: ${e.message}")
                }
                
                val currentInterval = if (fastPollsRemaining > 0) {
                    fastPollsRemaining--
                    fastIntervalMs
                } else {
                    baseIntervalMs
                }
                delay(currentInterval)
            }
        }
        Log.i(TAG, "CommandPoller started (baseInterval=${baseIntervalMs}ms)")
    }

    fun stop() {
        scope.cancel()
    }

    private suspend fun pollOnce(): Boolean {
        val prefs = Prefs(context)
        if (!prefs.hasBackend()) return false
        val client = BackendClient(prefs)
        val cmds = client.pollCommands(prefs.deviceId)
        var executedAny = false
        for (c in cmds) {
            if (prefs.executedCommandIds.contains(c.id)) {
                Log.i(TAG, "Skipping already executed command: ${c.id}")
                client.ackCommand(prefs.deviceId, c.id, "already_executed")
                continue
            }
            Log.i(TAG, "Received command: ${c.type} (${c.id})")
            executedAny = true
            val result = runCatching { dispatch(c, prefs, client) }
                .onFailure { Log.w(TAG, "dispatch failed: ${it.message}") }
                .getOrElse { "error: ${it.message}" }
            
            prefs.markCommandExecuted(c.id)
            client.ackCommand(prefs.deviceId, c.id, result)
        }
        return executedAny
    }

    private suspend fun dispatch(
        c: BackendClient.PendingCommand,
        prefs: Prefs,
        client: BackendClient
    ): String {
        return when (c.type.lowercase()) {
            "lock" -> {
                showLock(context, context.getString(R.string.lock_message))
                tryLockNow(context)
                "ok"
            }
            "alarm" -> {
                AlarmPlayer.playForSeconds(context, 60)
                "ok"
            }
            "stop_alarm" -> {
                AlarmPlayer.stop()
                "ok"
            }
            "locate" -> {
                val loc = LocationHelper.getCurrentLocation(context)
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
                EmergencyHandler.trigger(context, source = "remote")
                "ok"
            }
            "record_audio" -> {
                val success = AudioRecorderHelper.recordAndUpload(context, client, prefs)
                if (success) "ok" else "failed"
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
            val dpm = context.getSystemService(Context.DEVICE_POLICY_SERVICE)
                as DevicePolicyManager
            val admin = LockerAdminReceiver.componentName(context)
            if (dpm.isAdminActive(admin)) dpm.lockNow()
        } catch (_: Exception) {
        }
    }

    companion object {
        private const val TAG = "CommandPoller"
    }
}
