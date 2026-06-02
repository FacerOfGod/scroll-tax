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
import java.security.MessageDigest
import java.util.concurrent.atomic.AtomicInteger
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class ScrollDetectionModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    // In-memory seed for HMAC signing of the pending-penalty queue.
    // Set by JS via setXrplSeed() on app mount; never persisted to disk.
    private var xrplSeedRef: String? = null

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
            if (appsArray != null && appsArray.size() > 0) {
                val appSet = mutableSetOf<String>()
                for (i in 0 until appsArray.size()) {
                    appSet.add(appsArray.getString(i) ?: "")
                }
                editor.putStringSet("bannedApps", appSet)
                Log.d("ScrollDetection", "bannedApps updated: $appSet")
            }
            // Empty array → skip write so the stored list (or built-in defaults) is preserved
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
            // Monotonic id avoids the collisions that System.currentTimeMillis().toInt()
            // produced when two notifications fired within the same millisecond.
            androidx.core.app.NotificationManagerCompat.from(reactApplicationContext)
                .notify(notificationIdSeq.getAndIncrement(), notification)
        } catch (e: SecurityException) {
            Log.w("ScrollDetection", "Notification permission denied")
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    /**
     * Registers the XRPL wallet seed for HMAC-signing the pending-penalty queue.
     * Called from JS on app mount. The seed is held in memory only — never written
     * to SharedPreferences.
     */
    @ReactMethod
    fun setXrplSeed(seed: String) {
        xrplSeedRef = seed
        instance?.xrplSeedRef = seed
        Log.d("ScrollDetection", "XRPL seed registered for HMAC signing")
    }

    /**
     * Returns pending penalties that fired while JS was inactive, then clears the queue.
     * Each entry is HMAC-verified before returning; tampered or unsigned entries are
     * silently dropped.
     */
    @ReactMethod
    fun getPendingPenalties(promise: Promise) {
        val prefs   = reactApplicationContext.getSharedPreferences("ScrollTaxPrefs", Context.MODE_PRIVATE)
        val raw     = prefs.getString("pendingPenalties", "") ?: ""
        prefs.edit().remove("pendingPenalties").apply()

        val seed = xrplSeedRef
        if (seed == null) {
            // Seed not registered yet — drop all entries to prevent replaying unsigned queue
            if (raw.isNotEmpty()) {
                Log.w("ScrollDetection", "getPendingPenalties: seed not set, dropping ${raw.split(";").size} entry/entries")
            }
            promise.resolve("")
            return
        }

        val verified = raw.split(";")
            .filter { it.isNotEmpty() }
            .mapNotNull { verifyEntry(seed, it) }
            .joinToString(";")

        promise.resolve(verified)
    }

    companion object {
        private var instance: ScrollDetectionModule? = null
        private val notificationIdSeq = AtomicInteger(2000)

        fun emitScrollEvent(pkg: String) = emit("onScrollEvent", pkg)

        fun emitPenaltyEvent(pkg: String, minutes: Int) = emit("onPenaltyEvent", "$pkg|$minutes")

        fun emitBannedAppEnteredEvent(pkg: String) = emit("onBannedAppEntered", pkg)

        private fun emit(event: String, payload: String) {
            instance?.let { module ->
                // In bridgeless/new-arch mode, getJSModule throws UnsupportedOperationException.
                // We try the old bridge path first; on any failure we fall through to queuing
                // for penalty events so they are never silently lost.
                var emitted = false
                try {
                    module.reactApplicationContext
                        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                        .emit(event, payload)
                    emitted = true
                    Log.d("ScrollDetection", "Emitted $event: $payload")
                } catch (e: Exception) {
                    Log.w("ScrollDetection", "Direct emit failed ($event): ${e.message}")
                }

                if (!emitted && event == "onPenaltyEvent") {
                    // Queue with HMAC signature for flush on next app-foreground
                    val seed = module.xrplSeedRef
                    val entry = if (seed != null) signEntry(seed, payload) else payload
                    val prefs = module.reactApplicationContext.getSharedPreferences("ScrollTaxPrefs", Context.MODE_PRIVATE)
                    val existing = prefs.getString("pendingPenalties", "") ?: ""
                    val updated = if (existing.isEmpty()) entry else "$existing;$entry"
                    prefs.edit().putString("pendingPenalties", updated).apply()
                    Log.d("ScrollDetection", "Queued penalty: $payload signed=${seed != null}")
                }
            }
        }

        // ── HMAC helpers ──────────────────────────────────────────────────────

        /** Derives a 32-byte HMAC key from the XRPL seed via SHA-256. */
        private fun deriveHmacKey(seed: String): ByteArray =
            MessageDigest.getInstance("SHA-256").digest(seed.toByteArray(Charsets.UTF_8))

        /** Returns the HMAC-SHA256 of [data] as a lowercase hex string. */
        private fun hmacSha256(key: ByteArray, data: String): String {
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(key, "HmacSHA256"))
            return mac.doFinal(data.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
        }

        /** Returns "payload:hmachex" — the signed queue entry. */
        private fun signEntry(seed: String, payload: String): String {
            val sig = hmacSha256(deriveHmacKey(seed), payload)
            return "$payload:$sig"
        }

        /**
         * Verifies the HMAC on a signed entry and returns the raw payload if valid,
         * or null if the signature is missing or incorrect.
         */
        private fun verifyEntry(seed: String, signedEntry: String): String? {
            val lastColon = signedEntry.lastIndexOf(':')
            if (lastColon < 0) {
                Log.w("ScrollDetection", "Dropping unsigned pending penalty: $signedEntry")
                return null
            }
            val payload  = signedEntry.substring(0, lastColon)
            val sig      = signedEntry.substring(lastColon + 1)
            val expected = hmacSha256(deriveHmacKey(seed), payload)
            return if (sig == expected) payload else {
                Log.w("ScrollDetection", "Dropping tampered pending penalty: $signedEntry")
                null
            }
        }
    }
}
