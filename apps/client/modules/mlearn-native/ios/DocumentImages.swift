import Foundation

// One accepted source image, never an arbitrary renderer path or a binary cache.
struct DocumentImageLocation: Decodable {
  let sourceId: String
  let resourceId: String
  let path: String
  let mimeType: String
  let byteLength: Int

  func uri() throws -> String {
    guard ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"].contains(mimeType),
          byteLength > 0, byteLength <= 2 * 1024 * 1024 else {
      throw MediaProviderError.failed("Document resource is not a bounded supported image.")
    }
    let url = URL(fileURLWithPath: path)
    let attributes = try FileManager.default.attributesOfItem(atPath: path)
    guard attributes[.type] as? FileAttributeType == .typeRegular else {
      throw MediaProviderError.failed("Document image is not an ordinary file.")
    }
    let input = try FileHandle(forReadingFrom: url)
    defer { do { try input.close() } catch { NSLog("Document image close failed: %@", error.localizedDescription) } }
    guard try input.seekToEnd() == UInt64(byteLength) else {
      throw MediaProviderError.failed("Document image size changed.")
    }
    try input.seek(toOffset: 0)
    var bytes = Data()
    while bytes.count <= byteLength {
      guard let chunk = try input.read(upToCount: min(64 * 1024, byteLength + 1 - bytes.count)),
            !chunk.isEmpty else { break }
      bytes.append(chunk)
    }
    guard bytes.count == byteLength else { throw MediaProviderError.failed("Document image size changed.") }
    return "data:\(mimeType);base64,\(bytes.base64EncodedString())"
  }
}
