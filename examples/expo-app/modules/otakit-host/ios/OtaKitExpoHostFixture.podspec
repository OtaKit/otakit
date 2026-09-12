Pod::Spec.new do |s|
  s.name = 'OtaKitExpoHostFixture'
  s.version = '0.0.1'
  s.summary = 'Private Expo host acceptance fixture'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'OtaKit'
  s.homepage = 'https://github.com/OtaKit/otakit'
  s.source = { :git => 'https://github.com/OtaKit/otakit.git' }
  s.platform = :ios, '16.4'
  s.swift_version = '5.9'
  s.static_framework = true
  s.source_files = '**/*.swift'
  s.dependency 'Expo'
  s.dependency 'ExpoModulesCore'
  s.dependency 'OtaKitReactNativeUpdater'
end
