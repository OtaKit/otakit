#import <Capacitor/Capacitor.h>

CAP_PLUGIN(UpdaterPlugin, "OtaKit",
  CAP_PLUGIN_METHOD(getState, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(check, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(download, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(apply, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(update, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(notifyAppReady, CAPPluginReturnPromise);
  CAP_PLUGIN_METHOD(getLastFailure, CAPPluginReturnPromise);
)
