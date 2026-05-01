package com.example.phonerakshak

import android.app.KeyguardManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.example.phonerakshak.databinding.ActivityLockBinding
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.io.File

/**
 * Full-screen lock activity. Shown when a LOCK SMS is received or when the
 * user taps "Test lock screen". The only way out is the configured PIN.
 *
 * On the first wrong attempt and again on every third attempt, a silent
 * front-camera photo is captured to internal storage (intruders/ folder)
 * and uploaded to the backend if one is configured.
 */
class LockScreenActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLockBinding
    private lateinit var prefs: Prefs
    private var wrongAttempts = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            (getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager)
                .requestDismissKeyguard(this, null)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
            )
        }

        binding = ActivityLockBinding.inflate(layoutInflater)
        setContentView(binding.root)
        prefs = Prefs(this)

        intent.getStringExtra(EXTRA_MESSAGE)?.let { msg ->
            if (msg.isNotBlank()) binding.txtMessage.text = msg
        }

        binding.btnUnlock.setOnClickListener { onUnlockClicked() }
    }

    private fun onUnlockClicked() {
        val pin = binding.inputPin.text.toString().trim()
        if (prefs.checkPin(pin)) {
            finish()
            return
        }

        wrongAttempts += 1
        binding.txtError.visibility = View.VISIBLE
        binding.inputPin.text.clear()

        if (wrongAttempts == 1 || wrongAttempts % 3 == 0) {
            tryCaptureIntruder()
        }

        // After 3+ wrong attempts, post an alert.
        if (wrongAttempts == 3 && prefs.hasBackend()) {
            val client = BackendClient(prefs.backendUrl)
            CoroutineScope(Dispatchers.IO).launch {
                client.postAlert(
                    prefs.deviceId,
                    "wrong_pin",
                    "$wrongAttempts wrong PIN attempts on lock screen"
                )
            }
        }
    }

    private fun tryCaptureIntruder() {
        val cameraOk = ContextCompat.checkSelfPermission(
            this, android.Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
        if (!cameraOk) return
        SilentCamera.captureIntruder(
            this,
            this,
            onSaved = { file -> uploadIntruder(file) }
        )
    }

    private fun uploadIntruder(file: File) {
        if (!prefs.hasBackend()) return
        val client = BackendClient(prefs.backendUrl)
        CoroutineScope(Dispatchers.IO).launch {
            client.uploadIntruderPhoto(prefs.deviceId, file)
        }
    }

    /** Block the back button — the only way out is the PIN. */
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        // intentionally swallow
    }

    companion object {
        const val EXTRA_MESSAGE = "extra_message"
    }
}
