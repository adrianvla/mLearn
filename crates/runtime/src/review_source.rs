//! Practice source alignment is shared by saved Materials and canonical targets.
use super::*;
use mlearn_core::{AnalyzedToken, SourceAnchor, SourceLocator};

fn selection(anchor: &SourceAnchor) -> Result<(u32, u32, &str), Failure> {
    let (start, end) = match &anchor.locator {
        SourceLocator::Message {
            selection_start,
            selection_end,
            ..
        }
        | SourceLocator::Video {
            selection_start,
            selection_end,
            ..
        }
        | SourceLocator::Document {
            selection_start,
            selection_end,
            ..
        }
        | SourceLocator::Image {
            selection_start,
            selection_end,
            ..
        } => (*selection_start, *selection_end),
    };
    let start_byte =
        usize::try_from(start).map_err(|error| Failure::Operation(error.to_string()))?;
    let end_byte = usize::try_from(end).map_err(|error| Failure::Operation(error.to_string()))?;
    let selected = anchor
        .text
        .get(start_byte..end_byte)
        .filter(|text| !text.is_empty())
        .ok_or_else(|| {
            Failure::Protocol(
                "invalid_review",
                "Word Practice requires a valid source selection".into(),
            )
        })?;
    Ok((start, end, selected))
}

impl LanguageWork {
    pub(super) fn validate_practice_target(
        &self,
        material: &Material,
        anchor: &SourceAnchor,
    ) -> Result<(), Failure> {
        match &material.content.target_id {
            Some(target) => self.validate_canonical_practice_source(target, anchor),
            None => {
                if selection(anchor)?.2 != material.content.phrase {
                    return Err(Failure::Protocol(
                        "invalid_review",
                        "Word Practice source selection does not match the saved Material phrase"
                            .into(),
                    ));
                }
                Ok(())
            }
        }
    }

    pub(super) fn validate_canonical_practice_source(
        &self,
        target: &str,
        anchor: &SourceAnchor,
    ) -> Result<(), Failure> {
        let (start, end, selected) = selection(anchor)?;
        let output = self.invoke(
            "text.analyze.v1",
            serde_json::json!({"texts":[anchor.text]}),
        )?;
        let tokens: Vec<Vec<AnalyzedToken>> = serde_json::from_value(output)
            .map_err(|error| Failure::Operation(error.to_string()))?;
        if tokens.len() != 1
            || !tokens[0].iter().any(|token| {
                token.start == start
                    && token.end == end
                    && token.text == selected
                    && token.targets.iter().any(|id| id == target)
            })
        {
            return Err(Failure::Protocol(
                "invalid_review",
                "Word Practice source selection does not match the canonical target".into(),
            ));
        }
        Ok(())
    }
}
