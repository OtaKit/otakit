package com.otakit.reactnative

import android.app.Application
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.UserManager
import android.system.Os
import android.system.OsConstants
import com.facebook.react.ReactHost
import com.facebook.react.bridge.JSBundleLoader
import com.facebook.react.bridge.ReactContext
import com.facebook.react.common.annotations.UnstableReactNativeAPI
import com.facebook.react.fabric.ComponentFactory
import com.facebook.react.runtime.ReactHostDelegate
import com.facebook.react.runtime.ReactHostImpl
import com.otakit.core.ArtifactCache
import com.otakit.core.ArtifactInstaller
import com.otakit.core.EventDelivery
import com.otakit.core.LaunchStore
import com.otakit.core.RNManifest
import java.io.File
import java.net.HttpURLConnection
import java.net.URI
import java.nio.file.Files
import java.util.Base64
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.Future
import org.json.JSONArray
import org.json.JSONObject

/** One coordinator per application; each native module captures one immutable JS generation. */
object OtaKitRuntime {
  private val stateExecutor = Executors.newSingleThreadExecutor()
  private val networkExecutor = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())
  private lateinit var preparation: Future<Engine>
  private var host: ReactHost? = null
  @Volatile private var uiIntent = false
  @Volatile private var foreground = false

  /**
   * Call once in Application.onCreate. All configuration and artifact I/O runs off the main thread.
   */
  @Synchronized
  fun prepare(
    application: Application,
    configuration: () -> String,
    embeddedBundle: () -> File,
    caseFolding: () -> ByteArray,
  ) {
    check(!::preparation.isInitialized) { "OtaKit host is already configured" }
    preparation =
      stateExecutor.submit<Engine> {
        check(application.getSystemService(UserManager::class.java).isUserUnlocked) {
          "STORAGE_UNAVAILABLE"
        }
        val config = JSONObject(configuration())
        val receipt = config.getJSONObject("embeddedReceipt")
        check(
          receipt.getString("framework") == "react-native" &&
            receipt.getString("platform") == "android"
        ) {
          "INCOMPATIBLE_ARTIFACT"
        }
        val builtin =
          JSONObject()
            .put("appId", receipt.getString("appId"))
            .put("platform", "android")
            .put("runtimeVersion", receipt.getString("runtimeVersion"))
            .put("contentHash", receipt.getString("embeddedContentHash"))
            .put("version", receipt.getString("version"))
            .put("bundlePath", embeddedBundle().canonicalPath)
            .put("embedded", true)
        val root = File(application.noBackupFilesDir, "OtaKitRN").canonicalFile
        Files.createDirectories(root.toPath())
        val sync = LaunchStore.DirectorySync { directory ->
          val fd = Os.open(directory.path, OsConstants.O_RDONLY or OsConstants.O_NOFOLLOW, 0)
          try {
            check(OsConstants.S_ISDIR(Os.fstat(fd).st_mode)) { "Expected storage directory" }
            Os.fsync(fd)
          } finally {
            Os.close(fd)
          }
        }
        val installer = ArtifactInstaller(caseFolding())
        val cache =
          ArtifactCache(
            root,
            builtin,
            installer,
            keys(config.getJSONObject("publicKeys")),
            config.getString("reactNativeVersion"),
            config.getInt("hermesBytecodeVersion"),
            sync,
          )
        val store =
          LaunchStore(
            File(root, "launch.json"),
            config.getString("nativeBuildId"),
            builtin,
            sync,
            cache::verify,
          )
        // Serialize cleanup with downloads while allowing RN startup to proceed independently.
        networkExecutor.execute { runCatching { cache.collect(store.state()) } }
        if (!config.isNull("ingestURL")) {
          runCatching {
            val info = application.packageManager.getPackageInfo(application.packageName, 0)
            val build =
              if (android.os.Build.VERSION.SDK_INT >= 28) info.longVersionCode.toString()
              else info.versionCode.toString()
            EventDelivery(
                store,
                config.getString("ingestURL"),
                builtin.getString("appId"),
                "android",
                build,
                config.optBoolean("allowLocalhost"),
              )
              .start()
          }
        }
        Engine(config, builtin, root, store, installer, cache)
      }
    main.post(
      object : Runnable {
        override fun run() {
          if (preparation.isDone && !preparation.isCancelled)
            stateExecutor.execute {
              runCatching {
                if (engine().store.checkTimeout(SystemClock.elapsedRealtime(), 10_000)) reload()
              }
            }
          main.postDelayed(this, 250)
        }
      }
    )
  }

  /** Set before creating an Activity's RN surface. Headless starts leave staged code untouched. */
  fun setForegroundUIIntent(value: Boolean) {
    uiIntent = value
  }

  fun setForeground(value: Boolean) {
    foreground = value
    if (::preparation.isInitialized)
      stateExecutor.execute {
        runCatching { engine().store.setForeground(value, SystemClock.elapsedRealtime()) }
      }
  }

  /**
   * Wrap the application's original delegate so packages, bindings and exception handling survive.
   */
  @OptIn(UnstableReactNativeAPI::class)
  @Synchronized
  fun createHost(
    application: Application,
    original: ReactHostDelegate,
    componentFactory: ComponentFactory,
  ): ReactHost {
    check(host == null) { "OtaKit host already exists" }
    val delegate =
      object : ReactHostDelegate by original {
        override val jsBundleLoader: JSBundleLoader
          get() {
            check(Looper.myLooper() != Looper.getMainLooper()) {
              "Bundle selection must run on the RN background executor"
            }
            val engine = engine()
            engine.store.beginLaunch(uiIntent, true, SystemClock.elapsedRealtime())
            engine.store.setForeground(foreground, SystemClock.elapsedRealtime())
            return JSBundleLoader.createFileLoader(
              engine.store.state().getJSONObject("current").getString("bundlePath")
            )
          }
      }
    // This host always runs verified embedded/OTA bundles. Metro remains a separate development
    // host.
    return ReactHostImpl(application, delegate, componentFactory, false, false).also { created ->
      host = created
      created.addReactInstanceEventListener(
        object : com.facebook.react.ReactInstanceEventListener {
          override fun onReactContextInitialized(context: ReactContext) {
            hostReady(context)
          }
        }
      )
    }
  }

  private fun hostReady(context: ReactContext) {
    val module = context.getNativeModule(OtaKitUpdater::class.java) ?: return
    val generation = module.generation
    engine().store.hostReady(generation)
    val previous = context.jsExceptionHandler
    context.jsExceptionHandler =
      com.facebook.react.bridge.JSExceptionHandler { error ->
        stateExecutor.execute { runCatching { if (engine().store.fail(generation)) reload() } }
        if (previous != null) previous.handleException(error) else throw error
      }
  }

  private fun reload() {
    if (Looper.myLooper() == Looper.getMainLooper())
      host?.reload("OtaKit artifact selection changed")
    else main.post { host?.reload("OtaKit artifact selection changed") }
  }

  private fun engine(): Engine {
    check(::preparation.isInitialized) { "OtaKit host is not configured" }
    return preparation.get()
  }

  internal fun captureGeneration(): Long = engine().store.state().getLong("generation")

  internal fun bind(generation: Long): String {
    val store = engine().store
    store.bindBootstrap(generation)
    val artifact = store.state().getJSONObject("current")
    val context = JSONObject().put("generation", generation.toString())
    for (key in
      listOf("appId", "platform", "runtimeVersion", "contentHash", "releaseId", "channel")) context
      .put(key, artifact.opt(key) ?: JSONObject.NULL)
    context
      .put("artifactRoot", JSONObject.NULL)
      .put("expoConfig", JSONObject.NULL)
      .put("expoDomRoot", JSONObject.NULL)
    if (!artifact.optBoolean("embedded")) {
      val root = File(artifact.getString("bundlePath")).parentFile!!
      context.put("artifactRoot", root.toURI().toString().trimEnd('/'))
      val expo = File(root, "expo-config.json")
      if (expo.exists()) context.put("expoConfig", JSONObject(expo.readText()))
      val descriptor = JSONObject(File(root, "otakit-bundle.json").readText())
      context.put(
        "expoDomRoot",
        descriptor.optJSONObject("expo")?.opt("domRoot") ?: JSONObject.NULL,
      )
    }
    return context.toString()
  }

  internal fun state(): String = engine().store.state().toString()

  internal fun ready(generation: Long) = engine().store.notifyReady(generation)

  internal fun guard(generation: Long, active: Boolean) =
    engine().store.setActivationGuard(active, generation)

  internal fun apply(generation: Long): Boolean {
    check(Looper.myLooper() == Looper.getMainLooper()) {
      "Activation must share the headless-task/UI executor"
    }
    check(foreground && uiIntent) { "ACTIVATION_DEFERRED" }
    val next = engine().store.apply(generation, SystemClock.elapsedRealtime())
    if (next != generation) {
      reload()
      return true
    }
    return false
  }

  internal fun submit(network: Boolean = false, operation: () -> Unit) {
    (if (network) networkExecutor else stateExecutor).execute(operation)
  }

  internal fun submitOnMain(operation: () -> Unit) {
    main.post(operation)
  }

  internal fun backgroundWork(generation: Long) {
    engine().store.observeBackgroundWork(generation)
  }

  internal fun check(generation: Long): String = engine().check(generation)

  internal fun download(generation: Long): String = engine().download(generation)

  private fun keys(value: JSONObject): Map<String, ByteArray> =
    value.keys().asSequence().associateWith { Base64.getDecoder().decode(value.getString(it)) }

  private class Engine(
    val config: JSONObject,
    val builtin: JSONObject,
    val root: File,
    val store: LaunchStore,
    val installer: ArtifactInstaller,
    val cache: ArtifactCache,
  ) {
    private var manifest: JSONObject? = null
    private val channel = if (config.isNull("channel")) null else config.getString("channel")
    private val rnVersion = config.getString("reactNativeVersion")
    private val bytecodeVersion = config.getInt("hermesBytecodeVersion")

    fun check(generation: Long): String {
      store.assertInstance(generation)
      val base = config.getString("cdnURL").trimEnd('/')
      val url =
        "$base/manifests/${builtin.getString("appId")}/v3/android/${channel ?: "__base__"}/${builtin.getString("runtimeVersion")}/manifest.json"
      val downloaded = fetch(url, 4 * 1024 * 1024)
      try {
        val verified =
          RNManifest.verify(
            downloaded.readText(),
            builtin.getString("appId"),
            "android",
            builtin.getString("runtimeVersion"),
            channel,
            keys(config.getJSONObject("publicKeys")),
            System.currentTimeMillis() / 1000,
          )
        store.assertInstance(generation)
        manifest = verified
        return verified.toString()
      } finally {
        downloaded.delete()
      }
    }

    fun download(generation: Long): String {
      store.assertInstance(generation)
      val candidate = checkNotNull(manifest) { "Check for an update before downloading" }
      check(
        candidate.getJSONObject("signature").getLong("exp") > System.currentTimeMillis() / 1000
      ) {
        "EXPIRED_MANIFEST"
      }
      val hash = candidate.getString("contentHash")
      val failed = store.state().getJSONArray("failed")
      for (index in 0 until failed.length()) check(failed.getString(index) != hash) {
        "QUARANTINED_ARTIFACT"
      }
      val pointer =
        JSONObject(builtin.toString())
          .put("contentHash", hash)
          .put("version", candidate.getString("version"))
          .put("releaseId", candidate.getString("releaseId"))
          .put("channel", candidate.opt("channel") ?: JSONObject.NULL)
      if (hash == builtin.getString("contentHash")) {
        check(candidate.getString("version") == builtin.getString("version")) {
          "INCOMPATIBLE_ARTIFACT"
        }
        store.stage(pointer, generation)
        return candidate.toString()
      }
      val destination = cache.directory(hash)
      var staging: File? = null
      var completed = false
      try {
        val inventory: JSONArray
        if (destination.exists()) inventory = cache.verifyDirectory(candidate)
        else {
          val temporary = File(root, "staging/${UUID.randomUUID()}")
          staging = temporary
          Files.createDirectories(temporary.toPath())
          if (candidate.getString("strategy") == "zip") {
            val archive = fetch(candidate.getString("url"), candidate.getLong("size"))
            try {
              inventory =
                installer.installZip(
                  archive,
                  temporary,
                  candidate,
                  keys(config.getJSONObject("bundleKeys")),
                  rnVersion,
                  bytecodeVersion,
                )
            } finally {
              archive.delete()
            }
          } else {
            installer.validateDeltaInventory(candidate)
            val files = candidate.getJSONArray("files")
            for (index in 0 until files.length()) {
              val file = files.getJSONObject(index)
              val downloaded = fetch(file.getString("url"), file.getLong("size"))
              try {
                val target = File(temporary, file.getString("path"))
                Files.createDirectories(target.parentFile!!.toPath())
                Files.move(downloaded.toPath(), target.toPath())
              } finally {
                downloaded.delete()
              }
            }
            inventory =
              installer.verifyDirectory(temporary, candidate, rnVersion, bytecodeVersion, null)
          }
        }
        cache.commit(staging, candidate, candidate.toString(), inventory)
        pointer
          .put("embedded", false)
          .put("bundlePath", File(destination, "index.bundle").canonicalPath)
        store.stage(pointer, generation, staging != null)
        completed = true
        return candidate.toString()
      } finally {
        staging?.deleteRecursively()
        if (!completed)
          runCatching { store.recordDownloadFailure(pointer, "RN download or verification failed") }
      }
    }

    private fun fetch(raw: String, limit: Long): File {
      val uri = URI(raw)
      check(
        uri.userInfo == null &&
          uri.fragment == null &&
          (uri.scheme == "https" ||
            (config.optBoolean("allowLocalhost") &&
              uri.scheme == "http" &&
              uri.host in listOf("localhost", "127.0.0.1", "::1")))
      ) {
        "INVALID_DOWNLOAD_URL"
      }
      val connection = uri.toURL().openConnection() as HttpURLConnection
      connection.instanceFollowRedirects = false
      connection.connectTimeout = 30_000
      connection.readTimeout = 30_000
      val directory = File(root, "downloads")
      Files.createDirectories(directory.toPath())
      val file = File.createTempFile("download-", ".tmp", directory)
      try {
        check(connection.responseCode == 200) { "DOWNLOAD_HTTP_${connection.responseCode}" }
        check(connection.contentLengthLong <= limit) { "DOWNLOAD_TOO_LARGE" }
        val deadline = SystemClock.elapsedRealtime() + 120_000
        var written = 0L
        connection.inputStream.use { input ->
          file.outputStream().use { output ->
            val buffer = ByteArray(8192)
            while (true) {
              check(SystemClock.elapsedRealtime() < deadline) { "DOWNLOAD_TIMEOUT" }
              val count = input.read(buffer)
              if (count == -1) break
              check(count <= limit - written) { "DOWNLOAD_TOO_LARGE" }
              output.write(buffer, 0, count)
              written += count
            }
          }
        }
        return file
      } catch (error: Exception) {
        file.delete()
        throw error
      } finally {
        connection.disconnect()
      }
    }
  }
}
