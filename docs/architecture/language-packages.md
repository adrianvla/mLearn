# Language packages: SDK conformance

A language package is a WebAssembly module plus declared data that implements every language-specific behaviour (analysis, dictionary entries, graphs, collections, learning tasks, OCR post-processing). Core code has no language branches; it executes whatever capabilities a package declares. This guide states what a third-party or private package must satisfy. Everything below is enforced by `crates/runtime/src/catalog.rs` (`Manifest::validate`) and `crates/language-host` unless marked otherwise.

## Building a package

- Write the package in Rust against `crates/language-sdk` and build for `wasm32-unknown-unknown`. `language-plugins/hello` is the minimal example; `language-plugins/english` and `language-plugins/japanese` are complete analyzers.
- Export the entry points with `mlearn_language_sdk::export_plugin!(handler)` or `export_plugin!(handler, initialize)`. The macro exports `mlearn_abi_version` (ABI `1`), `mlearn_alloc`/`mlearn_dealloc` and the batch entry point. The handler receives `Call { capability, input }` and returns a JSON value.
- Messages are JSON and at most `MAX_MESSAGE_BYTES` (256 KiB). The guest has no filesystem, network, clock or database access; it reads only its declared data through `read_asset`, `read_resource`, `resource_get` and `resource_keys`.

## Manifest (`plugin.json` plus catalog artifacts)

| Field | Rule |
|---|---|
| `id` | 1–128 chars, ASCII letters, digits, `.`, `_`, `-`; stable across releases (it keys learner data). |
| `displayName` | Optional, 1–256 chars, no control characters. Shown to learners. |
| `version` | 1–128 chars. Learners see the part before `-`/`+`; build metadata after it is not shown. |
| `abiVersion` | Must be `1`. |
| `capabilities` | 1–64 ids, each 1–256 chars. |
| `assets` | At most 32 artifacts, each `{path, sha256, byteLength}`; checked on download and on every load. |
| `resources` | At most 8; each names an asset and a kind: `bytes-v1` (random-access bytes) or `key-value-sqlite-v1` (read-only key/value index). |
| `execution` | `fresh` (default: a new 64 MiB instance per batch) or `persistent-v1` (a reused instance with a larger memory budget for large dictionaries). |

Budgets: code ≤ 4 MiB. With `fresh`, each asset ≤ 8 MiB, each SQLite resource ≤ 32 MiB and all assets ≤ 40 MiB. With `persistent-v1`, each resource ≤ 128 MiB and all assets ≤ 256 MiB. Guest execution is fuel- and memory-bounded and cancellable; exceeding a bound fails that call, not the application.

## Capabilities

Capability ids are versioned strings (`name.vN`) that the runtime dispatches without interpreting their language content. The first-party packages declare:

`language.describe.v1` (names, scripts, collection kinds, level scales), `text.analyze.v1` (tokens with stable target ids), `target.inspect.v1` (entries, senses, readings, attribution), `graph.neighborhood.v1`, `collection.targets.v1`, `learning.probes.v1`/`v2` and `learning.validate.v1` (tasks and their validators), and the `image.ocr.*.v1` family (profile, geometry, recognition, post-processing).

Conformance expectations:
- Target ids must be stable across rebuilds and independent of array order or display labels. A withdrawn or changed capability must make dependent tasks report incompatibility, never be silently remapped.
- Names, level scales, readings and grammar labels come from the package (`language.describe.v1`), so core UI uses neutral names (for example "level marks").
- Unknown namespaced fields in package output are preserved through storage and export but carry no authority.
- A package that cannot provide something returns an error for that call; it never returns fabricated results.

## Licensing and attribution

Every dictionary or corpus a package ships must have its licence file beside the package source (`language-plugins/english/WordNet-LICENSE.txt`, `language-plugins/japanese/JMdict-LICENSE.md`), and pinned data sources are recorded (`data-pin.json`, `archive-pin.json`, `enrichment-pin.json`). Entries returned by `target.inspect.v1` must include an `attribution` string, which the Inspector shows. The runtime does not check licence content; the publisher signing the catalog is responsible for it.

## Distribution

**Desktop** downloads packages from an authenticated catalog and never embeds executable language modules. The catalog is an Ed25519-signed envelope `{payload, signature}` whose payload lists manifests and carries `expiresAt`. The desktop trusts exactly one catalog, fixed at build time by `MLEARN_CATALOG_TRUST` (`{"url": …, "publicKey": …}`). `tools/prepare-plugins.mjs` builds the first-party packages and signs a local development catalog with the development key in `.mlearn/dev-publisher.pem`; that catalog expires after two days. Production publishers sign with their own key. Learners cannot yet add institutional or private catalogs: that needs a decision on trust and privacy (FEATURES OPS-07, logged as open).

**Mobile** (iOS and Android) bundles executable packages into the app build (`BundledPlugin`) and downloads only language data, never replacement code. Adding a package to a mobile release means adding it to the bundle at build time.

## Checking a package

- `cargo test -p mlearn-runtime --test catalog` exercises installation, replay, update, removal and refusal of invalid manifests against a real signed catalog.
- `npm run build:plugin` builds and signs the first-party packages; `npm run check:contracts` confirms the shared protocol types.
