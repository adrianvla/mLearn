package expo.modules.mlearnnative

import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.TextRecognizerOptionsInterface
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import com.google.mlkit.vision.text.devanagari.DevanagariTextRecognizerOptions
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executor

internal class OcrHost(private val execute: (String) -> String) {
  private val slot = OcrSlot()
  private val display = OcrSlot()

  private enum class Provider(val id: String, val label: String, val artifact: String, val scripts: List<String>) {
    LATIN("android.mlkit.latin", "ML Kit Latin", "text-recognition", listOf("Latn")),
    CHINESE("android.mlkit.chinese", "ML Kit Chinese", "text-recognition-chinese", listOf("Latn", "Hans", "Hant")),
    JAPANESE("android.mlkit.japanese", "ML Kit Japanese", "text-recognition-japanese", listOf("Latn", "Jpan")),
    KOREAN("android.mlkit.korean", "ML Kit Korean", "text-recognition-korean", listOf("Latn", "Kore")),
    DEVANAGARI("android.mlkit.devanagari", "ML Kit Devanagari", "text-recognition-devanagari", listOf("Latn", "Deva"));

    fun descriptor(): JSONObject {
      val bundled = options().isThickClient
      return JSONObject().put("id", id).put("label", label)
        .put("revision", "com.google.mlkit:$artifact:16.0.1")
        .put("availability", if (bundled) "ready" else "unavailable")
        .put("languages", JSONArray()).put("scripts", JSONArray(scripts))
        .put("languageProvenance", "Bundled ML Kit Text Recognition v2 SDK script option; not runtime language enumeration or tested quality.")
        .put("reason", if (bundled) JSONObject.NULL else "The packaged ML Kit script module is missing; downloadable fallback is disabled.")
    }

    private fun options(): TextRecognizerOptionsInterface = when (this) {
      LATIN -> TextRecognizerOptions.DEFAULT_OPTIONS
      CHINESE -> ChineseTextRecognizerOptions.Builder().build()
      JAPANESE -> JapaneseTextRecognizerOptions.Builder().build()
      KOREAN -> KoreanTextRecognizerOptions.Builder().build()
      DEVANAGARI -> DevanagariTextRecognizerOptions.Builder().build()
    }

    fun client(): TextRecognizer {
      val options = options()
      check(options.isThickClient) { "Bundled ML Kit script module is unavailable; no downloadable fallback is allowed." }
      return TextRecognition.getClient(options)
    }
  }

  fun providers(): String = JSONArray(Provider.entries.map { it.descriptor() }).toString()
  fun reserve(id: String) { slot.reserve(id) }
  fun start(id: String): OcrSlot.Ticket = slot.start(id)
  fun reserveDisplay(): OcrSlot.Ticket {
    val id = "display-${UUID.randomUUID()}"
    display.reserve(id, runtimeRequest = false)
    return display.start(id)
  }
  fun invalidate(id: String) { slot.cancel(id) }
  fun finish(ticket: OcrSlot.Ticket) { (if (ticket.runtimeRequest) slot else display).finish(ticket) }
  fun publish(ticket: OcrSlot.Ticket, publish: () -> Unit) { (if (ticket.runtimeRequest) slot else display).publish(ticket, publish) }
  fun cancelRuntime(id: String) {
    val response = response(JSONObject().put("type", "cancel_ocr").put("requestId", id), "ocr_cancelled")
    check(response.getString("requestId") == id) { "Runtime OCR cancellation identity changed." }
  }
  fun close(): String? { display.close(); return slot.close() }

  private fun response(action: JSONObject, expected: String): JSONObject {
    val response = JSONObject(execute(action.toString()))
    check(response.getString("type") == expected) {
      response.optString("message", "Runtime OCR action failed.")
    }
    return response
  }

  fun recognize(ticket: OcrSlot.Ticket, requestJSON: String): String {
    try {
      slot.check(ticket)
      check(requestJSON.length <= 16 * 1024 && requestJSON.toByteArray(Charsets.UTF_8).size <= 16 * 1024) {
        "OCR request exceeds its wire bound."
      }
      val request = JSONObject(requestJSON)
      check(request.getString("requestId") == ticket.id) { "OCR request identity changed." }
      val plan = response(JSONObject().put("type", "plan_ocr").put("request", request), "ocr_plan").getJSONObject("plan")
      slot.check(ticket)
      check(plan.getString("requestId") == ticket.id &&
        plan.getString("sourceId") == request.getString("sourceId") &&
        plan.getString("resourceId") == request.getString("resourceId") &&
        plan.getString("contentRevision") == request.getString("contentRevision") &&
        plan.getString("providerId") == request.getString("providerId")) { "Admitted OCR plan identity changed." }
      val provider = Provider.entries.singleOrNull { it.id == plan.getString("providerId") }
        ?: error("Selected Android OCR provider is unavailable.")
      check(plan.getJSONArray("recognitionLanguages").length() == 0) {
        "ML Kit script providers do not accept recognition language hints; select a provider explicitly."
      }
      OcrImages.raster(plan) { slot.check(ticket) }.use { raster ->
        slot.check(ticket)
        val recognizer = provider.client()
        val text = try {
          slot.check(ticket)
          // The completion signal does NOT cancel SDK inference. This IO lane and
          // its bitmap/client remain owned until the real task completes, even
          // after cancellation or module destruction invalidates publication.
          val completed = CompletableFuture<Text>()
          recognizer.process(InputImage.fromBitmap(raster.bitmap, 0))
            .addOnCompleteListener(Executor { it.run() }) { task ->
              if (task.isSuccessful) completed.complete(task.result)
              else completed.completeExceptionally(task.exception ?: IllegalStateException("ML Kit task cancelled."))
            }
          // join is deliberately not interruptible; only the actual SDK task
          // completion may release its client and input bitmap.
          completed.join()
        } finally { recognizer.close() }
        slot.check(ticket)
        val result = JSONObject().put("requestId", ticket.id).put("provider", provider.descriptor())
          .put("width", raster.width).put("height", raster.height).put("crop", raster.cropJSON())
          .put("regions", regions(text, raster))
        slot.check(ticket)
        val completed = response(JSONObject().put("type", "complete_ocr").put("result", result), "ocr_page")
        slot.check(ticket)
        val page = completed.getJSONObject("page")
        check(page.getString("sourceId") == plan.getString("sourceId") &&
          page.getString("resourceId") == plan.getString("resourceId") &&
          page.getString("contentRevision") == plan.getString("contentRevision")) { "Persisted OCR page identity changed." }
        return completed.toString()
      }
    } catch (error: Throwable) {
      // Decode/SDK/bound failures must not strand Rust's admitted job. Duplicate
      // cancellation of the same request is safe across uncertain transport.
      try { cancelRuntime(ticket.id) }
      catch (cleanup: Exception) { error.addSuppressed(cleanup) }
      throw error
    }
  }

  private fun regions(text: Text, raster: OcrRaster): JSONArray {
    val regions = JSONArray()
    var textBytes = 0
    for (block in text.textBlocks) for (line in block.lines) {
      check(regions.length() < 512) { "OCR exceeds the 512 observation bound." }
      val value = line.text
      // Count both wire copies (region text and its actual sole candidate).
      check(value.length <= 16 * 1024) { "OCR exceeds the aggregate 32 KiB text bound." }
      textBytes += value.toByteArray(Charsets.UTF_8).size * 2
      check(textBytes <= 32 * 1024) { "OCR exceeds the aggregate 32 KiB text bound." }
      val corners = line.cornerPoints
      check(corners != null && corners.size == 4) { "ML Kit did not supply a four-corner observation." }
      val quad = JSONObject()
      val keys = arrayOf("topLeft", "topRight", "bottomRight", "bottomLeft")
      corners.forEachIndexed { index, point ->
        val (x, y) = OcrGeometry.sourcePoint(point.x, point.y, raster.bitmap.width,
          raster.bitmap.height, raster.bounds, raster.width, raster.height)
        quad.put(keys[index], JSONObject().put("x", x).put("y", y))
      }
      val confidence = line.confidence
      check(confidence.isFinite() && confidence in 0f..1f) { "ML Kit returned invalid confidence." }
      regions.put(JSONObject().put("id", "line-${regions.length()}").put("text", value).put("quad", quad)
        .put("candidates", JSONArray().put(JSONObject().put("text", value).put("confidence", confidence.toDouble())))
        .put("language", line.recognizedLanguage.takeUnless { it.isEmpty() || it == "und" } ?: JSONObject.NULL)
        // No SDK writing-direction/orientation enum is exposed by this wire.
        .put("orientation", JSONObject.NULL).put("readingOf", JSONObject.NULL))
    }
    return regions
  }

  fun imagePageUri(ticket: OcrSlot.Ticket, sourceId: String, resourceId: String, cropJSON: String?): String {
    display.check(ticket)
    val location = response(JSONObject().put("type", "image_page_location")
      .put("sourceId", sourceId).put("resourceId", resourceId), "image_page_location").getJSONObject("location")
    check(location.getString("sourceId") == sourceId && location.getString("resourceId") == resourceId) {
      "Image page source identity changed."
    }
    if (cropJSON != null) {
      check(cropJSON.length <= 1024 && cropJSON.toByteArray(Charsets.UTF_8).size <= 1024) { "Display crop exceeds its bound." }
      location.put("crop", JSONObject(cropJSON))
    }
    OcrImages.raster(location) { display.check(ticket) }.use {
      return OcrImages.dataUri(it) { display.check(ticket) }
    }
  }
}
