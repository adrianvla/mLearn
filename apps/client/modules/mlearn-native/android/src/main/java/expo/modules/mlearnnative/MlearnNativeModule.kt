package expo.modules.mlearnnative

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import net.kikan.mlearn.rust.RuntimeBridge
import java.io.File

class MlearnNativeModule : Module() {
  private var bridgeInstance: RuntimeBridge? = null

  @Synchronized private fun bridge(): RuntimeBridge {
    bridgeInstance?.let { return it }
    val context = appContext.reactContext ?: error("React context is unavailable")
    val directory = File(context.filesDir, "mlearn-v3")
    check(directory.isDirectory || directory.mkdirs()) { "Cannot create native profile directory" }
    return RuntimeBridge(directory.absolutePath).also { bridgeInstance = it }
  }

  override fun definition() = ModuleDefinition {
    Name("MlearnNative")
    AsyncFunction("execute") { request: String -> bridge().execute(request) }
  }
}
