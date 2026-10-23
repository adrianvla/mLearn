import Foundation

final class NativeMediaCaptures {
  private let lock = NSLock()
  private var active: (String, MediaExtractionJob, Bool)?
  private var outputs: Set<String> = []
  private var closed = false
  private let root = FileManager.default.temporaryDirectory.appendingPathComponent("mlearn-capture-\(UUID().uuidString)", isDirectory: true)

  func reserve(_ id: String) throws {
    lock.lock()
    defer { lock.unlock() }
    guard !closed, active == nil, outputs.count < 8 else { throw MediaProviderError.failed("Media capture is busy; release pending files and retry.") }
    active = (id, MediaExtractionJob(), false)
  }
  func reservePick(_ name: String) throws -> String {
    lock.lock()
    defer { lock.unlock() }
    guard !closed, outputs.count + (active == nil ? 0 : 1) < 8 else { throw MediaProviderError.failed("Release pending media selections before picking more files.") }
    guard !name.isEmpty, name.utf8.count <= 255, name != ".", name != "..",
          !name.contains("/"), !name.contains("\\"), !name.contains("\0") else { throw MediaProviderError.failed("Invalid selected media filename.") }
    let directory = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    let path = directory.appendingPathComponent(name).path
    outputs.insert(path)
    return path
  }
  func importPicked(_ uri: String, name: String, document: Bool = false) throws -> String {
    if document {
      guard ["txt", "epub", "pdf"].contains(URL(fileURLWithPath: name).pathExtension.lowercased()) else {
        throw MediaProviderError.failed("Select a TXT, EPUB or PDF document.")
      }
    }
    guard let source = URL(string: uri), source.isFileURL else {
      throw MediaProviderError.failed("The picker returned an invalid file URL.")
    }
    let scoped = source.startAccessingSecurityScopedResource()
    defer { if scoped { source.stopAccessingSecurityScopedResource() } }
    let path = try reservePick(name)
    do {
      var coordinationError: NSError?
      var copyError: Error?
      NSFileCoordinator().coordinate(readingItemAt: source, options: .withoutChanges, error: &coordinationError) { readable in
        do {
          try AppleMediaProvider.copyMedia(from: readable, to: URL(fileURLWithPath: path),
            maximumBytes: document ? 8 * 1024 * 1024 : AppleMediaProvider.maximumBytes,
            checkCancelled: {
              self.lock.lock()
              let available = !self.closed && self.outputs.contains(path)
              self.lock.unlock()
              guard available else { throw CancellationError() }
            })
        }
        catch { copyError = error }
      }
      if let error = coordinationError { throw error }
      if let error = copyError { throw error }
      lock.lock()
      let available = !closed && outputs.contains(path)
      lock.unlock()
      guard available else { throw CancellationError() }
      return path
    } catch {
      try release(path)
      throw error
    }
  }
  func start(_ id: String) throws -> MediaExtractionJob {
    lock.lock()
    defer { lock.unlock() }
    guard let active, active.0 == id else { throw CancellationError() }
    guard !active.2 else { throw MediaProviderError.failed("This media job is already running.") }
    self.active = (active.0, active.1, true)
    return active.1
  }
  func job(_ id: String) throws -> MediaExtractionJob {
    lock.lock()
    defer { lock.unlock() }
    guard let active, active.0 == id else { throw CancellationError() }
    return active.1
  }
  func cancel(_ id: String) {
    lock.lock()
    let job = active?.0 == id ? active?.1 : nil
    lock.unlock()
    job?.cancel()
  }
  func capture(_ id: String, plan: MediaCapturePlan) async throws -> String {
    let job = try self.job(id)
    let directory = root.appendingPathComponent(UUID().uuidString, isDirectory: true)
    defer { finishFailed(id) }
    let file = try await AppleMediaProvider.capture(plan: plan, directory: directory, job: job)
    do { return try publish(file, job: job) }
    catch {
      try FileManager.default.removeItem(at: directory)
      throw error
    }
  }
  private func publish(_ file: CapturedMediaFile, job: MediaExtractionJob) throws -> String {
    let data = try JSONEncoder().encode(file)
    lock.lock()
    defer { lock.unlock() }
    try job.check()
    outputs.insert(file.path)
    return String(decoding: data, as: UTF8.self)
  }
  func finishFailed(_ id: String) {
    lock.lock()
    if active?.0 == id { active = nil }
    let removeRoot = closed && active == nil
    lock.unlock()
    if removeRoot { removeTemporaryRoot() }
  }
  func release(_ path: String) throws {
    lock.lock()
    defer { lock.unlock() }
    guard outputs.contains(path) else { return }
    let directory = URL(fileURLWithPath: path).deletingLastPathComponent()
    if FileManager.default.fileExists(atPath: directory.path) {
      try FileManager.default.removeItem(at: directory)
    }
    outputs.remove(path)
  }
  func close() {
    lock.lock()
    closed = true
    active?.1.cancel()
    let removeRoot = active == nil
    outputs.removeAll()
    lock.unlock()
    if removeRoot { removeTemporaryRoot() }
  }
  private func removeTemporaryRoot() {
    if FileManager.default.fileExists(atPath: root.path) {
      do { try FileManager.default.removeItem(at: root) }
      catch { NSLog("Media owner cleanup failed: %@", error.localizedDescription) }
    }
  }
}
