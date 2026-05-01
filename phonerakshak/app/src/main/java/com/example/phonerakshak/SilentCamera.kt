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
}
