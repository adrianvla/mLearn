package expo.modules.mlearnnative

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import net.kikan.mlearn.rust.RuntimeBridge
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import android.app.Activity
import android.content.Intent
import android.net.Uri
import expo.modules.kotlin.Promise
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.ensureActive

class MlearnNativeModule : Module() {
  private val cancellationScope = CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(1))
  // Leave capacity for raw cues and checkpoints while Rust admits one guest call.
  private val executionScope = CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(3))
  private var bridgeInstance: RuntimeBridge? = null
  private val mediaScope = CoroutineScope(SupervisorJob() + Dispatchers.IO.limitedParallelism(1))
  private val mediaCaptures by lazy {
    val context = appContext.reactContext ?: error("React context is unavailable")
    MediaCapture(File(context.cacheDir, "mlearn-capture-${java.util.UUID.randomUUID()}"))
  }
  private data class PendingExport(val promise: Promise, val file: File, val completed: AtomicBoolean = AtomicBoolean(false))
  @Volatile private var pendingExport: PendingExport? = null
  private val exportBusy = AtomicBoolean(false)
  private val mediaClosed = AtomicBoolean(false)
  private fun removeExport(file: File) {
    val directory = file.parentFile ?: return
    if (directory.exists() && !directory.deleteRecursively()) {
      android.util.Log.e("MlearnNative", "Cannot release temporary media export")
    }
  }

  private fun mediaResponse(action: JSONObject, expected: String): JSONObject {
    val response = JSONObject(bridge().execute(action.toString()))
    check(response.optString("type") == expected) { response.optString("message", "Runtime media action failed.") }
    return response
  }

  @Synchronized private fun bridge(): RuntimeBridge {
    bridgeInstance?.let { return it }
    val context = appContext.reactContext ?: error("React context is unavailable")
    val directory = File(context.filesDir, "mlearn-v3")
    check(directory.isDirectory || directory.mkdirs()) { "Cannot create native profile directory" }
    return RuntimeBridge(directory.absolutePath).also { bridgeInstance = it }
  }

  override fun definition() = ModuleDefinition {
    Name("MlearnNative")
    OnDestroy {
      mediaClosed.set(true)
      mediaCaptures.close()
      pendingExport?.let {
        if (it.completed.compareAndSet(false, true)) {
          it.promise.reject("ERR_MEDIA_CANCELLED", "Media export cancelled by module destruction.", null)
        }
        removeExport(it.file)
      }
      pendingExport = null
      mediaScope.cancel(); cancellationScope.cancel(); executionScope.cancel()
    }
    AsyncFunction("reserveMediaCapture") { id: String -> mediaCaptures.reserve(id) }
    AsyncFunction("importPickedMedia") { uri: String, name: String ->
      val source = Uri.parse(uri)
      check(source.scheme == "content") { "The media picker must return a content URI." }
      val context = appContext.reactContext ?: error("React context is unavailable")
      mediaCaptures.copyPicked(name, {
        checkNotNull(context.contentResolver.openInputStream(source)) { "Cannot open the selected media." }
      }) {
        check(!mediaClosed.get()) { "Media selection cancelled by module destruction." }
      }
    }.runOnQueue(mediaScope)
    AsyncFunction("importPickedDocument") { uri: String, name: String ->
      check(name.substringAfterLast('.', "").lowercase() in setOf("txt", "epub", "pdf")) {
        "Select a TXT, EPUB or PDF document."
      }
      val source = Uri.parse(uri)
      check(source.scheme == "content") { "The document picker must return a content URI." }
      val context = appContext.reactContext ?: error("React context is unavailable")
      mediaCaptures.copyPicked(name, {
        checkNotNull(context.contentResolver.openInputStream(source)) { "Cannot open the selected document." }
      }, maximumBytes = 8L * 1024 * 1024) {
        check(!mediaClosed.get()) { "Document selection cancelled by module destruction." }
      }
    }.runOnQueue(mediaScope)
    AsyncFunction("documentImageUri") { sourceId: String, resourceId: String ->
      val location = mediaResponse(
        JSONObject().put("type", "document_resource").put("sourceId", sourceId).put("resourceId", resourceId),
        "document_resource"
      ).getJSONObject("location")
      check(location.getString("sourceId") == sourceId && location.getString("resourceId") == resourceId) {
        "Document image identity changed."
      }
      documentImageUri(location)
    }.runOnQueue(mediaScope)
    AsyncFunction("cancelMediaCapture") { id: String -> mediaCaptures.cancel(id) }.runOnQueue(cancellationScope)
    AsyncFunction("releaseMediaCapture") { path: String -> mediaCaptures.release(path) }.runOnQueue(mediaScope)
    AsyncFunction("captureMedia") { id: String, request: String ->
      try {
        mediaCaptures.check(id)
        val response = mediaResponse(JSONObject().put("type", "plan_material_media").put("request", JSONObject(request)), "material_media_plan")
        mediaCaptures.capture(id, response.getJSONObject("plan"))
      } finally { mediaCaptures.finish(id) }
    }.runOnQueue(mediaScope)
    AsyncFunction("authoredMediaUri") { id: String ->
      val response = mediaResponse(JSONObject().put("type", "material_media").put("id", id), "material_media")
      Uri.fromFile(File(response.getJSONObject("location").getString("path"))).toString()
    }.runOnQueue(executionScope)
    AsyncFunction("exportAuthoredMedia") { id: String, promise: Promise ->
      if (mediaClosed.get() || !exportBusy.compareAndSet(false, true)) {
        promise.reject("ERR_MEDIA_BUSY", "A media export is already open or the module was destroyed.", null)
        return@AsyncFunction
      }
      mediaScope.launch {
        var snapshot: File? = null
        try {
          val location = mediaResponse(JSONObject().put("type", "material_media").put("id", id), "material_media").getJSONObject("location")
          val media = location.getJSONObject("media")
          val file = File(location.getString("path"))
          val context = appContext.reactContext ?: error("React context is unavailable")
          val directory = File(context.cacheDir, "mlearn-export-${java.util.UUID.randomUUID()}")
          check(directory.mkdirs()) { "Cannot create export directory." }
          val copy = File(directory, "media")
          snapshot = copy
          file.inputStream().use { input ->
            copy.outputStream().use { output ->
              val buffer = ByteArray(64 * 1024)
              while (true) {
                ensureActive()
                val count = input.read(buffer)
                if (count < 0) break
                output.write(buffer, 0, count)
              }
            }
          }
          withContext(Dispatchers.Main) {
            check(!mediaClosed.get()) { "The native media module was destroyed." }
            pendingExport = PendingExport(promise, copy)
            try {
              val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = media.getString("mimeType")
                putExtra(Intent.EXTRA_TITLE, media.getString("name"))
              }
              appContext.throwingActivity.startActivityForResult(intent, 50431)
              snapshot = null // the OS result/lifecycle owner now owns this copy
            } catch (error: Exception) { pendingExport = null; throw error }
          }
        } catch (error: Exception) {
          exportBusy.set(false)
          promise.reject("ERR_MEDIA_EXPORT", error.message, error)
        } finally { snapshot?.let { removeExport(it) } }
      }
    }
    // Matches the lifecycle API used by the installed Expo DocumentPicker.
    OnActivityResult { _, (requestCode, resultCode, intent) ->
      if (requestCode != 50431) return@OnActivityResult
      val pending = pendingExport ?: return@OnActivityResult
      if (resultCode != Activity.RESULT_OK) {
        pendingExport = null
        removeExport(pending.file)
        exportBusy.set(false)
        if (pending.completed.compareAndSet(false, true)) pending.promise.resolve(false)
      } else {
        mediaScope.launch {
          try {
            val uri = intent?.data ?: error("The save picker returned no destination.")
            val context = appContext.reactContext ?: error("React context is unavailable")
            context.contentResolver.openOutputStream(uri, "w").use { output ->
              checkNotNull(output) { "Cannot open the selected export destination." }
              pending.file.inputStream().use { input ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                  ensureActive()
                  val count = input.read(buffer)
                  if (count < 0) break
                  output.write(buffer, 0, count)
                }
              }
            }
            ensureActive()
            if (pending.completed.compareAndSet(false, true)) pending.promise.resolve(true)
          } catch (error: Exception) {
            if (pending.completed.compareAndSet(false, true)) pending.promise.reject("ERR_MEDIA_EXPORT", error.message, error)
          }
          finally {
            removeExport(pending.file)
            exportBusy.set(false)
            // OnDestroy already clears this record if the scope was cancelled.
            pendingExport = null
          }
        }
      }
    }
    AsyncFunction("cancelSourceOpen") { bridge().cancelSourceOpen() }.runOnQueue(cancellationScope)
    AsyncFunction("execute") { request: String -> bridge().execute(request) }.runOnQueue(executionScope)
  }
}
