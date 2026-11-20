require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'NhactoiWindow'
  s.version        = package['version']
  s.summary        = 'Window size and iPhone Duo fold reporting for Nhắc tôi.'
  s.description    = 'Publishes the app window and UIKit division reserved regions (the iPhone Duo fold) in the same shape as the Android WindowManager payload.'
  s.license        = 'UNLICENSED'
  s.author         = 'Nhắc tôi'
  s.homepage       = 'https://nhactoi.local'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
