# Japanese analysis boundary for M01 review

M01 remains incomplete for the original Japanese subtitle workflow. This is a measured boundary of the current package/guest implementation, not evidence that Japanese cannot run in Rust or Wasmi. No English content, character splitter, maximum-match word list or fake Japanese package substitutes for that workflow.

## Reference and pinned compatibility probe

The read-only v2 reference at `1788f9c74dc73dd884b687ec80d9550c3ebf6c6b` declares `sudachipy` and `sudachidict_small` without versions. `GenericLanguage._ensure_sudachi` prefers Small and uses SplitMode C; dictionary-form/normalized-form selection belongs to its language configuration. Its unversioned install and fallback do **not** establish a reproducible accepted analyzer variant, and are not copied into core.

For the size/format probe, the official **SudachiDict Small 20260116** wheel contains `resources/system.dic` of **122,948,155 bytes** (117.25 MiB), compressed to41,760,293 bytes. The public wheel metadata, URL and SHA-256 are retained locally in `.mlearn/m01/sudachi-small-source.json`; the hash-verified wheel is an ignored package-source cache, not a shipped v3 artifact. This V0 dictionary is an explicit probe pin, not a claim that the unversioned v2 environment used that release. [Official release metadata](https://pypi.org/pypi/SudachiDict-small/20260116/json), [Sudachi dictionary versions](https://github.com/WorksApplications/SudachiDict/blob/develop/README.md).

## Exact current blockers

- `crates/language-sdk/src/lib.rs::read_asset` accepts at most8 MiB and returns a complete guest-owned buffer. The host provides no file handle, mmap, WASI filesystem or bounded byte-range reader for a standard analyzer binary.
- `crates/language-host/src/execute.rs` limits each guest to64 MiB. This pinned dictionary alone is larger than that entire allowance before the analyzer, lattice, input/output and copy overhead. Raising only the download limit would not fix this.
- The larger resource route is **SQLite primary-key lookup**, not arbitrary binary access. `crates/runtime/src/catalog.rs::Manifest::validate` caps each indexed resource at32 MiB and all package assets at40 MiB. Declaring `system.dic` as that resource would neither admit its size nor make its binary format a SQLite index.
- `CompiledPlugin::invoke` instantiates a fresh guest for each call. Simply raising memory and copying/parsing117 MiB for every subtitle window is not a validated mobile lifecycle or performance policy. No representative Sudachi output/latency comparison has been run in v3, so model loading cannot be claimed as analysis acceptance.
- A usable Inspector also needs authenticated lexical data with stable entry/sense IDs, not merely morphological spans. The English WordNet target schema and capability inventory cannot be relabeled as Japanese. JMdict ingestion, attribution and its lexical identity/association remain undelivered.

## Implementation decision required

A genuine package needs a concrete analyzer/resource strategy before implementation can continue honestly:

1. Adapt a pinned Rust analyzer to generic bounded, authenticated, read-only package resources, with a measured guest/session/cache lifetime and explicit per-package resource policy; or
2. Validate a different genuine morphological model/engine against representative Japanese output, memory and timing under the existing ABI before selecting it.

The first path may need a generic byte-resource ABI and a persistent bounded analyzer instance/lifetime. The second may avoid that ABI, but no alternative is accepted merely because its dictionary is smaller or it segments the fixture. Neither path permits a language-code branch in core, guest filesystem/network access, desktop executable bundling or mobile executable downloads. The current hard-coded fixture budgets must not simply be raised without measuring the resulting guest and cache lifecycle.

This is the outstanding major implementation boundary presented for maintainer review. It does not authorize M02, declare a Japanese package delivered, or close original-corpus acceptance. Next evidence must include a pinned analyzer/model, actual morphological forms/offsets and lexical targets, then the original open→play→seek→Inspector→claim→restart workflow.
