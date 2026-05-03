package com.example.phonerakshak

import android.app.admin.DeviceAdminReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent

/** DeviceAdmin receiver — required so DevicePolicyManager.lockNow() works. */
class LockerAdminReceiver : DeviceAdminReceiver() {
    companion object {
        fun componentName(context: Context): ComponentName =
            ComponentName(context, LockerAdminReceiver::class.java)
    }

    override fun onPasswordFailed(context: Context, intent: Intent) {
        super.onPasswordFailed(context, intent)
        // Launch transparent activity over lock screen to capture selfie
        val captureIntent = Intent(context, InvisibleCaptureActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        }
        context.startActivity(captureIntent)
    }
}
