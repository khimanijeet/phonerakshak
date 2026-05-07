package com.example.phonerakshak

import android.Manifest
import android.annotation.SuppressLint
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var prefs: Prefs

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        prefs = Prefs(this)
        webView = findViewById(R.id.webView)

        setupWebView()
        requestPermissionsIfNeeded()
        handleDeviceRegistration()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                if (url.startsWith(prefs.backendUrl)) {
                    return false // Let WebView handle it
                }
                // Open external links in browser
                startActivity(Intent(Intent.ACTION_VIEW, request.url))
                return true
            }

            override fun onReceivedError(
                view: WebView?,
                errorCode: Int,
                description: String?,
                failingUrl: String?
            ) {
                super.onReceivedError(view, errorCode, description, failingUrl)
                Toast.makeText(this@MainActivity, "Connection Error: $description", Toast.LENGTH_LONG).show()
                // Optionally load a simple offline HTML
                val offlineHtml = """
                    <html><body style="background-color:#0A0B10;color:white;display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;font-family:sans-serif;">
                        <h2>Connection Error</h2>
                        <p>Please check your internet connection.</p>
                        <button onclick="window.location.reload()" style="padding:10px 20px;background:#E53935;color:white;border:none;border-radius:5px;font-size:16px;margin-top:20px;">Retry</button>
                    </body></html>
                """.trimIndent()
                view?.loadData(offlineHtml, "text/html", "UTF-8")
            }
        }
        
        webView.webChromeClient = WebChromeClient()
        webView.addJavascriptInterface(WebAppInterface(this), "AndroidNative")

        webView.loadUrl("${prefs.backendUrl}/customer/login")
    }

    private fun handleDeviceRegistration() {
        if (!prefs.isConfigured()) {
            CoroutineScope(Dispatchers.IO).launch {
                val client = BackendClient(prefs)
                val token = client.registerDevice(
                    deviceId = prefs.deviceId,
                    phone = "", // Left blank, user configures on web if needed
                    emergency = "",
                    model = Build.MODEL
                )
                if (token != null) {
                    prefs.jwtToken = token
                    // Start background service once registered
                    withContext(Dispatchers.Main) {
                        PhoneRakshakService.start(this@MainActivity)
                        SyncWorker.schedule(this@MainActivity)
                    }
                }
            }
        } else {
            // Already configured, make sure services are running if tracking mode enabled
            PhoneRakshakService.start(this)
            SyncWorker.schedule(this)
        }
    }

    private fun requestPermissionsIfNeeded() {
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
            try {
                startActivity(
                    Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:$packageName")
                    )
                )
            } catch (e: Exception) {
                // Ignore if not supported
            }
        }
        
        // Request Device Admin for lock feature silently if possible, or prompt
        val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val admin = LockerAdminReceiver.componentName(this)
        if (!dpm.isAdminActive(admin)) {
            try {
                val intent = Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN).apply {
                    putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, admin)
                    putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, getString(R.string.admin_explanation))
                }
                startActivity(intent)
            } catch (e: Exception) {
               // Ignore
            }
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
    
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    inner class WebAppInterface(private val mContext: Context) {
        @JavascriptInterface
        fun start_tracking() {
            val lm = mContext.getSystemService(Context.LOCATION_SERVICE) as android.location.LocationManager
            if (!lm.isProviderEnabled(android.location.LocationManager.GPS_PROVIDER)) {
                Toast.makeText(mContext, "Please enable GPS", Toast.LENGTH_LONG).show()
                return
            }
            prefs.trackingMode = 1
            PhoneRakshakService.start(mContext)
            Toast.makeText(mContext, "Tracking Started", Toast.LENGTH_SHORT).show()
        }

        @JavascriptInterface
        fun stop_tracking() {
            prefs.trackingMode = 0
            PhoneRakshakService.stop(mContext)
            Toast.makeText(mContext, "Tracking Stopped", Toast.LENGTH_SHORT).show()
        }

        @JavascriptInterface
        fun unlink_device() {
            prefs.trackingMode = 0
            prefs.jwtToken = null
            PhoneRakshakService.stop(mContext)
            Toast.makeText(mContext, "Device Unlinked", Toast.LENGTH_SHORT).show()
            val intent = Intent(mContext, MainActivity::class.java)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
            mContext.startActivity(intent)
        }

        @JavascriptInterface
        fun play_alarm() {
            AlarmPlayer.playForSeconds(mContext, 15)
            Toast.makeText(mContext, "Playing Alarm", Toast.LENGTH_SHORT).show()
        }

        @JavascriptInterface
        fun lock_device() {
            val dpm = getSystemService(Context.DEVICE_POLICY_SERVICE) as DevicePolicyManager
            if (dpm.isAdminActive(LockerAdminReceiver.componentName(mContext))) {
                dpm.lockNow()
            } else {
                Toast.makeText(mContext, "Device Admin not enabled", Toast.LENGTH_SHORT).show()
                val intent = Intent(mContext, LockScreenActivity::class.java).apply {
                    putExtra(LockScreenActivity.EXTRA_MESSAGE, getString(R.string.lock_message))
                }
                startActivity(intent)
            }
        }
        
        @JavascriptInterface
        fun get_device_id(): String {
            return prefs.deviceId
        }
    }
}
