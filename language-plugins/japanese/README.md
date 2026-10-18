# Japanese language package

`JapaneseEngine::from_dictionary_bytes(Vec<u8>)` consumes the pinned Small
20260116 V0 dictionary once. `analyze(&str)` uses Sudachi 0.6.11 Mode C with
the pinned default normalization, OOV and path-rewrite plugins. It returns
original half-open UTF-8 byte spans, source surface, dictionary-form lemma,
normalized form, reading, six POS components and OOV status. No lexical
learner identity is inferred from Sudachi word IDs.

The engine retains one dictionary and reuses tokenizer/result buffers. It is
thread-local (`Rc`), with ordinary drop-based release. `src/plugin.rs` exposes
the SDK's description, analysis and inspection ABI. JMdict `ent_seq` supplies
stable lexical targets; readings, POS and written-form restrictions remain
plugin-owned. The host owns authenticated resource snapshots and the bounded
persistent guest lifetime.

Native callers validate the full dictionary digest before parsing. SDK
initialization checks the exact package-owned size and digest against the
host's immutable, streaming-verified snapshot before chunked loading. That
path does not repeat SHA-256 inside the interpreter: the redundant pass made
native debug initialization take minutes without adding another trust boundary.
Wrong authenticated dictionary identities remain rejected before parsing.

## Data preparation

Run `npm run prepare:language-data` once online, then `npm run build:plugin`.
The explicit preparation command acquires the hash-pinned official Sudachi
wheel and reconstructs the exact pinned JMdict XML from immutable archive
inputs in `archive-pin.json`. Node's built-in Brotli decoder and the platform
`patch` command are used; no Python/NPM package installation is needed.
The final XML must match the independently verified official source's SHA-256.
Cold replay can take several minutes. Subsequent preparation verifies cached
inputs, and normal plugin builds remain offline.

Existing exact official gzip inputs remain supported. Do not replace the pin
with a moving daily download. Sources live in `.mlearn/package-sources`;
`MLEARN_LANGUAGE_SOURCE_CACHE` and `MLEARN_JAPANESE_OUTPUT` allow isolated
preparation checks. `data-pin.json` and `JMdict-LICENSE.md` retain provenance
and attribution. Native GUI and mobile resource acceptance are separate gates.

Do not remove whitespace, emoji, repeated spans or zero-length spans in the
engine. Pinned upstream normalization can expand `㍿` into two morphemes,
the second with an empty original span. IgnoreYomigana retains parenthesized
reading bytes in the corresponding source surface. Small can split compounds
even in Mode C; this is not a reason to substitute another dictionary.

This producer is an isolated Cargo workspace so the application's root
manifest and lockfile are untouched. `Cargo.lock` pins its complete dependency
resolution, including the local SDK path. The vendored patch and upstream
attribution are in `vendor/`; mLearn-owned code uses the repository license.

From the repository root, with a separately extracted pinned dictionary:

```sh
export CARGO_TARGET_DIR="$(mktemp -d /tmp/mlearn-japanese-build.XXXXXX)"
export MLEARN_SUDACHI_DICTIONARY=/absolute/path/to/system.dic
cargo test --locked --manifest-path language-plugins/japanese/Cargo.toml -p mlearn-japanese-engine -- --test-threads=1
cargo build --locked --manifest-path language-plugins/japanese/Cargo.toml --target wasm32-unknown-unknown --release --lib
cargo run --locked --manifest-path language-plugins/japanese/Cargo.toml --release --example probe -- "$MLEARN_SUDACHI_DICTIONARY" /absolute/path/to/subtitles.srt
```

The probe is native-only measurement tooling, not a guest filesystem API.
It measures allocation traffic with `stats_alloc`, initialization including
SHA-256 validation, per-input latency and a 1,300-call representative warm
batch when supplied the original six-cue SRT. Use `/usr/bin/time -l` on macOS
for process peak RSS; cumulative allocation traffic is not peak memory.
The release Wasm build includes the SDK guest exports. A successful build alone
does not prove Wasmi execution or native/mobile resource acceptance.

The retained M01 evidence and exact producer handoff are in the ignored
`.mlearn/m01/rescue-japanese-portable.md` report.
