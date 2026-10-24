// Bounded native API comparison. No pixel rotations or output geometry rewrites.
import Foundation
import Vision
import ImageIO
import CryptoKit

enum FollowupError: Error { case arguments, decode(String), crop }
let arguments = CommandLine.arguments
guard arguments.count == 4 else { throw FollowupError.arguments }
let fixtureRoot = URL(fileURLWithPath: arguments[1])
let outputRoot = URL(fileURLWithPath: arguments[2])
let mode = arguments[3]
let processStart = ProcessInfo.processInfo.systemUptime
var records: [[String: Any]] = []
var counts = ["decodes": 0, "requestConstructions": 0, "handlerConstructions": 0, "performs": 0]
func now() -> Double { ProcessInfo.processInfo.systemUptime }
func milliseconds(_ start: Double) -> Double { (now() - start) * 1000 }
func hash(_ url: URL) throws -> String {
    SHA256.hash(data: try Data(contentsOf: url)).map { String(format: "%02x", $0) }.joined()
}
func persist(_ record: [String: Any]) throws {
    records.append(record)
    let result: [String: Any] = [
        "processID": ProcessInfo.processInfo.processIdentifier, "mode": mode,
        "os": ProcessInfo.processInfo.operatingSystemVersionString,
        "elapsedSinceMainMs": milliseconds(processStart), "ownedCounts": counts,
        "nativeModelInitializationCount": NSNull(), "nativeCacheHits": NSNull(),
        "fixtureSHA256": [
            "vertical-ruby.png": try hash(fixtureRoot.appendingPathComponent("vertical-ruby.png")),
            "horizontal-mixed.png": try hash(fixtureRoot.appendingPathComponent("horizontal-mixed.png")),
            "devanagari.png": try hash(fixtureRoot.appendingPathComponent("devanagari.png"))
        ],
        "sourceSHA256": try hash(fixtureRoot.appendingPathComponent("Followup.swift")),
        "records": records
    ]
    try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted, .sortedKeys])
        .write(to: outputRoot.appendingPathComponent("followup-\(mode).json"))
    print("\(record["id"] ?? "?"): \(record["summary"] ?? "") timings=\(record["timingsMs"] ?? [:])")
    fflush(stdout)
}
func decode(_ name: String) throws -> CGImage {
    counts["decodes", default: 0] += 1
    guard let source = CGImageSourceCreateWithURL(fixtureRoot.appendingPathComponent(name + ".png") as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0,
                [kCGImageSourceShouldCacheImmediately: true] as CFDictionary)
    else { throw FollowupError.decode(name) }
    return image
}
func makeRequest(corrected: Bool = false) -> VNRecognizeTextRequest {
    counts["requestConstructions", default: 0] += 1
    let request = VNRecognizeTextRequest()
    request.revision = VNRecognizeTextRequestRevision3
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["ja-JP", "en-US"]
    request.usesLanguageCorrection = corrected
    request.automaticallyDetectsLanguage = corrected
    request.minimumTextHeight = 0
    return request
}
func makeHandler(_ image: CGImage) -> VNImageRequestHandler {
    counts["handlerConstructions", default: 0] += 1
    return VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
}
func legacyObservations(_ request: VNRecognizeTextRequest) -> [[String: Any]] {
    (request.results ?? []).enumerated().map { index, observation in
        [
            "providerIndex": index,
            "quadBottomLeft": [observation.topLeft, observation.topRight,
                               observation.bottomRight, observation.bottomLeft].map { [Double($0.x), Double($0.y)] },
            "candidates": observation.topCandidates(3).map { ["text": $0.string, "confidence": $0.confidence] }
        ]
    }
}
func perform(_ id: String, _ request: VNRecognizeTextRequest, _ handler: VNImageRequestHandler,
             timings: [String: Double] = [:], crop: [Double]? = nil) throws {
    var phases = timings
    let start = now()
    counts["performs", default: 0] += 1
    do {
        try handler.perform([request])
        phases["perform"] = milliseconds(start)
        let serialize = now()
        let observations = legacyObservations(request)
        phases["projection"] = milliseconds(serialize)
        let summary = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " | ")
        var record: [String: Any] = [
            "id": id, "api": "VNRecognizeTextRequest", "revision": request.revision,
            "languages": request.recognitionLanguages, "correction": request.usesLanguageCorrection,
            "autoDetection": request.automaticallyDetectsLanguage, "orientation": "up",
            "state": observations.isEmpty ? "empty" : "recognized", "observations": observations,
            "timingsMs": phases, "summary": summary
        ]
        if let crop { record["cropTopLeftPixels"] = crop; record["parentPixels"] = [480, 420] }
        try persist(record)
    } catch {
        phases["perform"] = milliseconds(start)
        try persist(["id": id, "state": "failed", "error": String(describing: error), "timingsMs": phases])
    }
}

// Exactly three retained-handler requests and two decode/new-handler reopens.
let setupStart = now()
let retainedRequest = makeRequest()
let setupMs = milliseconds(setupStart)
let capabilityStart = now()
let languages = try retainedRequest.supportedRecognitionLanguages()
let capabilityMs = milliseconds(capabilityStart)
let decodeStart = now()
let horizontal = try decode("horizontal-mixed")
let decodeMs = milliseconds(decodeStart)
let handlerStart = now()
let retainedHandler = makeHandler(horizontal)
let handlerMs = milliseconds(handlerStart)
for i in 0..<3 {
    try perform("retained-horizontal-\(i)", retainedRequest, retainedHandler,
                timings: i == 0 ? ["requestConstruction": setupMs, "capabilityQuery": capabilityMs,
                                   "decode": decodeMs, "handlerConstruction": handlerMs] : [:])
}
for i in 0..<2 {
    try autoreleasepool {
        let start = now(); let image = try decode("horizontal-mixed"); let decodeTime = milliseconds(start)
        let requestStart = now(); let request = makeRequest(); let requestTime = milliseconds(requestStart)
        let handlerStart = now(); let handler = makeHandler(image); let handlerTime = milliseconds(handlerStart)
        try perform("reopened-horizontal-\(i)", request, handler,
                    timings: ["decode": decodeTime, "requestConstruction": requestTime, "handlerConstruction": handlerTime])
    }
}
let hindi = try decode("devanagari")
let hindiRequest = makeRequest()
hindiRequest.recognitionLanguages = ["hi-IN"]
let hindiHandler = makeHandler(hindi)
try perform("hindi-language-switch-0", hindiRequest, hindiHandler)
try perform("hindi-language-switch-1", hindiRequest, hindiHandler)

if mode == "A" {
    let vertical = try decode("vertical-ruby")
    let baseline = makeRequest(); baseline.recognitionLanguages = ["ja-JP"]
    try perform("vertical-baseline", baseline, makeHandler(vertical))
    let corrected = makeRequest(corrected: true); corrected.recognitionLanguages = ["ja-JP"]
    try perform("vertical-correction-autodetection", corrected, makeHandler(vertical))
    // Isolate the real right main column, excluding the neighboring ruby.
    let cropRect = CGRect(x: 300, y: 30, width: 50, height: 290)
    guard let column = vertical.cropping(to: cropRect) else { throw FollowupError.crop }
    let cropRequest = makeRequest(); cropRequest.recognitionLanguages = ["ja-JP"]
    try perform("vertical-main-column-crop", cropRequest, makeHandler(column),
                crop: [300, 30, 50, 290])

    if #available(macOS 15, *) {
        let start = now()
        counts["requestConstructions", default: 0] += 1
        var request = RecognizeTextRequest(.revision3)
        request.recognitionLevel = .accurate
        request.recognitionLanguages = [Locale.Language(identifier: "ja-JP")]
        request.usesLanguageCorrection = true
        request.automaticallyDetectsLanguage = true
        let setup = milliseconds(start)
        let capabilityStart = now()
        let supported = request.supportedRecognitionLanguages.map { $0.minimalIdentifier }
        let capability = milliseconds(capabilityStart)
        let performStart = now()
        counts["performs", default: 0] += 1
        do {
            let output = try await request.perform(on: vertical, orientation: .up)
            let elapsed = milliseconds(performStart)
            // Native Codable retains the provider's actual polygons, candidate order and confidence.
            let raw = try JSONSerialization.jsonObject(with: JSONEncoder().encode(output))
            try persist(["id": "vertical-swift-text", "api": "RecognizeTextRequest",
                         "revision": "revision3", "supportedLanguages": supported,
                         "state": output.isEmpty ? "empty" : "recognized", "rawOutput": raw,
                         "summary": output.compactMap { $0.topCandidates(1).first?.string }.joined(separator: " | "),
                         "timingsMs": ["requestConstruction": setup, "capabilityQuery": capability, "perform": elapsed]])
        } catch {
            try persist(["id": "vertical-swift-text", "state": "failed", "error": String(describing: error)])
        }
    }
    if #available(macOS 26, *) {
        let start = now()
        counts["requestConstructions", default: 0] += 1
        var request = RecognizeDocumentsRequest(.revision1)
        request.textRecognitionOptions.recognitionLanguages = [Locale.Language(identifier: "ja-JP")]
        request.textRecognitionOptions.useLanguageCorrection = true
        request.textRecognitionOptions.automaticallyDetectLanguage = true
        request.textRecognitionOptions.maximumCandidateCount = 3
        request.barcodeDetectionOptions.enabled = false
        let setup = milliseconds(start)
        let capabilityStart = now()
        let supported = request.supportedRecognitionLanguages.map { $0.minimalIdentifier }
        let capability = milliseconds(capabilityStart)
        let performStart = now()
        counts["performs", default: 0] += 1
        do {
            let output = try await request.perform(on: vertical, orientation: .up)
            let elapsed = milliseconds(performStart)
            let raw = try JSONSerialization.jsonObject(with: JSONEncoder().encode(output))
            try persist(["id": "vertical-documents", "api": "RecognizeDocumentsRequest",
                         "revision": "revision1", "supportedLanguages": supported,
                         "state": output.isEmpty ? "empty" : "recognized", "rawOutput": raw,
                         "summary": output.map { $0.document.text.transcript }.joined(separator: " | "),
                         "timingsMs": ["requestConstruction": setup, "capabilityQuery": capability, "perform": elapsed]])
        } catch {
            try persist(["id": "vertical-documents", "state": "failed", "error": String(describing: error)])
        }
    }
}
print("DONE mode=\(mode) pid=\(ProcessInfo.processInfo.processIdentifier) counts=\(counts) supported=\(languages.count)")
