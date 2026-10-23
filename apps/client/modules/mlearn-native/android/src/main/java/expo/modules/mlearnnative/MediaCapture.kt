package expo.modules.mlearnnative

import android.graphics.Bitmap
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

// All calls run on the module's single media lane, not the UI or a new pool.
internal class MediaCapture(private val root: File) {
  private companion object {
    const val MAX_MEDIA_BYTES = 128L * 1024 * 1024
    private const val MAX_SAMPLE_BYTES = 16 * 1024 * 1024
  }

  // PNG compression and provider copies must stop before writing an excess byte,
  // not after an unbounded temporary file has already consumed disk space.
  private class LimitedOutput(
    private val output: OutputStream,
    private val maximumBytes: Long = MAX_MEDIA_BYTES,
    private val checkCancelled: () -> Unit,
  ) : OutputStream() {
    private var written = 0L
    override fun write(value: Int) {
      checkCancelled()
      check(written < maximumBytes) { "Selected file exceeds its byte limit." }
      output.write(value)
      written++
    }
    override fun write(buffer: ByteArray, offset: Int, count: Int) {
      checkCancelled()
      check(count.toLong() <= maximumBytes - written) { "Selected file exceeds its byte limit." }
      output.write(buffer, offset, count)
      written += count
    }
  }

  private data class Job(val id: String, val cancelled: AtomicBoolean = AtomicBoolean(false))
  private var active: Job? = null
  private val outputs = mutableSetOf<String>()
  private var closed = false

  @Synchronized fun reserve(id: String) {
    check(!closed && active == null && outputs.size < 8) { "Media capture is busy; release pending files and retry." }
    active = Job(id)
  }
  @Synchronized private fun reservePick(name: String): String {
    check(!closed && outputs.size + (if (active == null) 0 else 1) < 8) { "Release pending media selections before picking more files." }
    check(name.isNotEmpty() && name.toByteArray(Charsets.UTF_8).size <= 255 &&
      name != "." && name != ".." && !name.contains('/') && !name.contains('\\') && !name.contains('\u0000')) { "Invalid selected media filename." }
    val directory = File(root, UUID.randomUUID().toString())
    check(directory.mkdirs()) { "Cannot create selected media directory." }
    return File(directory, name).absolutePath.also { outputs.add(it) }
  }
  fun copyPicked(name: String, openInput: () -> InputStream, checkCancelled: () -> Unit): String =
    copyPicked(name, openInput, MAX_MEDIA_BYTES, checkCancelled)

  fun copyPicked(name: String, openInput: () -> InputStream, maximumBytes: Long, checkCancelled: () -> Unit): String {
    val path = reservePick(name)
    var published = false
    try {
      val output = File(path)
      val checkCopy = {
        checkCancelled()
        synchronized(this) {
          check(!closed && outputs.contains(path)) { "Media selection cancelled." }
        }
      }
      openInput().use { input ->
        output.outputStream().use { stream ->
          val limited = LimitedOutput(stream, maximumBytes, checkCopy)
          val buffer = ByteArray(64 * 1024)
          var copied = 0L
          while (true) {
            checkCopy()
            // Read only one lookahead byte at the limit, including when the
            // provider omits or lies about its advertised content length.
            val count = input.read(buffer, 0, minOf(buffer.size.toLong(), maximumBytes - copied + 1).toInt())
            if (count < 0) break
            limited.write(buffer, 0, count)
            copied += count
          }
        }
      }
      synchronized(this) {
        checkCopy()
        check(output.length() in 1..maximumBytes) { "The selected file is empty or exceeds its byte limit." }
        published = true
      }
      return path
    } finally {
      if (!published) release(path)
    }
  }
  @Synchronized fun cancel(id: String) { active?.takeIf { it.id == id }?.cancelled?.set(true) }
  @Synchronized fun finish(id: String) {
    if (active?.id == id) active = null
    if (closed && active == null && root.exists() && !root.deleteRecursively()) {
      android.util.Log.e("MlearnNative", "Cannot release media owner root")
    }
  }
  @Synchronized fun check(id: String) {
    check(active?.let { it.id == id && !it.cancelled.get() } == true) { "Media capture cancelled." }
  }
  @Synchronized fun release(path: String) {
    if (outputs.contains(path)) {
      check(File(path).parentFile?.deleteRecursively() == true) { "Cannot release captured media." }
      outputs.remove(path)
    }
  }
  @Synchronized fun close() {
    closed = true
    active?.cancelled?.set(true)
    outputs.forEach { path ->
      if (File(path).exists() && File(path).parentFile?.deleteRecursively() != true) {
        android.util.Log.e("MlearnNative", "Cannot release captured media on destruction")
      }
    }
    outputs.clear()
    if (active == null && root.exists() && !root.deleteRecursively()) {
      android.util.Log.e("MlearnNative", "Cannot release media owner root")
    }
  }

  fun capture(id: String, plan: JSONObject): String {
    check(id)
    val directory = File(root, UUID.randomUUID().toString())
    check(directory.mkdirs()) { "Cannot create capture directory." }
    var published = false
    try {
      val kind = plan.getString("kind")
      val path = plan.getString("path")
      val startUs = plan.getLong("startMs") * 1000L
      val endUs = plan.getLong("endMs") * 1000L
      var actualStart = startUs
      var actualEnd = endUs
      val output: File
      if (kind == "image") {
        output = File(directory, "frame.png")
        val retriever = MediaMetadataRetriever()
        try {
          retriever.setDataSource(path)
          // Resolve an actual video sample timestamp before requesting its decoded
          // frame; do not label a closest-sync frame as an exact arbitrary time.
          val extractor = MediaExtractor()
          try {
            extractor.setDataSource(path)
            val track = (0 until extractor.trackCount).firstOrNull {
              extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true
            } ?: error("The source has no video track.")
            extractor.selectTrack(track)
            extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
            var timestamp = extractor.sampleTime
            var scannedBytes = 0L
            check(timestamp >= 0) { "No frame exists at this position." }
            while (extractor.sampleTime in 0 until startUs) {
              check(id)
              val sampleSize = extractor.sampleSize
              check(sampleSize in 1..MAX_SAMPLE_BYTES.toLong() &&
                sampleSize + 64 <= MAX_MEDIA_BYTES - scannedBytes) {
                "The frame search exceeds the bounded capture work limit."
              }
              scannedBytes += sampleSize + 64
              timestamp = extractor.sampleTime
              if (!extractor.advance()) break
            }
            if (extractor.sampleTime >= 0) timestamp = extractor.sampleTime
            val width = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toLongOrNull() ?: 0
            val height = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toLongOrNull() ?: 0
            // Allow at most 128 MiB even for an eight-byte-per-pixel decoded frame.
            // Check metadata before asking the platform to allocate the bitmap.
            check(width > 0 && height > 0 && width <= MAX_MEDIA_BYTES / 8 / height) {
              "The decoded frame exceeds the 128 MiB capture limit or has no dimensions."
            }
            check(id)
            val bitmap = retriever.getFrameAtTime(timestamp, MediaMetadataRetriever.OPTION_CLOSEST)
              ?: error("Cannot decode the selected frame.")
            try {
              check(bitmap.allocationByteCount.toLong() <= MAX_MEDIA_BYTES) { "The decoded frame exceeds the 128 MiB capture limit." }
              output.outputStream().use { stream ->
                check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, LimitedOutput(stream) { check(id) })) {
                  "Cannot encode the captured frame."
                }
              }
            } finally { bitmap.recycle() }
            actualStart = timestamp
            actualEnd = timestamp
          } finally { extractor.release() }
        } finally { retriever.release() }
      } else {
        check(kind == "audio" || kind == "video") { "Unsupported capture kind." }
        check(endUs > startUs) { "A clip must have a positive duration." }
        output = File(directory, if (kind == "audio") "audio.m4a" else "video.mp4")
        val extractor = MediaExtractor()
        var muxer: MediaMuxer? = null
        try {
          extractor.setDataSource(path)
          val tracks = mutableMapOf<Int, Int>()
          var video = false
          val writer = MediaMuxer(output.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
          muxer = writer
          for (index in 0 until extractor.trackCount) {
            val format = extractor.getTrackFormat(index)
            val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
            if (mime.startsWith("audio/") || (kind == "video" && mime.startsWith("video/"))) {
              video = video || mime.startsWith("video/")
              tracks[index] = writer.addTrack(format)
              extractor.selectTrack(index)
            }
          }
          check(tracks.isNotEmpty() && (kind != "video" || video)) { "The requested media track is unavailable." }
          // Remux begins at a real sync/sample boundary. Report that boundary,
          // including any pre-roll, instead of pretending arbitrary trim is exact.
          extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
          actualStart = extractor.sampleTime
          check(actualStart >= 0 && actualStart < endUs) { "No samples exist in the selected range." }
          // Reject a known oversized selection before reading samples or writing
          // payload. Keep the same checks during writing in case the source changes.
          var plannedBytes = 1024L * 1024
          while (extractor.sampleTime >= 0 && extractor.sampleTime < endUs) {
            check(id)
            val sampleSize = extractor.sampleSize
            check(sampleSize in 1..MAX_SAMPLE_BYTES.toLong() &&
              sampleSize + 64 <= MAX_MEDIA_BYTES - plannedBytes) {
              "The capture exceeds the 128 MiB limit or its sample limit."
            }
            plannedBytes += sampleSize + 64
            if (!extractor.advance()) break
          }
          // Replay the original seek: the first interleaved sample timestamp
          // can select an earlier audio sample when used as a new seek target.
          extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)
          check(extractor.sampleTime == actualStart) { "The media source changed during capture." }
          // Retain rotation metadata for ordinary phone videos.
          val metadata = MediaMetadataRetriever()
          try {
            metadata.setDataSource(path)
            metadata.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull()?.let {
              if (video) writer.setOrientationHint(it)
            }
          } finally { metadata.release() }
          writer.start()
          val buffer = ByteBuffer.allocateDirect(MAX_SAMPLE_BYTES)
          val info = MediaCodec.BufferInfo()
          val lastTimes = mutableMapOf<Int, Long>()
          val previousTimes = mutableMapOf<Int, Long>()
          var samples = 0
          // Reserve container header space and per-sample table work as well as
          // encoded payload. Finalized container bytes are checked independently.
          var muxedBytes = 1024L * 1024
          while (extractor.sampleTime >= 0 && extractor.sampleTime < endUs) {
            check(id)
            val time = extractor.sampleTime
            buffer.clear()
            val sampleSize = extractor.sampleSize
            check(sampleSize in 1..buffer.capacity().toLong()) { "A media sample is empty or exceeds the 16 MiB capture limit." }
            check(sampleSize + 64 <= MAX_MEDIA_BYTES - muxedBytes) { "The capture exceeds the 128 MiB limit." }
            val count = extractor.readSampleData(buffer, 0)
            if (count < 0) break
            check(count.toLong() == sampleSize) { "The media sample size changed during capture." }
            muxedBytes += sampleSize + 64
            check((extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_ENCRYPTED) == 0) { "Encrypted media cannot be captured." }
            val destination = tracks[extractor.sampleTrackIndex] ?: error("Unexpected media track.")
            info.set(0, count, time - actualStart,
              if ((extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC) != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
            writer.writeSampleData(destination, buffer, info)
            check(output.length() <= MAX_MEDIA_BYTES) { "The capture exceeds the 128 MiB limit." }
            val latest = lastTimes[destination]
            if (latest == null || time > latest) {
              if (latest != null) previousTimes[destination] = latest
              lastTimes[destination] = time
            } else if (time < latest && time > (previousTimes[destination] ?: Long.MIN_VALUE)) {
              previousTimes[destination] = time
            }
            samples++
            if (!extractor.advance()) break
          }
          check(samples > 0) { "The selected range contains no media samples." }
          // MediaMuxer's explicit empty EOS sample controls the final sample's
          // duration. Preserve its ordinary preceding interval, but trim at the
          // requested boundary rather than retaining an AAC packet past EOF.
          for ((destination, last) in lastTimes) {
            check(id)
            val preceding = previousTimes[destination]
            val sourceTrack = tracks.entries.first { it.value == destination }.key
            val naturalEnd = if (preceding != null) last + (last - preceding)
              else extractor.getTrackFormat(sourceTrack).getLong(MediaFormat.KEY_DURATION)
            val finalTime = minOf(endUs, naturalEnd)
            check(finalTime > last) { "Cannot resolve the last captured sample duration." }
            info.set(0, 0, finalTime - actualStart, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            writer.writeSampleData(destination, ByteBuffer.allocate(0), info)
          }
          writer.stop()
          check(output.length() in 1..MAX_MEDIA_BYTES) { "The capture is empty or exceeds the 128 MiB limit." }
        } finally {
          // release() closes an unfinished muxer too; partial output is removed below.
          try { muxer?.release() } finally { extractor.release() }
        }
      }
      if (kind != "image") {
        val produced = MediaExtractor()
        try {
          produced.setDataSource(output.absolutePath)
          // Keep muxed duration and source offset in microseconds until the final
          // conversion. Adding rounded milliseconds can extend an EOF origin
          // beyond its canonical source duration.
          val durationUs = (0 until produced.trackCount).maxOfOrNull {
            produced.getTrackFormat(it).getLong(MediaFormat.KEY_DURATION)
          }
            ?: error("Cannot read the produced clip duration.")
          check(durationUs > 0) { "The produced clip has no duration." }
          actualEnd = actualStart + durationUs
        } finally { produced.release() }
      }
      check(id)
      check(output.length() in 1..MAX_MEDIA_BYTES) { "The provider produced an empty file or exceeded the 128 MiB limit." }
      val startMs = (actualStart + 500L) / 1000L
      val endMs = if (kind == "image") startMs else (actualEnd + 500L) / 1000L
      android.util.Log.i("MlearnMedia",
        "capture kind=$kind start_us=$actualStart end_us=$actualEnd requested_end_us=$endUs start_ms=$startMs end_ms=$endMs")
      val result = JSONObject().put("path", output.absolutePath).put("name", output.name).put("kind", kind)
        .put("segment", JSONObject().put("sourceId", plan.getString("sourceId"))
          .put("contentRevision", plan.getString("contentRevision"))
          .put("startMs", startMs).put("endMs", endMs))
      synchronized(this) {
        check(id)
        outputs.add(output.absolutePath)
        published = true
      }
      return result.toString()
    } finally {
      if (!published && !directory.deleteRecursively()) {
        android.util.Log.e("MlearnNative", "Cannot remove partial media capture")
      }
      synchronized(this) {
        finish(id)
        if (closed && root.exists() && !root.deleteRecursively()) {
          android.util.Log.e("MlearnNative", "Cannot release media owner root")
        }
      }
    }
  }
}
