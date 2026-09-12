package com.otakit.reactnative

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

@ReactModule(name = OtaKitUpdater.NAME)
class OtaKitUpdater(context: ReactApplicationContext) : NativeOtaKitSpec(context) {
  companion object {
    const val NAME = "OtaKitUpdater"
  }

  internal val generation = OtaKitRuntime.captureGeneration()
  private val tasks = HeadlessJsTaskContext.getInstance(context)
  private val taskListener =
    object : HeadlessJsTaskEventListener {
      override fun onHeadlessJsTaskStart(taskId: Int) {
        OtaKitRuntime.backgroundWork(generation)
      }

      override fun onHeadlessJsTaskFinish(taskId: Int) {
        /* Deferral lasts until the next process. */
      }
    }

  init {
    tasks.addTaskEventListener(taskListener)
  }

  override fun invalidate() {
    tasks.removeTaskEventListener(taskListener)
    super.invalidate()
  }

  override fun getName(): String = NAME

  override fun bindInstance(): String = OtaKitRuntime.bind(generation)

  private fun run(promise: Promise, network: Boolean = false, operation: () -> Any?) {
    OtaKitRuntime.submit(network) {
      try {
        promise.resolve(operation())
      } catch (error: Exception) {
        promise.reject("OTAKIT_ERROR", error.message, error)
      }
    }
  }

  override fun getState(promise: Promise) = run(promise) { OtaKitRuntime.state() }

  override fun check(promise: Promise) = run(promise, true) { OtaKitRuntime.check(generation) }

  override fun download(promise: Promise) =
    run(promise, true) { OtaKitRuntime.download(generation) }

  override fun notifyAppReady(promise: Promise) =
    run(promise) {
      OtaKitRuntime.ready(generation)
      null
    }

  override fun apply(promise: Promise) {
    OtaKitRuntime.submitOnMain {
      try {
        if (tasks.hasActiveTasks()) OtaKitRuntime.backgroundWork(generation)
        if (!OtaKitRuntime.apply(generation)) promise.resolve(null)
      } catch (error: Exception) {
        promise.reject("ACTIVATION_DEFERRED", error.message, error)
      }
    }
  }

  override fun setActivationGuard(active: Boolean) {
    OtaKitRuntime.guard(generation, active)
  }
}

class OtaKitPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == OtaKitUpdater.NAME) OtaKitUpdater(reactContext) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      OtaKitUpdater.NAME to
        ReactModuleInfo(OtaKitUpdater.NAME, OtaKitUpdater.NAME, false, false, false, true)
    )
  }
}
