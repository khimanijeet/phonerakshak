package com.example.phonerakshak

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent
import kotlinx.coroutines.DelicateCoroutinesApi
import kotlinx.coroutines.GlobalScope
import kotlinx.coroutines.launch

class GeofenceReceiver : BroadcastReceiver() {
    @OptIn(DelicateCoroutinesApi::class)
    override fun onReceive(context: Context, intent: Intent) {
        val geofencingEvent = GeofencingEvent.fromIntent(intent)
        if (geofencingEvent == null || geofencingEvent.hasError()) {
            Log.e("GeofenceReceiver", "GeofencingEvent error")
            return
        }

        val transition = geofencingEvent.geofenceTransition
        if (transition == Geofence.GEOFENCE_TRANSITION_EXIT) {
            Log.w("GeofenceReceiver", "GEOFENCE BREACHED! Device left Safe Zone.")
            
            // Trigger Theft Mode
            AlarmPlayer.playForSeconds(context, 60)
            
            // Show lock screen
            val i = Intent(context, LockScreenActivity::class.java).apply {
                addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TASK or
                        Intent.FLAG_ACTIVITY_NO_HISTORY
                )
                putExtra(LockScreenActivity.EXTRA_MESSAGE, "GEOFENCE BREACHED! This device is stolen.")
            }
            context.startActivity(i)

            // Alert Backend
            val prefs = Prefs(context)
            if (prefs.hasBackend()) {
                GlobalScope.launch {
                    val client = BackendClient(prefs)
                    client.postAlert(prefs.deviceId, "geofence_breach", "Device left the Smart Safe Zone!")
                }
            }
        }
    }
}
