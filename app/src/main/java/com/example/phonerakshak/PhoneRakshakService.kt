package com.example.phonerakshak

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import com.google.android.gms.location.*
import kotlinx.coroutines.*

class PhoneRakshakService : Service() {

    private val serviceJob = SupervisorJob()
    private val scope = CoroutineScope(Dispatchers.IO + serviceJob)
    
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private lateinit var offlineQueue: OfflineQueue
    
    private var isTracking = false

    override fun onBind(intent: Intent?): IBinder? = null

    @SuppressLint("MissingPermission")
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val prefs = Prefs(this)
        
        // Strategy: Only run if mode is Suspicious (1) or Lost (2).
        if (prefs.trackingMode == 0) {
            Log.i(TAG, "Normal mode. Stopping service.")
            stopForeground(true)
            stopSelf()
            return START_NOT_STICKY
        }

        if (!isTracking) {
            startForeground(NOTIF_ID, buildNotification(prefs.trackingMode))
            offlineQueue = OfflineQueue(this)
            fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)

            startLocationUpdates(prefs.trackingMode)
            startHeartbeat(prefs)
            isTracking = true
        }

        return START_STICKY
    }

    private fun startHeartbeat(prefs: Prefs) {
        scope.launch {
            val client = BackendClient(prefs)
            val startTime = System.currentTimeMillis()
            
            while (isActive) {
                val mode = prefs.trackingMode
                if (mode == 0) {
                    stopSelf()
                    break
                }
                
                // Auto-fallback: If in Lost mode for > 4 hours, revert to Suspicious
                if (mode == 2 && System.currentTimeMillis() - startTime > 4 * 60 * 60 * 1000L) {
                    Log.i(TAG, "Lost mode timeout. Falling back to Suspicious.")
                    prefs.trackingMode = 1
                    startLocationUpdates(1) // Reconfigure GPS
                }

                try {
                    val batteryStatus: Intent? = android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED).let { ifilter ->
                        this@PhoneRakshakService.registerReceiver(null, ifilter)
                    }
                    val level: Int = batteryStatus?.getIntExtra(android.os.BatteryManager.EXTRA_LEVEL, -1) ?: -1
                    val scale: Int = batteryStatus?.getIntExtra(android.os.BatteryManager.EXTRA_SCALE, -1) ?: -1
                    val batteryPct = if (level != -1 && scale != -1) (level * 100 / scale.toFloat()).toInt() else -1

                    val success = client.ping(prefs.deviceId, batteryPct)
                    
                    if (success) {
                        val queuedLocs = offlineQueue.getLocations()
                        if (queuedLocs.length() > 0) {
                            if (client.syncLocations(prefs.deviceId, queuedLocs)) {
                                offlineQueue.clearLocations()
                            }
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Heartbeat failed", e)
                }
                
                val delayMs = if (mode == 2) 30 * 1000L else 120 * 1000L // 30s for Lost, 2m for Suspicious
                delay(delayMs)
            }
        }
    }

    @SuppressLint("MissingPermission")
    private fun startLocationUpdates(mode: Int) {
        if (!LocationHelper.hasFineLocationPermission(this)) return

        if (::locationCallback.isInitialized) {
            fusedLocationClient.removeLocationUpdates(locationCallback)
        }

        val requestBuilder = if (mode == 2) {
            LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 30 * 1000L) // 30s
                .setMinUpdateIntervalMillis(15 * 1000L)
        } else {
            LocationRequest.Builder(Priority.PRIORITY_BALANCED_POWER_ACCURACY, 120 * 1000L) // 2m
                .setMinUpdateIntervalMillis(60 * 1000L)
                .setMinUpdateDistanceMeters(50f)
        }

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(locationResult: LocationResult) {
                for (location in locationResult.locations) {
                    val prefs = Prefs(this@PhoneRakshakService)
                    prefs.lastKnownLocation = "${location.latitude},${location.longitude},${location.accuracy},${System.currentTimeMillis()}"
                    
                    scope.launch {
                        val client = BackendClient(prefs)
                        val success = client.postLocation(prefs.deviceId, location.latitude, location.longitude, location.accuracy, "background")
                        if (!success) {
                            offlineQueue.addLocation(location.latitude, location.longitude, location.accuracy)
                        }
                    }
                }
            }
        }
        fusedLocationClient.requestLocationUpdates(requestBuilder.build(), locationCallback, Looper.getMainLooper())
    }

    override fun onDestroy() {
        if (::fusedLocationClient.isInitialized && ::locationCallback.isInitialized) {
            fusedLocationClient.removeLocationUpdates(locationCallback)
        }
        scope.cancel()
        super.onDestroy()
    }

    private fun buildNotification(mode: Int): Notification {
        val channelId = "phonerakshak_service"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            if (nm.getNotificationChannel(channelId) == null) {
                nm.createNotificationChannel(
                    NotificationChannel(
                        channelId,
                        "Anti-Theft Tracking",
                        NotificationManager.IMPORTANCE_LOW
                    )
                )
            }
        }

        val openIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val modeText = if (mode == 2) "Lost Mode: High Accuracy Tracking Active" else "Suspicious Mode: Tracking Active"

        return NotificationCompat.Builder(this, channelId)
            .setContentTitle("PhoneRakshak Security")
            .setContentText(modeText)
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setOngoing(true)
            .setContentIntent(openIntent)
            .build()
    }

    companion object {
        private const val NOTIF_ID = 4242
        private const val TAG = "PhoneRakshakSvc"

        fun start(context: Context) {
            val intent = Intent(context, PhoneRakshakService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, PhoneRakshakService::class.java))
        }
    }
}
