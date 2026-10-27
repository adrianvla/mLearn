import Foundation
import Network
import CryptoKit
import CoreGraphics
import CoreImage
import ImageIO

private enum CheckError: Error { case failed(String) }
private struct Observation: Encodable {
  let file: String
  let inputSHA256: String
  let elapsedMs: Double
  let displayMeanAbsoluteError: Double?
  let result: AppleOcrNativeResult
}
private struct Report: Encodable {
  let os: String
  let networkStatus: String
  let providers: [AppleOcrProviderInfo]
  let rejections: [String]
  let observations: [Observation]
}

@main
private enum AppleOcrChecks {
  static func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw CheckError.failed(message) }
  }

  static func rgba(_ image: CGImage) throws -> [UInt8] {
    var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
    try bytes.withUnsafeMutableBytes { buffer in
      guard let context = CGContext(data: buffer.baseAddress, width: image.width, height: image.height,
        bitsPerComponent: 8, bytesPerRow: image.width * 4, space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
        throw CheckError.failed("Cannot inspect source pixels")
      }
      context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
    }
    return bytes
  }

  static func main() async throws {
    try require(CommandLine.arguments.count == 3
      || CommandLine.arguments.count == 4 && CommandLine.arguments[3] == "--fixtures-only",
      "Expected fixture and report paths, optionally --fixtures-only")
    let original = URL(fileURLWithPath: CommandLine.arguments[1])
    let output = URL(fileURLWithPath: CommandLine.arguments[2])
    let fixtures = output.deletingLastPathComponent().appendingPathComponent("fixtures")
    try FileManager.default.createDirectory(at: fixtures, withIntermediateDirectories: true)
    var cases: [(String, AppleOcrRect?)] = [
      ("horizontal-mixed.png", nil), ("vertical-ruby.png", nil),
      ("low-contrast-glare.png", nil), ("spread.png", nil), ("no-text.png", nil),
      ("image-only.pdf", nil),
      ("spread.png", AppleOcrRect(x: 0.52, y: 35.0 / 450, width: 0.45, height: 100.0 / 450)),
    ]
    for file in Set(cases.map { $0.0 }).sorted() {
      try Data(contentsOf: original.appendingPathComponent(file))
        .write(to: fixtures.appendingPathComponent(file), options: .atomic)
    }
    guard let source = CGImageSourceCreateWithURL(
      fixtures.appendingPathComponent("horizontal-mixed.png") as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
      throw CheckError.failed("Missing orientation source")
    }
    let context = CIContext(options: [.useSoftwareRenderer: true])
    for orientation in 1...8 {
      // Core Image constructs inverse-oriented input pixels independently of
      // the provider's explicit Core Graphics EXIF transforms.
      let inverse = orientation == 6 ? 8 : orientation == 8 ? 6 : orientation
      let pixels = CIImage(cgImage: image).oriented(forExifOrientation: Int32(inverse))
      let file = "orientation-\(orientation).jpg"
      guard let raster = context.createCGImage(pixels, from: pixels.extent),
        let destination = CGImageDestinationCreateWithURL(
          fixtures.appendingPathComponent(file) as CFURL, "public.jpeg" as CFString, 1, nil) else {
        throw CheckError.failed("Cannot create orientation fixture")
      }
      CGImageDestinationAddImage(destination, raster, [
        kCGImagePropertyOrientation: orientation,
        kCGImageDestinationLossyCompressionQuality: 1.0,
      ] as CFDictionary)
      try require(CGImageDestinationFinalize(destination), "Cannot finish orientation fixture")
      guard let written = CGImageSourceCreateWithURL(fixtures.appendingPathComponent(file) as CFURL, nil),
        let properties = CGImageSourceCopyPropertiesAtIndex(written, 0, nil) as? [CFString: Any],
        let tag = properties[kCGImagePropertyOrientation] as? NSNumber else {
        throw CheckError.failed("Generated JPEG has no EXIF orientation")
      }
      try require(tag.intValue == orientation, "Generated JPEG orientation differs")
      cases.append((file, nil))
    }
    if CommandLine.arguments.count == 4 {
      print("IOS_ORIENTATION_FIXTURES_READY")
      return
    }
    let monitor = NWPathMonitor()
    let paths = AsyncStream<NWPath.Status> { continuation in
      monitor.pathUpdateHandler = { continuation.yield($0.status) }
      monitor.start(queue: DispatchQueue(label: "mlearn.ocr.offline-check"))
      continuation.onTermination = { _ in monitor.cancel() }
    }
    defer { monitor.cancel() }
    var wasOnline = false
    var disconnected = false
    var path = paths.makeAsyncIterator()
    while let status = await path.next() {
      if !wasOnline && status == .satisfied {
        wasOnline = true
        print("IOS_OCR_READY_FOR_OFFLINE")
        fflush(stdout)
      } else if wasOnline && status == .unsatisfied {
        disconnected = true
        print("IOS_OCR_OFFLINE_CONFIRMED")
        fflush(stdout)
        break
      }
    }
    try require(disconnected, "No observed online-to-offline transition")
    let providers = try AppleOcrProvider.providers()
    try require(providers.contains {
      $0.id == AppleOcrProvider.modernId && $0.availability == "ready"
        && $0.languages.contains("ja") && $0.languages.contains("en")
    }, "Executing provider does not advertise ready Japanese and English")

    let malformed = fixtures.appendingPathComponent("malformed.png")
    try Data([0, 1, 2, 3]).write(to: malformed, options: .atomic)
    var rejections: [String] = []
    for (file, kind) in [
      ("horizontal-mixed.png", "pre-cancelled-job"),
      ("horizontal-mixed.png", "post-admission-cancelled-job"),
      ("malformed.png", "malformed-image"),
    ] {
      let job = OcrRecognitionJob()
      let cancelled = kind != "malformed-image"
      if kind == "pre-cancelled-job" { job.cancel() }
      if kind == "post-admission-cancelled-job" { job.onWorkInstalled = { job.cancel() } }
      let plan = AppleOcrPlan(requestId: "rejection-\(kind)", sourceId: "fixture",
        contentRevision: "original", resourceId: file, path: fixtures.appendingPathComponent(file).path,
        mimeType: "image/png", pageIndex: nil, crop: nil,
        providerId: AppleOcrProvider.modernId, recognitionLanguages: ["ja", "en"])
      do {
        _ = try await AppleOcrProvider.recognize(plan: plan, job: job)
        throw CheckError.failed("Rejected input unexpectedly produced recognition")
      } catch is CancellationError where cancelled {
        rejections.append(kind)
      } catch OcrProviderError.failed where !cancelled {
        rejections.append("malformed-image")
      }
    }
    // Successful real recognition below must remain possible after both failures.
    var observations: [Observation] = []
    for (index, entry) in cases.enumerated() {
      let (file, crop) = entry
      let url = fixtures.appendingPathComponent(file)
      let pdf = file.hasSuffix(".pdf")
      let plan = AppleOcrPlan(requestId: "offline-\(index)", sourceId: "fixture",
        contentRevision: "original", resourceId: file, path: url.path,
        mimeType: pdf ? "application/pdf" : file.hasSuffix(".jpg") ? "image/jpeg" : "image/png",
        pageIndex: pdf ? 0 : nil,
        crop: crop, providerId: AppleOcrProvider.modernId, recognitionLanguages: ["ja", "en"])
      let start = ProcessInfo.processInfo.systemUptime
      let result = try await AppleOcrProvider.recognize(plan: plan, job: OcrRecognitionJob())
      let elapsed = (ProcessInfo.processInfo.systemUptime - start) * 1000
      var displayError: Double?
      if file.hasPrefix("orientation-") {
        let uri = try AppleOcrProvider.imagePageUri(location: AppleImagePageLocation(sourceId: "fixture",
          contentRevision: "original", resourceId: file, path: url.path, mimeType: "image/jpeg",
          pageIndex: nil), job: OcrRecognitionJob())
        let prefix = "data:image/png;base64,"
        try require(uri.hasPrefix(prefix), "Unexpected source-display encoding")
        guard let data = Data(base64Encoded: String(uri.dropFirst(prefix.count))),
          let displayed = CGImageSourceCreateWithData(data as CFData, nil),
          let actual = CGImageSourceCreateImageAtIndex(displayed, 0, nil),
          let encoded = CGImageSourceCreateWithURL(url as CFURL, nil),
          let expected = CGImageSourceCreateThumbnailAtIndex(encoded, 0, [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 2048,
          ] as CFDictionary) else { throw CheckError.failed("Cannot decode orientation display") }
        try data.write(to: output.deletingLastPathComponent()
          .appendingPathComponent("display-\(file).png"), options: .atomic)
        try require(actual.width == expected.width && actual.height == expected.height,
          "Displayed source dimensions differ from independent ImageIO transform")
        let actualPixels = try rgba(actual), expectedPixels = try rgba(expected)
        let error = zip(actualPixels, expectedPixels).reduce(0.0) { total, pair in
          total + Double(abs(Int(pair.0) - Int(pair.1)))
        } / Double(actualPixels.count)
        displayError = error
      }
      observations.append(Observation(file: file,
        inputSHA256: SHA256.hash(data: try Data(contentsOf: url)).map { String(format: "%02x", $0) }.joined(),
        elapsedMs: elapsed,
        displayMeanAbsoluteError: displayError,
        result: result))
      let report = Report(os: ProcessInfo.processInfo.operatingSystemVersionString,
        networkStatus: "unsatisfied", providers: providers, rejections: rejections,
        observations: observations)
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
      try encoder.encode(report).write(to: output, options: .atomic)
      if let error = displayError {
        try require(error <= 2, "\(file): displayed orientation differs from original source pixels: \(error)")
      }
      let text = Set(result.regions.map(\.text))
      if file == "horizontal-mixed.png" || pdf || file.hasPrefix("orientation-") {
        try require(text.contains("Open the blue book. 42") && text.contains("日本語の本を読む。"),
          "Mixed source content differs: \(text)")
        try require(result.width == 720 && result.height == 300, "Upright source dimensions differ")
      }
      if file == "vertical-ruby.png" {
        try require(text.contains("日本語を読む") && text.contains("青い本です"),
          "Vertical Japanese content differs: \(text)")
      }
      if crop != nil {
        try require(text == ["RIGHT PAGE 02"], "Crop recognized another source region: \(text)")
        try require(result.width == 1000 && result.height == 450, "Crop lost original source dimensions")
        try require(result.regions.allSatisfy { $0.quad.topLeft.x > 0.5 },
          "Crop geometry was not mapped to the original right page")
      }
    }
    print("IOS_OFFLINE_OCR_VERIFIED")
    fflush(stdout)
    while let status = await path.next() {
      if status == .satisfied {
        print("IOS_OCR_NETWORK_RESTORED")
        return
      }
    }
    throw CheckError.failed("No observed network restoration")
  }
}
