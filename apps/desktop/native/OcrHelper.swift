import Foundation
import CoreGraphics
import ImageIO

// Bundled and signed alongside the application, never compiled at runtime.
@main
enum OcrHelper {
  struct Input: Decodable {
    let operation: String
    let plan: AppleOcrPlan?
    let location: AppleImagePageLocation?
    let output: String?
    let crop: AppleOcrRect?
  }
  static func main() async {
    do {
      let data = FileHandle.standardInput.readData(ofLength: 32769)
      guard data.count <= 32768 else { throw OcrProviderError.limit("Helper request exceeds 32 KiB.") }
      let input = try JSONDecoder().decode(Input.self, from: data)
      let result: Data
      switch input.operation {
      case "providers":
        result = try JSONEncoder().encode(AppleOcrProvider.providers())
      case "recognize":
        guard let plan = input.plan else { throw OcrProviderError.failed("Missing admitted plan.") }
        result = try await JSONEncoder().encode(AppleOcrProvider.recognize(plan: plan, job: OcrRecognitionJob()))
      case "display":
        guard let location = input.location else { throw OcrProviderError.failed("Missing admitted location.") }
        result = try JSONEncoder().encode(AppleOcrProvider.imagePageUri(location: location,
          job: OcrRecognitionJob(), crop: input.crop))
      case "pdf":
        guard let location = input.location, let output = input.output else { throw OcrProviderError.failed("Missing admitted PDF raster destination.") }
        try renderPdf(location, output: output)
        result = Data("null".utf8)
      default: throw OcrProviderError.failed("Unknown helper operation.")
      }
      FileHandle.standardOutput.write(result)
    } catch {
      FileHandle.standardError.write(Data(error.localizedDescription.utf8))
      exit(1)
    }
  }
  static func renderPdf(_ location: AppleImagePageLocation, output: String) throws {
    guard location.mimeType == "application/pdf", let index = location.pageIndex, index >= 0 else {
      throw OcrProviderError.failed("Not an admitted PDF page.")
    }
    let input = try FileHandle(forReadingFrom: URL(fileURLWithPath: location.path))
    defer { do { try input.close() } catch { NSLog("PDF close failed: %@", error.localizedDescription) } }
    let data = try input.read(upToCount: 8 * 1024 * 1024 + 1) ?? Data()
    guard !data.isEmpty, data.count <= 8 * 1024 * 1024,
          let provider = CGDataProvider(data: data as CFData), let pdf = CGPDFDocument(provider),
          pdf.isUnlocked, index < pdf.numberOfPages, let page = pdf.page(at: index + 1) else {
      throw OcrProviderError.failed("Cannot read admitted PDF.")
    }
    let box = page.getBoxRect(.cropBox)
    let swapped = abs(page.rotationAngle % 180) == 90
    let width = ceil(swapped ? box.height : box.width), height = ceil(swapped ? box.width : box.height)
    guard width.isFinite, height.isFinite, width >= 1, height >= 1,
          width <= 32768, height <= 32768, width * height <= 16_777_216 else {
      throw OcrProviderError.limit("PDF page exceeds the 16 megapixel bound.")
    }
    guard let context = CGContext(data: nil, width: Int(width), height: Int(height), bitsPerComponent: 8,
      bytesPerRow: Int(width) * 4, space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { throw OcrProviderError.failed("Cannot allocate PDF raster.") }
    let rect = CGRect(x: 0, y: 0, width: width, height: height)
    context.setFillColor(CGColor(gray: 1, alpha: 1)); context.fill(rect)
    context.concatenate(page.getDrawingTransform(.cropBox, rect: rect, rotate: 0, preserveAspectRatio: true))
    context.drawPDFPage(page)
    guard let image = context.makeImage(),
          let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: output) as CFURL, "public.png" as CFString, 1, nil) else {
      throw OcrProviderError.failed("Cannot encode PDF raster.")
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination) else { throw OcrProviderError.failed("Cannot finalize PDF raster.") }
  }
}
