# Language Data Builds

This directory is the single source of truth for building Church Slavonic, German, Japanese, Russian, Spanish, and Chinese language packages. The website repo publishes the generated archives and catalog; the desktop app installs them on demand.

## Commands

```bash
npm run build:language:de
npm run build:language:es
npm run build:language:cu
npm run build:language:ja
npm run build:language:ru
npm run build:language:zh
npm run build:dictionaries
npm run package:language-data
npm run test:language-data
```

By default the scripts read language sources from `scripts/language-data/source/root-of-app` inside this repo. Override that with `MLEARN_ROOT_OF_APP=/path/to/root-of-app` only for one-off local builds.

`npm run package:language-data` writes archives to `../mlearn-website/release/language-data/v1` and the public catalog to `../mlearn-website/frontend/public/language-catalog.json`. Set `MLEARN_WEBSITE_ROOT=/path/to/mlearn-website` when the repositories are not siblings. Upload and frontend deployment remain website operations.

Runtime language metadata, frequency lists, dictionaries, and optional adapters live under this directory. Generated dictionary databases and downloaded provider sources are ignored by git; the reproducible provider scripts rebuild them in place.

The Russian build publishes OpenRussian as the default corpus-frequency list and SMARTool as a second provider. SMARTool's A1-B2 rows can be displayed using either CEFR labels or the corresponding ТРКИ labels.

The Spanish build inverts FreeDict's larger English-Spanish release into Spanish lookup rows with English glosses, then combines it with the pinned FrequencyWords list, the `es_core_news_sm` spaCy tokenizer, Spanish PaddleOCR, and Spanish speech metadata.

The Church Slavonic build combines the Wiktionary-derived kaikki.org dictionary, a frequency list built from the public-domain 1757 Elizabeth Bible, generic Cyrillic and Glagolitic tokenization, and Russian-script PaddleOCR. It intentionally does not claim modern Russian TTS or speech recognition as Church Slavonic pronunciation. The core package includes the SIL OFL-licensed Ponomar font as an optional reader content font.

Russian publishes one reading annotation: the normal Cyrillic surface with a combining acute accent on the stressed vowel. Mandarin Chinese publishes tone-marked pinyin as its reading annotation. Neither declares a separate prosody feature; Japanese pitch accent remains a distinct annotation because its pronunciation reading and pitch pattern carry different information.

## Archive Shape

Each learning language gets a small core archive:

```text
release/language-data/v1/ja/language-package-2026.06.29-<sha12>.tar.gz
  manifest.json
  files/languages/ja.json
  files/languages/ja.freq.json
```

Language packages are metadata-driven by default. The backend uses `runtime.*` and `textProcessing.*` bricks in `languages/<code>.json` through the generic adapter. A package may include a Python adapter only when metadata explicitly declares `runtime.adapter.type = "python-module"` and points at a safe package-relative adapter path such as `adapters/<code>_adapter.py`. The deprecated `runtime.nlp.adapter` declaration remains accepted for existing packages.

Do not publish `languages/<code>.py` as a convention or fallback. Stale adapter files are ignored unless metadata opts in, and generated core archives omit undeclared Python files.

Dictionary payloads are separate archives keyed by target/definition language:

```text
release/language-data/v1/ja-en/dictionary-ja-package-2026.06.29-<sha12>.tar.gz
  manifest.json
  files/dictionaries/ja/en/dictionary.db
```

Archive storage uses pair folders under the CDN prefix:

```text
mlearn/language-data/v1/ja/language-package-2026.06.29-<sha12>.tar.gz
mlearn/language-data/v1/ja-en/dictionary-ja-package-2026.06.29-<sha12>.tar.gz
mlearn/language-data/v1/ja-de/dictionary-jmdict-2026.06.29-<sha12>.tar.gz
```

That keeps the R2 bucket browsable when many language pairs exist. Archive filenames include the first 12 characters of the archive SHA-256, so a catalog update never reuses a CDN URL for different bytes. Japanese dictionary packs are target-specific (`dictionaries/ja/en`, `dictionaries/ja/fr`, `dictionaries/ja/de`) so multiple definition languages can be installed at the same time. `build-jmdict-ja-multilingual.py` builds the JMdict-based French and German packs.

The public catalog points to both:

```json
{
  "languages": {
    "ja": {
      "minimumAppVersion": "2.7.0",
      "bundle": { "url": "..." },
      "files": [],
      "dictionaryPacks": {
        "en": {
          "targetLanguage": "en",
          "bundle": { "url": "..." },
          "assets": []
        }
      }
    }
  }
}
```

Set `languageData.minimumAppVersion` in a source language metadata file only when that package depends on app behavior introduced in a particular release. The packager validates semantic `major.minor.patch` syntax and publishes it as the catalog entry's optional `minimumAppVersion`.

Generated archives are written to `../mlearn-website/release/language-data/v1`. From `../mlearn-website`, `npm run upload:language-data` uploads only archives referenced by that directory's `manifest.json`, and `npm run deploy:language-data` packages here before uploading and deploying the frontend catalog.

Set `LANGUAGE_ASSET_BASE_URL` if the public archive base URL changes. The default catalog URLs use `https://mlearn.kikan.net/language-data/v1/...`; the Pages redirect sends those downloads to `https://cdn.kikan.net/mlearn/language-data/v1/...`.

### Jitendex sense grouping and history

The graph builder groups definitions by Jitendex source `sense-number` containers. Synonyms and inline markup form one meaning; grammatical badges, notes, examples and cross-reference text do not become senses. No three-gloss truncation applies. Sense-level POS comes from source POS codes; other source badge codes remain package-owned metadata.

Rebuilt source senses use `ja:sense:v2:<sequence>:<semantic-hash>` IDs. The old `ja:sense:<sequence>:<gloss-position>` IDs must not be mapped to these automatically: old IDs represented individual text fragments or grammar labels, so a positional mapping could attach historical observations to a different meaning. Preserve the prior graph and learner journal during adoption, retain unmapped historical addresses, and review identity diffs. The separate `repair-jitendex-graph.ts` tool can conservatively remove proven bad grammar-to-meaning links while retaining historical nodes; it does not assert a sense migration.

`build-graph-assets.py --languages ja` accepts original Jitendex banks, or a lossless compiled `dictionaries/ja/en/dictionary.db` with source metadata and preserved raw term/pitch rows. Missing or lossy source input fails rather than producing an empty graph. Always build into a separate source/release directory and publish through the website catalog.

### Japanese spelling-check priority

The Japanese metadata override declares `ja:lexical-familiarity-spelling` version 1. Its two asserted `realizes` hops connect a presented spelling to other forms of the same dictionary entry. A known meaning access on that entry's forms contributes a weak relative weight of 0.1 toward prioritizing an unresolved spelling check. All routes share one dependency group; alternate forms do not add independent credit. Self-reported familiarity stays distinct from measured recall.

This rule chooses a check; it does not establish written recognition, reading, pronunciation, or sense mastery. It is an uncalibrated package heuristic, with no claim of measured learning gains or success probability. Decisions retain the exact source evidence, rule/package versions, outcome, and a graph-disabled choice from the same pool for later evaluation. No transfer calibration context is declared until an appropriate evaluation is available.

Language learning capability declarations may specify `providedBy`, an open list of presentation cue IDs. The review surface exposes `word-audio` and `example-audio`; packages declare which of their own capability IDs those cues supply. Unknown cue and capability IDs survive metadata serialization. This is assistance provenance, never inferred mastery. Playback admission is persisted before saved audio or system speech starts; an interrupted or failed playback after admission may conservatively retain the cue. Missing recordings create no cue.

Review clips with unknown answer alignment are conservatively admitted as reference content before front-side controls become available. They supply all accesses tested by that encounter. Post-answer playback is verification. Each new encounter requires fresh media admission, including when an assisted review leaves the same card due. Existing `audio` scaffold compatibility also suppresses independent surface-reading evidence; package cue declarations extend it rather than silently redefining legacy history.
