# Document import projection

This crate owns source-format parsing, not storage, navigation state, language
analysis, Knowledge, capture, sessions or rendering. The runtime maps its local
types into the generated core protocol and persists the bounded result.

## Public boundary

```rust
parse(bytes: &[u8], format: Format, limits: Limits) -> Result<Document, Error>
parse_file(path: &Path, format: Format, limits: Limits) -> Result<Document, Error>
parse_cancellable(bytes: &[u8], format: Format, limits: Limits,
                  control: &ParseControl) -> Result<Document, Error>
resolve_anchor(document: &Document, anchor: &Anchor) -> Result<&str, Error>

PdfReader::open(bytes: &[u8], limits: Limits, control: ParseControl)
    -> Result<PdfReader, Error>
PdfReader::metadata(&self) -> &PdfMetadata
PdfReader::read_page(&mut self, original_zero_based_index: usize)
    -> Result<ParsedPdfPage, Error>
```

`ParseControl` uses the existing job's `Arc<AtomicU64>` and admitted epoch.
Cancellation is checked before work and before returning output; PDF execution
also receives that same epoch through `CompiledPlugin::invoke_cancellable`.
Drop `PdfReader` on cancellation/source switch to release its immutable asset and
executor owner. A new epoch may reopen the same source after any parser failure.
Native ZIP/XML work has finite admission bounds and checks cancellation at
publication; it is not cooperatively interrupted inside the library's inflate.

`Document` contains raw-byte SHA-256 `content_revision`, `parser_revision`,
format, authored progression, spine, navigation, ordered blocks, original PDF
page metadata, immutable image resources and explicit fidelity descriptions.
`Block` contains resource/id/kind, untouched canonical UTF-8 text, half-open byte
span, original XML/text container span where available, authored ruby spans,
optional image-resource identity and optional authored `WritingMode`.
`SpineItem` preserves its original manifest/resource/properties and root mode.
The `WritingMode` variants serialize as `horizontal-tb`, `vertical-rl` and
`vertical-lr`; absence is not an inferred language or user appearance choice.

Original authored IDs win. Missing IDs use original source-byte positions;
segments around embedded images/blocks use the enclosing ID plus canonical text
byte offset. Colliding projected identities fail admission. Anchors include
both revisions, resource, block and exact UTF-8 endpoints. Duplicate quotations
never determine identity. XML container spans are not per-character source maps.

Image blocks stay in authored text order. Their text is the authored accessible
label, not extracted image text; exclude image blocks from linguistic analysis.
`ImageResource.bytes` are original untrusted data to persist behind bounded
resource handles, not markup to inject into a renderer. Inline SVG preserves its
original source bytes. This crate does not execute scripts or decode pixels.

## PDF isolation

`document-pdf-guest` compiles the maintained lopdf parser into trusted internal
core Wasm. Its native Rust build exports wire types only; no native PDF parser
or native fallback is linked into this crate's production path. It is a
host-owned source-format processor, not downloaded language code or a catalog
entry. Reusing `CompiledPlugin` is mechanical reuse of its validated Wasmi
execution, global serialized owner, immutable assets, SDK ABI and cancellation.
There is no second engine, worker pool or custom allocator.

Eager PDF object loading, stream/font expansion and text extraction all run
inside the existing **Fresh 64 MiB / 32,000,000-fuel** policy. Metadata and one
original page are separate calls. Input is an immutable asset capped at 8 MiB;
the existing SDK bounds every envelope at 256 KiB. A page text ceiling of
32 KiB leaves room even for worst-case JSON escaping plus page metadata.
Each import admits at most 64 pages, 65 total attempts including metadata,
8192 objects, 512 KiB decoded page content, 2 MiB aggregate page content and
2 MiB aggregate text. Repeated and failed page attempts consume the same
attempt allowance; there are no automatic retries.

The retained host currently grants Fresh's 32M fuel in one initial allowance.
Root must transfer the post-start/ABI remainder into its existing sliced
`run` replenishment before claiming 1M-slice cancellation responsiveness.
This parser neither edits that shared owner nor raises the allowance. The
hard finite CPU/memory bound, deterministic in-execution cancellation owner
test, between-page cancellation and next-job recovery are separately verified.

The per-object/decode checks are useful rejections, not the aggregate safety
proof. The unchanged executor memory/fuel ceilings also contain allocations
and work that lopdf performs before those checks. Generic denied-growth and
infinite-fuel fixtures exercise the exact same executor; real many-object and
aggregate compressed-object PDFs exercise the shipped parser artifact.

PDF text is exact lopdf output in content-operation order, not guaranteed visual
reading order. Media/crop boxes, rotation and object IDs remain original page
metadata. Empty pages explicitly report `text_available = false`. Images,
glyph rectangles, rendering, visual selection, OCR and inferred geometry are
unavailable, not fabricated.

## Native limits and fidelity

`Limits::default()` gives hard ceilings; callers may lower them but cannot
raise them. Native output is bounded independently of React:

- Input 8 MiB; ZIP32 catalog 128 entries; 512 KiB per entry; 2 MiB aggregate
  inflation; declared 100:1 expansion ratio. The standard ZIP library owns
  parsing, decompression, consistency, overlap and CRC checks. The small terminal
  footer admission guard bounds catalog allocation before that library runs.
- XML depth 32, 20,000 events/section and 64 attributes/element. No external/custom
  entities. Source resources cannot escape the archive or reference a network.
- At most 1024 blocks, 64 KiB/block and 2 MiB canonical text; original image
  resource bytes have a separate 2 MiB total ceiling.
- Authored mode CSS: at most 32 stylesheet sources / 512 KiB per chapter,
  128 writing-mode selector rules and 16 class/ID selector parts. The maintained
  CSS tokenizer parses declarations; simple compound tag/class/ID selectors,
  inheritance, source order, specificity and `!important` are supported.

Headings, ordinary/nested lists, paragraphs, direct container text, line breaks,
mixed images/text, preformatted text and simple authored partial ruby survive
in source order. Common raster image resources and inline SVG are retained.
Publisher CSS layout and emphasis are not rendered. Links retain their text,
not interactive destinations. ZIP64/multidisk, encrypted/obfuscated EPUB
resources, complex ruby, tables/math/embedded media, imported stylesheets,
unsupported mode values and complex/conditional writing-mode rules fail
explicitly. These are declared parser limits, not permanent product exclusions.

## Build and verification

Root integrates both crate members and the root lockfile, then runs:

```sh
node tools/prepare-documents.mjs
CARGO_BUILD_JOBS=2 cargo test --locked -p mlearn-document-parser
CARGO_BUILD_JOBS=2 cargo clippy --locked -p mlearn-document-parser --all-targets -- -D warnings
```

The script uses the existing shared target, builds release core Wasm with two
jobs and writes `artifacts/document_pdf_guest.wasm`. It uses getrandom's official
unsupported backend: parsing requires no entropy; accidental writer/encryption
randomness requests return an error instead of receiving fake random bytes or
ambient JavaScript/WASI imports.

The temporary `verification/Cargo.toml` files compile exactly the same source
while root owns workspace integration, without editing root manifests/lock.
Use the explicit script `--manifest-path` option for that guest manifest.
Their generated locks are verification-only and may be removed after root
workspace verification. Do not remove the embedded Wasm artifact before
rebuilding it: parser compilation intentionally requires the real artifact.
