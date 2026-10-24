# Original Vision OCR corpus

These are small original, synthetic reading samples, not screenshots of copyrighted
manga or learner data. `Probe.swift` draws the PNGs and an image-only PDF using
retained system fonts, then recognizes the real pixels with Apple Vision. The
drawn-text manifest is ground truth, not fabricated provider output. Text frames
are drawing frames, not ground-truth tight glyph boxes.

Cases: horizontal Japanese/Latin mixed text, two-page spread, vertical Japanese
with adjacent small publisher readings, low contrast plus glare, a shape-only
negative, a physically cropped spread region, a clockwise-rotated page, image-only
PDF raster, and Devanagari. These are prerequisite probes, not a claim of manga
recognition adequacy. Handwriting, real camera glare, perspective, photographed
manga, complex ruby and licensed document samples still need consuming-platform QA.

`manifest.json` pins dimensions, drawn text/coordinates/font and transforms.
`image-only.pdf` has only the original raster, so this case genuinely needs OCR.
Ordinary PDF text extraction must precede OCR in the product.

Run from repository root, after exporting the environment recorded in
`.mlearn/m03-m07/m06-vision/NOTEPAD.md`:

```sh
xcrun swiftc tests/fixtures/ocr/vision/Probe.swift \
  -module-cache-path "$TMPDIR/swift-module-cache" -o "$TMPDIR/vision-probe"
sandbox-exec -p '(version 1)(allow default)(deny network*)' \
  "$TMPDIR/vision-probe" tests/fixtures/ocr/vision .mlearn/m03-m07/m06-vision
```

This denies network operations by the probe and inherited child processes.
It does not turn off system networking or certify network behavior of all
out-of-process OS services. No remote OCR API is called; no separate model is
downloaded by this program. Device airplane-mode evidence remains required.

The probe is macOS-only because fixture drawing uses AppKit. Its Vision request
configuration is portable; the iOS adapter must use UIKit/Core Graphics/ImageIO
at the platform boundary and must not import this generator.
