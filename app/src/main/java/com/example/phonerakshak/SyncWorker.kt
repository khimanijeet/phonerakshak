package com.example.phonerakshak

import android.content.Context
import androidx.work.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.TimeUnit

class SyncWorker(appContext: Context, workerParams: WorkerParameters) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val prefs = Prefs(applicationContext)
        if (!prefs.isConfigured() || !prefs.hasBackend()) {
            return@withContext Result.success()
        }

        // Only do work if trackingMode is Normal (0), otherwise the ForegroundService handles it
        if (prefs.trackingMode != 0) {
            return@withContext Result.success()
        }

        val client = BackendClient(prefs)
        
        try {
            // Send ping
            val batteryStatus = applicationContext.registerReceiver(null, android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED))
            val level = batteryStatus?.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1) ?: -1
            val scale = batteryStatus?.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, -1) ?: -1
            val batteryPct = if (level != -1 && scale != -1) (level * 100 / scale.toFloat()).toInt() else -1

            val success = client.ping(prefs.deviceId, batteryPct)
            
            // Sync any queued offline locations
            if (success) {
                val queue = OfflineQueue(applicationContext)
                val queuedLocs = queue.getLocations()
                if (queuedLocs.length() > 0) {
                    if (client.syncLocations(prefs.deviceId, queuedLocs)) {
                        queue.clearLocations()
                    }
                }
            }
            
            // Note: We don't fetch new GPS location here. Normal mode is purely battery-saving.
            // If the user wants a location, they trigger an FCM 'locate' command which fires instantly.

            Result.success()
        } catch (e: Exception) {
            Result.retry()
        }
    }

    companion object {
        private const val WORK_NAME = "PhoneRakshakSyncWork"

        fun schedule(context: Context) {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()

            val workRequest = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(constraints)
                .build()

            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                workRequest
            )
        }
    }
}
