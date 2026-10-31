// WebView app around the web build (../../web). The page is copied into the APK's assets at build time. Your ROM
// dump is NOT included unless you build with -PbundleRom (then ../../rom/*.gbc goes in too); otherwise the app asks
// for the .gbc file on first launch and keeps a private copy. Nothing from the game is committed.
plugins { id("com.android.application") }

val webAssets = layout.buildDirectory.dir("webassets")
val syncWebAssets by tasks.registering(Sync::class) {
    into(webAssets)
    from(rootProject.file("../web")) { into("web"); exclude("tests/**") }
    if (project.hasProperty("bundleRom")) from(rootProject.file("../rom")) { into("rom"); include("*.gbc") }
}

android {
    namespace = "com.example.mariogolf"
    compileSdk = 34
    defaultConfig { applicationId = "com.example.mariogolf"; minSdk = 24; targetSdk = 34; versionCode = 1; versionName = "0.1.0" }
    setProperty("archivesBaseName", "MarioGolfGBC")
    sourceSets["main"].assets.srcDir(webAssets)
    buildTypes { release { isMinifyEnabled = false } }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
tasks.named("preBuild") { dependsOn(syncWebAssets) }
dependencies { implementation("androidx.webkit:webkit:1.12.1") }
