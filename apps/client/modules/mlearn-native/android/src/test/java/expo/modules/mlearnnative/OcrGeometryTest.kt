package expo.modules.mlearnnative

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class OcrGeometryTest {
  @Test fun physicalCropRoundsOutwardBeforeMappingActualCorners() {
    // Given a crop which cuts across original pixel boundaries.
    val bounds = OcrGeometry.crop(101, 79, doubleArrayOf(0.101, 0.203, 0.3, 0.4))
    // When an SDK corner (including an out-of-image one) is mapped back.
    val first = OcrGeometry.sourcePoint(0, 0, 31, 32, bounds, 101, 79)
    val outside = OcrGeometry.sourcePoint(32, -1, 31, 32, bounds, 101, 79)
    // Then exact physical bounds are preserved; raw evidence is not clipped.
    assertEquals(OcrBounds(10, 16, 41, 48), bounds)
    assertEquals(10.0 / 101, first.first, 1e-12)
    assertEquals(16.0 / 79, first.second, 1e-12)
    assertEquals(42.0 / 101, outside.first, 1e-12)
    assertEquals(15.0 / 79, outside.second, 1e-12)
  }

  @Test fun allExifOrientationsMapPhysicalCropBackToOriginalPixels() {
    // Given a non-square original and an asymmetric upright crop.
    val expected = listOf(
      OcrBounds(10, 20, 40, 60), OcrBounds(160, 20, 190, 60),
      OcrBounds(160, 40, 190, 80), OcrBounds(10, 40, 40, 80),
      OcrBounds(20, 10, 60, 40), OcrBounds(20, 60, 60, 90),
      OcrBounds(140, 60, 180, 90), OcrBounds(140, 10, 180, 40),
    )
    for (orientation in 1..8) {
      val uprightCrop = OcrBounds(10, 20, 40, 60)
      // When converting crop bounds through the inverse EXIF transform.
      val raw = OcrGeometry.rawCrop(uprightCrop, 200, 100, orientation)
      // Then only the original pixels in that region are selected.
      assertEquals("EXIF $orientation", expected[orientation - 1], raw)
      val points = listOf(Pair(raw.left, raw.top), Pair(raw.right, raw.top),
        Pair(raw.right, raw.bottom), Pair(raw.left, raw.bottom)).map {
        OcrGeometry.upright(it.first.toDouble(), it.second.toDouble(), 200, 100, orientation)
      }
      assertEquals(10.0, points.minOf { it.first }, 0.0)
      assertEquals(20.0, points.minOf { it.second }, 0.0)
      assertEquals(40.0, points.maxOf { it.first }, 0.0)
      assertEquals(60.0, points.maxOf { it.second }, 0.0)
    }
  }

  @Test fun decodeAndPdfRastersRemainBoundedForOddAndExtremeAspectRatios() {
    // Given the largest admitted edges and odd dimensions.
    for ((width, height) in listOf(Pair(32768, 1), Pair(1, 32768), Pair(4097, 4095), Pair(2049, 2049))) {
      val bounds = OcrGeometry.crop(width, height, null)
      // When selecting sampled image and PDF raster dimensions.
      val sample = OcrGeometry.sampleSize(bounds)
      val (rasterWidth, rasterHeight) = OcrGeometry.rasterSize(bounds)
      // Then allocation is bounded before the platform decoder is called.
      assertTrue((width + sample - 1) / sample <= 2048)
      assertTrue((height + sample - 1) / sample <= 2048)
      assertTrue(rasterWidth in 1..2048 && rasterHeight in 1..2048)
      assertTrue(rasterWidth.toLong() * rasterHeight <= 4_194_304)
    }
  }

  @Test fun invalidAndExcessiveSourcesFailRatherThanTruncate() {
    // Given unsupported dimensions and invalid normalized crops.
    val invalid = listOf(
      doubleArrayOf(Double.NaN, 0.0, 0.5, 0.5), doubleArrayOf(0.9, 0.0, 0.2, 0.5),
      doubleArrayOf(0.0, -0.1, 0.5, 0.5), doubleArrayOf(0.0, 0.0, 0.0, 0.5),
    )
    // When validating before allocation, then each fails explicitly.
    assertThrows(IllegalArgumentException::class.java) { OcrGeometry.dimensions(32769, 1) }
    assertThrows(IllegalArgumentException::class.java) { OcrGeometry.dimensions(32768, 32768) }
    assertThrows(IllegalArgumentException::class.java) { OcrGeometry.dimensions(0, 1) }
    invalid.forEach { rect ->
      assertThrows(IllegalArgumentException::class.java) { OcrGeometry.crop(100, 100, rect) }
    }
  }
}
