package com.example.phonerakshak

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * A transparent activity launched over the system lock screen to provide a 
 * valid LifecycleOwner for SilentCamera. It takes a photo, uploads it, 
 * and closes instantly.
 */
class InvisibleCaptureActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Hide window completely to remain invisible to the user
        window.attributes.alpha = 0f
        
        val prefs = Prefs(this)
        SilentCamera.captureIntruder(
            context = this,
            lifecycleOwner = this,
            onSaved = { file -> 
                if (prefs.hasBackend()) {
                    CoroutineScope(Dispatchers.IO).launch {
                        BackendClient(prefs).uploadIntruderPhoto(prefs.deviceId, file)
                    }
                }
                finish() 
            },
            onError = { 
                finish() 
            }
        )
    }
}
