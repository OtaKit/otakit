package com.helloworld

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.bridge.JSBundleLoader
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.defaults.DefaultComponentsRegistry
import com.facebook.react.defaults.DefaultReactHostDelegate
import com.facebook.react.defaults.DefaultTurboModuleManagerDelegate
import com.facebook.react.fabric.ComponentFactory
import com.otakit.reactnative.OtaKitRuntime
import java.io.File
import org.json.JSONObject

@OptIn(UnstableReactNativeAPI::class)
class MainApplication : Application(), ReactApplication {
  var testScenario: String? = null
  override val reactHost: ReactHost by lazy {
    val original =
      DefaultReactHostDelegate(
        jsMainModulePath = "index",
        jsBundleLoader =
          JSBundleLoader.createAssetLoader(this, "assets://index.android.bundle", true),
        reactPackages = PackageList(this).packages,
        turboModuleManagerDelegateBuilder = DefaultTurboModuleManagerDelegate.Builder(),
      )
    OtaKitRuntime.createHost(
        this,
        original,
        ComponentFactory().also { DefaultComponentsRegistry.register(it) },
      )
      .also { created ->
        created.addReactInstanceEventListener(
          object : com.facebook.react.ReactInstanceEventListener {
            override fun onReactContextInitialized(
              context: com.facebook.react.bridge.ReactContext
            ) {
              if (testScenario == "headless-guard") {
                com.facebook.react.jstasks.HeadlessJsTaskContext.getInstance(context)
                  .startTask(
                    com.facebook.react.jstasks.HeadlessJsTaskConfig(
                      "OtaKitBackgroundFixture",
                      com.facebook.react.bridge.Arguments.createMap(),
                      0,
                      true,
                    )
                  )
              }
            }
          }
        )
      }
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    OtaKitRuntime.prepare(
      this,
      configuration = {
        assets.open("OtaKitFixture/configuration.json").bufferedReader().use { it.readText() }
      },
      embeddedBundle = {
        val config =
          assets.open("OtaKitFixture/configuration.json").bufferedReader().use {
            JSONObject(it.readText())
          }
        val build = config.getString("nativeBuildId")
        // Fixture-only asset materialization. Production build hooks still need sealed receipts.
        val destination = File(noBackupFilesDir, "embedded/$build")
        fun copyAsset(path: String, output: File) {
          val children = assets.list(path)!!
          if (children.isNotEmpty()) {
            output.mkdirs()
            children.forEach { copyAsset("$path/$it", File(output, it)) }
          } else {
            output.parentFile!!.mkdirs()
            assets.open(path).use { input -> output.outputStream().use { input.copyTo(it) } }
          }
        }
        copyAsset("OtaKitFixture/payload", destination)
        File(destination, "index.bundle")
      },
      caseFolding = { assets.open("OtaKitFixture/case-folding.json").use { it.readBytes() } },
    )
  }
}
