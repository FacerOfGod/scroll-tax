package com.scrolltax

import android.animation.ValueAnimator
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.util.TypedValue
import android.view.View
import android.view.WindowManager
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

    // Red-border overlay state (alternative to the warning notification)
    private var windowManager: WindowManager? = null
    private var overlayView: View? = null
    private var borderAnimator: ValueAnimator? = null

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
        // Mark monitoring as the user's intended state so BootReceiver knows to
        // restart it after a reboot. Cleared only on an explicit stopMonitoring().
        getSharedPreferences("ScrollTaxPrefs", Context.MODE_PRIVATE)
            .edit().putBoolean("monitoringActive", true).apply()
        handler.removeCallbacks(pollRunnable)  // guard against double-post on restart
        handler.post(pollRunnable)
        Log.d("ScrollDetection", "Monitoring service started")
        // START_STICKY: the OS recreates the service (with a null intent) after it
        // is killed for memory pressure, so monitoring is self-healing. There is no
        // intent payload to redeliver, so STICKY (not REDELIVER_INTENT) is correct.
        return START_STICKY
    }

    /**
     * Called when the user swipes the app off the recents list. A foreground
     * service usually survives this, but some OEMs kill it — so if monitoring is
     * the intended state, schedule a near-immediate restart.
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        val active = getSharedPreferences("ScrollTaxPrefs", Context.MODE_PRIVATE)
            .getBoolean("monitoringActive", false)
        if (active) {
            val restart = Intent(applicationContext, ScrollDetectionService::class.java)
            val flags = PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE
            val pi = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                PendingIntent.getForegroundService(this, 1, restart, flags)
            else
                PendingIntent.getService(this, 1, restart, flags)
            val am = getSystemService(Context.ALARM_SERVICE) as AlarmManager
            am.set(AlarmManager.RTC, System.currentTimeMillis() + 1000L, pi)
            Log.d("ScrollDetection", "Task removed — scheduled service restart")
        }
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        handler.removeCallbacks(pollRunnable)
        hideBorderOverlay()
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
                // Border mode replaces the warning notification with an ambient
                // red border that intensifies over the threshold window.
                if (borderModeEnabled()) {
                    showBorderOverlay(getThresholdSeconds())
                } else {
                    showWarningNotification(foreground)
                }
                ScrollDetectionModule.emitBannedAppEnteredEvent(foreground)
                Log.d("ScrollDetection", "Entered banned app: $foreground")
            } else {
                // Still inside — accumulate and fire if threshold reached
                val elapsedSeconds = (now - penaltyStartTime) / 1000
                ScrollDetectionModule.emitScrollEvent(foreground)
                if (elapsedSeconds >= getThresholdSeconds()) {
                    val mins = (elapsedSeconds / 60).toInt().coerceAtLeast(1)
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
                hideBorderOverlay()
            }
        }
    }

    /**
     * Returns the current foreground app by replaying UsageEvents over the last 60 seconds.
     * Tracks the most recent event per package; the foreground app is the one whose last
     * event is MOVE_TO_FOREGROUND with no subsequent MOVE_TO_BACKGROUND.
     * This is more accurate than queryUsageStats whose lastTimeUsed lags several seconds
     * after the user leaves an app.
     */
    private fun getForegroundApp(): String? {
        return try {
            val usm = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val now = System.currentTimeMillis()
            val events = usm.queryEvents(now - 60_000, now)
            val event = UsageEvents.Event()
            // For each package, keep only the most recent event (type + timestamp)
            val lastEvent = mutableMapOf<String, Pair<Int, Long>>()
            while (events.hasNextEvent()) {
                events.getNextEvent(event)
                val prev = lastEvent[event.packageName]
                if (prev == null || event.timeStamp > prev.second) {
                    lastEvent[event.packageName] = Pair(event.eventType, event.timeStamp)
                }
            }
            // The foreground app is the one whose most-recent event is MOVE_TO_FOREGROUND
            val foreground = lastEvent
                .filter { (pkg, pair) ->
                    pkg != packageName && pair.first == UsageEvents.Event.MOVE_TO_FOREGROUND
                }
                .maxByOrNull { (_, pair) -> pair.second }
                ?.key
            Log.d("ScrollDetection", "Current foreground: $foreground")
            foreground
        } catch (e: Exception) {
            Log.w("ScrollDetection", "getForegroundApp error: ${e.message}")
            null
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun isDistractionApp(pkg: String): Boolean {
        val prefs = getSharedPreferences("ScrollTaxPrefs", Context.MODE_PRIVATE)
        // Use null as default to distinguish "key never set" from "key set to empty set".
        // If the key was written as {} by old buggy JS code, stored is non-null but empty,
        // and we fall back to the built-in defaults so detection is never silently disabled.
        val stored = prefs.getStringSet("bannedApps", null)
        val banned = if (stored.isNullOrEmpty()) {
            setOf(
                "com.zhiliaoapp.musically",
                "com.instagram.android",
                "com.google.android.youtube",
                "com.whatsapp"
            )
        } else {
            stored
        }
        Log.d("ScrollDetection", "isDistractionApp($pkg) banned=$banned → ${banned.contains(pkg)}")
        return banned.contains(pkg)
    }

    private fun getThresholdSeconds(): Long {
        val prefs = getSharedPreferences("ScrollTaxPrefs", Context.MODE_PRIVATE)
        return prefs.getInt("thresholdSeconds", 30).toLong()
    }

    private fun borderModeEnabled(): Boolean {
        val prefs = getSharedPreferences("ScrollTaxPrefs", Context.MODE_PRIVATE)
        return prefs.getBoolean("borderModeEnabled", false)
    }

    // ── Red-border overlay ──────────────────────────────────────────────────────

    private fun dp(value: Int): Int = TypedValue.applyDimension(
        TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics
    ).toInt()

    /**
     * Draws a full-screen red border on top of the current (banned) app and fades
     * it in from transparent to fully opaque over [thresholdSeconds] — so it grows
     * more alarming the longer the user stays. Non-touchable, so it never blocks
     * interaction. No-ops if the overlay permission isn't granted or it's already up.
     */
    private fun showBorderOverlay(thresholdSeconds: Long) {
        if (overlayView != null) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this)) {
            Log.w("ScrollDetection", "Overlay permission not granted — skipping border")
            return
        }

        val wm = windowManager
            ?: (getSystemService(Context.WINDOW_SERVICE) as WindowManager).also { windowManager = it }

        val border = GradientDrawable().apply {
            setColor(Color.TRANSPARENT)
            setStroke(dp(36), Color.parseColor("#FF1B1B"))
        }
        val view = View(this).apply {
            background = border
            alpha = 0f
        }

        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        )

        try {
            wm.addView(view, params)
            overlayView = view
        } catch (e: Exception) {
            Log.w("ScrollDetection", "Failed to add border overlay: ${e.message}")
            return
        }

        borderAnimator = ValueAnimator.ofFloat(0f, 1f).apply {
            duration = (thresholdSeconds * 1000L).coerceAtLeast(1000L)
            addUpdateListener { a -> overlayView?.alpha = a.animatedValue as Float }
            start()
        }
    }

    private fun hideBorderOverlay() {
        borderAnimator?.cancel()
        borderAnimator = null
        val view = overlayView ?: return
        try {
            windowManager?.removeView(view)
        } catch (e: Exception) {
            Log.w("ScrollDetection", "Failed to remove border overlay: ${e.message}")
        }
        overlayView = null
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
            .setSmallIcon(R.drawable.ic_notification)
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
            .setSmallIcon(R.drawable.ic_notification)
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
