// WebView wrapper around the web port (../../web). The web folder and your own ROM dump (../../rom/*.gbc)
// are copied into the APK's assets at build time; neither is committed.
plugins { id("com.android.application") }

val webAssets = layout.buildDirectory.dir("webassets")
val syncWebAssets by tasks.registering(Sync::class) {
    into(webAssets)
    from(rootProject.file("../web")) { into("web") }          // includes web/gen/game.js when tools/recomp.py has been run
    from(rootProject.file("../rom")) { into("rom"); include("*.gbc") }
}

android {
    namespace = "com.example.mariotennis"
    compileSdk = 34
    defaultConfig { applicationId = "com.example.mariotennis"; minSdk = 24; targetSdk = 34; versionCode = 85; versionName = "0.35.31" }
    setProperty("archivesBaseName", "MTenn3D")
    sourceSets["main"].assets.srcDir(webAssets)
    buildTypes { release { isMinifyEnabled = false } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
tasks.named("preBuild") { dependsOn(syncWebAssets) }
dependencies { implementation("androidx.webkit:webkit:1.12.1") }
