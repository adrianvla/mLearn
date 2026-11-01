use super::super::{PACKAGE, validate_target};
use mlearn_language_sdk::{
    learning::{
        KnowledgeKey, MediaKind, ProbeInput, ProbeMedia, ProbeOutput, ReviewDirection, ReviewProbe,
        ReviewTarget,
    },
    serde_json::{self, Value},
};

/// Content shared by authored Material and canonical dictionary task composition.
pub(super) struct Content<'a> {
    pub target_id: Option<&'a str>,
    pub phrase: &'a str,
    pub meaning: &'a str,
    pub media: &'a [ProbeMedia],
}

pub(crate) fn generate(
    value: Value,
    lookup: &impl Fn(&str) -> Result<Option<Value>, String>,
) -> Result<Value, String> {
    let input: ProbeInput = serde_json::from_value(value).map_err(|error| error.to_string())?;
    input.validate(PACKAGE)?;
    let probes = if input.target_id.as_deref() == Some(super::super::grammar::TARGET) {
        Vec::new()
    } else {
        if let Some(target) = &input.target_id {
            validate_target(target, lookup)?;
        }
        compose(Content {
            target_id: input.target_id.as_deref(),
            phrase: &input.phrase,
            meaning: &input.meaning,
            media: &input.media,
        })
    };
    serde_json::to_value(ProbeOutput {
        contract_version: 1,
        probes,
    })
    .map_err(|error| error.to_string())
}

pub(super) fn compose(input: Content<'_>) -> Vec<ReviewProbe> {
    let key = |capability: &str| {
        input.target_id.map(|target| KnowledgeKey {
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
    let mut probes = Vec::new();
    let meaning = input.meaning.trim();
    if !input.phrase.trim().is_empty()
        && !meaning.is_empty()
        && !input
            .phrase
            .to_lowercase()
            .contains(&meaning.to_lowercase())
    {
        probes.push(ReviewProbe {
            id: "written".into(),
            contract_version: 1,
            direction: ReviewDirection::Written,
            cue: input.phrase.into(),
            answer: meaning.into(),
            targets: vec![row("meaning", "Meaning")],
            supplied: key("written-recognition").into_iter().collect(),
            required_media: None,
        });
    }
    if !input.phrase.trim().is_empty()
        && !meaning.is_empty()
        && !meaning
            .to_lowercase()
            .contains(&input.phrase.to_lowercase())
    {
        probes.push(ReviewProbe {
            id: "focused".into(),
            contract_version: 1,
            direction: ReviewDirection::Focused,
            cue: meaning.into(),
            answer: input.phrase.into(),
            targets: vec![row("written-recognition", "Written form")],
            supplied: key("meaning").into_iter().collect(),
            required_media: None,
        });
    }
    if let Some(media) = input.media.iter().find(|media| {
        !input.phrase.trim().is_empty() && media.kind == MediaKind::Audio && media.bound_to_target
    }) {
        let mut targets = vec![row("listening", "Listening recognition")];
        if !meaning.is_empty() {
            targets.push(row("meaning", "Meaning"));
        }
        probes.push(ReviewProbe {
            id: "audio".into(),
            contract_version: 1,
            direction: ReviewDirection::Audio,
            cue: "Listen to the audio".into(),
            answer: if meaning.is_empty() {
                input.phrase.into()
            } else {
                format!("{}\n{meaning}", input.phrase)
            },
            targets,
            supplied: vec![],
            required_media: Some(mlearn_core::AuthoredMediaId(media.id.clone())),
        });
    }
    probes.retain(|probe| probe.cue.len() <= 16_384 && probe.answer.len() <= 16_384);
    probes
}
