import Foundation
import Network
import CryptoKit

private enum CheckError: Error { case failed(String) }
private struct Observation: Encodable {
  let file: String
  let inputSHA256: String
  let result: AppleOcrNativeResult
}
private struct Report: Encodable {
  let os: String
  let networkStatus: String
  let providers: [AppleOcrProviderInfo]
  let observations: [Observation]
}

@main
private enum AppleOcrChecks {
  static func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw CheckError.failed(message) }
  }

  static func main() async throws {
    try require(CommandLine.arguments.count == 3, "Expected fixture and report paths")
    let fixtures = URL(fileURLWithPath: CommandLine.arguments[1])
    let output = URL(fileURLWithPath: CommandLine.arguments[2])
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

    var observations: [Observation] = []
    let cases: [(String, AppleOcrRect?)] = [
      ("horizontal-mixed.png", nil), ("vertical-ruby.png", nil),
      ("low-contrast-glare.png", nil), ("spread.png", nil), ("no-text.png", nil),
      ("image-only.pdf", nil),
      ("spread.png", AppleOcrRect(x: 0.52, y: 35.0 / 450, width: 0.45, height: 100.0 / 450)),
    ]
    for (index, entry) in cases.enumerated() {
      let (file, crop) = entry
      let url = fixtures.appendingPathComponent(file)
      let pdf = file.hasSuffix(".pdf")
      let plan = AppleOcrPlan(requestId: "offline-\(index)", sourceId: "fixture",
        contentRevision: "original", resourceId: file, path: url.path,
        mimeType: pdf ? "application/pdf" : "image/png", pageIndex: pdf ? 0 : nil,
        crop: crop, providerId: AppleOcrProvider.modernId, recognitionLanguages: ["ja", "en"])
      let result = try await AppleOcrProvider.recognize(plan: plan, job: OcrRecognitionJob())
      observations.append(Observation(file: file,
        inputSHA256: SHA256.hash(data: try Data(contentsOf: url)).map { String(format: "%02x", $0) }.joined(),
        result: result))
      let report = Report(os: ProcessInfo.processInfo.operatingSystemVersionString,
        networkStatus: "unsatisfied", providers: providers, observations: observations)
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
      try encoder.encode(report).write(to: output, options: .atomic)
      let text = Set(result.regions.map(\.text))
      if file == "horizontal-mixed.png" || pdf {
        try require(text.contains("Open the blue book. 42") && text.contains("日本語の本を読む。"),
          "Mixed source content differs: \(text)")
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
