import Foundation

precondition(CommandLine.arguments.count == 3, "Expected source and destination directories")
let source = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let destination = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
let files = [
    ("watch-fixture.mp4", "m01-watch.mp4"),
    ("watch-fixture.srt", "m01-watch.srt"),
    ("watch-japanese.mp4", "m01-japanese.mp4"),
    ("watch-japanese.srt", "m01-japanese.srt"),
]
try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
for (input, output) in files {
    try FileManager.default.copyItem(
        at: source.appendingPathComponent(input),
        to: destination.appendingPathComponent(output)
    )
}
