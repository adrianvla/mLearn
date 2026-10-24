// Standalone macOS evidence generator, not the iOS production adapter.
import AppKit
import Vision
import ImageIO
import CryptoKit

enum ProbeError: Error { case invalidArguments, imageCreation, pdfCreation, assertion(String) }
let args = CommandLine.arguments
guard args.count == 3 else { throw ProbeError.invalidArguments }
let fixtures = URL(fileURLWithPath: args[1], isDirectory: true)
let evidence = URL(fileURLWithPath: args[2], isDirectory: true)
try FileManager.default.createDirectory(at: fixtures, withIntermediateDirectories: true)
try FileManager.default.createDirectory(at: evidence, withIntermediateDirectories: true)

func json(_ object: Any, _ url: URL) throws {
    try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
        .write(to: url)
}
func rect(_ r: CGRect) -> [Double] { [r.minX, r.minY, r.width, r.height] }
func topRect(_ r: CGRect) -> [Double] { [r.minX, 1 - r.maxY, r.width, r.height] }
func quad(_ r: VNRectangleObservation) -> [[Double]] {
    [r.topLeft, r.topRight, r.bottomRight, r.bottomLeft].map { [Double($0.x), 1.0 - Double($0.y)] }
}
func context(_ w: Int, _ h: Int) throws -> CGContext {
    guard let c = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8,
                            bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(),
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { throw ProbeError.imageCreation }
    c.setFillColor(CGColor(gray: 1, alpha: 1))
    c.fill(CGRect(x: 0, y: 0, width: w, height: h))
    return c
}
struct Line {
    let text: String
    let x: Double
    let y: Double // top-left logical text frame, in pixels
    let size: Double
    var gray: Double = 0
    var role: String = "main"
}
var manifest: [[String: Any]] = []
func image(_ name: String, _ w: Int, _ h: Int, _ lines: [Line],
           glare: Bool = false, shapes: Bool = false) throws -> CGImage {
    let c = try context(w, h)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(cgContext: c, flipped: false)
    var truth: [[String: Any]] = []
    for line in lines {
        let font = NSFont(name: "HiraginoSans-W3", size: line.size) ?? NSFont.systemFont(ofSize: line.size)
        let attrs: [NSAttributedString.Key: Any] = [
            .font: font, .foregroundColor: NSColor(white: line.gray, alpha: 1)
        ]
        let measured = (line.text as NSString).size(withAttributes: attrs)
        (line.text as NSString).draw(at: NSPoint(x: line.x, y: Double(h) - line.y - measured.height),
                                   withAttributes: attrs)
        truth.append(["text": line.text, "role": line.role, "font": font.fontName,
                      "frameTopLeftPixels": [line.x, line.y, measured.width, measured.height]])
    }
    NSGraphicsContext.restoreGraphicsState()
    if glare {
        c.setFillColor(CGColor(gray: 1, alpha: 0.85))
        c.fill(CGRect(x: 180, y: 0, width: 100, height: h))
    }
    if shapes {
        c.setStrokeColor(CGColor(gray: 0.2, alpha: 1)); c.setLineWidth(5)
        c.strokeEllipse(in: CGRect(x: 80, y: 80, width: 120, height: 120))
        c.stroke(CGRect(x: 300, y: 80, width: 150, height: 120))
    }
    guard let result = c.makeImage() else { throw ProbeError.imageCreation }
    try save(result, name)
    manifest.append(["id": name, "width": w, "height": h, "drawnText": truth,
                     "glare": glare, "shapeOnly": shapes])
    return result
}
func save(_ image: CGImage, _ name: String) throws {
    guard let d = CGImageDestinationCreateWithURL(fixtures.appendingPathComponent(name + ".png") as CFURL,
                                                 "public.png" as CFString, 1, nil)
    else { throw ProbeError.imageCreation }
    CGImageDestinationAddImage(d, image, nil)
    guard CGImageDestinationFinalize(d) else { throw ProbeError.imageCreation }
}
let mixed = try image("horizontal-mixed", 720, 300, [
    Line(text: "Open the blue book. 42", x: 40, y: 40, size: 32),
    Line(text: "日本語の本を読む。", x: 40, y: 125, size: 34)
])
let spread = try image("spread", 1000, 450, [
    Line(text: "LEFT PAGE 01", x: 40, y: 60, size: 30),
    Line(text: "The blue book.", x: 40, y: 160, size: 30),
    Line(text: "RIGHT PAGE 02", x: 540, y: 60, size: 30),
    Line(text: "Read again.", x: 540, y: 160, size: 30)
])
var vertical: [Line] = []
for (column, text) in ["日本語を読む", "青い本です"].enumerated() {
    for (row, char) in text.enumerated() {
        vertical.append(Line(text: String(char), x: 310 - Double(column) * 130,
                             y: 40 + Double(row) * 44, size: 36))
    }
}
for (row, char) in "にほんご".enumerated() {
    vertical.append(Line(text: String(char), x: 355, y: 43 + Double(row) * 18,
                         size: 14, role: "publisher-reading"))
}
let manga = try image("vertical-ruby", 480, 420, vertical)
let low = try image("low-contrast-glare", 720, 300, [
    Line(text: "Open the blue book. 42", x: 40, y: 40, size: 32, gray: 0.78),
    Line(text: "日本語の本を読む。", x: 40, y: 125, size: 34, gray: 0.78)
], glare: true)
let blank = try image("no-text", 600, 300, [], shapes: true)
let unsupported = try image("devanagari", 720, 220, [
    Line(text: "नमस्ते पुस्तक", x: 40, y: 60, size: 42)
])
// Crop coordinates are integer top-left source pixels. CGImage cropping uses that space.
let cropPixels = CGRect(x: 520, y: 35, width: 450, height: 100)
guard let crop = spread.cropping(to: cropPixels) else { throw ProbeError.imageCreation }
try save(crop, "spread-right-crop")
manifest.append(["id": "spread-right-crop", "parent": "spread",
                 "cropTopLeftPixels": rect(cropPixels), "width": 450, "height": 100])
let rotatedContext = try context(300, 720)
rotatedContext.translateBy(x: 150, y: 360)
rotatedContext.rotate(by: -.pi / 2)
rotatedContext.draw(mixed, in: CGRect(x: -360, y: -150, width: 720, height: 300))
guard let rotated = rotatedContext.makeImage() else { throw ProbeError.imageCreation }
try save(rotated, "horizontal-rotated-clockwise")
manifest.append(["id": "horizontal-rotated-clockwise", "parent": "horizontal-mixed",
                 "width": 300, "height": 720, "pixelRotation": "clockwise90",
                 "recognitionOrientation": "left"])
// An image-only PDF: no hidden searchable text is added.
var media = CGRect(x: 0, y: 0, width: 720, height: 300)
guard let pdf = CGContext(fixtures.appendingPathComponent("image-only.pdf") as CFURL, mediaBox: &media, nil)
else { throw ProbeError.pdfCreation }
pdf.beginPDFPage(nil); pdf.draw(mixed, in: media); pdf.endPDFPage(); pdf.closePDF()
guard let doc = CGPDFDocument(fixtures.appendingPathComponent("image-only.pdf") as CFURL),
      let page = doc.page(at: 1) else { throw ProbeError.pdfCreation }
let pdfContext = try context(720, 300)
pdfContext.drawPDFPage(page)
guard let pdfRaster = pdfContext.makeImage() else { throw ProbeError.imageCreation }
try save(pdfRaster, "pdf-page-1")
manifest.append(["id": "pdf-page-1", "parent": "image-only.pdf", "pageIndex": 0,
                 "width": 720, "height": 300, "rasterScale": 1])
try json(manifest, fixtures.appendingPathComponent("manifest.json"))

let revision = VNRecognizeTextRequestRevision3
var capabilities: [[String: Any]] = []
for level: VNRequestTextRecognitionLevel in [.accurate, .fast] {
    let request = VNRecognizeTextRequest()
    request.revision = revision; request.recognitionLevel = level
    capabilities.append(["level": level == .accurate ? "accurate" : "fast",
                         "revision": revision, "languages": try request.supportedRecognitionLanguages()])
}
try json(["os": ProcessInfo.processInfo.operatingSystemVersionString,
          "supportedRevisions": Array(VNRecognizeTextRequest.supportedRevisions),
          "provider": "apple.vision.VNRecognizeTextRequest",
          "capabilities": capabilities], evidence.appendingPathComponent("capabilities.json"))
var results: [[String: Any]] = []
func recognize(_ id: String, _ image: CGImage, languages: [String],
               orientation: CGImagePropertyOrientation = .up,
               roi: CGRect = CGRect(x: 0, y: 0, width: 1, height: 1)) throws {
    let request = VNRecognizeTextRequest()
    request.revision = revision
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.automaticallyDetectsLanguage = false
    request.minimumTextHeight = 0
    request.regionOfInterest = roi
    let supported = try request.supportedRecognitionLanguages()
    let absent = languages.filter { !supported.contains($0) }
    if !absent.isEmpty {
        results.append(["id": id, "state": "unsupported-language", "unsupported": absent])
        return
    }
    request.recognitionLanguages = languages
    let start = ProcessInfo.processInfo.systemUptime
    do {
        try VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:]).perform([request])
        let observations = try (request.results ?? []).enumerated().map { index, observation -> [String: Any] in
            let candidates = try observation.topCandidates(3).map { candidate -> [String: Any] in
                let full = candidate.string.startIndex..<candidate.string.endIndex
                var record: [String: Any] = ["text": candidate.string, "confidence": candidate.confidence,
                                            "utf16Length": candidate.string.utf16.count]
                if let box = try candidate.boundingBox(for: full) { record["fullRangeQuadTopLeft"] = quad(box) }
                return record
            }
            return ["providerIndex": index, "visionRectBottomLeft": rect(observation.boundingBox),
                    "rectTopLeft": topRect(observation.boundingBox), "quadTopLeft": quad(observation),
                    "candidates": candidates]
        }
        results.append(["id": id, "state": observations.isEmpty ? "empty" : "recognized",
                        "languages": languages, "orientationRaw": orientation.rawValue,
                        "roiBottomLeft": rect(roi), "observations": observations,
                        "elapsedMs": (ProcessInfo.processInfo.systemUptime - start) * 1000])
        print("\(id): \(observations.count) observations")
    } catch {
        results.append(["id": id, "state": "failed", "error": String(describing: error)])
    }
}
try recognize("horizontal-mixed", mixed, languages: ["ja-JP", "en-US"])
try recognize("spread", spread, languages: ["en-US"])
try recognize("vertical-ruby", manga, languages: ["ja-JP"])
try recognize("low-contrast-glare", low, languages: ["ja-JP", "en-US"])
try recognize("no-text", blank, languages: ["en-US"])
try recognize("spread-right-crop", crop, languages: ["en-US"])
try recognize("spread-right-roi", spread, languages: ["en-US"],
              roi: CGRect(x: 0.52, y: 0.70, width: 0.45, height: 100.0 / 450))
try recognize("rotated-corrected", rotated, languages: ["ja-JP", "en-US"], orientation: .left)
try recognize("rotated-unhinted", rotated, languages: ["ja-JP", "en-US"])
try recognize("pdf-page-1", pdfRaster, languages: ["ja-JP", "en-US"])
try recognize("devanagari-hindi", unsupported, languages: ["hi-IN"])
try recognize("invalid-roi", mixed, languages: ["en-US"], roi: CGRect(x: 2, y: 0, width: 1, height: 1))
try json(results, evidence.appendingPathComponent("results.json"))
var hashes: [String: String] = [:]
for url in try FileManager.default.contentsOfDirectory(at: fixtures, includingPropertiesForKeys: nil)
    .sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
    hashes[url.lastPathComponent] = SHA256.hash(data: try Data(contentsOf: url)).map { String(format: "%02x", $0) }.joined()
}
try json(hashes, evidence.appendingPathComponent("sha256.json"))
