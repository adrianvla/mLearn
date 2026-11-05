use crate::execution::Failure;
use mlearn_core::*;
use mlearn_document_parser as parser;
use std::{collections::BTreeMap, path::Path};

pub(super) struct DocumentProjection {
    pub record: DocumentRecord,
    pub blocks: Vec<DocumentBlock>,
    pub contents: Vec<DocumentNavigation>,
    pub resources: Vec<DocumentResourceLocation>,
}

pub(super) fn number(value: usize) -> Result<u32, Failure> {
    u32::try_from(value).map_err(|error| Failure::Operation(error.to_string()))
}

pub(super) fn project(
    parsed: &parser::Document,
    id: String,
    title: String,
    path: &Path,
    package_id: &str,
    package_version: &str,
) -> Result<DocumentProjection, Failure> {
    let pages: BTreeMap<_, _> = parsed
        .pages
        .iter()
        .map(|page| (page.resource.as_str(), page.index))
        .collect();
    let blocks = parsed
        .blocks
        .iter()
        .map(|block| {
            Ok(DocumentBlock {
                resource: block.resource.clone(),
                id: block.id.clone(),
                kind: block.kind.clone(),
                text: block.text.clone(),
                readings: block
                    .readings
                    .iter()
                    .map(|reading| {
                        Ok(SourceReading {
                            start: number(reading.start.0)?,
                            end: number(reading.end.0)?,
                            text: reading.text.clone(),
                        })
                    })
                    .collect::<Result<_, Failure>>()?,
                image: block.image.as_ref().map(|resource_id| DocumentImage {
                    resource_id: resource_id.clone(),
                    alt: block.text.clone(),
                }),
                page: pages.get(block.resource.as_str()).copied(),
                writing_mode: block.writing_mode.map(|mode| match mode {
                    parser::WritingMode::HorizontalTb => DocumentFlow::HorizontalTb,
                    parser::WritingMode::VerticalRl => DocumentFlow::VerticalRl,
                    parser::WritingMode::VerticalLr => DocumentFlow::VerticalLr,
                }),
            })
        })
        .collect::<Result<Vec<_>, Failure>>()?;
    let position = |block: &DocumentBlock| DocumentPosition {
        parser_revision: parsed.parser_revision.into(),
        resource: block.resource.clone(),
        block_id: block.id.clone(),
        offset: 0,
    };
    let mut contents = Vec::new();
    for entry in &parsed.navigation {
        let block = blocks
            .iter()
            .find(|block| block.resource == entry.resource && block.id == entry.block_id)
            .ok_or_else(|| {
                Failure::Operation(format!(
                    "Contents target has no preserved source anchor: {}{}",
                    entry.resource,
                    entry
                        .fragment
                        .as_ref()
                        .map_or(String::new(), |fragment| format!("#{fragment}"))
                ))
            })?;
        contents.push(DocumentNavigation {
            label: entry.label.clone(),
            position: DocumentPosition {
                offset: number(entry.offset.0)?,
                ..position(block)
            },
        });
    }
    if contents.is_empty() {
        contents.extend(
            blocks
                .iter()
                .filter(|block| block.image.is_none())
                .map(|block| DocumentNavigation {
                    label: block.page.map_or_else(
                        || {
                            block
                                .text
                                .lines()
                                .find(|line| !line.trim().is_empty())
                                .unwrap_or("Empty passage")
                                .chars()
                                .take(80)
                                .collect()
                        },
                        |page| format!("Page {}", page + 1),
                    ),
                    position: position(block),
                }),
        );
    }
    Ok(DocumentProjection {
        record: DocumentRecord {
            id,
            title,
            document_path: path.to_string_lossy().into_owned(),
            content_revision: parsed.content_revision.clone(),
            parser_revision: parsed.parser_revision.into(),
            format: match parsed.format {
                parser::Format::Text => DocumentFormat::Text,
                parser::Format::Epub => DocumentFormat::Epub,
                parser::Format::Pdf => DocumentFormat::Pdf,
            },
            package_id: package_id.into(),
            package_version: package_version.into(),
            position: None,
            appearance: DocumentAppearance::default(),
            progression: parsed.progression.clone(),
            total_blocks: number(blocks.len())?,
            total_pages: number(parsed.pages.len())?,
            fidelity: parsed
                .fidelity
                .iter()
                .map(|value| (*value).into())
                .collect(),
        },
        blocks,
        contents,
        resources: Vec::new(),
    })
}
