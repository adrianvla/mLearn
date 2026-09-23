# Guardian and KikanRuntime

## Guardian boundary

The Electron main process runs `Guardian.preflight()` after the single-instance
lock and before IPC handlers, migrations, or ordinary services start. Guardian
reads canonical files directly: flashcards and review counts, world entities,
journal record counts, the knowledge SQLite database (including archived
evidence), retained legacy knowledge events, and legacy conversation evidence. Suggested cards and derived
knowledge projections do not count as irreplaceable learning evidence.

The ledger and up to eight recovery snapshots live in `<userData>/guardian/`.
Snapshots include canonical data and irreplaceable media; SQLite is backed up
through its API, including committed WAL content. Regenerable flashcard audio
is omitted from automatic recovery snapshots. Manifests record semantic
metrics, schema versions, and SHA-256 file hashes. Startup snapshots precede
migrations; a second check follows them. Normal guarded writes update the
ledger, and a verified checkpoint on normal shutdown captures new work from
that session. Unexpected loss blocks subsequent guarded writes and startup.
Blocked launches do not rotate snapshots or adopt the damaged state.

On blocked startup, the desktop dialog offers the latest verified compatible
snapshot. Restoration first quarantines current files, then copies the
snapshot using a resumable transaction marker. Reopening after an interrupted
restore finishes it before ordinary startup. A deliberately selected import
is staged and applied by the same mechanism on the next launch. Earlier
recovery points remain available after import. Export All Data includes
canonical world, journal, and SQLite history as well as existing user data.

The Settings status is read-only. It does not authorize loss or bypass the
main-process guard. The runtime-control system cannot access Guardian's ledger
or grant deletion/reset intent.

## KikanRuntime boundary

The generic protocol and client are under `src/electron/kikanRuntime/`.
Discovery advertises the configuration capability. A document is accepted
only after strict schema, time, sequence, same-origin, and Ed25519 signature
checks. Accepted state is persisted as a verified last-known-good document;
expired documents fall back to embedded defaults while retaining their signed
replay floor. Targeting and experiment cohorts are deterministic per local
installation ID. The ID is never sent with diagnostics.

The mLearn adapter in `services/kikanRuntime.ts` maps evaluated switches and
bounded patches to cloud LLM, plugin installation, and update behavior. Patch
directives can only disable a named capability or set a validated numeric
parameter; they cannot run code. Signed rollback directs the existing native
updater to a version-specific immutable feed. Guardian's startup schema check
still prevents an old binary from opening newer learner data. An unavailable
runtime service never gates startup or offline use.

Operational diagnostics are off by default. When the user enables the setting
and a signed configuration supplies an endpoint, the client sends only an
event enum, app version, platform, and a coarse error-type fingerprint. It
sends no content, account ID, URL, stack trace, or installation ID. Sampling,
the 20-event session budget, a short request timeout, and a strict receiver
schema limit collection. Telemetry failures have no effect on app availability.

## Publishing and recovery operations

The signer is an Ed25519 private key corresponding to
`src/electron/kikanRuntime/trust.ts`. Keep it outside the repository and
provision it only to an authorized publisher. To publish a document:

```bash
npm run runtime:publish -- DOCUMENT.json PRIVATE_KEY.pem PUBLICATION_DIR
```

The document sequence must increase. The publisher checks the protocol and
atomically replaces each file. The small reference service can be exercised
locally with `npm run runtime:serve -- PUBLICATION_DIR`; production requires
TLS and a proxy that does not log telemetry request bodies. The packaged
client currently discovers at
`https://mlearn-versioning.kikan.net/runtime/discovery.json`. Deploy the
discovery/configuration endpoint and updated public privacy policy together
before enabling telemetry.

For rollback, preserve the already signed installer and update metadata for
the target release. Stage a version-specific feed with:

```bash
npm run runtime:publish-rollback -- RELEASE_DIR TARGET_VERSION PUBLICATION_DIR
```

The tool verifies artifact hashes and sizes before and after staging and
refuses to overwrite a published version. Publish a signed runtime document
with that target version, the HTTPS feed URL, `allowReleaseRollback: true`,
and a maximum data schema compatible with the old binary. The native updater
handles interrupted downloads and installation; Guardian blocks an unsafe
data downgrade on the next launch. macOS native update installation requires
a Developer ID signed, notarized release; an unsigned local package can
exercise Guardian and runtime fallback, but cannot validate that final OS
installation step.

To recover manually when the startup dialog is unavailable, preserve the
entire user-data folder, including `guardian/`, before changing anything.
Inspect the ledger reason and the manifests. Never delete the ledger to make
a damaged profile look new. Use a compatible app release or restore a
verified snapshot while retaining its quarantine directory.

## Scope and limits

Guardian currently protects Electron's local user-data profile. The
Capacitor bridge reports protection status as unavailable; mobile data needs
its own storage boundary before claiming equivalent coverage. A sudden power
loss can preempt the normal shutdown checkpoint; the previous snapshot still
exists, and in-operation guards detect unexplained loss when possible.
Automatic recovery points are local to the same disk, so user export or an
external backup remains necessary for device loss. The runtime reference
service and signing key are tooling, not a deployed production control plane.
