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
    defaultConfig { applicationId = "com.example.mariotennis"; minSdk = 24; targetSdk = 34; versionCode = 128; versionName = "0.35.74" }
    setProperty("archivesBaseName", "MTenn3D")
    // -Pedition=port: "MTenn3D Port", a separate app beside MTenn3D (its own saves and settings) that always starts
    // the game on the JS port (CODE: PORT); the CODE button still switches for that run
    val portEdition = findProperty("edition") == "port"
    defaultConfig.manifestPlaceholders["appLabel"] = if (portEdition) "MTenn3D Port" else "MTenn3D"
    defaultConfig.resValue("string", "start_page", if (portEdition) "full.html#port" else "full.html")
    if (portEdition) { defaultConfig.applicationId = "com.example.mariotennis.port"; setProperty("archivesBaseName", "MTenn3D-Port") }
    sourceSets["main"].assets.srcDir(webAssets)
    buildTypes { release { isMinifyEnabled = false } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
tasks.named("preBuild") { dependsOn(syncWebAssets) }
dependencies { implementation("androidx.webkit:webkit:1.12.1") }
