# Add project specific ProGuard rules here.
# These are appended to the default Android rules referenced from build.gradle.
# https://developer.android.com/build/shrink-code

# React Native ships consumer ProGuard rules with its AAR for the core framework
# (com.facebook.react / hermes / soloader), so those are covered automatically.
# The rules below cover this app's own code and reflection-heavy integrations that
# R8 cannot see are used.

# ── This app's native bridge ────────────────────────────────────────────────
# ScrollDetectionModule/Package/Service are referenced reflectively by RN's
# module registry and the OS (foreground service / receivers in the manifest).
-keep class com.scrolltax.** { *; }

# ── React Native annotation-based members (defensive) ───────────────────────
# Members tagged with these annotations are invoked reflectively across the JS
# bridge; the codegen/registry must be able to find them by name.
-keepclassmembers class * {
    @com.facebook.react.bridge.ReactMethod <methods>;
    @com.facebook.react.uimanager.annotations.ReactProp <methods>;
    @com.facebook.react.uimanager.annotations.ReactPropGroup <methods>;
}
-keep,allowobfuscation @interface com.facebook.proguard.annotations.DoNotStrip
-keep,allowobfuscation @interface com.facebook.proguard.annotations.KeepGettersAndSetters
-keep @com.facebook.proguard.annotations.DoNotStrip class *
-keepclassmembers class * {
    @com.facebook.proguard.annotations.DoNotStrip *;
}

# ── Hermes / JNI ────────────────────────────────────────────────────────────
-keep class com.facebook.hermes.unicode.** { *; }
-keep class com.facebook.jni.** { *; }

# ── OkHttp / Okio (RN networking; xrpl + Supabase HTTP) ─────────────────────
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn org.conscrypt.**
-keepnames class okhttp3.internal.publicsuffix.PublicSuffixDatabase

# ── Ledger Nano BLE (react-native-ble-plx / @ledgerhq transport) ────────────
# BLE transport uses reflection over GATT callbacks; keep its classes intact.
-keep class com.bleplx.** { *; }
-keep class com.polidea.rxandroidble2.** { *; }
-dontwarn com.polidea.rxandroidble2.**

# ── Keychain (wallet seed storage) ──────────────────────────────────────────
-keep class com.oblador.keychain.** { *; }

# ── Kotlin metadata / coroutines (used by the native service) ───────────────
-keep class kotlin.Metadata { *; }
-dontwarn kotlinx.**

# Keep generic signatures + annotations so reflection-based (de)serialization and
# the RN bridge keep working after shrinking.
-keepattributes Signature,*Annotation*,InnerClasses,EnclosingMethod,SourceFile,LineNumberTable
