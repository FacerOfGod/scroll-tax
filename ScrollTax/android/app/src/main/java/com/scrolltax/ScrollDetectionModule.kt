package com.scrolltax

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.Promise
import com.facebook.react.modules.core.DeviceEventManagerModule
import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.util.Log
import androidx.core.content.ContextCompat

class ScrollDetectionModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    init {
        instance = this
    }

    override fun getName() = "ScrollDetection"

    @ReactMethod
    fun startMonitoring() {
        val intent = Intent(reactApplicationContext, ScrollDetectionService::class.java)
        ContextCompat.startForegroundService(reactApplicationContext, intent)
        Log.d("ScrollDetection", "startMonitoring called")
    }

    @ReactMethod
    fun stopMonitoring() {
        val intent = Intent(reactApplicationContext, ScrollDetectionService::class.java)
        reactApplicationContext.stopService(intent)
        Log.d("ScrollDetection", "stopMonitoring called")
    }

    @ReactMethod
    fun updateSettings(config: ReadableMap) {
        val prefs = reactApplicationContext.getSharedPreferences("ScrollTaxPrefs", Context.MODE_PRIVATE)
        val editor = prefs.edit()
        if (config.hasKey("thresholdSeconds")) {
            editor.putInt("thresholdSeconds", config.getInt("thresholdSeconds"))
        }
        if (config.hasKey("bannedApps")) {
            val appsArray = config.getArray("bannedApps")
            if (appsArray != null) {
                val appSet = mutableSetOf<String>()
                for (i in 0 until appsArray.size()) {
                    appSet.add(appsArray.getString(i) ?: "")
                }
                editor.putStringSet("bannedApps", appSet)
            }
        }
        editor.apply()
        Log.d("ScrollDetection", "Settings updated")
    }

    @ReactMethod
    fun hasUsageAccess(promise: Promise) {
        val appOps = reactApplicationContext.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
        val mode = appOps.checkOpNoThrow(
            AppOpsManager.OPSTR_GET_USAGE_STATS,
            android.os.Process.myUid(),
            reactApplicationContext.packageName
        )
        promise.resolve(mode == AppOpsManager.MODE_ALLOWED)
    }

    @ReactMethod
    fun openUsageAccessSettings() {
        val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        reactApplicationContext.startActivity(intent)
    }

    @ReactMethod
    fun showNotification(title: String, body: String) {
        val channelId = "scrolltax_warnings"
        val notification = androidx.core.app.NotificationCompat.Builder(reactApplicationContext, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setPriority(androidx.core.app.NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build()
        try {
            androidx.core.app.NotificationManagerCompat.from(reactApplicationContext)
                .notify(System.currentTimeMillis().toInt(), notification)
        } catch (e: SecurityException) {
            Log.w("ScrollDetection", "Notification permission denied")
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    @ReactMethod
    fun setTelegramContext(
        supabaseUrl: String,
        supabaseKey: String,
        accessToken: String,
        telegramId: String,
        sessionId: String,
        amount: Float,
    ) {
        val prefs = reactApplicationContext.getSharedPreferences("ScrollTaxPrefs", Context.MODE_PRIVATE)
        prefs.edit()
            .putString("tg_url", supabaseUrl)
            .putString("tg_key", supabaseKey)
            .putString("tg_token", accessToken)
            .putString("tg_tid", telegramId)
            .putString("tg_sid", sessionId)
            .putFloat("tg_amount", amount)
            .apply()
        Log.d("ScrollDetection", "Telegram context updated: session=$sessionId tid=$telegramId")
    }

    @ReactMethod
    fun getPendingPenalties(promise: Promise) {
        val prefs = reactApplicationContext.getSharedPreferences("ScrollTaxPrefs", Context.MODE_PRIVATE)
        val pending = prefs.getString("pendingPenalties", "") ?: ""
        prefs.edit().remove("pendingPenalties").apply()
        promise.resolve(pending)
    }

    companion object {
        private var instance: ScrollDetectionModule? = null

        fun emitScrollEvent(pkg: String) = emit("onScrollEvent", pkg)

        fun emitPenaltyEvent(pkg: String, minutes: Int) = emit("onPenaltyEvent", "$pkg|$minutes")

        fun emitBannedAppEnteredEvent(pkg: String) = emit("onBannedAppEntered", pkg)

        private fun emit(event: String, payload: String) {
            instance?.let { module ->
                if (module.reactApplicationContext.hasActiveCatalystInstance()) {
                    module.reactApplicationContext
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        .emit(event, payload)
                    Log.d("ScrollDetection", "Emitted $event: $payload")
                } else if (event == "onPenaltyEvent") {
                    // JS bridge is inactive (app backgrounded) — queue for flush on resume
                    val prefs = module.reactApplicationContext.getSharedPreferences("ScrollTaxPrefs", Context.MODE_PRIVATE)
                    val existing = prefs.getString("pendingPenalties", "") ?: ""
                    val updated = if (existing.isEmpty()) payload else "$existing;$payload"
                    prefs.edit().putString("pendingPenalties", updated).apply()
                    Log.d("ScrollDetection", "Queued penalty (JS inactive): $payload")
                }
            }
        }
    }
}
