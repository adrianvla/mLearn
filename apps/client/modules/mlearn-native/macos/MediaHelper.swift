import AVFoundation
import Foundation

// A signed, bundled executable. Only the native host supplies a validated plan
// on stdin; it is never compiled or fetched at application runtime.
@main
enum MediaHelper {
  static func main() async {
    do {
      let input = FileHandle.standardInput.readDataToEndOfFile()
      struct Input: Decodable {
        let plan: MediaCapturePlan
        let directory: String
      }
      let request = try JSONDecoder().decode(Input.self, from: input)
      let file = try await AppleMediaProvider.capture(
        plan: request.plan, directory: URL(fileURLWithPath: request.directory),
        job: MediaExtractionJob())
      FileHandle.standardOutput.write(try JSONEncoder().encode(file))
    } catch {
      FileHandle.standardError.write(Data(error.localizedDescription.utf8))
      exit(1)
    }
  }
}
