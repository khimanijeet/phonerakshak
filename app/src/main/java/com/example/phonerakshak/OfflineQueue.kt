package com.example.phonerakshak

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

class OfflineQueue(context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences("offline_queue", Context.MODE_PRIVATE)

    fun addLocation(lat: Double, lng: Double, accuracy: Float?) {
        val list = getLocations()
        val obj = JSONObject()
        obj.put("lat", lat)
        obj.put("lng", lng)
        obj.put("accuracy", accuracy?.toDouble() ?: JSONObject.NULL)
        obj.put("timestamp", System.currentTimeMillis())
        list.put(obj)
        prefs.edit().putString("locations", list.toString()).apply()
    }

    fun getLocations(): JSONArray {
        val str = prefs.getString("locations", "[]")
        return try {
            JSONArray(str)
        } catch (e: Exception) {
            JSONArray()
        }
    }

    fun clearLocations() {
        prefs.edit().remove("locations").apply()
    }
}
