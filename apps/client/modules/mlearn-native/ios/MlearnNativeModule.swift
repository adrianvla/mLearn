import ExpoModulesCore
import Foundation

public class MlearnNativeModule: Module {
  private var bridgeInstance: RuntimeBridge?
  private let initializationLock = NSLock()

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
    AsyncFunction("execute") { (request: String) throws -> String in
      try self.bridge().execute(request: request)
    }
  }
}
