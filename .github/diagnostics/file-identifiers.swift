// Read only after the original UI flow: resource queries may warm provider caches.
import Foundation

var observations: [[String: String]] = []
for path in CommandLine.arguments.dropFirst() {
    var observation = [
        "path": path,
        "exists": String(FileManager.default.fileExists(atPath: path)),
        "readable": String(FileManager.default.isReadableFile(atPath: path)),
    ]
    do {
        let values = try URL(fileURLWithPath: path).resourceValues(forKeys: [
            .fileResourceIdentifierKey, .documentIdentifierKey,
            .volumeIdentifierKey, .fileSizeKey, .isRegularFileKey,
        ])
        observation["fileIdentifier"] = String(describing: values.fileResourceIdentifier)
        observation["documentIdentifier"] = String(describing: values.documentIdentifier)
        observation["volumeIdentifier"] = String(describing: values.volumeIdentifier)
        observation["bytes"] = String(describing: values.fileSize)
        observation["regular"] = String(describing: values.isRegularFile)
        observation["status"] = "read"
    } catch {
        let nativeError = error as NSError
        observation["status"] = "error"
        observation["errorDomain"] = nativeError.domain
        observation["errorCode"] = String(nativeError.code)
        observation["error"] = nativeError.localizedDescription
    }
    observations.append(observation)
}
let data = try JSONSerialization.data(withJSONObject: observations, options: [.prettyPrinted, .sortedKeys])
print(String(decoding: data, as: UTF8.self))
