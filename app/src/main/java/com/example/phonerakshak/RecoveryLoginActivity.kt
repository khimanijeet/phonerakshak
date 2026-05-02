package com.example.phonerakshak

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class RecoveryLoginActivity : AppCompatActivity() {

    private lateinit var viewFinder: PreviewView
    private lateinit var cameraExecutor: ExecutorService
    private lateinit var tvLivenessPrompt: TextView
    private lateinit var etRecoveryCode: EditText
    private lateinit var btnVerify: Button

    private var livenessPassed = false
    private var isProcessing = false
    private var currentPrompt = "Blink your eyes to verify liveness"
    
    // TFLite placeholder
    // private lateinit var faceNetInterpreter: Interpreter

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_recovery_login)

        viewFinder = findViewById(R.id.viewFinder)
        tvLivenessPrompt = findViewById(R.id.tvLivenessPrompt)
        etRecoveryCode = findViewById(R.id.etRecoveryCode)
        btnVerify = findViewById(R.id.btnVerify)
        
        tvLivenessPrompt.text = currentPrompt

        cameraExecutor = Executors.newSingleThreadExecutor()

        if (allPermissionsGranted()) {
            startCamera()
        } else {
            ActivityCompat.requestPermissions(this, REQUIRED_PERMISSIONS, REQUEST_CODE_PERMISSIONS)
        }

        btnVerify.setOnClickListener {
            if (livenessPassed) {
                // Perform face matching
                submitFaceDescriptor()
            } else {
                Toast.makeText(this, "Please complete liveness check first", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun startCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)

        cameraProviderFuture.addListener({
            val cameraProvider: ProcessCameraProvider = cameraProviderFuture.get()
            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(viewFinder.surfaceProvider)
            }

            val imageAnalyzer = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
                .also {
                    it.setAnalyzer(cameraExecutor) { imageProxy ->
                        processImageProxy(imageProxy)
                    }
                }

            val cameraSelector = CameraSelector.DEFAULT_FRONT_CAMERA

            try {
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(this, cameraSelector, preview, imageAnalyzer)
            } catch (exc: Exception) {
                Log.e(TAG, "Use case binding failed", exc)
            }
        }, ContextCompat.getMainExecutor(this))
    }

    @androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
    private fun processImageProxy(imageProxy: androidx.camera.core.ImageProxy) {
        val mediaImage = imageProxy.image
        if (mediaImage != null && !isProcessing && !livenessPassed) {
            isProcessing = true
            val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
            
            val options = FaceDetectorOptions.Builder()
                .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
                .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
                .build()

            val detector = FaceDetection.getClient(options)

            detector.process(image)
                .addOnSuccessListener { faces ->
                    for (face in faces) {
                        // Liveness check: Detect blink
                        val leftEyeOpen = face.leftEyeOpenProbability
                        val rightEyeOpen = face.rightEyeOpenProbability
                        
                        if (leftEyeOpen != null && rightEyeOpen != null) {
                            if (leftEyeOpen < 0.2f && rightEyeOpen < 0.2f) {
                                // Both eyes closed -> Blink detected
                                runOnUiThread {
                                    livenessPassed = true
                                    tvLivenessPrompt.text = "Liveness Verified! You can now verify."
                                    tvLivenessPrompt.setTextColor(android.graphics.Color.GREEN)
                                }
                            }
                        }
                    }
                }
                .addOnFailureListener { e ->
                    Log.e(TAG, "Face detection failed", e)
                }
                .addOnCompleteListener {
                    imageProxy.close()
                    isProcessing = false
                }
        } else {
            imageProxy.close()
        }
    }

    private fun submitFaceDescriptor() {
        val recoveryCode = etRecoveryCode.text.toString()
        if (recoveryCode.isEmpty()) {
            Toast.makeText(this, "Enter Recovery Code", Toast.LENGTH_SHORT).show()
            return
        }

        // MOCK DESCRIPTOR FOR NOW until TFLite model is added
        val mockDescriptor = DoubleArray(128) { Math.random() }
        val jsonArray = JSONArray()
        mockDescriptor.forEach { jsonArray.put(it) }

        val json = JSONObject()
        json.put("recoveryCode", recoveryCode)
        json.put("liveDescriptor", jsonArray)

        val body = json.toString().toRequestBody("application/json; charset=utf-8".toMediaType())
        val request = Request.Builder()
            .url("${BuildConfig.BACKEND_URL}/api/auth/verify-face")
            .post(body)
            .build()

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val client = OkHttpClient()
                val response = client.newCall(request).execute()
                val resStr = response.body?.string()
                
                if (response.isSuccessful) {
                    val jsonObj = JSONObject(resStr!!)
                    val token = jsonObj.getString("token")
                    val deviceId = jsonObj.getString("deviceId")
                    
                    val prefs = Prefs(this@RecoveryLoginActivity)
                    prefs.jwtToken = token
                    prefs.targetDeviceId = deviceId
                    
                    runOnUiThread {
                        Toast.makeText(this@RecoveryLoginActivity, "Face Verified! Access Granted.", Toast.LENGTH_LONG).show()
                        startActivity(Intent(this@RecoveryLoginActivity, RecoveryDashboardActivity::class.java))
                        finish()
                    }
                } else {
                    runOnUiThread {
                        Toast.makeText(this@RecoveryLoginActivity, "Verification Failed", Toast.LENGTH_LONG).show()
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun allPermissionsGranted() = REQUIRED_PERMISSIONS.all {
        ContextCompat.checkSelfPermission(baseContext, it) == PackageManager.PERMISSION_GRANTED
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_CODE_PERMISSIONS) {
            if (allPermissionsGranted()) {
                startCamera()
            } else {
                Toast.makeText(this, "Permissions not granted by the user.", Toast.LENGTH_SHORT).show()
                finish()
            }
        }
    }

    companion object {
        private const val TAG = "RecoveryLoginActivity"
        private const val REQUEST_CODE_PERMISSIONS = 10
        private val REQUIRED_PERMISSIONS = arrayOf(Manifest.permission.CAMERA)
    }
}
