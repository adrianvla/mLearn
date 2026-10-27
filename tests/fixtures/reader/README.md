# Reader fixtures

Original, small CC0-1.0 test content, authored for mLearn. No external book, live profile, downloaded font, or model is included.

| File | Intended seam |
| --- | --- |
| `journey.txt` | UTF-8, astral character before selection, paragraph structure, repeated passage |
| `continuity.txt` | Same English target as the Watch fixture for real cross-surface Knowledge verification |
| `journey.epub` | Actual EPUB 3 ZIP with first uncompressed mimetype, OPF, contents, two spine items, authored ruby, vertical default, horizontal override, inline original SVG |
| `journey.pdf` | Actual three-page CoreGraphics PDF: selectable text; graphics-only page with no extractable text; cropped/rotated selectable page |
| `expected.json` | Independent expected base strings, half-open UTF-8 ruby spans, duplicate-passage restore anchor, PDF UTF-16 selection and containing source rectangle |
| `epub/` | Retained EPUB source documents; not a second runtime implementation |
| `../../../tools/fixtures/reader/documents.swift` | Generator and decoder using installed zip/unzip, Foundation XMLParser, CoreGraphics/CoreText, and macOS PDFKit |

From the repository root on macOS, export the lane's `TMPDIR`, `NODE_COMPILE_CACHE`, `BUN_RUNTIME_TRANSPILER_CACHE_PATH`, and `CARGO_BUILD_JOBS=2`, then:

```
swift -module-cache-path "$TMPDIR/swift-module-cache" tools/fixtures/reader/documents.swift verify
```

`generate` creates the binary EPUB/PDF and immediately verifies them. It requires no existing `journey.epub` and a fresh `$TMPDIR/epub-stage`; preserve delivered binaries when only verification is needed. Generation uses real archive/PDF tools, not text renamed to document extensions. Generated PDF metadata/ZIP timestamps may change across regeneration; content assertions, rather than binary reproducibility, are the fixture contract.

The verifier checks ZIP CRCs, first stored mimetype, XML well-formedness, rootfile, manifest resources, spine order, contents links, duplicate IDs, exact base text and authored reading spans. It excludes `rt`/`rp` from base text. This small fixture decoder is not a production EPUB parser, CSS engine, sanitizer, or full EPUBCheck validator.

PDFKit reopens the PDF and verifies page count, exact extracted text, absence of text on page 1, selection string and source coordinates, page 2 rotation/crop. It renders three offscreen thumbnails into `$TMPDIR`, and writes `decoded-blocks.json` and `decoded-report.txt`. PDFKit selection indices are UTF-16; Reader canonical spans must be converted to UTF-8 at the host boundary.

`restore` intentionally selects `bridge-two` rather than the identical `bridge-one` paragraph. It covers the immutable source identity needed for reflow/restart; the fixture verifier does not implement or certify app pagination, persistence, restart, navigation, touch selection, native accessibility, or mobile rendering.

MacOS PDF decoding/rendering passed on October 22, 2026. EPUB layout/ruby/vertical rendering, EPUBCheck conformance, Android PDF decoding/rendering, and iOS PDF decoding/rendering have not been run. A graphics-only PDF page is an honest render-only case; it is not evidence that OCR ran.
