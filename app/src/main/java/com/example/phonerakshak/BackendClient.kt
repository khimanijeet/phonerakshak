package com.example.phonerakshak

import android.util.Log
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
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
class BackendClient(private val baseUrl: String) {

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

    fun registerDevice(
        deviceId: String,
        phone: String,
        emergency: String,
        model: String?
    ): Boolean {
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
                .build()

            client.newCall(req).execute().use { resp ->
                Log.i(TAG, "registerDevice -> ${resp.code}")
                resp.isSuccessful
            }
        } catch (e: Exception) {
            Log.w(TAG, "registerDevice failed: ${e.message}")
            false
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
            }.toString()

            val req = Request.Builder()
                .url("$baseUrl/api/locations")
                .post(body.toRequestBody(jsonMedia))
                .build()

            client.newCall(req).execute().use { resp ->
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
            }.toString()

            val req = Request.Builder()
                .url("$baseUrl/api/alerts")
                .post(body.toRequestBody(jsonMedia))
                .build()

            client.newCall(req).execute().use { resp ->
                Log.i(TAG, "postAlert($type) -> ${resp.code}")
                resp.isSuccessful
            }
        } catch (e: Exception) {
            Log.w(TAG, "postAlert failed: ${e.message}")
            false
        }
    }

    /** Returns the list of pending commands. The server marks them delivered on this call. */
    fun pollCommands(deviceId: String): List<PendingCommand> {
        return try {
            val req = Request.Builder()
                .url("$baseUrl/api/devices/$deviceId/commands")
                .get()
                .build()

            client.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) {
                    Log.w(TAG, "pollCommands -> ${resp.code}")
                    return emptyList()
                }
                val body = resp.body?.string() ?: return emptyList()
                val obj = JSONObject(body)
                val arr: JSONArray = obj.optJSONArray("commands") ?: return emptyList()
                buildList {
                    for (i in 0 until arr.length()) {
                        val c = arr.getJSONObject(i)
                        add(
                            PendingCommand(
                                id = c.getString("id"),
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
            }.toString()

            val req = Request.Builder()
                .url("$baseUrl/api/devices/$deviceId/commands/$commandId/ack")
                .post(body.toRequestBody(jsonMedia))
                .build()

            client.newCall(req).execute().use { resp -> resp.isSuccessful }
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

            val req = Request.Builder()
                .url("$baseUrl/api/intruders")
                .post(body)
                .build()

            client.newCall(req).execute().use { resp ->
                Log.i(TAG, "uploadIntruderPhoto -> ${resp.code}")
                resp.isSuccessful
            }
        } catch (e: Exception) {
            Log.w(TAG, "uploadIntruderPhoto failed: ${e.message}")
            false
        }
    }

    companion object {
        private const val TAG = "BackendClient"
    }
}
