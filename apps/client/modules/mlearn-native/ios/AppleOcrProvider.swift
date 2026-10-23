import Foundation
import CoreGraphics
import ImageIO
import Vision

// Shared with the signed macOS helper. These host wire values mirror Rust's OCR
// contract; admission, source revisions, persistence and annotation semantics stay in Rust.
struct AppleOcrPoint: Codable, Sendable { let x: Double; let y: Double }
struct AppleOcrQuad: Encodable, Sendable {
  let topLeft: AppleOcrPoint
  let topRight: AppleOcrPoint
  let bottomRight: AppleOcrPoint
  let bottomLeft: AppleOcrPoint
}
struct AppleOcrRect: Codable, Equatable, Sendable {
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}
struct AppleOcrRequest: Decodable {
  let requestId: String
  let sourceId: String
  let contentRevision: String
  let resourceId: String
  let providerId: String
  let recognitionLanguages: [String]
  let crop: AppleOcrRect?
}
struct AppleOcrPlan: Decodable, Sendable {
  let requestId: String
  let sourceId: String
  let contentRevision: String
  let resourceId: String
  let path: String
  let mimeType: String
  let pageIndex: Int?
  let crop: AppleOcrRect?
  let providerId: String
  let recognitionLanguages: [String]
}
struct AppleImagePageLocation: Decodable, Sendable {
  let sourceId: String
  let contentRevision: String
  let resourceId: String
  let path: String
  let mimeType: String
  let pageIndex: Int?
}
struct AppleOcrProviderInfo: Encodable, Sendable {
  let id: String
  let label: String
  let revision: String
  let availability: String
  let languages: [String]
  let scripts: [String]
  let languageProvenance: String
  let reason: String?

  enum CodingKeys: String, CodingKey {
    case id, label, revision, availability, languages, scripts, languageProvenance, reason
  }
  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(id, forKey: .id); try c.encode(label, forKey: .label)
    try c.encode(revision, forKey: .revision); try c.encode(availability, forKey: .availability)
    try c.encode(languages, forKey: .languages); try c.encode(scripts, forKey: .scripts)
    try c.encode(languageProvenance, forKey: .languageProvenance); try c.encode(reason, forKey: .reason)
  }
}
struct AppleOcrCandidate: Encodable, Sendable { let text: String; let confidence: Double }
struct AppleOcrRegion: Encodable, Sendable {
  let id: String
  let text: String
  let quad: AppleOcrQuad
  let candidates: [AppleOcrCandidate]
  let language: String?
  let orientation: String?
  // Native OCR does not guess publisher-reading relationships.
  enum CodingKeys: String, CodingKey { case id, text, quad, candidates, language, orientation, readingOf }
  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(id, forKey: .id); try c.encode(text, forKey: .text)
    try c.encode(quad, forKey: .quad); try c.encode(candidates, forKey: .candidates)
    try c.encode(language, forKey: .language); try c.encode(orientation, forKey: .orientation)
    try c.encodeNil(forKey: .readingOf)
  }
}
struct AppleOcrNativeResult: Encodable, Sendable {
  let requestId: String
  let provider: AppleOcrProviderInfo
  let width: Int
  let height: Int
  let crop: AppleOcrRect?
  let regions: [AppleOcrRegion]
  enum CodingKeys: String, CodingKey { case requestId, provider, width, height, crop, regions }
  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(requestId, forKey: .requestId); try c.encode(provider, forKey: .provider)
    try c.encode(width, forKey: .width); try c.encode(height, forKey: .height)
    try c.encode(crop, forKey: .crop); try c.encode(regions, forKey: .regions)
  }
}
enum OcrProviderError: LocalizedError {
  case unavailable(String), unsupportedLanguages([String]), limit(String), failed(String), busy
  var errorDescription: String? {
    switch self {
    case .unavailable(let reason): return "OCR unavailable: \(reason)"
    case .unsupportedLanguages(let languages): return "Unsupported OCR languages: \(languages.joined(separator: ", "))"
    case .limit(let reason): return "OCR resource limit: \(reason)"
    case .failed(let reason): return "OCR failed: \(reason)"
    case .busy: return "OCR is busy or the module has closed."
    }
  }
}

final class OcrRecognitionJob: @unchecked Sendable {
  private let lock = NSLock()
  private var cancelled = false
  private var cancelWork: (() -> Void)?

  func check() throws {
    lock.lock(); defer { lock.unlock() }
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
    cancelWork = nil
    lock.unlock()
    work?()
  }
  // Cancellation and a completed result's storage action have one linearization
  // point. No inference/decoding is done under this short publication lock.
  func publish<T>(_ action: () throws -> T) throws -> T {
    lock.lock(); defer { lock.unlock() }
    if cancelled { throw CancellationError() }
    return try action()
  }
}

enum AppleOcrProvider {
  static let modernId = "apple.vision.text"
  static let legacyId = "apple.vision.legacy"
  static let maximumSourceBytes = 8 * 1024 * 1024
  static let maximumRasterSide = 2048
  static let maximumSourcePixels = 16_777_216
  static let maximumDisplayCharacters = 8 * 1024 * 1024

  private static func info(id: String, languages: [String], reason: String? = nil) -> AppleOcrProviderInfo {
    AppleOcrProviderInfo(id: id, label: id == modernId ? "Apple Vision" : "Apple Vision (legacy)",
      revision: "\(id)-revision3/\(ProcessInfo.processInfo.operatingSystemVersionString)",
      availability: reason == nil ? "ready" : "unavailable", languages: languages, scripts: [],
      languageProvenance: "Executing Vision accurate request supportedRecognitionLanguages", reason: reason)
  }
  @available(macOS 15, iOS 18, *)
  private static func modern(_ languages: [String]) -> RecognizeTextRequest {
    var request = RecognizeTextRequest(.revision3)
    request.recognitionLevel = .accurate
    request.minimumTextHeightFraction = 0
    request.automaticallyDetectsLanguage = true
    request.usesLanguageCorrection = true
    if !languages.isEmpty { request.recognitionLanguages = languages.map { Locale.Language(identifier: $0) } }
    return request
  }
  @available(macOS 13, iOS 16, *)
  private static func legacy(_ languages: [String]) -> VNRecognizeTextRequest {
    let request = VNRecognizeTextRequest()
    request.revision = VNRecognizeTextRequestRevision3
    request.recognitionLevel = .accurate
    request.minimumTextHeight = 0
    request.automaticallyDetectsLanguage = true
    request.usesLanguageCorrection = true
    if !languages.isEmpty { request.recognitionLanguages = languages }
    return request
  }
  static func providers() throws -> [AppleOcrProviderInfo] {
    var result: [AppleOcrProviderInfo] = []
    if #available(macOS 15, iOS 18, *) {
      result.append(info(id: modernId, languages: modern([]).supportedRecognitionLanguages.map { $0.minimalIdentifier }))
    } else {
      result.append(info(id: modernId, languages: [], reason: "Requires iOS 18 or macOS 15."))
    }
    if #available(macOS 13, iOS 16, *) {
      do { result.append(info(id: legacyId, languages: try legacy([]).supportedRecognitionLanguages())) }
      catch { result.append(info(id: legacyId, languages: [], reason: error.localizedDescription)) }
    } else {
      result.append(info(id: legacyId, languages: [], reason: "Requires iOS 16 or macOS 13 for revision 3."))
    }
    return result
  }
  private static func validateLanguages(_ requested: [String], supported: [String]) throws {
    guard requested.count <= 16, requested.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 64 }) else {
      throw OcrProviderError.limit("At most 16 bounded language identifiers are allowed.")
    }
    // Completion validates exact advertised identifiers in Rust. Accepting only
    // a locale alias here would recognize successfully but fail to persist.
    let available = Set(supported)
    let unsupported = requested.filter { !available.contains($0) }
    if !unsupported.isEmpty { throw OcrProviderError.unsupportedLanguages(unsupported) }
  }

  // The owner keeps this task/bitmap alive until native execution actually returns,
  // even when cancellation was requested. A cancelled task never publishes.
  static func recognize(plan: AppleOcrPlan, job: OcrRecognitionJob) async throws -> AppleOcrNativeResult {
    try job.check()
    let work = Task.detached(priority: .userInitiated) {
      try await recognizeWork(plan: plan, job: job)
    }
    do { try job.installCancellation { work.cancel() } }
    catch { work.cancel(); _ = try? await work.value; throw error }
    defer { try? job.installCancellation(nil) }
    return try await withTaskCancellationHandler(operation: {
      do {
        let result = try await work.value
        try job.check()
        return result
      } catch {
        // Vision may report its own NSError when interrupted. Cancellation is
        // owned by the admitted job, not reclassified as an inference failure.
        try job.check()
        try Task.checkCancellation()
        throw error
      }
    }, onCancel: { job.cancel() })
  }
  private static func recognizeWork(plan: AppleOcrPlan, job: OcrRecognitionJob) async throws -> AppleOcrNativeResult {
    guard plan.requestId.utf8.count <= 128, !plan.requestId.isEmpty else {
      throw OcrProviderError.failed("Invalid request identity.")
    }
    let provider: AppleOcrProviderInfo
    // Capability errors are resolved before allocating the source raster.
    if plan.providerId == modernId {
      guard #available(macOS 15, iOS 18, *) else { throw OcrProviderError.unavailable("Modern Vision requires iOS 18 or macOS 15.") }
      let request = modern(plan.recognitionLanguages)
      provider = info(id: modernId, languages: request.supportedRecognitionLanguages.map { $0.minimalIdentifier })
      try validateLanguages(plan.recognitionLanguages, supported: provider.languages)
      // Keep the result and static callee explicit across Swift toolchains.
      let raster: Raster = try autoreleasepool { try Self.raster(path: plan.path, mimeType: plan.mimeType, pageIndex: plan.pageIndex, crop: plan.crop, job: job) }
      try job.check(); try Task.checkCancellation()
      let observations = try await request.perform(on: raster.image, orientation: .up)
      try job.check(); try Task.checkCancellation()
      guard observations.count <= 512 else { throw OcrProviderError.limit("More than 512 text regions.") }
      let regions = observations.enumerated().map { index, observation in
        var language: String?
        var orientation: String?
        if #available(macOS 26, iOS 26, *) {
          if observation.recognitionLanguages.count == 1 { language = observation.recognitionLanguages[0].minimalIdentifier }
          if let direction = observation.textDirection {
            switch direction {
            case .leftToRight: orientation = "leftToRight"
            case .rightToLeft: orientation = "rightToLeft"
            case .topToBottom: orientation = "topToBottom"
            @unknown default: orientation = nil
            }
          }
        }
        let candidates = observation.topCandidates(3).map { AppleOcrCandidate(text: $0.string, confidence: Double($0.confidence)) }
        return AppleOcrRegion(id: "\(plan.requestId):\(index)", text: candidates.first?.text ?? "",
          quad: raster.quad([observation.topLeft.cgPoint, observation.topRight.cgPoint,
                             observation.bottomRight.cgPoint, observation.bottomLeft.cgPoint]),
          candidates: candidates, language: language, orientation: orientation)
      }
      try validateRegions(regions)
      return raster.result(plan.requestId, provider, regions)
    } else if plan.providerId == legacyId {
      guard #available(macOS 13, iOS 16, *) else { throw OcrProviderError.unavailable("Legacy revision 3 requires iOS 16 or macOS 13.") }
      let request = legacy(plan.recognitionLanguages)
      provider = info(id: legacyId, languages: try request.supportedRecognitionLanguages())
      try validateLanguages(plan.recognitionLanguages, supported: provider.languages)
      let raster: Raster = try autoreleasepool { try Self.raster(path: plan.path, mimeType: plan.mimeType, pageIndex: plan.pageIndex, crop: plan.crop, job: job) }
      return try await withTaskCancellationHandler(operation: {
        try job.check(); try Task.checkCancellation()
        return try autoreleasepool {
          try VNImageRequestHandler(cgImage: raster.image, orientation: .up, options: [:]).perform([request])
          try job.check(); try Task.checkCancellation()
          let observations = request.results ?? []
          guard observations.count <= 512 else { throw OcrProviderError.limit("More than 512 text regions.") }
          let regions = observations.enumerated().map { index, observation in
            let candidates = observation.topCandidates(3).map { AppleOcrCandidate(text: $0.string, confidence: Double($0.confidence)) }
            return AppleOcrRegion(id: "\(plan.requestId):\(index)", text: candidates.first?.text ?? "",
              quad: raster.quad([observation.topLeft, observation.topRight, observation.bottomRight, observation.bottomLeft]),
              candidates: candidates, language: nil, orientation: nil)
          }
          try validateRegions(regions)
          return raster.result(plan.requestId, provider, regions)
        }
      }, onCancel: { request.cancel() })
    } else {
      throw OcrProviderError.unavailable("Unknown provider \(plan.providerId).")
    }
  }
  private static func validateRegions(_ regions: [AppleOcrRegion]) throws {
    var bytes = 0
    for region in regions {
      guard !region.candidates.isEmpty else { throw OcrProviderError.failed("A text observation has no recognized candidate.") }
      bytes += region.text.utf8.count
      for candidate in region.candidates {
        bytes += candidate.text.utf8.count
        guard candidate.confidence.isFinite, (0...1).contains(candidate.confidence) else {
          throw OcrProviderError.failed("Invalid provider confidence.")
        }
      }
      guard bytes <= 32 * 1024 else { throw OcrProviderError.limit("Recognition text exceeds 32 KiB.") }
      let q = region.quad
      guard [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft].allSatisfy({ $0.x.isFinite && $0.y.isFinite }) else {
        throw OcrProviderError.failed("Invalid provider geometry.")
      }
    }
  }

  struct Raster {
    let image: CGImage
    let width: Int
    let height: Int
    let sourceCrop: CGRect
    let crop: AppleOcrRect?

    func quad(_ points: [CGPoint]) -> AppleOcrQuad {
      let p = points.map { AppleOcrPoint(
        x: (sourceCrop.minX + Double($0.x) * sourceCrop.width) / Double(width),
        y: (sourceCrop.minY + (1 - Double($0.y)) * sourceCrop.height) / Double(height)) }
      return AppleOcrQuad(topLeft: p[0], topRight: p[1], bottomRight: p[2], bottomLeft: p[3])
    }
    func result(_ id: String, _ provider: AppleOcrProviderInfo, _ regions: [AppleOcrRegion]) -> AppleOcrNativeResult {
      AppleOcrNativeResult(requestId: id, provider: provider, width: width, height: height, crop: crop, regions: regions)
    }
  }
  private static func sourceData(_ path: String, job: OcrRecognitionJob) throws -> Data {
    try job.check()
    let attributes = try FileManager.default.attributesOfItem(atPath: path)
    guard attributes[.type] as? FileAttributeType == .typeRegular else { throw OcrProviderError.failed("Source is not an ordinary registered file.") }
    let input = try FileHandle(forReadingFrom: URL(fileURLWithPath: path))
    defer { do { try input.close() } catch { NSLog("OCR source close failed: %@", error.localizedDescription) } }
    let length = try input.seekToEnd()
    guard length > 0, length <= maximumSourceBytes else { throw OcrProviderError.limit("Source must be nonempty and at most 8 MiB.") }
    try input.seek(toOffset: 0)
    var data = Data()
    while true {
      try job.check()
      guard let chunk = try input.read(upToCount: min(64 * 1024, maximumSourceBytes + 1 - data.count)), !chunk.isEmpty else { break }
      data.append(chunk)
      guard data.count <= maximumSourceBytes else { throw OcrProviderError.limit("Source exceeds 8 MiB.") }
    }
    guard data.count == Int(length) else { throw OcrProviderError.failed("Source changed during reading.") }
    return data
  }
  static func raster(path: String, mimeType: String, pageIndex: Int?, crop: AppleOcrRect?, job: OcrRecognitionJob) throws -> Raster {
    let data = try sourceData(path, job: job)
    let draw: (CGContext, CGRect) -> Void
    let width: Int
    let height: Int
    if mimeType == "application/pdf" {
      guard let index = pageIndex, index >= 0, index < Int.max,
            let provider = CGDataProvider(data: data as CFData), let pdf = CGPDFDocument(provider),
            pdf.isUnlocked, index < pdf.numberOfPages, let page = pdf.page(at: index + 1) else {
        throw OcrProviderError.failed("Cannot open the admitted PDF page.")
      }
      let box = page.getBoxRect(.cropBox)
      let swapped = abs(page.rotationAngle % 180) == 90
      let w = ceil(swapped ? box.height : box.width), h = ceil(swapped ? box.width : box.height)
      try validateDimensions(w, h)
      width = Int(w); height = Int(h)
      draw = { context, crop in
        context.translateBy(x: -crop.minX, y: -(Double(height) - crop.maxY))
        context.concatenate(page.getDrawingTransform(.cropBox, rect: CGRect(x: 0, y: 0, width: width, height: height), rotate: 0, preserveAspectRatio: true))
        context.drawPDFPage(page)
      }
    } else {
      guard mimeType.hasPrefix("image/"), pageIndex == nil,
            let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary),
            CGImageSourceGetCount(source) == 1,
            let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
            let rawWidth = props[kCGImagePropertyPixelWidth] as? NSNumber,
            let rawHeight = props[kCGImagePropertyPixelHeight] as? NSNumber else {
        throw OcrProviderError.failed("Cannot decode a single admitted image.")
      }
      try validateDimensions(rawWidth.doubleValue, rawHeight.doubleValue)
      let orientationValue = (props[kCGImagePropertyOrientation] as? NSNumber)?.uint32Value ?? 1
      guard let orientation = CGImagePropertyOrientation(rawValue: orientationValue) else { throw OcrProviderError.failed("Invalid EXIF orientation.") }
      let w = rawWidth.intValue, h = rawHeight.intValue
      let swapped = orientationValue >= 5
      width = swapped ? h : w; height = swapped ? w : h
      try job.check()
      guard let image = CGImageSourceCreateImageAtIndex(source, 0, [kCGImageSourceShouldCacheImmediately: true] as CFDictionary),
            image.width == w, image.height == h else { throw OcrProviderError.failed("Image dimensions changed during decode.") }
      let transform: CGAffineTransform
      switch orientation {
      case .up: transform = .identity
      case .upMirrored: transform = CGAffineTransform(a: -1, b: 0, c: 0, d: 1, tx: Double(w), ty: 0)
      case .down: transform = CGAffineTransform(a: -1, b: 0, c: 0, d: -1, tx: Double(w), ty: Double(h))
      case .downMirrored: transform = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: Double(h))
      case .leftMirrored: transform = CGAffineTransform(a: 0, b: 1, c: 1, d: 0, tx: 0, ty: 0)
      case .right: transform = CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: Double(h), ty: 0)
      case .rightMirrored: transform = CGAffineTransform(a: 0, b: -1, c: -1, d: 0, tx: Double(h), ty: Double(w))
      case .left: transform = CGAffineTransform(a: 0, b: -1, c: 1, d: 0, tx: 0, ty: Double(w))
      @unknown default: throw OcrProviderError.failed("Unsupported EXIF orientation.")
      }
      draw = { context, crop in
        context.translateBy(x: 0, y: crop.height)
        context.scaleBy(x: 1, y: -1)
        context.translateBy(x: -crop.minX, y: -crop.minY)
        context.concatenate(transform)
        context.translateBy(x: 0, y: Double(h)); context.scaleBy(x: 1, y: -1)
        context.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
      }
    }
    try job.check()
    let sourceCrop: CGRect
    if let crop {
      guard crop.x.isFinite, crop.y.isFinite, crop.width.isFinite, crop.height.isFinite,
            crop.x >= 0, crop.y >= 0, crop.width > 0, crop.height > 0,
            crop.x + crop.width <= 1, crop.y + crop.height <= 1 else {
        throw OcrProviderError.failed("Crop must be positive and contained in the upright source.")
      }
      let x = floor(crop.x * Double(width)), y = floor(crop.y * Double(height))
      sourceCrop = CGRect(x: x, y: y, width: ceil((crop.x + crop.width) * Double(width)) - x,
                          height: ceil((crop.y + crop.height) * Double(height)) - y)
    } else { sourceCrop = CGRect(x: 0, y: 0, width: width, height: height) }
    let scale = min(1, Double(maximumRasterSide) / max(sourceCrop.width, sourceCrop.height))
    let rasterWidth = max(1, Int(floor(sourceCrop.width * scale)))
    let rasterHeight = max(1, Int(floor(sourceCrop.height * scale)))
    guard let context = CGContext(data: nil, width: rasterWidth, height: rasterHeight, bitsPerComponent: 8,
      bytesPerRow: rasterWidth * 4, space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { throw OcrProviderError.failed("Cannot allocate bounded raster.") }
    context.setFillColor(CGColor(gray: 1, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: rasterWidth, height: rasterHeight))
    context.scaleBy(x: Double(rasterWidth) / sourceCrop.width, y: Double(rasterHeight) / sourceCrop.height)
    draw(context, sourceCrop)
    try job.check()
    guard let image = context.makeImage() else { throw OcrProviderError.failed("Cannot finalize source raster.") }
    let actualCrop = crop.map { _ in AppleOcrRect(x: sourceCrop.minX / Double(width), y: sourceCrop.minY / Double(height),
      width: sourceCrop.width / Double(width), height: sourceCrop.height / Double(height)) }
    return Raster(image: image, width: width, height: height, sourceCrop: sourceCrop, crop: actualCrop)
  }
  private static func validateDimensions(_ width: Double, _ height: Double) throws {
    guard width.isFinite, height.isFinite, width >= 1, height >= 1,
          width <= 32768, height <= 32768, width * height <= Double(maximumSourcePixels) else {
      throw OcrProviderError.limit("Decoded source exceeds 16 megapixels or 32768 pixels per side.")
    }
  }

  private final class ImageOutput {
    var data = Data()
    var failure: Error?
    let job: OcrRecognitionJob
    init(_ job: OcrRecognitionJob) { self.job = job }
    func write(_ bytes: UnsafeRawPointer, _ count: Int) -> Int {
      guard failure == nil else { return 0 }
      do {
        try job.check()
        // Bound before appending; the final base64 URI must also fit 8 MiB.
        guard count <= 6 * 1024 * 1024 - 64 - data.count else { throw OcrProviderError.limit("Encoded source display exceeds 8 MiB.") }
        data.append(bytes.assumingMemoryBound(to: UInt8.self), count: count)
        return count
      } catch { failure = error; return 0 }
    }
  }
  static func imagePageUri(location: AppleImagePageLocation, job: OcrRecognitionJob,
                           crop: AppleOcrRect? = nil) throws -> String {
    try autoreleasepool {
      let image = try raster(path: location.path, mimeType: location.mimeType, pageIndex: location.pageIndex, crop: crop, job: job).image
      let output = ImageOutput(job)
      var callbacks = CGDataConsumerCallbacks(putBytes: { info, bytes, count in
        guard let info else { return 0 }
        return Unmanaged<ImageOutput>.fromOpaque(info).takeUnretainedValue().write(bytes, count)
      }, releaseConsumer: nil)
      guard let consumer = CGDataConsumer(info: Unmanaged.passUnretained(output).toOpaque(), cbks: &callbacks),
            let destination = CGImageDestinationCreateWithDataConsumer(consumer, "public.png" as CFString, 1, nil) else {
        throw OcrProviderError.failed("Cannot encode image page.")
      }
      CGImageDestinationAddImage(destination, image, nil)
      let complete = CGImageDestinationFinalize(destination)
      if let failure = output.failure { throw failure }
      guard complete else { throw OcrProviderError.failed("Cannot finalize encoded image page.") }
      try job.check()
      let uri = "data:image/png;base64,\(output.data.base64EncodedString())"
      guard uri.utf8.count <= maximumDisplayCharacters else { throw OcrProviderError.limit("Encoded image URI exceeds 8 MiB.") }
      return uri
    }
  }
}
