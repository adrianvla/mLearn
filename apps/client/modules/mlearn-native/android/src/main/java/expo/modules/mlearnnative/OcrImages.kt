package expo.modules.mlearnnative

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapRegionDecoder
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Rect
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.util.Base64
import androidx.exifinterface.media.ExifInterface
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.OutputStream

internal class OcrRaster(val bitmap: Bitmap, val width: Int, val height: Int,
  val bounds: OcrBounds, val cropped: Boolean) : AutoCloseable {
  fun cropJSON(): Any = if (!cropped) JSONObject.NULL else JSONObject()
    .put("x", bounds.left.toDouble() / width).put("y", bounds.top.toDouble() / height)
    .put("width", bounds.width.toDouble() / width).put("height", bounds.height.toDouble() / height)
  override fun close() { bitmap.recycle() }
}

internal object OcrImages {
  const val MAX_INPUT_BYTES = 8L * 1024 * 1024
  private const val MAX_DISPLAY_BYTES = 6 * 1024 * 1024 - 64

  private fun requestedCrop(location: JSONObject): DoubleArray? {
    if (location.isNull("crop")) return null
    val crop = location.getJSONObject("crop")
    return doubleArrayOf(crop.getDouble("x"), crop.getDouble("y"), crop.getDouble("width"), crop.getDouble("height"))
  }

  fun raster(location: JSONObject, checkCancelled: () -> Unit): OcrRaster {
    val file = File(location.getString("path"))
    check(file.isAbsolute && file.isFile && file.length() in 1..MAX_INPUT_BYTES) {
      "The registered OCR source is missing or exceeds 8 MiB."
    }
    checkCancelled()
    return when (location.getString("mimeType")) {
      "application/pdf" -> pdf(file, location.getInt("pageIndex"), requestedCrop(location), checkCancelled)
      "image/jpeg", "image/png", "image/webp", "image/gif" -> {
        check(location.isNull("pageIndex")) { "An image cannot select a PDF page." }
        image(file, requestedCrop(location), checkCancelled)
      }
      else -> error("The registered source is not a supported OCR image or PDF.")
    }
  }

  private fun checkedBitmap(bitmap: Bitmap) {
    check(bitmap.width in 1..OcrGeometry.MAX_SIDE && bitmap.height in 1..OcrGeometry.MAX_SIDE &&
      bitmap.width.toLong() * bitmap.height <= OcrGeometry.MAX_PIXELS &&
      bitmap.allocationByteCount <= OcrGeometry.MAX_PIXELS * 4) { "OCR raster exceeds its allocation limit." }
  }

  private fun image(file: File, crop: DoubleArray?, checkCancelled: () -> Unit): OcrRaster {
    val metadata = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, metadata)
    OcrGeometry.dimensions(metadata.outWidth, metadata.outHeight)
    if (metadata.outMimeType == "image/gif") {
      return gif(file, metadata.outWidth, metadata.outHeight, crop, checkCancelled)
    }
    val orientation = ExifInterface(file).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
      .let { if (it == ExifInterface.ORIENTATION_UNDEFINED) ExifInterface.ORIENTATION_NORMAL else it }
    check(orientation in 1..8) { "Unsupported EXIF orientation." }
    val width = if (orientation >= 5) metadata.outHeight else metadata.outWidth
    val height = if (orientation >= 5) metadata.outWidth else metadata.outHeight
    val bounds = OcrGeometry.crop(width, height, crop)
    val raw = OcrGeometry.rawCrop(bounds, metadata.outWidth, metadata.outHeight, orientation)
    checkCancelled()
    // Decode only the requested original-pixel rectangle, never a crop of a
    // previously downsampled page. BitmapRegionDecoder also works on API 26.
    // The boolean overload is deprecated on API 31 but required on API 26.
    val decoder = BitmapRegionDecoder.newInstance(file.absolutePath, false)
      ?: error("Cannot open the registered image decoder.")
    val decoded = try {
      decoder.decodeRegion(Rect(raw.left, raw.top, raw.right, raw.bottom), BitmapFactory.Options().apply {
        inSampleSize = OcrGeometry.sampleSize(raw)
        inPreferredConfig = Bitmap.Config.ARGB_8888
      }) ?: error("Cannot decode the registered image region.")
    } finally { decoder.recycle() }
    var upright: Bitmap? = null
    var published = false
    try {
      checkedBitmap(decoded)
      checkCancelled()
      // Build the exact EXIF affine matrix from three pixel-edge points.
      val matrix = Matrix()
      val corners = listOf(Pair(0.0, 0.0), Pair(decoded.width.toDouble(), 0.0), Pair(0.0, decoded.height.toDouble()))
      val source = corners.flatMap { listOf(it.first.toFloat(), it.second.toFloat()) }.toFloatArray()
      val target = corners.flatMap {
        val point = OcrGeometry.upright(it.first, it.second, decoded.width, decoded.height, orientation)
        listOf(point.first.toFloat(), point.second.toFloat())
      }.toFloatArray()
      check(matrix.setPolyToPoly(source, 0, target, 0, 3)) { "Cannot orient the registered image." }
      val oriented = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, false)
      upright = oriented
      checkedBitmap(oriented)
      checkCancelled()
      return OcrRaster(oriented, width, height, bounds, crop != null).also { published = true }
    } finally {
      // createBitmap may return the original for orientation 1.
      if (upright !== decoded) decoded.recycle()
      if (!published) upright?.recycle()
    }
  }

  private fun gif(file: File, width: Int, height: Int, crop: DoubleArray?,
    checkCancelled: () -> Unit): OcrRaster {
    // Region decoding is not available for GIF. Its static page is the first
    // frame, decoded under a stricter original-allocation bound. Crop original
    // pixels before scaling; never approximate a crop of a sampled full page.
    check(width.toLong() * height <= OcrGeometry.MAX_PIXELS) {
      "GIF original pixels exceed the bounded 16 MiB decode limit."
    }
    val bounds = OcrGeometry.crop(width, height, crop)
    checkCancelled()
    val original = BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply {
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }) ?: error("Cannot decode the registered GIF first frame.")
    var selected: Bitmap? = null
    try {
      check(original.width == width && original.height == height &&
        original.allocationByteCount <= OcrGeometry.MAX_PIXELS * 4) { "GIF decoded dimensions changed or exceed their bound." }
      checkCancelled()
      selected = Bitmap.createBitmap(original, bounds.left, bounds.top, bounds.width, bounds.height)
    } finally {
      if (selected !== original) original.recycle()
    }
    val physical = checkNotNull(selected)
    var raster: Bitmap? = null
    var published = false
    try {
      val (rasterWidth, rasterHeight) = OcrGeometry.rasterSize(bounds)
      raster = Bitmap.createScaledBitmap(physical, rasterWidth, rasterHeight, true)
      checkedBitmap(raster)
      checkCancelled()
      return OcrRaster(raster, width, height, bounds, crop != null).also { published = true }
    } finally {
      if (raster !== physical) physical.recycle()
      if (!published) raster?.recycle()
    }
  }

  private fun pdf(file: File, pageIndex: Int, crop: DoubleArray?, checkCancelled: () -> Unit): OcrRaster {
    ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { descriptor ->
      PdfRenderer(descriptor).use { renderer ->
        check(pageIndex in 0 until renderer.pageCount) { "Registered PDF page is unavailable." }
        renderer.openPage(pageIndex).use { page ->
          val bounds = OcrGeometry.crop(page.width, page.height, crop)
          val (width, height) = OcrGeometry.rasterSize(bounds)
          checkCancelled()
          val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
          try {
            checkedBitmap(bitmap)
            bitmap.eraseColor(Color.WHITE)
            val sx = width.toFloat() / bounds.width
            val sy = height.toFloat() / bounds.height
            val matrix = Matrix().apply {
              setValues(floatArrayOf(sx, 0f, -bounds.left * sx, 0f, sy, -bounds.top * sy, 0f, 0f, 1f))
            }
            page.render(bitmap, null, matrix, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            checkCancelled()
            return OcrRaster(bitmap, page.width, page.height, bounds, crop != null)
          } catch (error: Throwable) {
            bitmap.recycle()
            throw error
          }
        }
      }
    }
  }

  fun dataUri(raster: OcrRaster, checkCancelled: () -> Unit): String {
    val bytes = ByteArrayOutputStream()
    val bounded = object : OutputStream() {
      override fun write(value: Int) {
        checkCancelled()
        check(bytes.size() < MAX_DISPLAY_BYTES) { "Encoded image page exceeds its display bound." }
        bytes.write(value)
      }
      override fun write(buffer: ByteArray, offset: Int, count: Int) {
        checkCancelled()
        check(count <= MAX_DISPLAY_BYTES - bytes.size()) { "Encoded image page exceeds its display bound." }
        bytes.write(buffer, offset, count)
      }
    }
    check(raster.bitmap.compress(Bitmap.CompressFormat.PNG, 100, bounded)) { "Cannot encode the image page." }
    checkCancelled()
    return "data:image/png;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
  }
}
