# Pinned Sudachi dependency

Source: Works Applications `sudachi.rs` 0.6.11 at commit
`90fd6068c80c2fc3b63e0dbab0e341475bad4d8f`, Apache-2.0. The upstream
copyright notices remain in the source; `LICENSE` is the upstream license.
`resources/{sudachi.json,char.def,unk.def,rewrite.def}` are the exact pinned
upstream defaults. No dictionary binary is embedded or committed.

The source archive is reproducible from:

```sh
curl -fL https://codeload.github.com/WorksApplications/sudachi.rs/tar.gz/90fd6068c80c2fc3b63e0dbab0e341475bad4d8f -o upstream.tar.gz
# SHA-256: 632a74c8f12e8baee9b35cf3b2764a4959edad254508c90e505b2f0986fd8184
```

`portable.patch` records every changed runtime source file and the adapted
crate manifest relative to that archive. Apply it with `patch -p1` from the
extracted archive root. All other vendored source/definition files retain
their upstream contents. The distribution contains the crate's source
(including upstream in-source tests), the four embedded resources and the
license, not the CLI, Python binding, external test harness or binary fixtures.
Upstream's native workspace test suite is not the owner suite here.
Seven upstream CSV test fixtures have a terminal newline added by text
vendoring; no runtime resource or Rust algorithm has that transformation.

The default `portable` feature:

- Removes mmap storage/constructors and the dictionary compiler from the
  compiled guest dependency. `Storage::Owned` and the original parser remain.
- Removes DSO loading, its library handles/errors and export helper. Only
  upstream's bundled plugin classes can initialize.
- Initializes the default input rewrite and MeCab OOV definitions directly
  from the pinned embedded bytes. Alternate definition paths are rejected,
  rather than silently replaced by defaults.
- Adds the missing 32-bit `usize` FxHash seed using the already present
  upstream `SEED32`. No tokenization or linguistic algorithm is rewritten.
- Exposes the existing input-preprocessed morpheme surface through a borrowed
  accessor. Original surface/offset APIs remain unchanged; the package uses
  this to project ruby bases without substituting dictionary-form lemmas.

The optional `native` feature with `--no-default-features` retains upstream
host paths for dependency development. The Japanese owner always uses the
default portable feature, including in native reference-comparison runs.
The independent semantic oracle uses the **unmodified** upstream crate,
not this feature.

Rust 1.99 reports upstream lifetime-style and unused `SplitIter` warnings.
They are retained, not suppressed. Upstream's unsafe self-referential storage
implementation is also retained. The owner verifies the exact dictionary
size and digest before calling that trusted parser; it is not a general
untrusted dictionary parser.
