package expo.modules.mlearnnative

import kotlin.math.ceil
import kotlin.math.floor

// Integer source-space crops are selected before sampling. The same transform
// maps real SDK corners back, including corners outside the inference bitmap.
internal data class OcrBounds(val left: Int, val top: Int, val right: Int, val bottom: Int) {
  val width get() = right - left
  val height get() = bottom - top
}

internal object OcrGeometry {
  const val MAX_SIDE = 2048
  const val MAX_PIXELS = 4_194_304
  const val MAX_SOURCE_SIDE = 32768
  const val MAX_SOURCE_PIXELS = 268_435_456L

  fun dimensions(width: Int, height: Int) {
    require(width in 1..MAX_SOURCE_SIDE && height in 1..MAX_SOURCE_SIDE &&
      width.toLong() * height <= MAX_SOURCE_PIXELS) { "Source dimensions exceed the bounded OCR limit." }
  }

  fun crop(width: Int, height: Int, rect: DoubleArray?): OcrBounds {
    dimensions(width, height)
    if (rect == null) return OcrBounds(0, 0, width, height)
    require(rect.size == 4 && rect.all { it.isFinite() } &&
      rect[0] >= 0 && rect[1] >= 0 && rect[2] > 0 && rect[3] > 0 &&
      rect[0] + rect[2] <= 1 && rect[1] + rect[3] <= 1) { "Invalid normalized OCR crop." }
    return OcrBounds(
      floor(rect[0] * width).toInt(), floor(rect[1] * height).toInt(),
      ceil((rect[0] + rect[2]) * width).toInt().coerceAtMost(width),
      ceil((rect[1] + rect[3]) * height).toInt().coerceAtMost(height),
    )
  }

  fun rasterSize(bounds: OcrBounds): Pair<Int, Int> {
    val scale = minOf(1.0, MAX_SIDE.toDouble() / maxOf(bounds.width, bounds.height))
    return Pair(maxOf(1, floor(bounds.width * scale).toInt()), maxOf(1, floor(bounds.height * scale).toInt()))
  }

  fun sampleSize(bounds: OcrBounds): Int {
    var sample = 1
    while ((bounds.width + sample - 1) / sample > MAX_SIDE ||
      (bounds.height + sample - 1) / sample > MAX_SIDE) sample *= 2
    return sample
  }

  // EXIF orientations 1..8; coordinates describe pixel edges, not centers.
  fun upright(x: Double, y: Double, width: Int, height: Int, orientation: Int): Pair<Double, Double> =
    when (orientation) {
      1 -> Pair(x, y)
      2 -> Pair(width - x, y)
      3 -> Pair(width - x, height - y)
      4 -> Pair(x, height - y)
      5 -> Pair(y, x)
      6 -> Pair(height - y, x)
      7 -> Pair(height - y, width - x)
      8 -> Pair(y, width - x)
      else -> error("Unsupported EXIF orientation.")
    }

  fun rawCrop(bounds: OcrBounds, width: Int, height: Int, orientation: Int): OcrBounds {
    val inverse = when (orientation) { 6 -> 8; 8 -> 6; else -> orientation }
    val swapped = orientation >= 5
    val points = listOf(
      Pair(bounds.left, bounds.top), Pair(bounds.right, bounds.top),
      Pair(bounds.right, bounds.bottom), Pair(bounds.left, bounds.bottom),
    ).map { upright(it.first.toDouble(), it.second.toDouble(),
      if (swapped) height else width, if (swapped) width else height, inverse) }
    return OcrBounds(points.minOf { it.first }.toInt(), points.minOf { it.second }.toInt(),
      points.maxOf { it.first }.toInt(), points.maxOf { it.second }.toInt())
  }

  fun sourcePoint(x: Int, y: Int, bitmapWidth: Int, bitmapHeight: Int,
    bounds: OcrBounds, width: Int, height: Int): Pair<Double, Double> =
    Pair((bounds.left + x.toDouble() * bounds.width / bitmapWidth) / width,
      (bounds.top + y.toDouble() * bounds.height / bitmapHeight) / height)
}
