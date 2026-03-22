package com.scrolltax

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

class ScrollDetectionService : Service() {

    private val handler = Handler(Looper.getMainLooper())
    private var currentBannedApp: String? = null
    private var penaltyStartTime: Long = 0
    private var serviceStartTime: Long = 0
    private var lastWarningTimeMs: Long = 0
    private val WARNING_COOLDOWN_MS = 120_000L

    private val CHANNEL_MONITOR = "scrolltax_monitor"
    private val CHANNEL_WARN    = "scrolltax_warnings"
    private val NOTIF_FOREGROUND = 1001

    private val pollRunnable = object : Runnable {
        override fun run() {
            checkForegroundApp()
            handler.postDelayed(this, 1000L)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        createChannels()
        startForeground(NOTIF_FOREGROUND, buildMonitorNotification())
        serviceStartTime = System.currentTimeMillis()
        handler.post(pollRunnable)
        Log.d("ScrollDetection", "Monitoring service started")
        return START_STICKY
    }

    override fun onDestroy() {
        handler.removeCallbacks(pollRunnable)
        Log.d("ScrollDetection", "Monitoring service stopped")
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ── Core polling ─────────────────────────────────────────────────────────

    private fun checkForegroundApp() {
        val foreground = getForegroundApp()
        val now = System.currentTimeMillis()

        if (foreground != null && isDistractionApp(foreground)) {
            if (foreground != currentBannedApp) {
                // Newly entered a banned app
                currentBannedApp = foreground
                penaltyStartTime = now
                showWarningNotification(foreground)
                ScrollDetectionModule.emitBannedAppEnteredEvent(foreground)
                Log.d("ScrollDetection", "Entered banned app: $foreground")
            } else {
                // Still inside — accumulate and fire if threshold reached
                val elapsedSeconds = (now - penaltyStartTime) / 1000
                ScrollDetectionModule.emitScrollEvent(foreground)
                if (elapsedSeconds >= getThresholdSeconds()) {
                    val mins = (elapsedSeconds / 60).toInt().coerceAtLeast(1)
                    insertTelegramDeduction(foreground)
                    ScrollDetectionModule.emitPenaltyEvent(foreground, mins)
                    penaltyStartTime = now
                    Log.d("ScrollDetection", "Penalty fired for $foreground (${elapsedSeconds}s)")
                }
            }
        } else {
            if (currentBannedApp != null) {
                Log.d("ScrollDetection", "Left banned app: $currentBannedApp")
                currentBannedApp = null
                penaltyStartTime = 0
            }
        }
    }

    /**
     * Scans ALL UsageEvents from service start to now and replays foreground/background
     * transitions to determine the current foreground app accurately.
     * No fixed window = no staleness from queryUsageStats, no missed events from short windows.
     */
    private fun getForegroundApp(): String? {
        return try {
            val usm = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val now = System.currentTimeMillis()
            val events = usm.queryEvents(serviceStartTime, now)
            val event = UsageEvents.Event()
            var current: String? = null
            while (events.hasNextEvent()) {
                events.getNextEvent(event)
                when (event.eventType) {
                    UsageEvents.Event.MOVE_TO_FOREGROUND -> current = event.packageName
                    UsageEvents.Event.MOVE_TO_BACKGROUND -> {
                        if (current == event.packageName) current = null
                    }
                }
            }
            Log.d("ScrollDetection", "Current foreground: $current")
            current
        } catch (e: Exception) {
            Log.w("ScrollDetection", "getForegroundApp error: ${e.message}")
            null
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun insertTelegramDeduction(pkg: String) {
        val prefs   = getSharedPreferences("ScrollTaxPrefs", Context.MODE_PRIVATE)
        val url     = prefs.getString("tg_url", null)   ?: return
        val key     = prefs.getString("tg_key", null)   ?: return
        val token   = prefs.getString("tg_token", null) ?: return
        val tid     = prefs.getString("tg_tid", null)   ?: return
        val sid     = prefs.getString("tg_sid", null)   ?: return
        val amount  = prefs.getFloat("tg_amount", 0.5f)
        val appName = friendlyName(pkg)
        Thread {
            try {
                val conn = java.net.URL("$url/rest/v1/deductions")
                    .openConnection() as java.net.HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("apikey", key)
                conn.setRequestProperty("Authorization", "Bearer $token")
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("Prefer", "return=minimal")
                conn.connectTimeout = 10_000
                conn.readTimeout    = 10_000
                conn.doOutput       = true
                val body = """{"session_id":"$sid","telegram_id":"$tid","amount":$amount,"app_name":"$appName"}"""
                conn.outputStream.use { it.write(body.toByteArray()) }
                Log.d("ScrollDetection", "Telegram deduction HTTP ${conn.responseCode} for $pkg")
                conn.disconnect()
            } catch (e: Exception) {
                Log.e("ScrollDetection", "Telegram deduction failed: ${e.message}")
            }
        }.start()
    }

    private fun isDistractionApp(pkg: String): Boolean {
        val prefs = getSharedPreferences("ScrollTaxPrefs", Context.MODE_PRIVATE)
        val banned = prefs.getStringSet("bannedApps", setOf(
            "com.zhiliaoapp.musically",
            "com.instagram.android",
            "com.google.android.youtube",
            "com.whatsapp"
        ))
        return banned?.contains(pkg) ?: false
    }

    private fun getThresholdSeconds(): Long {
        val prefs = getSharedPreferences("ScrollTaxPrefs", Context.MODE_PRIVATE)
        return prefs.getInt("thresholdSeconds", 5).toLong()
    }

    private fun friendlyName(pkg: String) = when (pkg) {
        "com.zhiliaoapp.musically"   -> "TikTok"
        "com.instagram.android"      -> "Instagram"
        "com.google.android.youtube" -> "YouTube"
        "com.whatsapp"               -> "WhatsApp"
        else -> pkg.split(".").last().replaceFirstChar { it.uppercase() }
    }

    // ── Notifications ─────────────────────────────────────────────────────────

    private fun showWarningNotification(pkg: String) {
        val now = System.currentTimeMillis()
        if (now - lastWarningTimeMs < WARNING_COOLDOWN_MS) return
        lastWarningTimeMs = now

        val notification = NotificationCompat.Builder(this, CHANNEL_WARN)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle("⚠️ ${friendlyName(pkg)} detected")
            .setContentText("Stay too long and you'll be penalized.")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(this).notify(pkg.hashCode(), notification)
        } catch (e: SecurityException) {
            Log.w("ScrollDetection", "Notification permission denied")
        }
    }

    private fun buildMonitorNotification() =
        NotificationCompat.Builder(this, CHANNEL_MONITOR)
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setContentTitle("ScrollTax is active")
            .setContentText("Monitoring for banned apps…")
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setSilent(true)
            .setOngoing(true)
            .build()

    private fun createChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_MONITOR, "ScrollTax Monitor", NotificationManager.IMPORTANCE_MIN)
                    .apply { description = "Persistent monitoring indicator" }
            )
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_WARN, "ScrollTax Warnings", NotificationManager.IMPORTANCE_HIGH)
                    .apply { description = "Alerts when you open a banned app" }
            )
        }
    }
}
