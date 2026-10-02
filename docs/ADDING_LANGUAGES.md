# Adding languages and catalogs

[Back to mLearn](../README.md#extend-mlearn)

Languages are installed at runtime from a language catalog. The app does not require language modules, dictionaries, or frequency files to be bundled in this repository.

This guide documents the catalog and package layout. The JSON examples are illustrative: replace example URLs, versions, sizes, and checksums with values for your published artifacts. For the v2.10 graph extension contract, see the [graph types](https://github.com/adrianvla/mLearn/blob/dev/src/shared/graph/types.ts) and the repository's [language architecture conventions](../AGENTS.md#language-architecture-open-world).

The default catalog URL is:

```text
https://mlearn.kikan.net/language-catalog.json
```

Users and developers can point the app at a different compatible catalog in **Settings → Connection → Language Catalog URL**. Internally this is the `languageCatalogUrl` setting.

A catalog is only an index. It tells the app which language archives and dictionary archives are available, where to download them, and which checksums to verify. Runtime behavior comes from the files installed from those archives into the user's `language-data/` directory.

## Catalog shape

The catalog is a JSON file with a top-level `languages` object. Each language has a core language package plus optional dictionary packs keyed by definition language:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-07-06T00:00:00.000Z",
  "languages": {
    "example": {
      "name": "Example Language",
      "nameTranslated": "Example",
      "version": "example-package-2026.07.06",
      "minimumAppVersion": "2.7.0",
      "bundle": {
        "url": "https://example.com/language-data/v1/example/language-package-2026.07.06.tar.gz",
        "sizeBytes": 123456,
        "sha256": "..."
      },
      "files": [
        {
          "id": "language-metadata",
          "path": "languages/example.json",
          "required": true
        }
      ],
      "dictionaryPacks": {
        "en": {
          "targetLanguage": "en",
          "name": "English",
          "version": "example-en-dictionary-2026.07.06",
          "bundle": {
            "url": "https://example.com/language-data/v1/example-en/dictionary-2026.07.06.tar.gz",
            "sizeBytes": 123456,
            "sha256": "..."
          },
          "assets": [
            {
              "id": "dictionary-en",
              "path": "dictionaries/example/en/dictionary.db",
              "required": true
            }
          ]
        }
      }
    }
  }
}
```

`bundle.url` may also be written as a relative `href`; relative links are resolved against the catalog URL. Archive paths must be safe relative paths, and archive contents are extracted under `files/`.

`minimumAppVersion` is optional. When present, it must be a semantic `major.minor.patch` version. Clients compare it numerically, including normal prerelease ordering, and keep incompatible language packages visible but unavailable for installation. Catalog entries without it remain compatible with older clients.

## Installed file layout

Core language packages and dictionary packs should install into stable, language-grouped paths:

```text
languages/<code>.json
languages/<code>.freq.json
dictionaries/<code>/<target>/dictionary.db
dictionaries/<code>/<target>/metadata.json
models/<code>/...
adapters/<code>_adapter.py
```

Dictionary packs are separate from the core language package so users can install only the definition languages they need. A user can install multiple dictionary packs for the same learning language, such as `ja -> en`, `ja -> fr`, and `ja -> de`.

## Language metadata

The installed `languages/<code>.json` file is the language contract. It tells the app how to tokenize, normalize, display, OCR, look up, and study the language. Prefer metadata-driven building blocks over hardcoded app behavior.

```json
{
  "name": "Example Language",
  "name_translated": "Example",
  "colour_codes": {
    "NOUN": "#ebccfd",
    "VERB": "#ffefd1"
  },
  "translatable": ["NOUN", "VERB"],
  "frequencyLevels": {
    "names": { "1": "A1", "2": "A2" },
    "displayOrder": "ascending",
    "difficulty": "higher-is-harder"
  },
  "textProcessing": {
    "scriptProfile": {
      "acceptedScripts": ["Latn"],
      "wordScriptValidation": "contains-required"
    },
    "lexemeNormalization": {
      "surface": [{ "type": "case-fold" }]
    },
    "readingAnnotation": {
      "enabled": false
    },
    "partOfSpeech": {
      "translatable": ["NOUN", "VERB"],
      "colors": {
        "NOUN": "#ebccfd",
        "VERB": "#ffefd1"
      }
    },
    "tokenJoinSeparator": " "
  },
  "runtime": {
    "nlp": {
      "tokenizer": {
        "type": "unicode-word",
        "capabilities": ["segments"],
        "fallback": "unicode-word"
      },
      "dictionary": {
        "type": "sqlite-zlib-json",
        "schema": "simple-headword-zlib-json",
        "targetPathTemplate": "dictionaries/{language}/{target}/dictionary.db",
        "metadataPath": "dictionaries/example/en/metadata.json",
        "renderer": "simple-glosses"
      }
    }
  },
  "languageData": {
    "version": "example-package-2026.07.06",
    "assets": [
      {
        "id": "language-metadata",
        "path": "languages/example.json",
        "required": true
      },
      {
        "id": "frequency",
        "path": "languages/example.freq.json",
        "required": true
      }
    ],
    "dictionaryPacks": {
      "en": {
        "targetLanguage": "en",
        "name": "English",
        "version": "example-en-dictionary-2026.07.06",
        "assets": [
          {
            "id": "dictionary-en",
            "path": "dictionaries/example/en/dictionary.db",
            "required": true
          },
          {
            "id": "metadata-en",
            "path": "dictionaries/example/en/metadata.json",
            "required": true
          }
        ]
      }
    }
  }
}
```

The most important metadata areas are:

- `runtime.nlp.tokenizer` — declares how trusted tokenization works. Use a generic tokenizer when possible; only add a Python adapter when metadata cannot express the behavior.
- `runtime.nlp.dictionary` — declares the installed dictionary DB schema and lookup paths.
- `textProcessing.scriptProfile` — tells the app what scripts count as words for Reader, OCR, subtitles, STT, and filtering.
- `textProcessing.lexemeNormalization` — maps inflected/variant forms to dictionary lookup candidates.
- `textProcessing.readingAnnotation` — enables ruby/furigana-style readings only for languages that actually need them.
- `textProcessing.partOfSpeech` and `colour_codes` — define POS aliases, translatable tags, and display colors.
- `frequencyLevels` and `grammarLevels` — define labels and ordering. The UI derives `visualLevel` from this metadata instead of assuming JLPT.
- `prosody` — optional. Use this only when the language has accent/stress/tone data that should be rendered in word/flashcard surfaces.
- `languageData.dictionaryPacks` — one dictionary package per definition language, e.g. `ja -> en`, `ja -> fr`, `de -> en`.

## Python adapters

Most languages should use `src/root-of-app/generic_language.py` through metadata. If a language needs behavior that cannot be described with metadata, include an adapter in the package and opt in explicitly:

```json
{
  "runtime": {
    "nlp": {
      "adapter": {
        "type": "python-module",
        "path": "adapters/example_adapter.py"
      }
    }
  }
}
```

Do not publish `languages/<code>.py` as a convention or fallback. Undeclared adapter files are ignored.

## Building a catalog

Any static host, CDN, or API can serve a compatible catalog and archives. A third-party catalog needs to publish the JSON contract above and serve its referenced archives; it does not need the first-party deployment infrastructure.

On the development branch, dictionary builders, language sources, and the packager live in [`scripts/language-data/`](https://github.com/adrianvla/mLearn/tree/dev/scripts/language-data). Run the relevant build and validation commands from the mLearn repository:

```bash
npm run build:dictionaries
npm run package:language-data
npm run test:language-data
```

These are first-party build tools, not prerequisites for running mLearn or hosting a compatible catalog. The first-party packager writes artifacts and the catalog into the separate `mlearn-website` checkout, which owns upload and deployment. Review the scripts and their configured paths before using that publishing workflow on another machine.

## Testing a catalog

After publishing a catalog or running one locally:

1. Open Settings or the welcome window.
2. Set **Language Catalog URL** to the catalog JSON URL.
3. Select the learning language.
4. Select the dictionary definition language.
5. Install language data.
6. Smoke-test tokenization, dictionary lookup, Reader/OCR, subtitles, flashcards, Word Sync, and Level Study.

If a language needs behavior that the runtime cannot express, add a generic extension mechanism that language packages can use. Language-specific semantics belong in the package; do not hardcode a language branch in renderer or Electron code or extend a shared enumeration solely to name that language's linguistic categories. See [the open-world language architecture](../AGENTS.md#language-architecture-open-world).
