package com.example.phonerakshak

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingClient
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationServices

object GeofenceHelper {
    private const val TAG = "GeofenceHelper"
    const val GEOFENCE_ID = "PHONERAKSHAK_SAFE_ZONE"

    private fun getGeofencingClient(context: Context): GeofencingClient {
        return LocationServices.getGeofencingClient(context)
    }

    private fun getGeofencePendingIntent(context: Context): PendingIntent {
        val intent = Intent(context, GeofenceReceiver::class.java)
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        return PendingIntent.getBroadcast(context, 0, intent, flags)
    }

    @SuppressLint("MissingPermission")
    fun addGeofence(context: Context, lat: Double, lng: Double, radius: Float) {
        if (!LocationHelper.hasFineLocationPermission(context)) return

        val geofence = Geofence.Builder()
            .setRequestId(GEOFENCE_ID)
            .setCircularRegion(lat, lng, radius)
            .setExpirationDuration(Geofence.NEVER_EXPIRE)
            .setTransitionTypes(Geofence.GEOFENCE_TRANSITION_EXIT)
            .build()

        val request = GeofencingRequest.Builder()
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_EXIT)
            .addGeofence(geofence)
            .build()

        getGeofencingClient(context).addGeofences(request, getGeofencePendingIntent(context))
            .addOnSuccessListener {
                Log.i(TAG, "Geofence added successfully: $lat, $lng ($radius m)")
            }
            .addOnFailureListener {
                Log.e(TAG, "Failed to add geofence", it)
            }
    }

    fun removeGeofence(context: Context) {
        getGeofencingClient(context).removeGeofences(getGeofencePendingIntent(context))
            .addOnSuccessListener {
                Log.i(TAG, "Geofence removed successfully")
            }
            .addOnFailureListener {
                Log.e(TAG, "Failed to remove geofence", it)
            }
    }
}
