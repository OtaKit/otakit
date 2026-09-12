package com.helloworld

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.otakit.reactnative.OtaKitRuntime

class MainActivity : ReactActivity() {
  override fun getMainComponentName(): String = "HelloWorld"

  override fun onCreate(savedInstanceState: Bundle?) {
    (application as MainApplication).testScenario = intent.getStringExtra("otakit-e2e")
    OtaKitRuntime.setForegroundUIIntent(true)
    super.onCreate(savedInstanceState)
  }

  override fun onResume() {
    super.onResume()
    OtaKitRuntime.setForeground(true)
  }

  override fun onPause() {
    OtaKitRuntime.setForeground(false)
    super.onPause()
  }

  override fun onDestroy() {
    OtaKitRuntime.setForegroundUIIntent(false)
    super.onDestroy()
  }

  override fun createReactActivityDelegate(): ReactActivityDelegate =
    object : DefaultReactActivityDelegate(this, mainComponentName, true) {
      override fun getLaunchOptions(): Bundle =
        Bundle().apply {
          putString("otaTestScenario", intent.getStringExtra("otakit-e2e"))
        }
    }
}
