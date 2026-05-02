package com.example.phonerakshak

import android.content.Context
import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.os.Build
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import java.io.FileOutputStream

/**
 * Silently captures a single photo from the front camera (or back if no front)
 * and saves it to the app's private intruders/ folder.
 *
 * Must be called from an Activity or other LifecycleOwner because CameraX
 * needs a lifecycle to bind to. Photos never leave the device.
 */
object SilentCamera {

    private const val TAG = "SilentCamera"
    private const val DIR = "intruders"

    fun captureIntruder(
        context: Context,
        lifecycleOwner: LifecycleOwner,
        onSaved: (File) -> Unit = {},
        onError: (Throwable) -> Unit = {}
    ) {
        val providerFuture = ProcessCameraProvider.getInstance(context)
        providerFuture.addListener({
            try {
                val provider = providerFuture.get()
                val imageCapture = ImageCapture.Builder()
                    .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                    .build()

                val selector = pickFrontIfAvailable(provider)
                provider.unbindAll()
                provider.bindToLifecycle(lifecycleOwner, selector, imageCapture)

                val outDir = File(context.filesDir, DIR).apply { mkdirs() }
                val ts = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
                val outFile = File(outDir, "intruder_$ts.jpg")

                val opts = ImageCapture.OutputFileOptions.Builder(outFile).build()

                imageCapture.takePicture(
                    opts,
                    ContextCompat.getMainExecutor(context),
                    object : ImageCapture.OnImageSavedCallback {
                        override fun onImageSaved(out: ImageCapture.OutputFileResults) {
                            Log.i(TAG, "Saved intruder photo: ${outFile.absolutePath}")
                            try { provider.unbindAll() } catch (_: Exception) {}
                            
                            // Apply the watermark before uploading
                            addWatermark(context, outFile)
                            
                            onSaved(outFile)
                        }

                        override fun onError(exc: ImageCaptureException) {
                            Log.w(TAG, "Capture failed: ${exc.message}")
                            try { provider.unbindAll() } catch (_: Exception) {}
                            onError(exc)
                        }
                    }
                )
            } catch (e: Exception) {
                Log.w(TAG, "Camera setup failed: ${e.message}")
                onError(e)
            }
        }, ContextCompat.getMainExecutor(context))
    }

    fun listIntruderPhotos(context: Context): List<File> {
        val dir = File(context.filesDir, DIR)
        if (!dir.isDirectory) return emptyList()
        return (dir.listFiles()?.toList() ?: emptyList())
            .sortedByDescending { it.lastModified() }
    }

    private fun pickFrontIfAvailable(provider: ProcessCameraProvider): CameraSelector {
        return if (provider.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA)) {
            CameraSelector.DEFAULT_FRONT_CAMERA
        } else {
            CameraSelector.DEFAULT_BACK_CAMERA
        }
    }

    private fun addWatermark(context: Context, file: File) {
        try {
            val bitmap = BitmapFactory.decodeFile(file.absolutePath) ?: return
            val mutableBitmap = bitmap.copy(Bitmap.Config.ARGB_8888, true)
            val canvas = Canvas(mutableBitmap)

            // Get Battery Info
            val batteryStatus: Intent? = IntentFilter(Intent.ACTION_BATTERY_CHANGED).let { ifilter ->
                context.registerReceiver(null, ifilter)
            }
            val level: Int = batteryStatus?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
            val scale: Int = batteryStatus?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
            val batteryPct = if (level != -1 && scale != -1) (level * 100 / scale.toFloat()).toInt() else -1

            // Get Location Info
            val prefs = Prefs(context)
            val locParts = prefs.lastKnownLocation?.split(",")
            val locStr = if (locParts != null && locParts.size >= 2) {
                "Lat: ${locParts[0].take(8)}, Lng: ${locParts[1].take(8)}"
            } else {
                "Location: Unknown"
            }

            // Get Time Info
            val timeStr = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())

            val watermarkText = "Date: $timeStr | Device: ${Build.MODEL} | Battery: $batteryPct% | $locStr"

            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                color = Color.YELLOW
                textSize = (bitmap.width * 0.03f).coerceAtLeast(16f) // Scale text relative to image width
                style = Paint.Style.FILL
                setShadowLayer(5f, 0f, 0f, Color.BLACK)
            }

            // Draw a semi-transparent black background behind the text for readability
            val bounds = Rect()
            paint.getTextBounds(watermarkText, 0, watermarkText.length, bounds)
            val padding = 20
            val bgRect = Rect(0, bitmap.height - bounds.height() - padding * 2, bitmap.width, bitmap.height)
            
            val bgPaint = Paint().apply {
                color = Color.argb(150, 0, 0, 0)
            }
            canvas.drawRect(bgRect, bgPaint)

            // Draw the text
            canvas.drawText(watermarkText, padding.toFloat(), (bitmap.height - padding).toFloat(), paint)

            // Save the modified bitmap back to the file
            FileOutputStream(file).use { out ->
                mutableBitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
            }
            
            Log.i(TAG, "Watermark added successfully")

        } catch (e: Exception) {
            Log.e(TAG, "Failed to add watermark: ${e.message}", e)
        }
    }
}
