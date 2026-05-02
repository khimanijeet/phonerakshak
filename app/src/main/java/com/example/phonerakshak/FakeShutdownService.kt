package com.example.phonerakshak

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.view.accessibility.AccessibilityEvent
import android.util.Log

class FakeShutdownService : AccessibilityService() {

    override fun onAccessibilityEvent(event: AccessibilityEvent) {
        if (event.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            val packageName = event.packageName?.toString() ?: ""
            
            // The power menu is usually shown by the system UI
            if (packageName.contains("android") || packageName.contains("systemui")) {
                val text = event.text.joinToString(" ").lowercase()
                
                // Detect common power menu keywords
                if (text.contains("power off") || text.contains("shut down") || text.contains("restart") || text.contains("reboot")) {
                    Log.d("FakeShutdown", "Power menu detected! Intercepting...")
                    
                    // Dismiss the system power menu
                    performGlobalAction(GLOBAL_ACTION_BACK)
                    
                    // Launch our fake shutdown screen
                    val intent = Intent(this, FakeShutdownActivity::class.java).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS)
                    }
                    startActivity(intent)
                }
            }
        }
    }

    override fun onInterrupt() {
        // Required method, nothing to do here
    }
}
