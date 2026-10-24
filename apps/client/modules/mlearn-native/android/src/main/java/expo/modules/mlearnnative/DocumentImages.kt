package expo.modules.mlearnnative

import android.util.Base64
import org.json.JSONObject
import java.io.File

// Runtime IDs are resolved before this boundary; no renderer-supplied paths.
internal fun documentImageUri(location: JSONObject): String {
  val mime = location.getString("mimeType")
  val length = location.getLong("byteLength")
  check(mime in setOf("image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml") &&
    length in 1..(2L * 1024 * 1024)) { "Document resource is not a bounded supported image." }
  val file = File(location.getString("path"))
  check(file.isFile && file.length() == length) { "Document image size changed." }
  val bytes = ByteArray(length.toInt() + 1)
  val count = file.inputStream().use { input ->
    var count = 0
    while (count < bytes.size) {
      val read = input.read(bytes, count, bytes.size - count)
      if (read < 0) break
      count += read
    }
    count
  }
  check(count.toLong() == length) { "Document image size changed." }
  return "data:$mime;base64," + Base64.encodeToString(bytes, 0, count, Base64.NO_WRAP)
}
