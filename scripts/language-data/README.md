# Language Data Builds

This directory is the single source of truth for building German, Japanese, Russian, and Chinese language packages. The website repo publishes the generated archives and catalog; the desktop app installs them on demand.

## Commands

```bash
npm run build:language:de
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

Generated archives are written to `../mlearn-website/release/language-data/v1`. From `../mlearn-website`, `npm run upload:language-data` uploads only archives referenced by that directory's `manifest.json`, and `npm run deploy:language-data` packages here before uploading and deploying the frontend catalog.

Set `LANGUAGE_ASSET_BASE_URL` if the public archive base URL changes. The default catalog URLs use `https://mlearn.kikan.net/language-data/v1/...`; the Pages redirect sends those downloads to `https://cdn.kikan.net/mlearn/language-data/v1/...`.
