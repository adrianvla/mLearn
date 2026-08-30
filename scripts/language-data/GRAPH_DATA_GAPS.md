# Graph Builder Data Gaps

## Japanese (`ja`) — supported for common vocabulary; JMnedict-style name data absent

Jitendex 2024.10.07.0 (JMdict-derived, CC BY-SA 4.0) provides 297,255 term rows
across 149 term banks, plus 13 term-meta banks that contain only Kanjium pitch
accents. No kanji bank (KANJIDIC2) and no names dictionary (JMnedict) is
installed; the only other Jitendex payload is `jitendex/HanaMinA` glyph SVGs.

### Name-domain data (REQ54)

- **JMnedict-style data: absent.** Zero of 297,255 rows carry a
  surname/given-name/full-name/company/product/organization/station
  classification. The flood of 200k+ ordinary personal and place names
  therefore cannot pollute candidates **vacuously** — the data does not exist
  at all in the in-repo sources, so there is nothing to filter or emit.
- **Nanori readings: absent.** Nanori (name-only kanji readings) come from
  KANJIDIC2, which is not installed; the builder has no kanji bank to read.
- **What does exist:** JMdict's own proper-noun tail — 282 of 297,255 rows
  carrying name-domain badges: Jitendex mythology codes (`grmyth` 95,
  `rommyth` 53, `jpmyth` 48, `chmyth` 10), `unc` (unclassified name) 32,
  `leg` (legend) 23, `person` (full name of a particular person) 17, `work` 3,
  `place` 1 — e.g. ナポレオン, 孔子, 月読, 蓬莱, 百人一首. Building the real
  corpus emits 845 `domain: 'names'` entities (150 dictionary-entries, 245
  surfaces, 450 senses). The builder marks the entry and its senses `'names'`;
  a surface gets `'names'` only when every row realizing it is name-domain, so
  a shared homograph (レア "Rhea" / レア "rare"; 13 such terms) stays common.
  The runtime's `DEFAULT_ENABLED_DOMAINS` (`['common']`,
  src/shared/graph/types.ts) keeps `'names'` entities out of ordinary
  learning/prediction. `fem`/`masc` badges mean "female/male term or language"
  (part of speech) and are deliberately not treated as names.
- **Caveat:** marking is per JMdict entry (ent_seq). An entry that mixes a
  name sense with an ordinary sense is marked `'names'` as a whole; JMdict
  separates such senses into distinct sequences in practice, and the shared
  surface rule keeps the common homograph reachable.
- **To add real name data:** JMnedict (EDRDG, CC BY-SA 4.0,
  edrdg.org) would supply the names dictionary; the builder would emit per
  name a `dictionary-entry`, kanji/kana `surface`s, and `pronunciation`
  (has-reading) relations, all `domain: 'names'`. KANJIDIC2 (EDRDG, CC BY-SA
  4.0) would supply `character` entities and nanori readings.

## Grammar construction metadata — absent for every language (REQ46)

The optional fields forwarded by `add_grammar_from_metadata` (`category`,
`function`, `formation`, `attachments`, `constraints`, `variants`, `register`,
`contrasts`, `related`) are populated by **zero** grammar points in every
installed language package; each point carries only `pattern`, `meaning`,
`level`, plus a `match` recognition rule where present (all languages except
ja have them; cu on 13 of 18 points):

| Language | Grammar points | pattern/meaning/level | match | any rich metadata |
| --- | --- | --- | --- | --- |
| ja | 230 | 230 | 0 | none |
| ru | 78 | 78 | 78 | none |
| zh | 96 | 96 | 96 | none |
| es | 35 | 35 | 35 | none |
| cu | 18 | 18 | 13 | none |
| de | — | no grammar array in de.json | — | — |

## Vocabulary facets emitted today (REQ45)

Of the facet fields pos, register, domain, frequency, jlpt, gender,
transitivity, semanticCategory, morphologicalClass, cefr, the builders emit
only:

| Language | Facets emitted | Source data present but unemitted |
| --- | --- | --- |
| ja | none (pitch-accent prosody is emitted, but it is not one of the ten facets) | POS badges (n, v1, vt, vi, adj-i, ...), verb conjugation rules (term row field 3: v5/v1/vs/...) |
| ru | gender (m/f/n, `has-gender`) | legacy OpenRussian tables (nouns.csv, verbs.csv, ...) group by part of speech; the current words.csv path exposes only gender |
| de | gender (TEI `gramGrp/gen`, `has-gender`) | the builder reads only `gramGrp/gen` from FreeDict TEI; no POS extraction |
| zh | none | CC-CEDICT definition lines embed POS markers; pinyin tones feed prosody |
| es | none (`pos` column exists in dictionary.db; used only for entry-id hashing) | payload `examples`, `notes`, `pos` |
| cu | none | payload `partOfSpeech` array, `common`, `score` |

No builder reads any frequency, JLPT, or CEFR data source (`*.freq.json` files
in `languages/` are consumed elsewhere, not here), and register, domain (other
than the ja `'names'` marking above), transitivity, semanticCategory, and
morphologicalClass are emitted by no builder.

## Chinese (`zh`) — supported


The installed CC-CEDICT dictionary databases provide simplified and traditional
surfaces, tone-marked pinyin, and English senses. `zh.t2s.json` provides
orthography conversion mappings. No radical, stroke-order, decomposition, or
character-reading dataset is installed, so the graph does not emit character or
radical/component relations.

## Spanish (`es`) — partial

The installed FreeDict database provides headwords, parts of speech, and English
glosses. It does not provide lemma-to-inflected-form tables or reliable gender
and number features. The graph therefore emits dictionary entries, surfaces, and
senses only. A future morphology graph needs a pinned Spanish morphological
lexicon or conjugation-table source with lemma, inflected form, gender, and
number fields.

## Church Slavonic (`cu`) — supported for lexical forms

The installed kaikki.org dictionary database provides headwords, lemmas,
romanized readings, inflected-form rows, and English definitions. The graph
emits entries, lemma/form surfaces, inflection identity relations,
pronunciations, and senses. The installed corpus frequency list and Ponomar font
do not provide a Glagolitic/Cyrillic transliteration map, recension labels, or
morphological feature tables. A future orthography/morpheme graph needs a
pinned script-transliteration or character-decomposition source plus
feature-tagged morphology.
