// Checks actual persisted probe output; does not mock OCR.
import Foundation

struct Candidate: Decodable { let text: String; let confidence: Double }
struct Observation: Decodable {
    let rectTopLeft: [Double]
    let candidates: [Candidate]
}
struct Result: Decodable {
    let id: String
    let state: String
    let observations: [Observation]?
    let error: String?
}
struct Capability: Decodable { let level: String; let languages: [String] }
struct Capabilities: Decodable { let capabilities: [Capability] }
enum CheckError: Error { case failed(String) }
func check(_ condition: Bool, _ message: String) throws {
    guard condition else { throw CheckError.failed(message) }
}
let root = URL(fileURLWithPath: CommandLine.arguments[1])
let results = try JSONDecoder().decode([Result].self, from: Data(contentsOf: root.appendingPathComponent("results.json")))
func result(_ id: String) throws -> Result {
    guard let value = results.first(where: { $0.id == id }) else { throw CheckError.failed("Missing \(id)") }
    return value
}
func first(_ id: String) throws -> Observation {
    guard let observation = try result(id).observations?.first else { throw CheckError.failed("No observation in \(id)") }
    return observation
}
// Given the fixed original raster, when recognized, then preserve genuine content and negative/error states.
try check(results.count == 12, "Expected all twelve cases")
let horizontal = try result("horizontal-mixed").observations ?? []
try check(horizontal.map { $0.candidates[0].text } == ["Open the blue book. 42", "日本語の本を読む。"],
          "Horizontal mixed text differs")
try check(try result("no-text").state == "empty", "Shape-only negative is not empty")
try check(try result("invalid-roi").state == "failed", "Invalid ROI did not fail")
try check(try result("invalid-roi").error?.contains("Code=14") == true, "Unexpected invalid-ROI error")
try check(try first("devanagari-hindi").candidates[0].text == "नमस्ते पुस्तक", "Hindi sample differs")
for output in results {
    for observation in output.observations ?? [] {
        let r = observation.rectTopLeft
        try check(r.count == 4 && r.allSatisfy { $0.isFinite }, "Invalid geometry")
        try check(r[0] >= 0 && r[1] >= 0 && r[2] > 0 && r[3] > 0 &&
                  r[0] + r[2] <= 1.001 && r[1] + r[3] <= 1.001, "Geometry escapes raster")
        try check(observation.candidates.allSatisfy { (0...1).contains($0.confidence) }, "Invalid confidence")
    }
}
// Given physical crop C, when mapped to page pixels, then hit the original right-page title.
let crop = try first("spread-right-crop")
try check(crop.candidates[0].text == "RIGHT PAGE 02", "Crop recognized the wrong source region")
let r = crop.rectTopLeft
let pagePixels = [520 + r[0] * 450, 35 + r[1] * 100, r[2] * 450, r[3] * 100]
let fullTitle = try result("spread").observations?.first { $0.candidates[0].text == "RIGHT PAGE 02" }
guard let fullTitle else { throw CheckError.failed("Missing full-page right title") }
let full = fullTitle.rectTopLeft
for (a, b) in zip(pagePixels, [full[0] * 1000, full[1] * 450, full[2] * 1000, full[3] * 450]) {
    try check(abs(a - b) <= 3, "Crop-to-page mapping differs by more than three pixels")
}
// Given identical ROI and physical crop, when recognized, then this provider reports crop-local coordinates.
let roi = try first("spread-right-roi")
try check(zip(roi.rectTopLeft, r).allSatisfy { abs($0 - $1) < 0.000001 }, "ROI geometry semantics changed")
for id in ["rotated-corrected", "pdf-page-1"] {
    let observations = try result(id).observations ?? []
    try check(observations.map { $0.candidates[0].text } == horizontal.map { $0.candidates[0].text },
              "\(id) content differs")
    try check(zip(observations, horizontal).allSatisfy { pair in
        zip(pair.0.rectTopLeft, pair.1.rectTopLeft).allSatisfy { abs($0 - $1) < 0.000001 }
    }, "\(id) upright geometry differs")
}
let caps = try JSONDecoder().decode(Capabilities.self, from: Data(contentsOf: root.appendingPathComponent("capabilities.json")))
let accurate = caps.capabilities.first { $0.level == "accurate" }?.languages ?? []
let fast = caps.capabilities.first { $0.level == "fast" }?.languages ?? []
try check(accurate.contains("ja-JP") && accurate.contains("hi-IN"), "Required host capability missing")
try check(!fast.contains("ja-JP") && !accurate.contains("bn-IN"), "Recorded unsupported-language expectation changed")
print("PASS: twelve actual OCR cases, empty/error states, candidate ranges, crop/ROI alignment, rotation/PDF parity, runtime language coverage")
