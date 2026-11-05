import ExpoModulesCore
import Foundation
import UIKit

// The module retains this delegate until the OS reports export or cancellation.
final class AuthoredMediaExport: NSObject, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
  let promise: Promise
  private let finished: () -> Void
  private let temporary: URL
  private var completed = false

  init(promise: Promise, temporary: URL, finished: @escaping () -> Void) {
    self.promise = promise
    self.temporary = temporary
    self.finished = finished
  }
  private func finish(_ saved: Bool) {
    guard !completed else { return }
    completed = true
    do { try FileManager.default.removeItem(at: temporary) }
    catch { NSLog("Media export cleanup failed: %@", error.localizedDescription) }
    promise.resolve(saved)
    finished()
  }
  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { finish(!urls.isEmpty) }
  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { finish(false) }
  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) { finish(false) }
  func cancel() { finish(false) }
}
