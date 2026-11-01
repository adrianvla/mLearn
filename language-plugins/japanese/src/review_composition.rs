use super::super::{characters, dictionary_capabilities, hiragana, validate_entry, PACKAGE};
use mlearn_core::{Capability, LexicalEntry};
use mlearn_language_sdk::{
    learning::{
        KnowledgeKey, MediaKind, ProbeInput, ProbeMedia, ProbeOutput, ReviewDirection, ReviewProbe,
        ReviewTarget,
    },
    serde_json::{self, Value},
};

/// The same package-owned content view serves authored and canonical tasks.
pub(super) struct Content<'a> {
    pub target_id: Option<&'a str>,
    pub phrase: &'a str,
    pub reading: &'a str,
    pub meaning: &'a str,
    pub media: &'a [ProbeMedia],
    pub capabilities: Option<&'a [Capability]>,
}

pub(crate) fn generate(
    value: Value,
    lookup: &impl Fn(&str) -> Result<Option<Value>, String>,
) -> Result<Value, String> {
    let input: ProbeInput = serde_json::from_value(value).map_err(|error| error.to_string())?;
    input.validate(PACKAGE)?;
    let character = match input.target_id.as_deref() {
        Some(target) if target.starts_with("kanjidic:") => {
            let entry: LexicalEntry = serde_json::from_value(characters::inspect(target, lookup)?)
                .map_err(|error| error.to_string())?;
            if input.phrase.trim() != entry.headword {
                return Err("Character material differs from its canonical literal".into());
            }
            Some(entry)
        }
        Some(target) => {
            let sequence = target
                .strip_prefix("jmdict:")
                .filter(|seq| {
                    !seq.is_empty()
                        && seq.len() <= 10
                        && seq.bytes().all(|byte| byte.is_ascii_digit())
                })
                .ok_or("Unknown Japanese target identity")?;
            validate_entry(
                target,
                lookup(&format!("entry/{sequence}"))?.ok_or("JMdict entry not found")?,
            )?;
            if dictionary_capabilities(target).is_empty() {
                return serde_json::to_value(ProbeOutput {
                    contract_version: 1,
                    probes: Vec::new(),
                })
                .map_err(|error| error.to_string());
            }
            None
        }
        None => None,
    };
    let probes = compose(Content {
        target_id: input.target_id.as_deref(),
        phrase: &input.phrase,
        reading: &input.reading,
        meaning: &input.meaning,
        media: &input.media,
        capabilities: character
            .as_ref()
            .map(|entry| entry.capabilities.as_slice()),
    });
    serde_json::to_value(ProbeOutput {
        contract_version: 1,
        probes,
    })
    .map_err(|error| error.to_string())
}

pub(super) fn compose(input: Content<'_>) -> Vec<ReviewProbe> {
    let supported = |capability: &str| {
        input.capabilities.is_none_or(|capabilities| {
            let id = format!("{PACKAGE}:{capability}");
            capabilities.iter().any(|value| value.id == id)
        })
    };
    let key = |capability: &str| {
        input
            .target_id
            .filter(|_| supported(capability))
            .map(|target| KnowledgeKey {
                package_id: PACKAGE.into(),
                target_id: target.into(),
                capability: format!("{PACKAGE}:{capability}"),
            })
    };
    let row = |capability: &str, label: &str| ReviewTarget {
        id: capability.into(),
        label: label.into(),
        mnemonic: None,
        key: key(capability),
    };
    let meaning = if supported("meaning") {
        input.meaning.trim()
    } else {
        ""
    };
    let reading = if supported("reading") {
        input.reading.trim()
    } else {
        ""
    };
    // Inspection joins published alternatives with " / ". Any visible alternative
    // discloses this Knowledge key; it cannot become hidden reading retrieval.
    let supplies_reading = |cue: &str| {
        reading
            .split(" / ")
            .filter(|value| !value.trim().is_empty())
            .any(|value| hiragana(cue).contains(&hiragana(value)))
    };
    let hidden_reading = !reading.is_empty() && !supplies_reading(input.phrase);
    let mut probes = Vec::new();
    let mut targets = Vec::new();
    if hidden_reading {
        targets.push(row("reading", "Reading"));
    }
    if !meaning.is_empty() && !input.phrase.contains(meaning) {
        targets.push(row("meaning", "Meaning"));
    }
    let answer = [reading, meaning]
        .into_iter()
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if !input.phrase.trim().is_empty() && !targets.is_empty() {
        let mut supplied: Vec<_> = key("written-recognition").into_iter().collect();
        if !hidden_reading && !reading.is_empty() {
            supplied.extend(key("reading"));
        }
        probes.push(ReviewProbe {
            id: "written".into(),
            contract_version: 1,
            direction: ReviewDirection::Written,
            cue: input.phrase.into(),
            answer,
            targets,
            supplied,
            required_media: None,
        });
    }
    if supported("written-recognition")
        && !input.phrase.trim().is_empty()
        && !meaning.is_empty()
        && !meaning.contains(input.phrase)
        && (reading.is_empty() || !supplies_reading(meaning))
    {
        let mut targets = vec![row("written-recognition", "Written form")];
        if hidden_reading {
            targets.push(row("reading", "Reading"));
        }
        probes.push(ReviewProbe {
            id: "focused".into(),
            contract_version: 1,
            direction: ReviewDirection::Focused,
            cue: meaning.into(),
            answer: if hidden_reading {
                format!("{}\n{reading}", input.phrase)
            } else {
                input.phrase.into()
            },
            targets,
            supplied: key("meaning").into_iter().collect(),
            required_media: None,
        });
    }
    if let Some(media) = input.media.iter().find(|media| {
        supported("listening")
            && !input.phrase.trim().is_empty()
            && media.kind == MediaKind::Audio
            && media.bound_to_target
    }) {
        let mut targets = vec![row("listening", "Listening recognition")];
        if !meaning.is_empty() {
            targets.push(row("meaning", "Meaning"));
        }
        probes.push(ReviewProbe {
            id: "audio".into(),
            contract_version: 1,
            direction: ReviewDirection::Audio,
            cue: "音声を聞く".into(),
            answer: [input.phrase, reading, meaning]
                .into_iter()
                .filter(|text| !text.is_empty())
                .collect::<Vec<_>>()
                .join("\n"),
            targets,
            supplied: key("reading").into_iter().collect(),
            required_media: Some(mlearn_core::AuthoredMediaId(media.id.clone())),
        });
    }
    probes.retain(|probe| probe.cue.len() <= 16_384 && probe.answer.len() <= 16_384);
    probes
}
