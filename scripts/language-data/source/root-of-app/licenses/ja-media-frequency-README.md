# Japanese media frequency curriculum

`languages/ja.media.freq.json` is a transformed extract of
`data/enrichment/frequency-subtitles.json` from
[jkindrix/japanese-language-data](https://github.com/jkindrix/japanese-language-data),
commit `28ae0f545aee9d9bc3547ce4bd7725b55e9b00f1`. That project derives
the counts and ranks from the OpenSubtitles 2018 Japanese corpus through
[hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords),
then matches vocabulary against JMdict. The source project and FrequencyWords
content identify their content license as **CC BY-SA 4.0**. The derived
curriculum asset is distributed under CC BY-SA 4.0; attribution and the
license link must accompany any published package.

- Source file: https://github.com/jkindrix/japanese-language-data/blob/28ae0f545aee9d9bc3547ce4bd7725b55e9b00f1/data/enrichment/frequency-subtitles.json
- Source SHA-256: `7aef89336af9ec00da408ded3e31f6be5811dd93fd3e9c4950968e40345dbc46`
- License: https://creativecommons.org/licenses/by-sa/4.0/
- Rebuild: `python3 scripts/language-data/providers/build-japanese-subtitle-frequency.py`

Rows retain the source's ascending, one-based rank and occurrence count. The
builder trims outer whitespace, normalizes surface and reading to Unicode NFC,
and deduplicates only identical surface-reading pairs. It does not convert a
surface to a lemma or equate different readings. The package assigns curriculum
bands by original source rank: 1–1,000; 1,001–3,000; 3,001–5,000;
5,001–8,000; and 8,001 onward. JLPT membership is a separate provider with
its own asset and level labels. Frequency ranks reflect this subtitle corpus,
not a universal measure of Japanese usage.

## Credits and upstream terms

Japanese Language Data: copyright Justin Kindrix and contributors. This extract
uses that project's subtitle-frequency enrichment at the pinned revision above.
Its [license](https://github.com/jkindrix/japanese-language-data/blob/28ae0f545aee9d9bc3547ce4bd7725b55e9b00f1/LICENSE)
and [attribution record](https://github.com/jkindrix/japanese-language-data/blob/28ae0f545aee9d9bc3547ce4bd7725b55e9b00f1/ATTRIBUTION.md)
provide the source notices.

Frequency counts are derived from FrequencyWords by **Hermit Dave**, using the
[OpenSubtitles 2018 corpus](https://opus.nlpl.eu/OpenSubtitles-v2018.php), under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).

This work uses the **JMdict** file. This file is the property of **James William
Breen and the Electronic Dictionary Research and Development Group (EDRDG)**,
and is used in conformance with the Group's license. See the
[JMdict project](https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project)
and [EDRDG General Dictionary Licence Statement](https://www.edrdg.org/edrdg/licence.html).
The upstream enrichment ingests JMdict through
[scriptin/jmdict-simplified](https://github.com/scriptin/jmdict-simplified).

This derived data, including its transformed surfaces/readings and frequency
records, is offered under CC BY-SA 4.0. Preserve applicable attribution, license
notices and indications of changes when redistributing it; adaptations must
satisfy the license's ShareAlike terms. The application's software license and
EULA do not impose additional restrictions on rights granted for this data.
