require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))
Pod::Spec.new do |s|
  s.name = 'OtaKitUpdaterCore'
  s.version = package['version']
  s.summary = 'OtaKit native verification and launch state'
  s.homepage = 'https://github.com/OtaKit/otakit'
  s.license = { :type => 'MIT', :file => 'LICENSE' }
  s.author = 'OtaKit'
  s.source = { :git => 'https://github.com/OtaKit/otakit.git', :tag => s.version }
  s.ios.deployment_target = '15.1'
  s.swift_version = '5.9'
  s.source_files = 'ios/Sources/**/*.swift'
  s.dependency 'ZIPFoundation', '0.9.20'
end
