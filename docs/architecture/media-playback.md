# Local media host findings — M01 changes requested

Rust owns admitted source identities and paths. React renders the shared Watch surface; desktop host adaptation resolves a source ID to bytes. File extensions accepted by the picker are candidate containers, not a claim that every host decoder and transport can play them.

## Linux failure

The failing original candidate reached `MEDIA_ERR_SRC_NOT_SUPPORTED` (4), readyState0, at the unchanged **decoded H.264/AAC fixture** assertion. GStreamer debug output reports `FormatError`. The supplied fixture independently decodes through `qtdemux → h264parse → avdec_h264 → fakesink`; adding the actual parser runtime package alone did **not** fix native playback. Development headers are not runtime elements.

The runner uses WebKitGTK **2.52.6**. That version explicitly rejects media protocols outside its allow-list before loading a pipeline. Its initial MIME sniff still reached our scheme handler (`bytes=0-1445`), explaining why a response in the trace did not prove playback. A process-local experiment admitted only the fixed `mlearn-media` scheme. It then exposed the next concrete failure: **GStreamer reports “No URI handler implemented for mlearn-media.”** The ineffective exception has been removed; no system setting was changed. Neither the readyState/duration assertion nor the advancing-time assertion was weakened. [Pinned WebKitGTK implementation](https://github.com/WebKit/WebKit/blob/webkitgtk-2.52.6/Source/WebCore/platform/graphics/gstreamer/GStreamerCommon.cpp).

Runs38993481639,39025955515,39026425829 and39026883759 retain the successive failures and source provenance. The decoder-chain probe passed, while the real native media gate remains failed. The selected WebKitGTK/GStreamer path needs a supported source transport; an allow-list entry cannot implement that transport. Final verification is recorded in `docs/implementation/STATE.md`.

## Original WebM — corrected diagnosis

The provided original is **VP9,2048×858, with stereo Opus**, duration236.681s. It was not transcoded or modified. Local Chromium decoded the original, reached readyState4 and advanced past1s with the expected video dimensions. Mac WebKit advertises `probably` for VP9/Opus; standalone AVFoundation's earlier refusal does **not** establish WebKit codec availability.

The real product trace shows:

1. `Range: bytes=0-1`
2. `Range: bytes=0-7`
3. `Range: bytes=0-1445`
4. an ordinary GET with **no Range**

The fourth request is rejected by the existing handler because the original is60,475,168 bytes and unranged bodies are limited to2 MiB. That is an identified transport failure, not evidence that the original codec is unsupported.

A temporary, local-only transport comparison served the **same original bytes**, streamed in64 KiB buffers, to the **same Tauri/WebKit application** over loopback HTTP. Native playback loaded its3m56s duration, advanced to6s, paused and saved6s. No private frames/audio were uploaded or put in model context; decoded-frame/quality and audible-output acceptance are not inferred from the diagnostic's timeline alone. The temporary adapter/CSP changes were restored, the diagnostic server stopped, and the normal product build restored. This is **not** candidate WebM support or original-corpus acceptance.

## Outstanding streaming decision

Tauri's current URI responder accepts a complete byte body (`Response<T>` where `T: Into<Cow<'static,[u8]>>`), not a streaming reader. Returning the whole original would violate the chosen bounded-body policy. Returning only2 MiB with a200 response or fabricating206 for an unranged request would violate the transport contract. The [official example's full-body fallback](https://github.com/tauri-apps/tauri/blob/dev/examples/streaming/main.rs) is not a bounded streaming implementation.

The original needs a deliberate host transport implementation: for example, a standard HTTP streaming endpoint constrained to admitted source IDs, bound only to loopback with per-process authorization, bounded buffers/concurrency and an owned shutdown/cancellation lifetime; or a platform media adapter providing equivalent source/UI behavior. No unauthenticated general file server, whole-file buffer, renderer-owned database, silent transcode or decoder replacement has been shipped as a shortcut.

This is a major implementation boundary for review. It stays within M01's playback requirement and does not authorize M02 or imply acceptance. Local probe results and failed attempts are retained under ignored `.mlearn/m01/`; public CI uses synthetic media only.
