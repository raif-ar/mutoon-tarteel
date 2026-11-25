Pod::Spec.new do |s|
  s.name           = 'ReciteListener'
  s.version        = '1.0.0'
  s.summary        = 'On-device listener model runner for Mutoon Recite (ONNX Runtime).'
  s.description    = 'Runs the streaming phoneme model with ONNX Runtime and keeps its state native.'
  s.license        = 'MIT'
  s.author         = 'Mutoon'
  s.homepage       = 'https://github.com/raif-ar/mutoon-tarteel'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '*.{h,m,mm,swift}'
  s.public_header_files = 'OrtRunner.h'

  # Fetched by scripts/fetch-onnxruntime-ios.mjs (gitignored).
  s.vendored_frameworks = 'Frameworks/onnxruntime.xcframework'
  # This ONNX Runtime build also references the system SQLite.
  s.libraries = 'c++', 'sqlite3'
  s.weak_frameworks = 'CoreML'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17'
  }
end
