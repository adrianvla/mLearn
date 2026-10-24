// Fixture generation and desktop decoding only; not a production Reader adapter.
// Run from the repository root. No third-party packages or user profiles.
import Foundation
import CoreGraphics
import CoreText
import AppKit
import PDFKit

struct Reading: Codable, Equatable {
    let start: Int
    let end: Int
    let text: String
}
struct Block: Codable, Equatable {
    let href: String
    let id: String
    var text: String
    var readings: [Reading]
}
struct Restore: Decodable {
    let href: String
    let blockId: String
    let start: Int
    let end: Int
    let quote: String
}
struct PDFExpected: Decodable {
    let pageCount: Int
    let page0Text: String
    let selectionStartUTF16: Int
    let selectionLengthUTF16: Int
    let selectionText: String
    let selectionContainerPDFPoints: [Double]
    let page1HasText: Bool
    let page2Text: String
    let page2Rotation: Int
    let page2CropBox: [Double]
}
struct Expected: Decodable {
    let schemaVersion: Int
    let offsetUnit: String
    let blocks: [Block]
    let restore: Restore
    let pdf: PDFExpected
}
enum FixtureError: Error { case invalid(String) }
func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw FixtureError.invalid(message) }
}
func command(_ args: [String], at directory: URL) throws -> Data {
    let process = Process()
    let pipe = Pipe()
    process.executableURL = URL(fileURLWithPath: args[0])
    process.arguments = Array(args.dropFirst())
    process.currentDirectoryURL = directory
    process.standardOutput = pipe
    try process.run()
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    try require(process.terminationStatus == 0, "Command failed: \(args)")
    return data
}
final class Chapter: NSObject, XMLParserDelegate {
    let href: String
    var blocks: [Block] = []
    var current: Block?
    var annotation: String?
    var rubyStart = 0
    var suppress = false
    var elements: [(String, [String: String])] = []
    init(href: String) { self.href = href }
    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?,
                qualifiedName: String?, attributes: [String: String]) {
        elements.append((name, attributes))
        if ["h1", "p"].contains(name) {
            current = Block(href: href, id: attributes["id"] ?? "", text: "", readings: [])
        }
        if name == "ruby" { rubyStart = current?.text.utf8.count ?? 0 }
        if name == "rt" { annotation = "" }
        if name == "rp" { suppress = true }
    }
    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if suppress { return }
        if annotation != nil { annotation?.append(string) }
        else { current?.text.append(string) }
    }
    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?,
                qualifiedName: String?) {
        if name == "rp" { suppress = false }
        if name == "rt", let text = annotation, let block = current {
            current?.readings.append(Reading(start: rubyStart, end: block.text.utf8.count, text: text))
            annotation = nil
        }
        if ["h1", "p"].contains(name), let block = current {
            blocks.append(block)
            current = nil
        }
    }
}
func rectangle(_ values: [Double]) -> CGRect {
    CGRect(x: values[0], y: values[1], width: values[2], height: values[3])
}
let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let fixtures = root.appendingPathComponent("tests/fixtures/reader")
let output = URL(fileURLWithPath: ProcessInfo.processInfo.environment["TMPDIR"]!)
let expected = try JSONDecoder().decode(Expected.self, from: Data(contentsOf: fixtures.appendingPathComponent("expected.json")))
try require(expected.schemaVersion == 1 && expected.offsetUnit == "utf8_byte_half_open_per_block", "Expectation schema")
let mode = CommandLine.arguments.dropFirst().first ?? "verify"
try require(["generate", "verify"].contains(mode), "Use generate or verify")
if mode == "generate" {
    let stage = output.appendingPathComponent("epub-stage")
    try require(!FileManager.default.fileExists(atPath: stage.path), "Use a fresh run TMPDIR for generation")
    try FileManager.default.copyItem(at: fixtures.appendingPathComponent("epub"), to: stage)
    try Data("application/epub+zip".utf8).write(to: stage.appendingPathComponent("mimetype"))
    let archive = fixtures.appendingPathComponent("journey.epub")
    try require(!FileManager.default.fileExists(atPath: archive.path), "Remove only your generated EPUB before regeneration")
    _ = try command(["/usr/bin/zip", "-X", "-0", archive.path, "mimetype"], at: stage)
    _ = try command(["/usr/bin/zip", "-X", "-r", archive.path, "META-INF", "EPUB"], at: stage)
    var mediaBox = CGRect(x: 0, y: 0, width: 612, height: 792)
    let pdfURL = fixtures.appendingPathComponent("journey.pdf")
    guard let context = CGContext(pdfURL as CFURL, mediaBox: &mediaBox, nil) else {
        throw FixtureError.invalid("PDF context")
    }
    let font = CTFontCreateWithName("Helvetica" as CFString, 20, nil)
    func line(_ text: String, y: CGFloat) {
        let attributed = NSAttributedString(string: text, attributes: [
            NSAttributedString.Key(kCTFontAttributeName as String): font
        ])
        context.textPosition = CGPoint(x: 48, y: y)
        CTLineDraw(CTLineCreateWithAttributedString(attributed), context)
    }
    context.beginPDFPage(nil)
    line("Start here. Return to the small bridge.", y: 720)
    line("The same bridge is still here.", y: 680)
    context.endPDFPage()
    context.beginPDFPage(nil)
    // Deliberately no text operators: honest image/graphics-only fallback page.
    context.setFillColor(CGColor(red: 0.2, green: 0.5, blue: 0.7, alpha: 1))
    context.fill(CGRect(x: 48, y: 250, width: 516, height: 220))
    context.setStrokeColor(CGColor(gray: 0, alpha: 1))
    context.setLineWidth(12)
    context.strokeEllipse(in: CGRect(x: 200, y: 300, width: 180, height: 100))
    context.endPDFPage()
    context.beginPDFPage(nil)
    line("Turn the page.", y: 720)
    context.endPDFPage()
    context.closePDF()
    guard let pdf = PDFDocument(url: pdfURL), let rotated = pdf.page(at: 2) else {
        throw FixtureError.invalid("Generated PDF reopening")
    }
    rotated.rotation = 90
    rotated.setBounds(CGRect(x: 24, y: 36, width: 564, height: 720), for: .cropBox)
    try require(pdf.write(to: pdfURL), "PDF rotation/crop write")
    print("GENERATED journey.epub journey.pdf")
}
// Decode the archive, not merely its exploded generator inputs.
let archive = fixtures.appendingPathComponent("journey.epub")
let zip = try Data(contentsOf: archive)
try require(zip.prefix(4) == Data([0x50, 0x4b, 0x03, 0x04]), "ZIP magic")
try require(zip[8] == 0 && zip[9] == 0, "First entry must be uncompressed")
let mime = try command(["/usr/bin/unzip", "-p", archive.path, "mimetype"], at: root)
try require(mime == Data("application/epub+zip".utf8), "EPUB mimetype")
try require(String(data: zip.subdata(in: 30..<38), encoding: .utf8) == "mimetype", "First EPUB entry")
_ = try command(["/usr/bin/unzip", "-t", archive.path], at: root)
var decoded: [Block] = []
var documentElements: [String: [(String, [String: String])]] = [:]
for href in ["META-INF/container.xml", "EPUB/package.opf", "EPUB/nav.xhtml", "EPUB/start.xhtml", "EPUB/return.xhtml"] {
    let data = try command(["/usr/bin/unzip", "-p", archive.path, href], at: root)
    let parser = XMLParser(data: data)
    parser.shouldResolveExternalEntities = false
    let chapter = Chapter(href: href)
    parser.delegate = chapter
    try require(parser.parse(), "XML parse \(href): \(String(describing: parser.parserError))")
    documentElements[href] = chapter.elements
    if href.hasSuffix("start.xhtml") || href.hasSuffix("return.xhtml") { decoded += chapter.blocks }
}
let container = documentElements["META-INF/container.xml"]!
try require(container.contains { $0.0 == "rootfile" && $0.1["full-path"] == "EPUB/package.opf" }, "EPUB rootfile")
let package = documentElements["EPUB/package.opf"]!
try require(package.contains { $0.0 == "package" && $0.1["version"] == "3.0" }, "EPUB version")
try require(package.contains { $0.0 == "spine" && $0.1["page-progression-direction"] == "rtl" }, "EPUB progression")
let manifest = package.filter { $0.0 == "item" }
try require(manifest.count == 4 && Set(manifest.compactMap { $0.1["id"] }).count == 4, "EPUB manifest IDs")
try require(package.filter { $0.0 == "itemref" }.compactMap { $0.1["idref"] } == ["start", "return"], "EPUB spine ordering")
for (_, item) in manifest {
    _ = try command(["/usr/bin/unzip", "-p", archive.path, "EPUB/" + item["href"]!], at: root)
}
let nav = documentElements["EPUB/nav.xhtml"]!
try require(nav.filter { $0.0 == "a" }.compactMap { $0.1["href"] } == ["start.xhtml#opening", "return.xhtml#crossing"], "EPUB contents links")
for href in ["EPUB/start.xhtml", "EPUB/return.xhtml"] {
    let ids = documentElements[href]!.compactMap { $0.1["id"] }
    try require(ids.count == Set(ids).count, "Unique block IDs in \(href)")
}
let css = try command(["/usr/bin/unzip", "-p", archive.path, "EPUB/book.css"], at: root)
try require(css == Data(contentsOf: fixtures.appendingPathComponent("epub/EPUB/book.css")), "EPUB authored flow stylesheet")
try require(decoded == expected.blocks, "Decoded source blocks/authored ruby mismatch")
let plain = try String(contentsOf: fixtures.appendingPathComponent("journey.txt"), encoding: .utf8)
try require(plain == expected.blocks.map(\.text).joined(separator: "\n\n") + "\n", "Plain text structure")
for block in decoded {
    for reading in block.readings {
        let bytes = Array(block.text.utf8)
        try require(String(bytes: bytes[reading.start..<reading.end], encoding: .utf8) != nil, "Ruby UTF-8 boundaries")
    }
}
let saved = expected.restore
guard let restored = decoded.first(where: { $0.href == saved.href && $0.id == saved.blockId }) else {
    throw FixtureError.invalid("Restore block")
}
try require(String(bytes: Array(restored.text.utf8)[saved.start..<saved.end], encoding: .utf8) == saved.quote, "Restore quote")
try require(decoded.filter { $0.text == restored.text }.count == 2, "Duplicate quote fixture")
// Restore has no layout/page index dependency; actual reflow remains integration QA.
try JSONEncoder().encode(decoded).write(to: output.appendingPathComponent("decoded-blocks.json"))
guard let pdf = PDFDocument(url: fixtures.appendingPathComponent("journey.pdf")),
      let first = pdf.page(at: 0), let blank = pdf.page(at: 1), let rotated = pdf.page(at: 2) else {
    throw FixtureError.invalid("PDF decoding")
}
try require(pdf.pageCount == expected.pdf.pageCount, "PDF page count")
try require(first.string == expected.pdf.page0Text, "PDF first-page text: \(first.string ?? "nil")")
try require(!(blank.string ?? "").isEmpty == expected.pdf.page1HasText, "PDF no-text page")
try require(rotated.string == expected.pdf.page2Text, "PDF rotated text")
try require(rotated.rotation == expected.pdf.page2Rotation, "PDF rotation")
try require(rotated.bounds(for: .cropBox) == rectangle(expected.pdf.page2CropBox), "PDF crop box")
guard let selection = first.selection(for: NSRange(location: expected.pdf.selectionStartUTF16, length: expected.pdf.selectionLengthUTF16)) else {
    throw FixtureError.invalid("PDF text selection")
}
let bounds = selection.bounds(for: first)
try require(selection.string == expected.pdf.selectionText, "PDF selected text")
try require(rectangle(expected.pdf.selectionContainerPDFPoints).contains(bounds) && bounds.width > 0, "PDF selection coordinates")
let box = first.bounds(for: .cropBox)
let normalized = CGRect(x: (bounds.minX - box.minX) / box.width,
                        y: (box.maxY - bounds.maxY) / box.height,
                        width: bounds.width / box.width, height: bounds.height / box.height)
let report = """
PDFKit macOS: 3 pages; exact text on pages 0/2; page 1 no text.
selection utf16=[26,38) text=small bridge
selection PDF bottom-left points=\(bounds)
selection normalized top-left crop-relative=\(normalized)
page2 rotation=\(rotated.rotation) crop=\(rotated.bounds(for: .cropBox))
EPUB: ZIP CRC, first stored mimetype, five XML documents, 7 blocks, 3 authored reading spans.
Restore: EPUB/return.xhtml#bridge-two utf8=[4,16), duplicate quote disambiguated.
Mobile rendering and actual application reflow/selection/restart: NOT RUN.
"""
try report.write(to: output.appendingPathComponent("decoded-report.txt"), atomically: true, encoding: .utf8)
for index in 0..<pdf.pageCount {
    let image = pdf.page(at: index)!.thumbnail(of: NSSize(width: 612, height: 792), for: .cropBox)
    guard let tiff = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff),
          let png = bitmap.representation(using: .png, properties: [:]) else {
        throw FixtureError.invalid("PDF rendered thumbnail \(index)")
    }
    try png.write(to: output.appendingPathComponent("pdf-page-\(index).png"))
}
print(report)
print("PASS reader fixture decoding")
