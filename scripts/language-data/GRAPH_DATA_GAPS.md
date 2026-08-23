# Graph Builder Data Gaps

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
