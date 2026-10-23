import ExpoModulesCore
import Foundation
import UIKit

public class MlearnNativeModule: Module {
  private var bridgeInstance: RuntimeBridge?
  private let initializationLock = NSLock()
  private let captures = NativeMediaCaptures()
  private var mediaExport: AuthoredMediaExport?
  private weak var mediaExportController: UIDocumentPickerViewController?
  private var mediaExportPending = false
  private var mediaClosed = false

  private func mediaResponse(_ action: [String: Any], expected: String) throws -> [String: Any] {
    let request = String(decoding: try JSONSerialization.data(withJSONObject: action), as: UTF8.self)
    let response = try bridge().execute(request: request)
    guard let object = try JSONSerialization.jsonObject(with: Data(response.utf8)) as? [String: Any] else {
      throw MediaProviderError.failed("Malformed runtime media response.")
    }
    guard object["type"] as? String == expected else {
      throw MediaProviderError.failed(object["message"] as? String ?? "Runtime media action failed.")
    }
    return object
  }

  private func bridge() throws -> RuntimeBridge {
    initializationLock.lock()
    defer { initializationLock.unlock() }
    if let bridgeInstance { return bridgeInstance }
    let base = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let directory = base.appendingPathComponent("mlearn-v3", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let bridgeInstance = try RuntimeBridge(profilePath: directory.path)
    self.bridgeInstance = bridgeInstance
    return bridgeInstance
  }

  public func definition() -> ModuleDefinition {
    Name("MlearnNative")
    OnDestroy {
      self.captures.close()
      DispatchQueue.main.async {
        self.mediaClosed = true
        self.mediaExportController?.dismiss(animated: false)
        self.mediaExport?.cancel()
        self.mediaExport = nil
      }
    }
    AsyncFunction("reserveMediaCapture") { (id: String) throws in try self.captures.reserve(id) }
    AsyncFunction("importPickedMedia") { (uri: String, name: String) throws -> String in
      try self.captures.importPicked(uri, name: name)
    }.runOnQueue(DispatchQueue.global(qos: .userInitiated))
    AsyncFunction("importPickedDocument") { (uri: String, name: String) throws -> String in
      try self.captures.importPicked(uri, name: name, document: true)
    }.runOnQueue(DispatchQueue.global(qos: .userInitiated))
    AsyncFunction("documentImageUri") { (sourceId: String, resourceId: String) throws -> String in
      let response = try self.mediaResponse(["type": "document_resource", "sourceId": sourceId, "resourceId": resourceId], expected: "document_resource")
      guard let location = response["location"] else { throw MediaProviderError.failed("Missing document image location.") }
      let image = try JSONDecoder().decode(DocumentImageLocation.self, from: JSONSerialization.data(withJSONObject: location))
      guard image.sourceId == sourceId, image.resourceId == resourceId else {
        throw MediaProviderError.failed("Document image identity changed.")
      }
      return try image.uri()
    }.runOnQueue(DispatchQueue.global(qos: .userInitiated))
    AsyncFunction("cancelMediaCapture") { (id: String) in self.captures.cancel(id) }
      .runOnQueue(DispatchQueue.global(qos: .userInitiated))
    AsyncFunction("releaseMediaCapture") { (path: String) throws in try self.captures.release(path) }
    AsyncFunction("captureMedia") { (id: String, request: String) async throws -> String in
      var admitted = false
      do {
        let job = try self.captures.start(id)
        admitted = true
        try job.check()
        let selection = try JSONSerialization.jsonObject(with: Data(request.utf8))
        let response = try self.mediaResponse(["type": "plan_material_media", "request": selection], expected: "material_media_plan")
        guard let plan = response["plan"] else { throw MediaProviderError.failed("Missing media plan.") }
        let decoded = try JSONDecoder().decode(MediaCapturePlan.self, from: JSONSerialization.data(withJSONObject: plan))
        return try await self.captures.capture(id, plan: decoded)
      } catch {
        if admitted { self.captures.finishFailed(id) }
        throw error
      }
    }
    AsyncFunction("authoredMediaUri") { (id: String) throws -> String in
      let response = try self.mediaResponse(["type": "material_media", "id": id], expected: "material_media")
      guard let location = response["location"] as? [String: Any], let path = location["path"] as? String else {
        throw MediaProviderError.failed("Missing authored media location.")
      }
      return URL(fileURLWithPath: path).absoluteString
    }.runOnQueue(DispatchQueue.global(qos: .userInitiated))
    AsyncFunction("exportAuthoredMedia") { (id: String, promise: Promise) in
      guard !self.mediaClosed, !self.mediaExportPending else {
        promise.reject(MediaProviderError.failed("A media export is already open or the module was destroyed."))
        return
      }
      self.mediaExportPending = true
      // Resolve through the same runtime off the main queue, then present the OS picker.
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          let response = try self.mediaResponse(["type": "material_media", "id": id], expected: "material_media")
          guard let location = response["location"] as? [String: Any],
                let path = location["path"] as? String,
                let media = location["media"] as? [String: Any],
                let name = media["name"] as? String, name == URL(fileURLWithPath: name).lastPathComponent else {
            throw MediaProviderError.failed("Missing authored media location.")
          }
          let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("mlearn-export-\(UUID().uuidString)", isDirectory: true)
          try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
          let copy = temporary.appendingPathComponent(name)
          do { try AppleMediaProvider.copyMedia(from: URL(fileURLWithPath: path), to: copy) }
          catch { try FileManager.default.removeItem(at: temporary); throw error }
          DispatchQueue.main.async {
            guard !self.mediaClosed, let controller = self.appContext?.utilities?.currentViewController() else {
              self.mediaExportPending = false
              do { try FileManager.default.removeItem(at: temporary) }
              catch { NSLog("Media export cleanup failed: %@", error.localizedDescription) }
              promise.reject(MediaProviderError.failed("A media export is already open or no presentation controller is available."))
              return
            }
            let delegate = AuthoredMediaExport(promise: promise, temporary: temporary) {
              self.mediaExport = nil
              self.mediaExportController = nil
              self.mediaExportPending = false
            }
            self.mediaExport = delegate
            let picker = UIDocumentPickerViewController(forExporting: [copy], asCopy: true)
            picker.delegate = delegate
            picker.presentationController?.delegate = delegate
            self.mediaExportController = picker
            controller.present(picker, animated: true)
          }
        } catch {
          DispatchQueue.main.async {
            self.mediaExportPending = false
            promise.reject(error)
          }
        }
      }
    }.runOnQueue(.main)
    AsyncFunction("cancelSourceOpen") { () throws -> Void in
      try self.bridge().cancelSourceOpen()
    }.runOnQueue(DispatchQueue.global(qos: .userInitiated))
    // Expo's serial default queue would put checkpoints behind cold guest work.
    // Rust owns bounded admission and releases storage while the guest runs.
    AsyncFunction("execute") { (request: String) throws -> String in
      try self.bridge().execute(request: request)
    }.runOnQueue(DispatchQueue.global(qos: .userInitiated))
  }
}
