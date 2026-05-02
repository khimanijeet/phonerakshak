package com.example.phonerakshak

import android.os.Build
import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Talks to the optional Node.js backend. All failures are logged but never
 * crash the app; the app works fully without a backend.
 */
class BackendClient(private val prefs: Prefs) {

    data class PendingCommand(
        val id: String,
        val type: String,
        val params: JSONObject?
    )

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build()

    private val jsonMedia = "application/json; charset=utf-8".toMediaType()
    private val jpegMedia = "image/jpeg".toMediaType()
    private val amrMedia = "audio/amr".toMediaType()
    private val baseUrl: String get() = prefs.backendUrl

    private fun buildRequest(url: String, method: String, body: okhttp3.RequestBody? = null): Request {
        val builder = Request.Builder().url(url)
        if (method == "POST") builder.post(body!!)
        else if (method == "GET") builder.get()
        
        prefs.jwtToken?.let { token ->
            builder.header("Authorization", "Bearer $token")
        }
        return builder.build()
    }

    private fun executeWithAuthRetry(requestFactory: () -> Request): okhttp3.Response {
        var req = requestFactory()
        var resp = client.newCall(req).execute()
        
        if (resp.code == 401 || resp.code == 403) {
            resp.close()
            Log.i(TAG, "JWT expired or invalid. Attempting silent re-registration...")
            // Attempt silent re-registration
            val newToken = registerDevice(
                prefs.deviceId,
                prefs.phoneNumber ?: "",
                prefs.emergencyNumber ?: "",
                Build.MODEL
            )
            if (newToken != null) {
                prefs.jwtToken = newToken
                // Retry request with new token
                req = requestFactory()
                resp = client.newCall(req).execute()
            }
        }
        return resp
    }

    fun registerDevice(
        deviceId: String,
        phone: String,
        emergency: String,
        model: String?
    ): String? {
        return try {
            val body = JSONObject().apply {
                put("deviceId", deviceId)
                put("phoneNumber", phone)
                put("emergencyNumber", emergency)
                if (!model.isNullOrBlank()) put("deviceModel", model)
            }.toString()

            val req = Request.Builder()
                .url("$baseUrl/api/devices")
                .post(body.toRequestBody(jsonMedia))
                .build() // Auth not required for registration

            client.newCall(req).execute().use { resp ->
                Log.i(TAG, "registerDevice -> ${resp.code}")
                if (!resp.isSuccessful) return null
                val respBody = resp.body?.string() ?: return null
                val obj = JSONObject(respBody)
                val token = obj.optString("token", null)
                if (token != null) prefs.jwtToken = token
                return token
            }
        } catch (e: Exception) {
            Log.w(TAG, "registerDevice failed: ${e.message}")
            null
        }
    }

    fun postLocation(
        deviceId: String,
        lat: Double,
        lng: Double,
        accuracy: Float?,
        trigger: String
    ): Boolean {
        return try {
            val body = JSONObject().apply {
                put("deviceId", deviceId)
                put("latitude", lat)
                put("longitude", lng)
                if (accuracy != null) put("accuracy", accuracy.toDouble())
                put("trigger", trigger)
            }.toString().toRequestBody(jsonMedia)

            executeWithAuthRetry { buildRequest("$baseUrl/api/locations", "POST", body) }.use { resp ->
                Log.i(TAG, "postLocation -> ${resp.code}")
                resp.isSuccessful
            }
        } catch (e: Exception) {
            Log.w(TAG, "postLocation failed: ${e.message}")
            false
        }
    }

    fun postAlert(deviceId: String, type: String, message: String, meta: JSONObject? = null): Boolean {
        return try {
            val body = JSONObject().apply {
                put("deviceId", deviceId)
                put("type", type)
                put("message", message)
                if (meta != null) put("meta", meta)
            }.toString().toRequestBody(jsonMedia)

            executeWithAuthRetry { buildRequest("$baseUrl/api/alerts", "POST", body) }.use { resp ->
                Log.i(TAG, "postAlert($type) -> ${resp.code}")
                resp.isSuccessful
            }
        } catch (e: Exception) {
            Log.w(TAG, "postAlert failed: ${e.message}")
            false
        }
    }

    fun pollCommands(deviceId: String): List<PendingCommand> {
        return try {
            executeWithAuthRetry { buildRequest("$baseUrl/api/devices/$deviceId/commands", "GET") }.use { resp ->
                if (!resp.isSuccessful) {
                    Log.w(TAG, "pollCommands -> ${resp.code}")
                    return emptyList()
                }
                val bodyStr = resp.body?.string() ?: return emptyList()
                val obj = JSONObject(bodyStr)
                val arr: JSONArray = obj.optJSONArray("commands") ?: return emptyList()
                buildList {
                    for (i in 0 until arr.length()) {
                        val c = arr.getJSONObject(i)
                        add(
                            PendingCommand(
                                id = c.optString("_id", c.optString("id")),
                                type = c.getString("type"),
                                params = c.optJSONObject("params")
                            )
                        )
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "pollCommands failed: ${e.message}")
            emptyList()
        }
    }

    fun ackCommand(deviceId: String, commandId: String, result: String?): Boolean {
        return try {
            val body = JSONObject().apply {
                if (result != null) put("result", result)
            }.toString().toRequestBody(jsonMedia)

            executeWithAuthRetry { buildRequest("$baseUrl/api/devices/$deviceId/commands/$commandId/ack", "POST", body) }.use { resp ->
                resp.isSuccessful
            }
        } catch (e: Exception) {
            Log.w(TAG, "ackCommand failed: ${e.message}")
            false
        }
    }

    fun uploadIntruderPhoto(deviceId: String, file: File): Boolean {
        if (!file.exists()) return false
        return try {
            val body = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("deviceId", deviceId)
                .addFormDataPart("photo", file.name, file.asRequestBody(jpegMedia))
                .build()

            executeWithAuthRetry { buildRequest("$baseUrl/api/intruders", "POST", body) }.use { resp ->
                Log.i(TAG, "uploadIntruderPhoto -> ${resp.code}")
                resp.isSuccessful
            }
        } catch (e: Exception) {
            Log.w(TAG, "uploadIntruderPhoto failed: ${e.message}")
            false
        }
    }

    fun uploadAudio(deviceId: String, file: File): Boolean {
        if (!file.exists()) return false
        return try {
            val body = MultipartBody.Builder()
                .setType(MultipartBody.FORM)
                .addFormDataPart("deviceId", deviceId)
                .addFormDataPart("audio", file.name, file.asRequestBody(amrMedia))
                .build()

            executeWithAuthRetry { buildRequest("$baseUrl/api/audio", "POST", body) }.use { resp ->
                Log.i(TAG, "uploadAudio -> ${resp.code}")
                resp.isSuccessful
            }
        } catch (e: Exception) {
            Log.w(TAG, "uploadAudio failed: ${e.message}")
            false
        }
    }

    // New Ping function for Heartbeat
    fun ping(deviceId: String): Boolean {
        return try {
            val body = JSONObject().apply { put("deviceId", deviceId) }.toString().toRequestBody(jsonMedia)
            executeWithAuthRetry { buildRequest("$baseUrl/api/devices/$deviceId/ping", "POST", body) }.use { resp ->
                resp.isSuccessful
            }
        } catch (e: Exception) {
            false
        }
    }

    fun getGeofence(deviceId: String): JSONObject? {
        return try {
            executeWithAuthRetry { buildRequest("$baseUrl/api/devices/$deviceId/geofence", "GET") }.use { resp ->
                if (!resp.isSuccessful) return null
                val bodyStr = resp.body?.string() ?: return null
                JSONObject(bodyStr)
            }
        } catch (e: Exception) {
            Log.w(TAG, "getGeofence failed: ${e.message}")
            null
        }
    }

    companion object {
        private const val TAG = "BackendClient"
    }
}
