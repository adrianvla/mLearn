// Synthetic offline acceptance media. Never reads the private acceptance corpus.
import Foundation
import AVFoundation
import CoreVideo
let directory=CommandLine.arguments[1]
func writeVideo(_ directory:String)throws->URL {
try FileManager.default.createDirectory(atPath:directory,withIntermediateDirectories:true)
let url=URL(fileURLWithPath:directory).appendingPathComponent("watch-fixture.mov")
if FileManager.default.fileExists(atPath:url.path){try FileManager.default.removeItem(at:url)}
let writer=try AVAssetWriter(outputURL:url,fileType:.mov)
let video=AVAssetWriterInput(mediaType:.video,outputSettings:[AVVideoCodecKey:AVVideoCodecType.h264,AVVideoWidthKey:640,AVVideoHeightKey:360])
let adaptor=AVAssetWriterInputPixelBufferAdaptor(assetWriterInput:video,sourcePixelBufferAttributes:[kCVPixelBufferPixelFormatTypeKey as String:kCVPixelFormatType_32BGRA,kCVPixelBufferWidthKey as String:640,kCVPixelBufferHeightKey as String:360])
writer.add(video)
writer.startWriting();writer.startSession(atSourceTime:.zero)
for frame in 0..<900 {
 while !video.isReadyForMoreMediaData {Thread.sleep(forTimeInterval:0.001)}
 var pixel:CVPixelBuffer?;CVPixelBufferPoolCreatePixelBuffer(nil,adaptor.pixelBufferPool!,&pixel)
 let buffer=pixel!;CVPixelBufferLockBaseAddress(buffer,[])
 let address=CVPixelBufferGetBaseAddress(buffer)!.assumingMemoryBound(to:UInt32.self)
 for i in 0..<(CVPixelBufferGetBytesPerRow(buffer)/4*360){address[i]=frame<450 ? 0xffd04040:0xff4080d0}
 CVPixelBufferUnlockBaseAddress(buffer,[])
 guard adaptor.append(buffer,withPresentationTime:CMTime(value:Int64(frame),timescale:30)) else {fatalError(writer.error?.localizedDescription ?? "Append failed")}
}
video.markAsFinished();let done=DispatchSemaphore(value:0);writer.finishWriting{done.signal()};done.wait()
guard writer.status == .completed else {fatalError(writer.error?.localizedDescription ?? "Encode failed")}

return url
}
let url=try writeVideo(directory)
let composition=AVMutableComposition()
let videoAsset=AVURLAsset(url:url)
let audioAsset=AVURLAsset(url:URL(fileURLWithPath:directory).appendingPathComponent("watch-tone.wav"))
let duration=try await videoAsset.load(.duration)
let videoTrack=try await videoAsset.loadTracks(withMediaType:.video).first!
let audioTrack=try await audioAsset.loadTracks(withMediaType:.audio).first!
try composition.addMutableTrack(withMediaType:.video,preferredTrackID:kCMPersistentTrackID_Invalid)!.insertTimeRange(CMTimeRange(start:.zero,duration:duration),of:videoTrack,at:.zero)
try composition.addMutableTrack(withMediaType:.audio,preferredTrackID:kCMPersistentTrackID_Invalid)!.insertTimeRange(CMTimeRange(start:.zero,duration:duration),of:audioTrack,at:.zero)
let final=URL(fileURLWithPath:directory).appendingPathComponent("watch-fixture.mp4")
if FileManager.default.fileExists(atPath:final.path){try FileManager.default.removeItem(at:final)}
let export=AVAssetExportSession(asset:composition,presetName:AVAssetExportPresetMediumQuality)!
try await export.export(to:final,as:.mp4)
print("H.264/AAC output with an authored 440Hz tone exported")
