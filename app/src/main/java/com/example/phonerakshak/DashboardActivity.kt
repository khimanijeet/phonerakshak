package com.example.phonerakshak

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.example.phonerakshak.databinding.ActivityDashboardBinding
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Main hub of the app once setup is complete. Shows protection status, last
 * known location, quick actions (test lock / alarm / locate / emergency),
 * intruder photo count, and a path back to settings.
 */
class DashboardActivity : AppCompatActivity() {

    private lateinit var binding: ActivityDashboardBinding
    private lateinit var prefs: Prefs

    private val refresher = object : Runnable {
        override fun run() {
            renderStatus()
            handler.postDelayed(this, 5_000L)
        }
    }
    private val handler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)

        // First-time users go to setup.
        if (!prefs.isConfigured()) {
            startActivity(Intent(this, SetupActivity::class.java))
            finish()
            return
        }

        binding = ActivityDashboardBinding.inflate(layoutInflater)
        setContentView(binding.root)

        binding.btnEmergency.setOnClickListener {
            EmergencyHandler.trigger(this, source = "panic_button")
            toast("Emergency Mode triggered")
        }

        binding.btnTestLock.setOnClickListener {
            startActivity(
                Intent(this, LockScreenActivity::class.java)
                    .putExtra(
                        LockScreenActivity.EXTRA_MESSAGE,
                        getString(R.string.lock_message)
                    )
            )
        }

        binding.btnTestAlarm.setOnClickListener {
            AlarmPlayer.playForSeconds(this, 10)
            toast("Alarm test (10s)")
        }

        binding.btnStopAlarm.setOnClickListener {
            AlarmPlayer.stop()
            toast("Alarm stopped")
        }

        binding.btnLocate.setOnClickListener { onLocateClicked() }
        binding.btnOpenMap.setOnClickListener { openLastInMaps() }
        binding.btnIntruders.setOnClickListener {
            startActivity(Intent(this, IntruderActivity::class.java))
        }
        binding.btnSettings.setOnClickListener {
            startActivity(Intent(this, SetupActivity::class.java))
        }
    }

    override fun onResume() {
        super.onResume()
        renderStatus()
        handler.post(refresher)
    }

    override fun onPause() {
        handler.removeCallbacks(refresher)
        super.onPause()
    }

    private fun renderStatus() {
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val adminActive = dpm.isAdminActive(LockerAdminReceiver.componentName(this))

        binding.txtProtection.text =
            if (prefs.isConfigured()) getString(R.string.status_running)
            else getString(R.string.status_stopped)
        binding.dotProtection.setBackgroundResource(
            if (prefs.isConfigured()) R.drawable.dot_green else R.drawable.dot_red
        )

        binding.txtAdmin.text =
            if (adminActive) getString(R.string.status_admin_on)
            else getString(R.string.status_admin_off)
        binding.dotAdmin.setBackgroundResource(
            if (adminActive) R.drawable.dot_green else R.drawable.dot_red
        )

        binding.txtBackend.text =
            if (prefs.hasBackend()) getString(R.string.status_backend_on, prefs.backendUrl)
            else getString(R.string.status_backend_off)
        binding.dotBackend.setBackgroundResource(
            if (prefs.hasBackend()) R.drawable.dot_green else R.drawable.dot_red
        )

        val intruderCount = SilentCamera.listIntruderPhotos(this).size
        binding.txtIntruderCount.text =
            resources.getQuantityString(R.plurals.intruders_count, intruderCount, intruderCount)

        val last = prefs.lastKnownLocation
        if (last != null) {
            val parts = last.split(",")
            if (parts.size >= 4) {
                val lat = parts[0]
                val lng = parts[1]
                val ts = parts[3].toLongOrNull() ?: 0L
                val when_ = if (ts > 0) {
                    SimpleDateFormat("MMM d, HH:mm:ss", Locale.getDefault()).format(Date(ts))
                } else "—"
                binding.txtLastLocation.text = getString(R.string.last_loc_format, lat, lng, when_)
                binding.btnOpenMap.isEnabled = true
            } else {
                binding.txtLastLocation.text = getString(R.string.last_loc_none)
                binding.btnOpenMap.isEnabled = false
            }
        } else {
            binding.txtLastLocation.text = getString(R.string.last_loc_none)
            binding.btnOpenMap.isEnabled = false
        }
    }

    private fun onLocateClicked() {
        toast("Getting location…")
        val prefs = this.prefs
        val backend = prefs.hasBackend()
        Thread {
            val loc = kotlinx.coroutines.runBlocking {
                LocationHelper.getCurrentLocation(this@DashboardActivity)
            }
            if (loc != null) {
                prefs.lastKnownLocation =
                    "${loc.latitude},${loc.longitude},${loc.accuracy},${System.currentTimeMillis()}"
                if (backend) {
                    BackendClient(prefs.backendUrl).postLocation(
                        prefs.deviceId,
                        loc.latitude,
                        loc.longitude,
                        loc.accuracy,
                        "dashboard"
                    )
                }
                runOnUiThread {
                    renderStatus()
                    toast("Location updated")
                }
            } else {
                runOnUiThread { toast("No GPS fix (check permissions / GPS)") }
            }
        }.start()
    }

    private fun openLastInMaps() {
        val last = prefs.lastKnownLocation ?: return
        val parts = last.split(",")
        if (parts.size < 2) return
        val lat = parts[0]
        val lng = parts[1]
        val uri = Uri.parse("geo:$lat,$lng?q=$lat,$lng(PhoneRakshak)")
        val i = Intent(Intent.ACTION_VIEW, uri)
        try {
            startActivity(i)
        } catch (_: Exception) {
            startActivity(
                Intent(
                    Intent.ACTION_VIEW,
                    Uri.parse("https://maps.google.com/?q=$lat,$lng")
                )
            )
        }
    }

    private fun toast(s: String) =
        Toast.makeText(this, s, Toast.LENGTH_SHORT).show()
}
