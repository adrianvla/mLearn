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
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
