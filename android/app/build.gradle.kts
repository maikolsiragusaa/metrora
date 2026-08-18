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

val productionReleaseEnabled = providers.gradleProperty("metroraProductionRelease")
    .orElse(providers.environmentVariable("METRORA_PRODUCTION_RELEASE"))
    .map(String::toBoolean)
    .orElse(false)
    .get()

if (qaSigningEnabled && productionReleaseEnabled) {
    error("QA and production Android signing cannot be enabled together")
}

fun requiredProductionSigningValue(environmentName: String, propertyName: String): String =
    providers.gradleProperty(propertyName)
        .orElse(providers.environmentVariable(environmentName))
        .orNull
        ?.takeIf(String::isNotBlank)
        ?: error("Production signing is enabled but $environmentName/$propertyName is missing")

val androidApplicationId = "eu.metrora.app"
val androidVersionCode = 2
val androidVersionName = "0.1.0-alpha.2"

val productionKeystorePath = if (productionReleaseEnabled) {
    requiredProductionSigningValue(
        environmentName = "METRORA_ANDROID_PRODUCTION_KEYSTORE_PATH",
        propertyName = "metroraProductionKeystorePath",
    )
} else {
    null
}
val productionStorePassword = if (productionReleaseEnabled) {
    requiredProductionSigningValue(
        environmentName = "METRORA_ANDROID_PRODUCTION_STORE_PASSWORD",
        propertyName = "metroraProductionStorePassword",
    )
} else {
    null
}
val productionKeyPassword = if (productionReleaseEnabled) {
    requiredProductionSigningValue(
        environmentName = "METRORA_ANDROID_PRODUCTION_KEY_PASSWORD",
        propertyName = "metroraProductionKeyPassword",
    )
} else {
    null
}
val productionKeyAlias = if (productionReleaseEnabled) {
    requiredProductionSigningValue(
        environmentName = "METRORA_ANDROID_PRODUCTION_KEY_ALIAS",
        propertyName = "metroraProductionKeyAlias",
    )
} else {
    null
}

android {
    namespace = "eu.metrora.app"
    compileSdk = 36

    defaultConfig {
        applicationId = androidApplicationId
        minSdk = 26
        targetSdk = 36
        versionCode = androidVersionCode
        versionName = androidVersionName
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

    if (productionReleaseEnabled) {
        val keystorePath = requireNotNull(productionKeystorePath)
        require(file(keystorePath).isFile) {
            "Production signing is enabled but METRORA_ANDROID_PRODUCTION_KEYSTORE_PATH is not a file"
        }
        signingConfigs {
            create("githubProduction") {
                storeFile = file(keystorePath)
                storeType = "JKS"
                storePassword = requireNotNull(productionStorePassword)
                keyAlias = requireNotNull(productionKeyAlias)
                keyPassword = requireNotNull(productionKeyPassword)
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
        if (productionReleaseEnabled && variant.name == "githubRelease") {
            variant.signingConfig.setConfig(
                extensions.getByType<ApplicationExtension>().signingConfigs.getByName("githubProduction"),
            )
        }
    }
}

tasks.register("printGithubReleaseMetadata") {
    group = "help"
    description = "Print the canonical Android GitHub release metadata."
    doLast {
        println("applicationId=$androidApplicationId")
        println("versionName=$androidVersionName")
        println("versionCode=$androidVersionCode")
    }
}

tasks.register("verifyGithubPublicRelease") {
    group = "verification"
    description = "Fail closed unless the GitHub public release is configured for production signing."
    doLast {
        check(productionReleaseEnabled) {
            "GitHub public release requires METRORA_PRODUCTION_RELEASE=true"
        }
        check(!qaSigningEnabled) {
            "GitHub public release cannot use the QA signing configuration"
        }
        check(productionKeystorePath != null && file(productionKeystorePath).isFile) {
            "GitHub public release requires a production keystore file"
        }
        check(productionStorePassword != null && productionKeyPassword != null && productionKeyAlias != null) {
            "GitHub public release requires production signing credentials"
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
    implementation(libs.exifinterface)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.datastore.preferences)
    implementation(libs.coroutines.android)
    debugImplementation(libs.compose.ui.tooling)
    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
    testImplementation(libs.org.json)
}
