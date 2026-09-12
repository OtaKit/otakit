# Resolve the exact native-core dependency installed with this updater, including pnpm layouts.
def use_otakit_updater!
  core_package = Pod::Executable.execute_command('node', [
    '--no-global-search-paths', '-p',
    'require.resolve("@otakit/updater-core/package.json", {paths: [process.argv[1]]})',
    __dir__
  ]).strip
  pod 'OtaKitUpdaterCore', :path => File.dirname(core_package)
end
