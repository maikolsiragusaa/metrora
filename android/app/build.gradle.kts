import com.android.build.api.dsl.ApplicationExtension
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

val qaSigningEnabled = providers.gradleProperty("metroraQaSigningEnabled")
    .orElse(providers.environmentVariable("METRORA_QA_SIGNING_ENABLED"))
    .map(String::toBoolean)
    .orElse(false)
    .get()

android {
    namespace = "eu.metrora.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "eu.metrora.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0-alpha.1"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    if (qaSigningEnabled) {
        val qaKeystorePath = providers.gradleProperty("metroraQaKeystorePath")
            .orElse(providers.environmentVariable("METRORA_QA_KEYSTORE_PATH"))
            .orNull
            ?: error("QA signing is enabled but METRORA_QA_KEYSTORE_PATH is missing")
        val qaStorePassword = providers.gradleProperty("metroraQaStorePassword")
            .orElse(providers.environmentVariable("METRORA_QA_STORE_PASSWORD"))
            .orNull
            ?: error("QA signing is enabled but METRORA_QA_STORE_PASSWORD is missing")
        val qaKeyPassword = providers.gradleProperty("metroraQaKeyPassword")
            .orElse(providers.environmentVariable("METRORA_QA_KEY_PASSWORD"))
            .orNull
            ?: error("QA signing is enabled but METRORA_QA_KEY_PASSWORD is missing")
        val qaKeyAlias = providers.gradleProperty("metroraQaKeyAlias")
            .orElse(providers.environmentVariable("METRORA_QA_KEY_ALIAS"))
            .orElse("MetroraAndroidPhysicalAcceptanceQA")
            .get()

        signingConfigs {
            create("githubQa") {
                storeFile = file(qaKeystorePath)
                storeType = "JKS"
                storePassword = qaStorePassword
                keyAlias = qaKeyAlias
                keyPassword = qaKeyPassword
            }
        }
    }

    flavorDimensions += "distribution"
    productFlavors {
        create("github") {
            dimension = "distribution"
            buildConfigField("String", "DISTRIBUTION_CHANNEL", "\"github\"")
        }
        create("fdroid") {
            dimension = "distribution"
            buildConfigField("String", "DISTRIBUTION_CHANNEL", "\"fdroid\"")
        }
        create("play") {
            dimension = "distribution"
            buildConfigField("String", "DISTRIBUTION_CHANNEL", "\"play\"")
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
        lintConfig = file("lint.xml")
        warningsAsErrors = true
    }
}

androidComponents {
    onVariants { variant ->
        if (qaSigningEnabled && variant.name == "githubDebug") {
            variant.signingConfig.setConfig(
                extensions.getByType<ApplicationExtension>().signingConfigs.getByName("githubQa"),
            )
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(platform(libs.compose.bom))
    implementation(libs.activity.compose)
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.icons)
    implementation(libs.camera.camera2)
    implementation(libs.camera.lifecycle)
    implementation(libs.camera.view)
    implementation(libs.mlkit.barcode)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.datastore.preferences)
    implementation(libs.coroutines.android)
    debugImplementation(libs.compose.ui.tooling)
    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.org.json)
}
