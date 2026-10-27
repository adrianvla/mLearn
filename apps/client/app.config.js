const { withGradleProperties, withProjectBuildGradle } = require('expo/config-plugins');
const { mergeContents } = require('@expo/config-plugins/build/utils/generateCode');

// The Rust bridge ships these two ABIs. Do not produce APKs that advertise
// 32-bit runtimes without the corresponding native library.
module.exports = ({ config }) => {
  config = withGradleProperties(config, (mod) => {
    mod.modResults = mod.modResults.filter((entry) => entry.key !== 'reactNativeArchitectures');
    mod.modResults.push({
      type: 'property',
      key: 'reactNativeArchitectures',
      value: 'arm64-v8a,x86_64',
    });
    return mod;
  });
  return withProjectBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') throw new Error('The Android toolchain mod requires a Groovy project');
    mod.modResults.contents = mergeContents({
      tag: 'mlearn-android-ndk',
      src: mod.modResults.contents,
      anchor: /apply plugin:\s*["']expo-root-project["']/,
      offset: 0,
      comment: '//',
      // Cargo inherits ANDROID_NDK_HOME. Configure both Expo's root default
      // and libraries such as Unistyles that otherwise use AGP's separate NDK.
      newSrc: `def mlearnNdkHome = System.getenv('ANDROID_NDK_HOME')
if (mlearnNdkHome) {
  def ndkProperties = new Properties()
  new File(mlearnNdkHome, 'source.properties').withInputStream { ndkProperties.load(it) }
  def selectedVersion = ndkProperties.getProperty('Pkg.Revision')?.trim()
  if (!selectedVersion) throw new GradleException('Selected Android NDK lacks Pkg.Revision')
  rootProject.ext.ndkVersion = selectedVersion
}
subprojects { subproject ->
  ['com.android.application', 'com.android.library'].each { pluginId ->
    subproject.plugins.withId(pluginId) {
      subproject.extensions.getByName('android').ndkVersion = rootProject.ext.ndkVersion
    }
  }
}
`,
    }).contents;
    return mod;
  });
};
