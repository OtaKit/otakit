package com.otakit.expofixture.host

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactHost
import com.otakit.core.ArtifactInstaller
import com.otakit.reactnative.OtaKitRuntime
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityHandler
import expo.modules.core.interfaces.ReactNativeHostHandler
import java.io.File
import org.json.JSONObject

/** Local native acceptance fixture. Production installation will be owned by the config plugin. */
class OtaKitExpoHostPackage : Package {
  private fun enabled(context: Context) =
    context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE == 0

  override fun createApplicationLifecycleListeners(
    context: Context
  ): List<ApplicationLifecycleListener> =
    if (!enabled(context)) emptyList()
    else
      listOf(
        object : ApplicationLifecycleListener {
          override fun onCreate(application: Application) {
            val assets = application.assets
            fun configuration() =
              assets.open("OtaKitFixture/configuration.json").bufferedReader().use {
                it.readText()
              }
            fun caseFolding() =
              assets.open("OtaKitFixture/case-folding.json").use { it.readBytes() }
            OtaKitRuntime.prepare(
              application,
              configuration = ::configuration,
              caseFolding = ::caseFolding,
              embeddedBundle = {
                val config = JSONObject(configuration())
                val receipt = config.getJSONObject("embeddedReceipt")
                // Rebuild this fixture-owned tree from APK assets on every process
                // start, then verify
                // its complete inventory and Hermes descriptor before allowing RN
                // to open the bundle.
                val root = File(application.noBackupFilesDir, "OtaKitExpoEmbedded")
                check(!root.exists() || root.deleteRecursively())
                fun copy(path: String, output: File) {
                  val children = checkNotNull(assets.list(path))
                  if (children.isNotEmpty()) {
                    check(output.mkdirs())
                    children.forEach { copy("$path/$it", File(output, it)) }
                  } else {
                    assets.open(path).use { input ->
                      output.outputStream().use { input.copyTo(it) }
                    }
                  }
                }
                copy("OtaKitFixture/payload", root)
                val manifest =
                  JSONObject()
                    .put("strategy", "zip")
                    .put("platform", "android")
                    .put("version", receipt.getString("version"))
                    .put("runtimeVersion", receipt.getString("runtimeVersion"))
                    .put(
                      "contentHash",
                      receipt.getString("embeddedContentHash"),
                    )
                ArtifactInstaller(caseFolding())
                  .verifyDirectory(
                    root,
                    manifest,
                    config.getString("reactNativeVersion"),
                    config.getInt("hermesBytecodeVersion"),
                    null,
                  )
                File(root, "index.bundle")
              },
            )
            // Observe real Activity transitions, including pauses while Expo is waiting
            // for storage.
            application.registerActivityLifecycleCallbacks(
              object : Application.ActivityLifecycleCallbacks {
                private val created = mutableSetOf<Activity>()
                private val resumed = mutableSetOf<Activity>()

                override fun onActivityCreated(activity: Activity, state: Bundle?) {
                  if (activity is ReactActivity) {
                    created.add(activity)
                    OtaKitRuntime.setForegroundUIIntent(true)
                  }
                }

                override fun onActivityResumed(activity: Activity) {
                  if (activity is ReactActivity) {
                    resumed.add(activity)
                    OtaKitRuntime.setForeground(true)
                  }
                }

                override fun onActivityPaused(activity: Activity) {
                  if (resumed.remove(activity)) OtaKitRuntime.setForeground(resumed.isNotEmpty())
                }

                override fun onActivityDestroyed(activity: Activity) {
                  if (created.remove(activity))
                    OtaKitRuntime.setForegroundUIIntent(created.isNotEmpty())
                  if (resumed.remove(activity)) OtaKitRuntime.setForeground(resumed.isNotEmpty())
                }

                override fun onActivityStarted(activity: Activity) {}

                override fun onActivityStopped(activity: Activity) {}

                override fun onActivitySaveInstanceState(
                  activity: Activity,
                  state: Bundle,
                ) {}
              }
            )
          }
        }
      )

  override fun createReactNativeHostHandlers(context: Context): List<ReactNativeHostHandler> =
    if (!enabled(context)) emptyList()
    else
      listOf(
        object : ReactNativeHostHandler {
          override fun getJSBundleFile(useDeveloperSupport: Boolean): String {
            check(!useDeveloperSupport) { "OtaKit fixture requires a release host" }
            return OtaKitRuntime.selectedBundleFile()
          }

          override fun onDidCreateReactHost(context: Context, reactHost: ReactHost) {
            OtaKitRuntime.attachHost(reactHost)
          }

          override fun onReactInstanceException(
            useDeveloperSupport: Boolean,
            exception: Exception,
          ) {
            // Expo's default delegate throws when no handler exists. Preserve that
            // fatal behavior;
            // OtaKit's per-context exception wrapper records failure before delegating
            // here.
            throw exception
          }
        }
      )

  override fun createReactActivityHandlers(context: Context): List<ReactActivityHandler> =
    // Expo calls this from the Activity constructor, before its Context is attached.
    // Read application flags only in the deferred callback selected during onCreate.
    listOf(
      object : ReactActivityHandler {
        override fun getDelayLoadAppHandler(
          activity: ReactActivity,
          reactHost: ReactHost,
        ): ReactActivityHandler.DelayLoadAppHandler? =
          if (!enabled(activity)) null
          else
            ReactActivityHandler.DelayLoadAppHandler { ready ->
              OtaKitRuntime.whenPrepared { result ->
                result.getOrThrow()
                ready.run()
              }
            }
      }
    )
}
