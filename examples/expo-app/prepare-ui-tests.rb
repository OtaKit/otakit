require 'fileutils'
require 'xcodeproj'

abort 'Usage: ruby prepare-ui-tests.rb <new directory outside the repo>' unless ARGV.length == 1
output = File.expand_path(ARGV[0])
repository = File.realpath(File.join(__dir__, '../..'))
parent = File.realpath(File.dirname(output))
abort 'UI test output must be outside the repository' if parent == repository || parent.start_with?(repository + '/')
Dir.mkdir(output)
FileUtils.cp(File.join(__dir__, 'ui-tests/NativeLinkTests.swift'), output)
project = Xcodeproj::Project.new(File.join(output, 'OtaKitFixtureUI.xcodeproj'))
target = project.new_target(:ui_test_bundle, 'OtaKitFixtureUI', :ios, '16.4')
target.add_file_references([project.main_group.new_file('NativeLinkTests.swift')])
target.build_configurations.each do |configuration|
  configuration.build_settings.merge!({
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'SWIFT_VERSION' => '5.0',
    'PRODUCT_BUNDLE_IDENTIFIER' => 'com.otakit.expofixture.ui-tests',
    'CODE_SIGNING_ALLOWED' => 'NO',
    'TARGETED_DEVICE_FAMILY' => '1,2',
    'SUPPORTS_MACCATALYST' => 'NO',
  })
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.add_test_target(target)
scheme.save_as(output, 'OtaKitFixtureUI', true)
puts project.path
