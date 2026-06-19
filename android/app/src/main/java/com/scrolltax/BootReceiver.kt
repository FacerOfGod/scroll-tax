package com.scrolltax

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.content.ContextCompat

/**
 * Restarts the scroll-monitoring foreground service after a device reboot or an
 * app update, but only if the user had monitoring active (the `monitoringActive`
 * flag set by ScrollDetectionService). Without this, a reboot would silently leave
 * the user unmonitored until they next open the app — a correctness hole for an
 * accountability product.
 *
 * NOTE: starting a foreground service from BOOT_COMPLETED is an allowed background
 * exemption, but OS rules vary by FGS type/version — the start is wrapped so a
 * platform refusal is logged rather than crashing the boot broadcast.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != "android.intent.action.QUICKBOOT_POWERON" &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) return

        val prefs = context.getSharedPreferences("ScrollTaxPrefs", Context.MODE_PRIVATE)
        if (!prefs.getBoolean("monitoringActive", false)) {
            Log.d("ScrollDetection", "Boot: monitoring not active — not restarting")
            return
        }

        try {
            ContextCompat.startForegroundService(
                context, Intent(context, ScrollDetectionService::class.java)
            )
            Log.d("ScrollDetection", "Boot: restarted monitoring service")
        } catch (e: Exception) {
            Log.w("ScrollDetection", "Boot: failed to restart service: ${e.message}")
        }
    }
}
