//! Exact canonical Practice scope, committed by the existing Review transaction.
use crate::{material_read, material_validation, ProfileStore, StorageError};
use mlearn_core::*;
use rusqlite::Connection;
use std::collections::BTreeSet;

pub(crate) fn validate(
    db: &Connection,
    items: &[TargetPracticeItem],
    assistance: &[ReviewAssistance],
) -> Result<(), StorageError> {
    if assistance.len() > 2
        || assistance.iter().enumerate().any(|(index, item)| {
            !matches!(item, ReviewAssistance::Inspector | ReviewAssistance::Source)
                || assistance[..index].contains(item)
        })
    {
        return Err(StorageError::Invalid(
            "Invalid initial Practice assistance".into(),
        ));
    }
    if !(1..=128).contains(&items.len()) {
        return Err(StorageError::Invalid(
            "Practice requires 1..128 explicit targets".into(),
        ));
    }
    let mut identities = BTreeSet::new();
    for item in items {
        material_validation::bounded(&item.package_revision, 512)?;
        let target = MaterialTarget {
            package_id: item.package_id.clone(),
            target_id: item.target_id.clone(),
        };
        material_validation::target(&target)?;
        if !identities.insert((&item.package_id, &item.target_id))
            || !(1..=32).contains(&item.capabilities.len())
        {
            return Err(StorageError::Invalid(
                "Invalid or duplicate Practice target scope".into(),
            ));
        }
        let mut capabilities = BTreeSet::new();
        for capability in &item.capabilities {
            material_validation::bounded(capability, 512)?;
            if !capabilities.insert(capability) {
                return Err(StorageError::Invalid(
                    "Duplicate Practice capability".into(),
                ));
            }
        }
        if let Some(anchor) = &item.source {
            material_validation::source(anchor)?;
            if anchor.package_id != item.package_id {
                return Err(StorageError::Invalid(
                    "Practice source belongs to another package".into(),
                ));
            }
        }
        if matches!(
            material_read::eligibility(db, &target)?.availability,
            CaptureAvailability::Excluded | CaptureAvailability::Existing { excluded: true, .. }
        ) {
            return Err(StorageError::Invalid(
                "Selected Practice target is excluded".into(),
            ));
        }
    }
    Ok(())
}

pub(crate) fn admit(
    db: &Connection,
    items: &[TargetPracticeItem],
    assistance: &[ReviewAssistance],
    admissions: &[ReviewAdmission],
) -> Result<u32, StorageError> {
    validate(db, items, assistance)?;
    if admissions.is_empty() || admissions.len() > items.len() * 8 {
        return Err(StorageError::Invalid(
            "Canonical Practice probe bound exceeded".into(),
        ));
    }
    let expected: BTreeSet<_> = items
        .iter()
        .flat_map(|item| {
            item.capabilities.iter().map(|capability| {
                (
                    item.package_id.as_str(),
                    item.target_id.as_str(),
                    capability.as_str(),
                )
            })
        })
        .collect();
    let mut tested = BTreeSet::new();
    for admission in admissions {
        let ReviewSubject::Target { target_id } = &admission.subject else {
            return Err(StorageError::Invalid(
                "Canonical Practice cannot admit a Material".into(),
            ));
        };
        let item = items
            .iter()
            .find(|item| item.package_id == admission.package_id && item.target_id == *target_id)
            .ok_or_else(|| {
                StorageError::Invalid("Canonical Practice broadened its target scope".into())
            })?;
        if item.package_revision != admission.package_revision || item.source != admission.source {
            return Err(StorageError::Invalid(
                "Canonical Practice admission changed its origin".into(),
            ));
        }
        for row in &admission.probe.targets {
            let key = row.key.as_ref().ok_or_else(|| {
                StorageError::Invalid("Canonical Practice requires exact tested keys".into())
            })?;
            let identity = (
                key.package_id.as_str(),
                key.target_id.as_str(),
                key.capability.as_str(),
            );
            if !expected.contains(&identity) || !tested.insert(identity) {
                return Err(StorageError::Invalid(
                    "Canonical Practice broadened or duplicated tested scope".into(),
                ));
            }
        }
    }
    if tested != expected {
        return Err(StorageError::Invalid(
            "Canonical Practice omitted a requested capability".into(),
        ));
    }
    u32::try_from(admissions.len()).map_err(|error| StorageError::Invalid(error.to_string()))
}

impl ProfileStore {
    pub fn review_practice_targets(
        &self,
        items: &[TargetPracticeItem],
        assistance: &[ReviewAssistance],
    ) -> Result<(), StorageError> {
        validate(&self.connection, items, assistance)
    }
}
