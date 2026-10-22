import AVFoundation
import Foundation
import ImageIO
import UniformTypeIdentifiers

// This source is compiled into both the Expo module and the bundled macOS helper.
struct MediaCapturePlan: Codable {
  let sourceId: String
  let contentRevision: String
  let path: String
  let kind: String
  let startMs: UInt32
  let endMs: UInt32
}

struct CapturedMediaFile: Codable {
  struct Segment: Codable {
    let sourceId: String
    let contentRevision: String
    let startMs: UInt32
    let endMs: UInt32
  }
  let path: String
  let kind: String
  let name: String
  let segment: Segment
}

enum MediaProviderError: LocalizedError {
  case failed(String)
  var errorDescription: String? {
    switch self { case .failed(let message): return message }
  }
}

final class MediaExtractionJob: @unchecked Sendable {
  private let lock = NSLock()
  private var cancelled = false
  private var cancelWork: (() -> Void)?

  func check() throws {
    lock.lock()
    defer { lock.unlock() }
    if cancelled { throw CancellationError() }
  }

  func installCancellation(_ work: (() -> Void)?) throws {
    lock.lock()
    let stopped = cancelled
    if !stopped { cancelWork = work }
    lock.unlock()
    if stopped { work?(); throw CancellationError() }
  }

  func cancel() {
    lock.lock()
    cancelled = true
    let work = cancelWork
    lock.unlock()
    work?()
  }
}

enum AppleMediaProvider {
  static let maximumBytes: UInt64 = 128 * 1024 * 1024

  static func validateFile(_ url: URL) throws {
    let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
    guard let size = attributes[.size] as? NSNumber, size.uint64Value > 0 else {
      throw MediaProviderError.failed("The provider produced an empty file.")
    }
    guard size.uint64Value <= maximumBytes else {
      throw MediaProviderError.failed("Media exceeds the 128 MiB limit.")
    }
  }

  // Check the opened file before creating a copy, then bound each write as well:
  // provider metadata can be stale and the source can grow during the read.
  static func copyMedia(from source: URL, to destination: URL) throws {
    let input = try FileHandle(forReadingFrom: source)
    defer { do { try input.close() } catch { NSLog("Media input close failed: %@", error.localizedDescription) } }
    let size = try input.seekToEnd()
    guard size > 0, size <= maximumBytes else {
      throw MediaProviderError.failed("Selected media must be nonempty and at most 128 MiB.")
    }
    try input.seek(toOffset: 0)
    guard FileManager.default.createFile(atPath: destination.path, contents: nil) else {
      throw MediaProviderError.failed("Cannot create selected media copy.")
    }
    var complete = false
    defer {
      if !complete {
        do { try FileManager.default.removeItem(at: destination) }
        catch { NSLog("Media copy cleanup failed: %@", error.localizedDescription) }
      }
    }
    let output = try FileHandle(forWritingTo: destination)
    defer { do { try output.close() } catch { NSLog("Media output close failed: %@", error.localizedDescription) } }
    var written: UInt64 = 0
    while let data = try input.read(upToCount: 64 * 1024), !data.isEmpty {
      guard UInt64(data.count) <= maximumBytes - written else {
        throw MediaProviderError.failed("Selected media exceeds the 128 MiB limit.")
      }
      try output.write(contentsOf: data)
      written += UInt64(data.count)
    }
    try validateFile(destination)
    complete = true
  }

  // ImageIO's URL sink has no byte limit. Its consumer callback lets us refuse
  // the write that would cross the cap, including during PNG finalization.
  private final class ImageOutput {
    let handle: FileHandle
    let job: MediaExtractionJob
    var written: UInt64 = 0
    var failure: Error?

    init(url: URL, job: MediaExtractionJob) throws {
      guard FileManager.default.createFile(atPath: url.path, contents: nil) else {
        throw MediaProviderError.failed("Cannot create captured image.")
      }
      handle = try FileHandle(forWritingTo: url)
      self.job = job
    }

    func write(_ buffer: UnsafeRawPointer, count: Int) -> Int {
      guard failure == nil else { return 0 }
      do {
        try job.check()
        guard UInt64(count) <= maximumBytes - written else {
          throw MediaProviderError.failed("Captured image exceeds the 128 MiB limit.")
        }
        try handle.write(contentsOf: Data(bytes: buffer, count: count))
        written += UInt64(count)
        return count
      } catch {
        failure = error
        return 0
      }
    }
  }

  @available(macOS, introduced: 10.13, deprecated: 15)
  @available(iOS, introduced: 12, deprecated: 18)
  private static func legacyExport(_ exporter: AVAssetExportSession, output: URL, audio: Bool, job: MediaExtractionJob) async throws {
    exporter.outputURL = output
    exporter.outputFileType = audio ? .m4a : .mp4
    try job.installCancellation { exporter.cancelExport() }
    await withCheckedContinuation { continuation in
      exporter.exportAsynchronously { continuation.resume() }
    }
    try job.check()
    guard exporter.status == .completed else {
      throw exporter.error ?? MediaProviderError.failed("Media export did not complete.")
    }
  }

  static func capture(plan: MediaCapturePlan, directory: URL, job: MediaExtractionJob) async throws -> CapturedMediaFile {
    try job.check()
    let asset = AVURLAsset(url: URL(fileURLWithPath: plan.path))
    let start = CMTime(value: Int64(plan.startMs), timescale: 1000)
    let end = CMTime(value: Int64(plan.endMs), timescale: 1000)
    let duration = try await asset.load(.duration)
    guard duration.isNumeric, start >= .zero, start <= duration,
          end >= start, end <= duration else {
      throw MediaProviderError.failed("Capture range is outside the current media duration.")
    }
    try job.check()
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    var published = false
    defer {
      if !published {
        do { try FileManager.default.removeItem(at: directory) }
        catch { NSLog("Media capture cleanup failed: %@", error.localizedDescription) }
      }
    }
    let output: URL
    let actualStart: CMTime
    let actualEnd: CMTime
    switch plan.kind {
    case "image":
      output = directory.appendingPathComponent("frame.png")
      let generator = AVAssetImageGenerator(asset: asset)
      generator.appliesPreferredTrackTransform = true
      generator.requestedTimeToleranceBefore = .zero
      generator.requestedTimeToleranceAfter = .zero
      try job.installCancellation { generator.cancelAllCGImageGeneration() }
      let result = try await generator.image(at: start)
      try job.check()
      let sink = try ImageOutput(url: output, job: job)
      defer { do { try sink.handle.close() } catch { NSLog("Image output close failed: %@", error.localizedDescription) } }
      var callbacks = CGDataConsumerCallbacks(putBytes: { info, buffer, count in
        guard let info else { return 0 }
        return Unmanaged<ImageOutput>.fromOpaque(info).takeUnretainedValue().write(buffer, count: count)
      }, releaseConsumer: nil)
      guard let consumer = CGDataConsumer(info: Unmanaged.passUnretained(sink).toOpaque(), cbks: &callbacks),
            let destination = CGImageDestinationCreateWithDataConsumer(consumer, UTType.png.identifier as CFString, 1, nil) else {
        throw MediaProviderError.failed("Cannot create captured image.")
      }
      CGImageDestinationAddImage(destination, result.image, nil)
      let finalized = CGImageDestinationFinalize(destination)
      if let failure = sink.failure { throw failure }
      guard finalized else {
        throw MediaProviderError.failed("Cannot encode captured image.")
      }
      actualStart = result.actualTime
      actualEnd = result.actualTime
    case "audio", "video":
      guard end > start else { throw MediaProviderError.failed("A clip must have a positive duration.") }
      let audio = plan.kind == "audio"
      if audio {
        let tracks = try await asset.loadTracks(withMediaType: .audio)
        if tracks.isEmpty { throw MediaProviderError.failed("The source has no audio track.") }
      }
      output = directory.appendingPathComponent(audio ? "audio.m4a" : "video.mp4")
      guard let exporter = AVAssetExportSession(asset: asset, presetName: audio ? AVAssetExportPresetAppleM4A : AVAssetExportPresetHighestQuality) else {
        throw MediaProviderError.failed("This source does not support the requested export.")
      }
      exporter.timeRange = CMTimeRange(start: start, end: end)
      // Apple's native limit can slightly overrun; validate the actual bytes
      // below too. Never shorten timeRange to fit a requested clip into the cap.
      exporter.fileLengthLimit = Int64(maximumBytes)
      exporter.directoryForTemporaryFiles = directory
      if #available(macOS 15, iOS 18, *) {
        let task = Task { try await exporter.export(to: output, as: audio ? .m4a : .mp4) }
        try job.installCancellation { task.cancel() }
        try await task.value
      } else {
        try await legacyExport(exporter, output: output, audio: audio, job: job)
      }
      // Reopen the produced file; never report the requested range for a whole-file copy.
      let produced = AVURLAsset(url: output)
      let producedDuration = try await produced.load(.duration)
      guard producedDuration.isNumeric, producedDuration > .zero else {
        throw MediaProviderError.failed("The exported clip contains no duration.")
      }
      guard CMTimeConvertScale(producedDuration, timescale: 1000, method: .roundHalfAwayFromZero) >= end - start else {
        throw MediaProviderError.failed("The export did not contain the complete requested clip.")
      }
      actualStart = start
      actualEnd = start + producedDuration
    default:
      throw MediaProviderError.failed("Unsupported capture kind.")
    }
    try job.installCancellation(nil)
    try job.check()
    try validateFile(output)
    func milliseconds(_ time: CMTime) throws -> UInt32 {
      let value = CMTimeGetSeconds(time) * 1000
      guard value.isFinite, value >= 0, value <= Double(UInt32.max) else {
        throw MediaProviderError.failed("The provider returned an invalid timestamp.")
      }
      return UInt32(value.rounded())
    }
    let result = CapturedMediaFile(path: output.path, kind: plan.kind, name: output.lastPathComponent,
      segment: .init(sourceId: plan.sourceId, contentRevision: plan.contentRevision,
        startMs: try milliseconds(actualStart), endMs: try milliseconds(actualEnd)))
    try job.check()
    published = true
    return result
  }
}
