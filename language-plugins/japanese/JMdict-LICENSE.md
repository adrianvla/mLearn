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
