require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))
Pod::Spec.new do |s|
  s.name = 'OtaKitReactNativeUpdater'
  s.version = package['version']
  s.summary = package['description']
  s.homepage = 'https://github.com/OtaKit/otakit'
  s.license = { :type => 'MIT', :file => 'LICENSE' }
  s.author = 'OtaKit'
  s.source = { :git => 'https://github.com/OtaKit/otakit.git', :tag => s.version }
  s.ios.deployment_target = '15.1'
  s.swift_version = '5.9'
  s.source_files = 'ios/**/*.{h,m,mm,swift}'
  s.dependency 'OtaKitUpdaterCore', package['dependencies']['@otakit/updater-core'].sub('workspace:*', package['version'])
  install_modules_dependencies(s)
end
