import Foundation

// One inference across all Apple OCR providers. Cancellation of executing work
// retains its slot until the native call unwinds and releases its bitmap.
final class NativeOcrRequests: @unchecked Sendable {
  private let lock = NSLock()
  private var active: (id: String, job: OcrRecognitionJob, running: Bool)?
  private var display: OcrRecognitionJob?
  private var closed = false

  func reserve(_ id: String) throws {
    guard !id.isEmpty, id.utf8.count <= 128 else { throw OcrProviderError.failed("Invalid OCR request identity.") }
    lock.lock(); defer { lock.unlock() }
    guard !closed, active == nil else { throw OcrProviderError.busy }
    active = (id, OcrRecognitionJob(), false)
  }
  func start(_ id: String) throws -> OcrRecognitionJob {
    lock.lock(); defer { lock.unlock() }
    guard !closed, let value = active, value.id == id else { throw CancellationError() }
    guard !value.running else { throw OcrProviderError.busy }
    active = (value.id, value.job, true)
    return value.job
  }
  func finish(_ id: String, job: OcrRecognitionJob) {
    lock.lock(); defer { lock.unlock() }
    if active?.id == id, active?.job === job { active = nil }
  }
  func cancel(_ id: String) {
    lock.lock()
    let value = active?.id == id ? active : nil
    if value?.running == false { active = nil }
    lock.unlock()
    value?.job.cancel()
  }
  @discardableResult
  func close() -> [String] {
    lock.lock()
    closed = true
    let value = active
    let image = display
    if value?.running == false { active = nil }
    lock.unlock()
    value?.job.cancel()
    image?.cancel()
    if let value, value.running { return [value.id] }
    return []
  }

  private func response(_ action: [String: Any], expected: String,
                        execute: (String) throws -> String) throws -> (String, [String: Any]) {
    let request = String(decoding: try JSONSerialization.data(withJSONObject: action), as: UTF8.self)
    let raw = try execute(request)
    guard raw.utf8.count <= 1024 * 1024,
          let object = try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any] else {
      throw OcrProviderError.failed("Malformed or unbounded runtime OCR response.")
    }
    guard object["type"] as? String == expected else {
      throw OcrProviderError.failed(object["message"] as? String ?? "Unexpected runtime OCR response.")
    }
    return (raw, object)
  }
  func cancel(_ id: String, execute: (String) throws -> String) throws {
    cancel(id)
    let (_, object) = try response(["type": "cancel_ocr", "requestId": id], expected: "ocr_cancelled", execute: execute)
    guard object["requestId"] as? String == id else { throw OcrProviderError.failed("Cancelled OCR request identity changed.") }
  }
  func recognize(_ id: String, requestJSON: String,
                 execute: @escaping @Sendable (String) throws -> String) async throws -> String {
    let job = try start(id)
    defer { finish(id, job: job) }
    do {
      try job.check()
      guard requestJSON.utf8.count <= 16 * 1024 else { throw OcrProviderError.limit("OCR request exceeds 16 KiB.") }
      let data = Data(requestJSON.utf8)
      let request = try JSONDecoder().decode(AppleOcrRequest.self, from: data)
      guard request.requestId == id else { throw OcrProviderError.failed("Request identity changed before OCR planning.") }
      let (_, planned) = try response(["type": "plan_ocr", "request": try JSONSerialization.jsonObject(with: data)],
                                     expected: "ocr_plan", execute: execute)
      guard let value = planned["plan"] else { throw OcrProviderError.failed("Missing OCR plan.") }
      let plan = try JSONDecoder().decode(AppleOcrPlan.self, from: JSONSerialization.data(withJSONObject: value))
      guard plan.requestId == id, plan.sourceId == request.sourceId,
            plan.contentRevision == request.contentRevision, plan.resourceId == request.resourceId,
            plan.providerId == request.providerId, plan.recognitionLanguages == request.recognitionLanguages,
            plan.crop == request.crop else { throw OcrProviderError.failed("Admitted OCR source identity changed.") }
      try job.check()
      let result = try await AppleOcrProvider.recognize(plan: plan, job: job)
      let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(result))
      return try job.publish {
        let (raw, completed) = try response(["type": "complete_ocr", "result": encoded], expected: "ocr_page", execute: execute)
        guard let page = completed["page"] as? [String: Any],
              page["sourceId"] as? String == plan.sourceId,
              page["contentRevision"] as? String == plan.contentRevision,
              page["resourceId"] as? String == plan.resourceId else {
          throw OcrProviderError.failed("Persisted OCR page identity changed.")
        }
        return raw
      }
    } catch {
      job.cancel()
      do { _ = try response(["type": "cancel_ocr", "requestId": id], expected: "ocr_cancelled", execute: execute) }
      catch { NSLog("OCR runtime cancellation cleanup failed: %@", error.localizedDescription) }
      throw error
    }
  }
  func imagePageUri(_ sourceId: String, resourceId: String, cropJSON: String? = nil,
                    execute: (String) throws -> String) throws -> String {
    // A separately bounded display conversion must not prevent viewing a source
    // while its OCR is pending. It never starts an inference or queues a folder.
    lock.lock()
    guard !closed, display == nil else { lock.unlock(); throw OcrProviderError.busy }
    let job = OcrRecognitionJob()
    display = job
    lock.unlock()
    defer {
      lock.lock()
      if display === job { display = nil }
      lock.unlock()
    }
    let (_, object) = try response(["type": "image_page_location", "sourceId": sourceId, "resourceId": resourceId],
                                   expected: "image_page_location", execute: execute)
    guard let value = object["location"] else { throw OcrProviderError.failed("Missing image page location.") }
    let location = try JSONDecoder().decode(AppleImagePageLocation.self, from: JSONSerialization.data(withJSONObject: value))
    guard location.sourceId == sourceId, location.resourceId == resourceId else {
      throw OcrProviderError.failed("Resolved image page identity changed.")
    }
    let crop: AppleOcrRect?
    if let cropJSON {
      guard cropJSON.utf8.count <= 1024 else { throw OcrProviderError.limit("Display crop exceeds its bound.") }
      crop = try JSONDecoder().decode(AppleOcrRect.self, from: Data(cropJSON.utf8))
    } else { crop = nil }
    let uri = try AppleOcrProvider.imagePageUri(location: location, job: job, crop: crop)
    return try job.publish { uri }
  }
}
