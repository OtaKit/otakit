#import <OtaKitRNSpec/OtaKitRNSpec.h>
#import <React/RCTReloadCommand.h>
#import "OtaKitReactNativeUpdater-Swift.h"

@interface OtaKitUpdater : NSObject <NativeOtaKitSpec>
@end

@implementation OtaKitUpdater {
  NSString *_generation;
}
RCT_EXPORT_MODULE(OtaKitUpdater)
+ (BOOL)requiresMainQueueSetup { return NO; }
- (instancetype)init { if ((self = [super init])) { _generation = [[OtaKitRuntime shared] captureGeneration]; } return self; }
- (NSString *)bindInstance {
  NSError *error = nil;
  NSString *context = [[OtaKitRuntime shared] bind:_generation error:&error];
  if (error) @throw [NSException exceptionWithName:@"OTAKIT_BOOTSTRAP_FAILED" reason:error.localizedDescription userInfo:nil];
  return context;
}
- (void)getState:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  NSError *error = nil; NSString *state = [[OtaKitRuntime shared] stateJSONAndReturnError:&error];
  if (error) reject(@"OTAKIT_STATE_ERROR", error.localizedDescription, error); else resolve(state);
}
- (void)check:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  [[OtaKitRuntime shared] check:_generation completion:^(NSString *value, NSError *error) { if (error) reject(@"OTAKIT_CHECK_ERROR", error.localizedDescription, error); else resolve(value); }];
}
- (void)download:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  [[OtaKitRuntime shared] download:_generation completion:^(NSString *value, NSError *error) { if (error) reject(@"OTAKIT_DOWNLOAD_ERROR", error.localizedDescription, error); else resolve(value); }];
}
- (void)apply:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  NSError *error = nil; BOOL reload = [[[OtaKitRuntime shared] apply:_generation error:&error] boolValue];
  if (error) reject(@"ACTIVATION_DEFERRED", error.localizedDescription, error);
  else if (!reload) resolve(nil); // Reloading terminates this JS instance and its promise.
}
- (void)notifyAppReady:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject {
  NSError *error = nil; [[OtaKitRuntime shared] notifyReady:_generation error:&error];
  if (error) reject(@"STALE_INSTANCE", error.localizedDescription, error); else resolve(nil);
}
- (void)setActivationGuard:(BOOL)active { [[OtaKitRuntime shared] setGuard:active generation:_generation]; }
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params {
  return std::make_shared<facebook::react::NativeOtaKitSpecJSI>(params);
}
@end
