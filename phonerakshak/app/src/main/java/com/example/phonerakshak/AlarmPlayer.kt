package com.example.phonerakshak

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Handler
import android.os.Looper
import android.util.Log

/** Plays the system alarm tone at max volume on the alarm stream (overrides silent). */
object AlarmPlayer {

    private const val TAG = "AlarmPlayer"
    private var current: MediaPlayer? = null

    fun playForSeconds(context: Context, seconds: Int = 60) {
        try {
            stop()

            val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            audio.setStreamVolume(
                AudioManager.STREAM_ALARM,
                audio.getStreamMaxVolume(AudioManager.STREAM_ALARM),
                0
            )

            val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            val mp = MediaPlayer().apply {
                setDataSource(context, uri)
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                isLooping = true
                prepare()
                start()
            }
            current = mp

            Handler(Looper.getMainLooper()).postDelayed({ stop() }, seconds * 1000L)
        } catch (e: Exception) {
            Log.w(TAG, "alarm failed: ${e.message}")
        }
    }

    fun stop() {
        try {
            current?.let {
                if (it.isPlaying) it.stop()
                it.release()
            }
        } catch (_: Exception) {
        }
        current = null
    }
}
