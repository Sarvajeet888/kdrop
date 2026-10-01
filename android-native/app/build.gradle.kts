plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "in.kalman.kdrop"
    compileSdk = 35
    defaultConfig {
        applicationId = "in.kalman.kdrop.nativeapp"
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0-preview"
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    // Bouncy Castle modules each include this JVM/OSGi descriptor; Android does not use it.
    packaging { resources.excludes += "META-INF/versions/9/OSGI-INF/MANIFEST.MF" }
}
dependencies {
    implementation("org.bouncycastle:bcpkix-jdk18on:1.78.1")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    implementation("com.google.zxing:core:3.5.3")
}
