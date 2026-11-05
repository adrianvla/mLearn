use std::error::Error;

use mlearn_japanese_engine::{JapaneseEngine, Token};

fn engine() -> Result<JapaneseEngine, Box<dyn Error>> {
    let path = std::env::var_os("MLEARN_SUDACHI_DICTIONARY")
        .ok_or("set MLEARN_SUDACHI_DICTIONARY to the pinned Small 20260116 system.dic")?;
    Ok(JapaneseEngine::from_dictionary_bytes(std::fs::read(path)?)?)
}

fn assert_original_spans(text: &str, tokens: &[Token]) {
    for token in tokens {
        assert_eq!(
            text.get(token.start..token.end),
            Some(token.surface.as_str())
        );
        assert_eq!(token.pos.len(), 6);
    }
}

#[test]
fn retains_pinned_mode_c_morphology_and_original_coordinates() -> Result<(), Box<dyn Error>> {
    // Given the pinned Small dictionary and reusable Mode C owner.
    let mut engine = engine()?;
    let cases = [
        (
            "食べました",
            vec!["食べる", "ます", "た"],
            vec!["タベ", "マシ", "タ"],
        ),
        ("行った", vec!["行く", "た"], vec!["イッ", "タ"]),
        (
            "東京都に行った",
            vec!["東京", "都", "に", "行く", "た"],
            vec!["トウキョウ", "ト", "ニ", "イッ", "タ"],
        ),
        (
            "国家公務員",
            vec!["国家", "公務", "員"],
            vec!["コッカ", "コウム", "イン"],
        ),
    ];
    for (text, lemmas, readings) in cases {
        // When analyzing each utterance without replacing the owner.
        let tokens = engine.analyze(text)?;
        // Then pinned native semantics and original byte coordinates are retained.
        assert_eq!(
            tokens.iter().map(|t| t.lemma.as_str()).collect::<Vec<_>>(),
            lemmas
        );
        assert_eq!(
            tokens
                .iter()
                .map(|t| t.reading.as_str())
                .collect::<Vec<_>>(),
            readings
        );
        assert_original_spans(text, &tokens);
    }
    Ok(())
}

#[test]
fn preserves_normalization_oov_and_ignored_yomigana_spans() -> Result<(), Box<dyn Error>> {
    // Given mixed original text, including a one-to-many normalization.
    let mut engine = engine()?;
    let text = " \t東京都に😀行った　ＡＢＣ ㍿ ｶﾞｯﾂﾎﾟｰｽﾞ\n漢字(かんじ)";
    // When applying upstream default normalization and OOV plugins.
    let tokens = engine.analyze(text)?;
    // Then original source bytes survive, including upstream's empty expansion span.
    assert_original_spans(text, &tokens);
    let emoji = tokens
        .iter()
        .find(|t| t.surface == "😀")
        .ok_or("missing emoji")?;
    assert!(emoji.oov);
    assert_eq!((emoji.start, emoji.end), (14, 18));
    let ascii = tokens
        .iter()
        .find(|t| t.surface == "ＡＢＣ")
        .ok_or("missing ABC")?;
    assert_eq!((&*ascii.lemma, &*ascii.reading), ("ABC", "エービーシー"));
    let expanded = tokens
        .iter()
        .find(|t| t.lemma == "会社")
        .ok_or("missing expansion")?;
    assert_eq!(
        (expanded.start, expanded.end, expanded.surface.as_str()),
        (43, 43, "")
    );
    let kanji = tokens.last().ok_or("missing kanji")?;
    assert_eq!(
        (&*kanji.surface, &*kanji.lemma, &*kanji.reading),
        ("漢字(かんじ)", "漢字", "カンジ")
    );
    Ok(())
}

#[test]
fn clears_previous_results_for_empty_input() -> Result<(), Box<dyn Error>> {
    // Given an owner which already analyzed source text.
    let mut engine = engine()?;
    engine.analyze("行った")?;
    // When analyzing an empty next input.
    let tokens = engine.analyze("")?;
    // Then no previous tokens leak into the next response.
    assert!(tokens.is_empty());
    Ok(())
}
