Pod::Spec.new do |s|
  s.name = 'MlearnNative'
  s.version = '0.1.0'
  s.summary = 'Local Expo bridge to the mLearn Rust runtime'
  s.description = 'Generated UniFFI bindings; no duplicate application logic.'
  s.license = { :type => 'SUL-1.0' }
  s.author = 'mLearn'
  s.homepage = 'https://github.com/adrianvla/mLearn'
  s.source = { :git => 'https://github.com/adrianvla/mLearn.git' }
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = 'MlearnNativeModule.swift', 'generated/*.swift'
  s.vendored_frameworks = 'generated/MlearnRust.xcframework'
  # CocoaPods links the static XCFramework but does not automatically expose
  # UniFFI's separately named Clang module to the Swift compiler.
  # Keep this target-local; do not change module search paths for other pods.
  s.preserve_paths = 'generated/headers/*'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_INCLUDE_PATHS' => '$(inherited) "$(PODS_TARGET_SRCROOT)/generated/headers"',
    'OTHER_SWIFT_FLAGS' => '$(inherited) -Xcc -fmodule-map-file="$(PODS_TARGET_SRCROOT)/generated/headers/module.modulemap"'
  }
end
