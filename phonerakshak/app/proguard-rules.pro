# Default settings: minifyEnabled is false in app/build.gradle, so these are
# only active if you turn minification on for release builds.
-dontwarn kotlinx.coroutines.**
-dontwarn okhttp3.**
-keep class okhttp3.** { *; }
-keep class androidx.camera.** { *; }
