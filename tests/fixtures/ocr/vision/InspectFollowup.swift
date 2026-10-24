// Decode already-completed native evidence; never performs recognition.
import Foundation
import Vision
import CryptoKit

enum InspectionError: Error { case missing(String), unexpected(String) }
let root = URL(fileURLWithPath: CommandLine.arguments[1])
let data = try Data(contentsOf: root.appendingPathComponent("followup-A.json"))
guard let input = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      let records = input["records"] as? [[String: Any]]
else { throw InspectionError.missing("records") }
func raw(_ id: String) throws -> Data {
    guard let record = records.first(where: { $0["id"] as? String == id }),
          let value = record["rawOutput"] else { throw InspectionError.missing(id) }
    return try JSONSerialization.data(withJSONObject: value)
}
func project(_ lines: [RecognizedTextObservation]) -> [[String: Any]] {
    lines.enumerated().map { index, line in
        var value: [String: Any] = [
            "providerIndex": index,
            "quadBottomLeft": [line.topLeft, line.topRight, line.bottomRight, line.bottomLeft]
                .map { [Double($0.cgPoint.x), Double($0.cgPoint.y)] },
            "candidates": line.topCandidates(3).map { ["text": $0.string, "confidence": $0.confidence] }
        ]
        if #available(macOS 26, *) {
            if let direction = line.textDirection {
                value["textDirection"] = String(describing: direction)
            } else {
                value["textDirection"] = NSNull()
            }
            value["isTitle"] = line.isTitle
        }
        return value
    }
}
let text = try JSONDecoder().decode([RecognizedTextObservation].self, from: raw("vertical-swift-text"))
var output: [String: Any] = ["swiftTextLines": project(text)]
let expected = ["にほんご", "日本語を読む", "青い本です"]
guard text.compactMap({ $0.topCandidates(1).first?.string }) == expected
else { throw InspectionError.unexpected("Swift text content/order") }
if #available(macOS 26, *) {
    let documents = try JSONDecoder().decode([DocumentObservation].self, from: raw("vertical-documents"))
    let lines = documents.flatMap { $0.document.text.lines }
    guard lines.compactMap({ $0.topCandidates(1).first?.string }) == expected
    else { throw InspectionError.unexpected("Document content/order") }
    output["documentLines"] = project(lines)
    output["documentTranscripts"] = documents.map { $0.document.text.transcript }
}
for line in text {
    let points = [line.topLeft, line.topRight, line.bottomRight, line.bottomLeft]
    guard points.allSatisfy({ (0...1).contains($0.cgPoint.x) && (0...1).contains($0.cgPoint.y) })
    else { throw InspectionError.unexpected("Polygon outside actual upright raster") }
}
output["inspectorSourceSHA256"] = SHA256.hash(data: try Data(contentsOf:
    URL(fileURLWithPath: "tests/fixtures/ocr/vision/InspectFollowup.swift")))
    .map { String(format: "%02x", $0) }.joined()
try JSONSerialization.data(withJSONObject: output, options: [.prettyPrinted, .sortedKeys])
    .write(to: root.appendingPathComponent("followup-inspected.json"))
print("PASS: decoded actual Swift/document output; both main columns and ruby, provider order and valid source polygons")
for line in text {
    print("LINE \(line.topCandidates(3).map { "\($0.string):\($0.confidence)" })")
}
