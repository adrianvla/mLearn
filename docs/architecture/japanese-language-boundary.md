# Japanese analysis execution — M01 rescue

Commit `7c91b41` implements the previously measured resource boundary. The language package owns genuine Sudachi morphology and JMdict lexical semantics; core supplies generic authenticated resources and bounded execution. No language-code branch, character splitter or guest filesystem/network access substitutes for analysis.

## Reference and pinned compatibility probe

The read-only v2 reference at `1788f9c74dc73dd884b687ec80d9550c3ebf6c6b` declares `sudachipy` and `sudachidict_small` without versions. `GenericLanguage._ensure_sudachi` prefers Small and uses SplitMode C; dictionary-form/normalized-form selection belongs to its language configuration. Its unversioned install and fallback do **not** establish a reproducible accepted analyzer variant, and are not copied into core.

The selected engine is Sudachi Rust **0.6.11**, upstream revision `90fd6068c80c2fc3b63e0dbab0e341475bad4d8f`, with **Small 20260116 V0, Mode C** and pinned default normalization/OOV/path-rewrite behavior. Its dictionary is **122,948,155 bytes**, SHA-256 `34bdc3d279530567399874e62d7f98ea327c536dd7029a3dfdf5c694db1942c7`. The selected official wheel is 41,766,874 bytes; exact source URLs, hashes and licensing are in `language-plugins/japanese/data-pin.json` and `vendor/README.md`. This explicit v3 pin does not retroactively identify v2's unversioned installation.

## Resource and lifetime ownership

- The SDK exposes resource length, authenticated digest and reads of at most 64 KiB. Rust streams and verifies immutable private snapshots. Guests receive no paths, file descriptors, SQL or ambient access.
- Existing Fresh execution retains its 64 MiB memory, 32 million call-fuel, 8 MiB small-asset/read and 32 MiB indexed-resource limits. Retained ABI1 English/hello packages and saved claims run offline without reinstalling.
- Explicit host-admitted PersistentV1 execution has one process-global lazy guest slot, 160 MiB memory, 384 million initialization fuel and 64 million call fuel. Switching owner, cancellation, malformed responses, errors/traps and shutdown evict the slot. Fuel is granted in bounded slices so cancellation remains observable.
- The final repaired guest's measured linear-memory high-water is **138,805,248 bytes**. Initialization uses **255,954,738 fuel**, about **121 ms** in the measured release Wasmi owner run. Ten warm batches of all 13 representative inputs took about **72 ms**. These are owner measurements, not mobile cold-start or audible-media benchmarks.
- SDK initialization checks the exact package-owned dictionary size/digest against the host's verified snapshot. It does not repeat a 117 MiB SHA-256 pass inside the interpreter. The public native constructor still validates untrusted dictionary bytes; a same-sized wrong-digest dictionary is rejected. The previous redundant-hash module exhausts the new initialization allowance in the counterfactual regression.
- Mobile bundles executable plugins and borrows static resource bytes at admission; desktop installs authenticated catalogue artifacts. Neither policy can be chosen by renderer or guest input.

## Lexical identity and reproducibility

JMdict's 2026-10-17 data supplies stable `jmdict:<ent_seq>` targets, readings, written-form restrictions, POS and definitions. The deterministic lookup index contains 218,923 entries and 465,834 forms; it is 120,008,704 bytes. Unknown/OOV spans are not promoted into invented lexical identities. Original UTF-8 text, including parenthesized readings, remains intact.

`npm run prepare:language-data` explicitly acquires pinned inputs. The immutable archive replay in `archive-pin.json` reconstructs the exact independently verified official JMdict XML, rather than depending on a moving daily URL. A clean empty-cache acquisition/index build reproduced both dictionary and index hashes. Subsequent plugin builds are offline. See `language-plugins/japanese/README.md`; dictionary binaries, local originals and private profiles remain uncommitted.

## Actual integration evidence

The independent native reference comparison matched all 13 inputs/101 tokens. Final real Wasmi execution validates the public positive-span contract, 59 genuine lexical targets and original-SRT readings. Review found that comparing only the analyzer's normalized reading discarded valid katakana JMdict candidates; `6d842f3e` compares both readings consistently without changing source or display text. Its regression fails before the repair, and the real runtime checks the four missing half-width katakana associations and genuine entries. Actual native Inspector selection exercises both repaired nouns. Runtime owner tests retain claim identity/retry, persisted source position, restart, withdrawal and a second restart using isolated storage.

Actual macOS Watch selected `度胸(どきょう)` from the original SRT, opened genuine `度胸` / `どきょう` with JMdict definitions, changed/withdrew/restored Meaning and retained the complete source/subtitle/package/18,736 ms position and claim across application restart. Both offline consuming mobile Release apps also exercised original-file import, genuine Japanese Inspector and claim/withdraw/cold-restart flows. This is not semantic proof that the supplied SRT matches the video's spoken audio.

An initial macOS cold paused Resume showed raw subtitles without an error; its cause was not confirmed. A separate cold-process repeat exposed all genuine tokens and the saved claim without playback, as did both mobile cold-restart flows. No guessed retry or playback prerequisite was added. The retained functional assessment records this bounded finding.

Raw evidence is under ignored `.mlearn/m01/rescue-*`; final source/CI/review disposition belongs to `docs/implementation/STATE.md`. No M02 or maintainer acceptance is implied.
