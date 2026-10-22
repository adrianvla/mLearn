// Run after the UI outcome; inode lookup is not document-ID lookup.
import Foundation
import Darwin

struct VolumeCapabilities {
    var length: UInt32 = 0
    var value = vol_capabilities_attr_t()
}

var observations: [[String: String]] = []
for path in CommandLine.arguments.dropFirst() {
    var observation = [
        "path": path,
        "exists": String(FileManager.default.fileExists(atPath: path)),
        "readable": String(FileManager.default.isReadableFile(atPath: path)),
    ]
    var filesystem = statfs()
    if statfs(path, &filesystem) == 0 {
        observation["filesystemType"] = withUnsafePointer(to: &filesystem.f_fstypename) {
            String(cString: UnsafeRawPointer($0).assumingMemoryBound(to: CChar.self))
        }
        observation["mountPoint"] = withUnsafePointer(to: &filesystem.f_mntonname) {
            String(cString: UnsafeRawPointer($0).assumingMemoryBound(to: CChar.self))
        }
        observation["nativeFSID"] = String(describing: filesystem.f_fsid)
        var file = stat()
        if lstat(path, &file) == 0 {
            observation["inode"] = String(file.st_ino)
            var buffer = [CChar](repeating: 0, count: Int(PATH_MAX))
            let length = fsgetpath(&buffer, buffer.count, &filesystem.f_fsid, file.st_ino)
            observation["inodeResolutionResult"] = String(length)
            if length >= 0 {
                let resolved = String(cString: buffer)
                observation["inodeResolvedPath"] = resolved
                var resolvedFile = stat()
                if lstat(resolved, &resolvedFile) == 0 {
                    observation["inodeRoundTripMatches"] = String(
                        resolvedFile.st_ino == file.st_ino && resolvedFile.st_dev == file.st_dev
                    )
                } else {
                    observation["resolvedStatErrno"] = String(errno)
                }
            } else {
                observation["inodeResolutionErrno"] = String(errno)
            }
        } else {
            observation["statErrno"] = String(errno)
        }
    } else {
        observation["statfsErrno"] = String(errno)
    }
    var attributes = attrlist()
    attributes.bitmapcount = UInt16(ATTR_BIT_MAP_COUNT)
    attributes.volattr = UInt32(ATTR_VOL_INFO) | UInt32(ATTR_VOL_CAPABILITIES)
    var capabilities = VolumeCapabilities()
    if getattrlist(path, &attributes, &capabilities, MemoryLayout<VolumeCapabilities>.size, 0) == 0 {
        for (name, flag) in [
            ("pathFromID", UInt32(VOL_CAP_FMT_PATH_FROM_ID)),
            ("documentID", UInt32(VOL_CAP_FMT_DOCUMENT_ID)),
        ] {
            observation["\(name)CapabilityValid"] = String(capabilities.value.valid.0 & flag != 0)
            observation["\(name)CapabilitySupported"] = String(capabilities.value.capabilities.0 & flag != 0)
        }
    } else {
        observation["volumeCapabilitiesErrno"] = String(errno)
    }
    let descriptor = open(path, O_RDONLY)
    if descriptor >= 0 {
        var buffer = [CChar](repeating: 0, count: Int(PATH_MAX))
        if fcntl(descriptor, F_GETPATH, &buffer) == 0 {
            observation["openedPath"] = String(cString: buffer)
        } else {
            observation["openedPathErrno"] = String(errno)
        }
        close(descriptor)
    } else {
        observation["openErrno"] = String(errno)
    }
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
