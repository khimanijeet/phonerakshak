package com.example.phonerakshak

import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.File

object AudioRecorderHelper {
    private const val TAG = "AudioRecorderHelper"

    suspend fun recordAndUpload(context: Context, client: BackendClient, prefs: Prefs): Boolean {
        if (ContextCompat.checkSelfPermission(context, android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "RECORD_AUDIO permission not granted")
            client.postAlert(prefs.deviceId, "audio_failed", "Microphone permission denied")
            return false
        }

        val file = File(context.cacheDir, "ambient_record_${System.currentTimeMillis()}.amr")
        var recorder: MediaRecorder? = null

        return withContext(Dispatchers.IO) {
            try {
                recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    MediaRecorder(context)
                } else {
                    @Suppress("DEPRECATION")
                    MediaRecorder()
                }

                recorder?.apply {
                    setAudioSource(MediaRecorder.AudioSource.MIC)
                    setOutputFormat(MediaRecorder.OutputFormat.AMR_NB)
                    setAudioEncoder(MediaRecorder.AudioEncoder.AMR_NB)
                    setOutputFile(file.absolutePath)
                    prepare()
                    start()
                }

                Log.i(TAG, "Recording started for 30s")
                // Record for 30 seconds
                delay(30_000L)

                recorder?.apply {
                    stop()
                    release()
                }
                recorder = null

                Log.i(TAG, "Recording finished, uploading...")
                val success = client.uploadAudio(prefs.deviceId, file)
                if (success) {
                    Log.i(TAG, "Audio uploaded successfully")
                    file.delete()
                    true
                } else {
                    Log.w(TAG, "Audio upload failed")
                    false
                }
            } catch (e: Exception) {
                Log.e(TAG, "Recording failed: ${e.message}", e)
                recorder?.release()
                recorder = null
                file.delete()
                false
            }
        }
    }
}
