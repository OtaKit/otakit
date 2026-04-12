#import <Capacitor/Capacitor.h>

CAP_PLUGIN(UpdaterPlugin, "OtaKit",
  CAP_PLUGIN_METHOD(check, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(download, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(apply, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(debugGetState, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(notifyAppReady, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(debugReset, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(debugListBundles, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(debugDeleteBundle, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(debugGetLastFailure, CAPPluginReturnPromise);
)
