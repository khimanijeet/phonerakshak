package com.example.phonerakshak

import android.os.Bundle
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

class RecoveryDashboardActivity : AppCompatActivity() {

    private lateinit var tvStatus: TextView
    private lateinit var btnLock: Button
    private lateinit var btnAlarm: Button
    private lateinit var btnLocation: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_recovery_dashboard)

        tvStatus = findViewById(R.id.tvStatus)
        btnLock = findViewById(R.id.btnLock)
        btnAlarm = findViewById(R.id.btnAlarm)
        btnLocation = findViewById(R.id.btnLocation)

        val prefs = Prefs(this)
        val targetDeviceId = prefs.targetDeviceId ?: "unknown"
        tvStatus.text = "Tracking Device: $targetDeviceId\n(Limited Access Mode)"

        btnLock.setOnClickListener { sendCommand("LOCK", targetDeviceId) }
        btnAlarm.setOnClickListener { sendCommand("ALARM", targetDeviceId) }
        btnLocation.setOnClickListener { sendCommand("LOC", targetDeviceId) }
        
        Toast.makeText(this, "Sensitive settings (Wipe Data, Contacts) are disabled in Recovery Mode", Toast.LENGTH_LONG).show()
    }

    private fun sendCommand(type: String, targetDeviceId: String?) {
        if (targetDeviceId == null) return
        val token = Prefs(this).jwtToken ?: return

        val json = JSONObject().apply { put("type", type) }
        val body = json.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
        
        val request = Request.Builder()
            .url("${BuildConfig.BACKEND_URL}/api/devices/$targetDeviceId/commands")
            .post(body)
            .addHeader("Authorization", "Bearer $token")
            .build()

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val response = OkHttpClient().newCall(request).execute()
                if (response.isSuccessful) {
                    runOnUiThread { Toast.makeText(this@RecoveryDashboardActivity, "Command $type Sent!", Toast.LENGTH_SHORT).show() }
                } else {
                    runOnUiThread { Toast.makeText(this@RecoveryDashboardActivity, "Failed to send $type", Toast.LENGTH_SHORT).show() }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }
}
