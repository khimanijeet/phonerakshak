package com.example.phonerakshak

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Long-running foreground service whose only job is to keep the process alive
 * so the SMS and SIM receivers continue to function in the background, even
 * after a reboot or on aggressive OEM battery managers. Also runs a
 * [CommandPoller] when a backend URL is configured.
 */
class PhoneRakshakService : Service() {

    private var poller: CommandPoller? = null
    private val serviceJob = SupervisorJob()
    private val scope = CoroutineScope(Dispatchers.IO + serviceJob)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIF_ID, buildNotification())

        val prefs = Prefs(this)
        if (prefs.isConfigured() && prefs.simFingerprint == null) {
            SimUtils.currentFingerprint(this)?.let { prefs.simFingerprint = it }
        }

        if (poller == null && prefs.hasBackend()) {
            poller = CommandPoller(this).also { it.start() }
            
            // Heartbeat ping every 5 minutes
            scope.launch {
                val client = BackendClient(prefs)
                while (isActive) {
                    try {
                        client.ping(prefs.deviceId)
                    } catch (e: Exception) {
                        // ignore
                    }
                    delay(5 * 60 * 1000L) // 5 minutes
                }
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        poller?.stop()
        poller = null
        scope.cancel()
        super.onDestroy()
    }

    private fun buildNotification(): Notification {
        val channelId = "phonerakshak_service"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            if (nm.getNotificationChannel(channelId) == null) {
                nm.createNotificationChannel(
                    NotificationChannel(
                        channelId,
                        getString(R.string.notif_channel),
                        NotificationManager.IMPORTANCE_LOW
                    )
                )
            }
        }

        val openIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, DashboardActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, channelId)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.notif_text))
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setOngoing(true)
            .setContentIntent(openIntent)
            .build()
    }

    companion object {
        private const val NOTIF_ID = 4242

        fun start(context: Context) {
            val intent = Intent(context, PhoneRakshakService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
    }
}
