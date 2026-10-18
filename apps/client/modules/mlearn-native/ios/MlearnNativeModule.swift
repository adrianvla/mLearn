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
