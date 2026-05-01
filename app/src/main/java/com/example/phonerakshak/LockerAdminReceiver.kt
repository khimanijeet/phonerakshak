package com.example.phonerakshak

import android.app.admin.DeviceAdminReceiver
import android.content.ComponentName
import android.content.Context

/** DeviceAdmin receiver — required so DevicePolicyManager.lockNow() works. */
class LockerAdminReceiver : DeviceAdminReceiver() {
    companion object {
        fun componentName(context: Context): ComponentName =
            ComponentName(context, LockerAdminReceiver::class.java)
    }
}
