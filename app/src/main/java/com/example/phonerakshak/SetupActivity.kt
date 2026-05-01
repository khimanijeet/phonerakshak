package com.example.phonerakshak

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import com.example.phonerakshak.databinding.ActivitySetupBinding
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class SetupActivity : AppCompatActivity() {

    private lateinit var binding: ActivitySetupBinding
    private lateinit var prefs: Prefs

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivitySetupBinding.inflate(layoutInflater)
        setContentView(binding.root)

        prefs = Prefs(this)
        binding.inputPhone.setText(prefs.phoneNumber ?: "")
        binding.inputEmergency.setText(prefs.emergencyNumber ?: "")
        binding.inputBackend.setText(prefs.backendUrl)

        binding.btnSave.setOnClickListener { onSaveClicked() }
        binding.btnAdmin.setOnClickListener { requestDeviceAdmin() }
        binding.btnTestLock.setOnClickListener { showTestLock() }
        binding.btnIntruders.setOnClickListener {
            startActivity(Intent(this, IntruderActivity::class.java))
        }
        binding.btnDashboard.setOnClickListener {
            if (prefs.isConfigured()) {
                startActivity(Intent(this, DashboardActivity::class.java))
            } else {
                toast("Save your settings first")
            }
        }

        requestStartupPermissions()
        updateStatus()
    }

    override fun onResume() {
        super.onResume()
        updateStatus()
    }

    private fun onSaveClicked() {
        val phone = binding.inputPhone.text.toString().trim()
        val emergency = binding.inputEmergency.text.toString().trim()
        val pin = binding.inputPin.text.toString().trim()
        val backend = binding.inputBackend.text.toString().trim()

        if (emergency.isEmpty()) {
            toast("Emergency contact is required")
            return
        }
        // PIN is required only on first setup, optional on edits.
        if (pin.isNotEmpty() && pin.length < 4) {
            toast("PIN must be at least 4 digits")
            return
        }
        if (pin.isEmpty() && !prefs.isConfigured()) {
            toast("PIN is required for first setup")
            return
        }

        prefs.phoneNumber = phone.ifEmpty { null }
        prefs.emergencyNumber = emergency
        prefs.backendUrl = backend
        if (pin.isNotEmpty()) prefs.setPin(pin)

        SimUtils.currentFingerprint(this)?.let { prefs.simFingerprint = it }

        // (Re)start the foreground service so receivers + poller pick up new config.
        PhoneRakshakService.start(this)

        if (prefs.hasBackend()) {
            val client = BackendClient(prefs)
            CoroutineScope(Dispatchers.IO).launch {
                val token = client.registerDevice(
                    prefs.deviceId,
                    phone,
                    emergency,
                    Build.MODEL
                )
                val ok = token != null
                if (ok) prefs.jwtToken = token
                withContext(Dispatchers.Main) {
                    toast(
                        if (ok) "Saved & registered with server"
                        else "Saved locally (server unreachable)"
                    )
                    updateStatus()
                    goToDashboardIfReady()
                }
            }
        } else {
            toast("Saved. Protection running.")
            updateStatus()
            goToDashboardIfReady()
        }
    }

    private fun goToDashboardIfReady() {
        if (prefs.isConfigured()) {
            startActivity(Intent(this, DashboardActivity::class.java))
            finish()
        }
    }

    private fun requestDeviceAdmin() {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = LockerAdminReceiver.componentName(this)
        if (dpm.isAdminActive(admin)) {
            toast(getString(R.string.status_admin_on))
            return
        }
        val i = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
            putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, admin)
            putExtra(
                DevicePolicyManager.EXTRA_ADD_EXPLANATION,
                getString(R.string.admin_explanation)
            )
        }
        startActivity(i)
    }

    private fun showTestLock() {
        startActivity(
            Intent(this, LockScreenActivity::class.java)
                .putExtra(LockScreenActivity.EXTRA_MESSAGE, getString(R.string.lock_message))
        )
    }

    private fun updateStatus() {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val adminActive = dpm.isAdminActive(LockerAdminReceiver.componentName(this))
        binding.txtAdminStatus.setText(
            if (adminActive) R.string.status_admin_on else R.string.status_admin_off
        )
        binding.txtStatus.setText(
            if (prefs.isConfigured()) R.string.status_running else R.string.status_stopped
        )
    }

    private fun requestStartupPermissions() {
        val perms = mutableListOf(
            Manifest.permission.RECEIVE_SMS,
            Manifest.permission.SEND_SMS,
            Manifest.permission.READ_SMS,
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.READ_PHONE_STATE,
            Manifest.permission.CAMERA
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            perms.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        val needed = perms.filter {
            ActivityCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (needed.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), 1001)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            ActivityCompat.checkSelfPermission(
                this, Manifest.permission.ACCESS_BACKGROUND_LOCATION
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this, arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION), 1002
            )
        }

        if (!Settings.canDrawOverlays(this)) {
            startActivity(
                Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$packageName")
                )
            )
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 1001 &&
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
            ActivityCompat.checkSelfPermission(
                this, Manifest.permission.ACCESS_BACKGROUND_LOCATION
            ) != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this, arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION), 1002
            )
        }
    }

    private fun toast(s: String) =
        Toast.makeText(this, s, Toast.LENGTH_SHORT).show()
}
