# JMdict attribution and data license

This package uses the JMdict Japanese-English Dictionary, copyright James
William Breen and the Electronic Dictionary Research and Development Group
(EDRDG). JMdict and the derived lexical SQLite index are distributed under
Creative Commons Attribution-ShareAlike 4.0 (CC-BY-SA-4.0).

Source and documentation: https://www.edrdg.org/jmdict/j_jmdict.html

EDRDG license statement: https://www.edrdg.org/edrdg/licence.html

License deed: https://creativecommons.org/licenses/by-sa/4.0/

License legal code: https://creativecommons.org/licenses/by-sa/4.0/legalcode

The pinned source timestamp, SHA-256, distribution URL and size are recorded
in `data-pin.json`. The preparation recipe derives an English lexical index,
retaining entry identities, reading/form restrictions and inherited POS.
It does not claim EDRDG endorsement or ownership of JMdict material.

Updates are explicit: acquire a new official snapshot, review and replace the
timestamp/hash/size pin, rebuild the index, and verify entry identity and
restriction regression tests before publishing a new authenticated package.
The moving daily URL must never silently replace the pinned source.

## Character source inputs

`data-pin.json` also pins KANJIDIC2 and KRADFILE for offline character-resource
preparation in the existing immutable lexicon resource. Character targets have
separate canonical identities from JMdict entries.

KANJIDIC2 is copyright James William Breen and EDRDG. KRADFILE is copyright
Michael Raine, James William Breen and EDRDG. These files and derived data are
distributed under the same CC-BY-SA-4.0 license described above.

KANJIDIC2 documentation: https://www.edrdg.org/wiki/KANJIDIC_Project.html

KRADFILE documentation: https://www.edrdg.org/krad/kradinf.html

KRADFILE contains visual lookup elements, sometimes represented by a kanji
containing an element rather than the element itself. Those lookup keys are
not identity or learner evidence for the representative character.
KANJIDIC2's JLPT field is the pre-2010 scale, not the current N1-N5 scale.
Neither source is represented as an authored stroke-order exercise.

The original KANJIDIC2 input also credits Jack Halpern (SKIP), Christian
Wittern and Koichi Yasuoka (Pinyin), Urs App (Four Corner/Morohashi), Mark
Spahn and Wolfgang Hadamitzky (descriptors), Charles Muller (Korean), and
Joseph De Roo (De Roo codes). SKIP's supplementary conditions are at
http://www.kanji.org/kanji/dictionaries/skip_permission.htm.
The prepared character records omit dictionary-reference and query codes;
the original input remains unchanged.

Reproduce the checked-in character archives with
`python3 tools/japanese_characters.py --kanjidic2 <verified-archive> --kradfile <verified-archive>`.
The command verifies compressed and expanded identities before publishing;
it cannot overwrite a different existing artifact. Normal builds consume
these frozen inputs offline. Publishing dictionary updates requires a regular
source-update procedure under the publisher's terms: review a current
snapshot, change its explicit pin, regenerate and verify, then publish a new
authenticated package. Freezing a snapshot does not replace that procedure.
