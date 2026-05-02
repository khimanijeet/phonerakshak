package com.example.phonerakshak

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import androidx.appcompat.app.AppCompatActivity

class FakeShutdownActivity : AppCompatActivity() {

    private var tapCount = 0
    private val resetHandler = Handler(Looper.getMainLooper())
    private val resetRunnable = Runnable { tapCount = 0 }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Lock screen to full screen, hide navigation and status bars (Immersive mode)
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_FULLSCREEN
                or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)

        // Keep screen fully awake but black
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        
        // Disable screen capture
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)

        // Show over lockscreen
        window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED)

        setContentView(R.layout.activity_fake_shutdown)

        val llShuttingDown = findViewById<LinearLayout>(R.id.llShuttingDown)

        // Fade out the "Shutting down..." animation after 3 seconds
        Handler(Looper.getMainLooper()).postDelayed({
            llShuttingDown.animate().alpha(0f).setDuration(1000).withEndAction {
                llShuttingDown.visibility = View.GONE
            }.start()
        }, 3000)

        // Secret exit mechanism: Tap the black screen 5 times rapidly
        val rootView = findViewById<View>(android.R.id.content)
        rootView.setOnClickListener {
            tapCount++
            resetHandler.removeCallbacks(resetRunnable)
            
            if (tapCount >= 5) {
                // Secret unlocked, exit the fake shutdown
                finish()
            } else {
                // Reset tap count after 1.5 seconds of inactivity
                resetHandler.postDelayed(resetRunnable, 1500)
            }
        }
    }

    // Prevent back button from exiting
    override fun onBackPressed() {
        // Do nothing
    }

    // Prevent finishing when swiped (in some OS versions)
    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_FULLSCREEN
                    or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
        }
    }
}
