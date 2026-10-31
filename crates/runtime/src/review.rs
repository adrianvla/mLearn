//! Package-owned probes, bounded native due reads and durable Review admission.
use crate::{
    Installed, Runtime,
    execution::{Cancellation, Failure},
    guest::{GuestWork, LanguageAction, LanguageWork, Prepared},
};
use mlearn_core::{
    Material, MaterialMediaKind, REVIEW_POLICY_VERSION, Response, ReviewAdmission, ReviewCommand,
    ReviewMode, ReviewProbe, ReviewSessionState, ReviewWorkId, review_compatible,
};
use mlearn_storage::{ProfileStore, StorageError};
use serde::Deserialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

#[path = "review_practice.rs"]
mod practice;

pub(super) struct ReviewWork {
    command: ReviewCommand,
    packages: BTreeMap<String, Installed>,
    profile: PathBuf,
    limit: usize,
    now: i64,
}

pub(super) fn storage_failure(error: StorageError) -> Failure {
    match error {
        StorageError::Conflict => Failure::Protocol("conflict", error.to_string()),
        StorageError::Invalid(_) => Failure::Protocol("invalid_review", error.to_string()),
        StorageError::Sql(_) | StorageError::Json(_) => Failure::Operation(error.to_string()),
    }
}

fn now() -> Result<i64, Failure> {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| Failure::Operation(e.to_string()))?
        .as_secs();
    i64::try_from(seconds).map_err(|e| Failure::Operation(e.to_string()))
}

impl Runtime {
    pub(super) fn prepare_review(&mut self, command: ReviewCommand) -> Result<Prepared, Failure> {
        // A committed retry does not depend on today's package, due queue or revision.
        if let Some(commit) = self
            .store
            .review_receipt(&command)
            .map_err(storage_failure)?
        {
            return Ok(Prepared::Immediate(Box::new(Response::Review { commit })));
        }
        let now = now()?;
        let limit = match &command {
            ReviewCommand::Start { start } => match &start.mode {
                ReviewMode::Continuous => 1,
                ReviewMode::Finite { limit } if (1..=128).contains(limit) => {
                    usize::try_from(*limit).map_err(|e| Failure::Operation(e.to_string()))?
                }
                ReviewMode::Finite { .. } => {
                    return Err(Failure::Protocol(
                        "invalid_review",
                        "Finite Review requires one to 128 encounters".into(),
                    ));
                }
                ReviewMode::Practice { items } => {
                    self.validate_practice(items)?;
                    items.len() * 8
                }
            },
            ReviewCommand::Next { mutation } => {
                let session = self
                    .store
                    .review_session(&mutation.session_id)
                    .map_err(storage_failure)?;
                if session.revision != mutation.expected_revision {
                    return Err(storage_failure(StorageError::Conflict));
                }
                if session.encounter.is_some()
                    || !matches!(
                        session.state,
                        ReviewSessionState::Active | ReviewSessionState::Unavailable
                    )
                {
                    return Err(Failure::Protocol(
                        "invalid_review",
                        "Finish the active encounter and resume Review before advancing".into(),
                    ));
                }
                match session.mode {
                    ReviewMode::Continuous => 1,
                    ReviewMode::Finite { .. } | ReviewMode::Practice { .. } => {
                        let commit = self
                            .store
                            .review_next(mutation, None, now)
                            .map_err(storage_failure)?;
                        return Ok(Prepared::Immediate(Box::new(Response::Review { commit })));
                    }
                }
            }
            ReviewCommand::Reveal { .. }
            | ReviewCommand::Delivery { .. }
            | ReviewCommand::Assistance { .. }
            | ReviewCommand::Submit { .. }
            | ReviewCommand::Undo { .. }
            | ReviewCommand::Correct { .. }
            | ReviewCommand::Pause { .. }
            | ReviewCommand::Resume { .. } => {
                let commit = self
                    .store
                    .review_apply(&command, now)
                    .map_err(storage_failure)?;
                return Ok(Prepared::Immediate(Box::new(Response::Review { commit })));
            }
        };
        Ok(Prepared::Work(GuestWork::Review(Box::new(ReviewWork {
            command,
            packages: self.installed.clone(),
            profile: self.root.join("profile.sqlite3"),
            limit,
            now,
        }))))
    }

    pub(super) fn complete_review(
        &mut self,
        work: &ReviewWork,
        admissions: &[ReviewAdmission],
    ) -> Result<Response, Failure> {
        if let Some(commit) = self
            .store
            .review_receipt(&work.command)
            .map_err(storage_failure)?
        {
            return Ok(Response::Review { commit });
        }
        if let ReviewCommand::Start { start } = &work.command
            && let ReviewMode::Practice { items } = &start.mode
        {
            self.validate_practice(items)?;
        }
        for admission in admissions {
            let package = self.installed.get(&admission.package_id).ok_or_else(|| {
                Failure::Operation("Review language package became unavailable; retry".into())
            })?;
            let prepared = work
                .packages
                .get(&admission.package_id)
                .ok_or_else(|| Failure::Operation("Missing admitted Review package".into()))?;
            let current = self
                .store
                .material(&admission.material_id)
                .map_err(storage_failure)?;
            if !Arc::ptr_eq(&package.compiled, &prepared.compiled)
                || package.revision()? != admission.package_revision
                || current.revision != admission.material_revision
                || current.excluded
            {
                return Err(Failure::Protocol(
                    "conflict",
                    "Review content changed while preparing; retry the action".into(),
                ));
            }
        }
        let commit = match &work.command {
            ReviewCommand::Start { start } => self.store.review_start(start, admissions, now()?),
            ReviewCommand::Next { mutation } => {
                self.store.review_next(mutation, admissions.first(), now()?)
            }
            _ => return Err(Failure::Operation("Invalid Review admission action".into())),
        }
        .map_err(storage_failure)?;
        Ok(Response::Review { commit })
    }
}

impl ReviewWork {
    pub(super) fn run(&self) -> Result<Vec<ReviewAdmission>, Failure> {
        let store = ProfileStore::open(&self.profile).map_err(storage_failure)?;
        if let ReviewCommand::Start { start } = &self.command
            && let ReviewMode::Practice { items } = &start.mode
        {
            return self.run_practice(&store, items);
        }
        let session_id = match &self.command {
            ReviewCommand::Start { start } => &start.session_id,
            ReviewCommand::Next { mutation } => &mutation.session_id,
            _ => return Err(Failure::Operation("Invalid Review admission action".into())),
        };
        let mut admissions = Vec::new();
        let mut after = None;
        let mut unavailable = None;
        loop {
            // Memory is bounded by one native page and the explicitly finite work set.
            let page = store
                .review_due_materials(after.as_ref(), self.now, 32)
                .map_err(storage_failure)?;
            if page.is_empty() {
                if admissions.is_empty()
                    && let Some(error) = unavailable
                {
                    return Err(error);
                }
                return Ok(admissions);
            }
            for due in &page {
                after = Some(due.material.id.clone());
                let package_id = &due.material.content.package_id;
                let Some(package) = self.packages.get(package_id) else {
                    unavailable.get_or_insert_with(|| Failure::Operation(format!(
                        "Review language package {package_id} is unavailable; install it and retry"
                    )));
                    continue;
                };
                if !package
                    .manifest
                    .capabilities
                    .iter()
                    .any(|c| c == "learning.probes.v1")
                {
                    unavailable.get_or_insert_with(|| Failure::Operation(format!(
                        "Review language package {package_id} does not provide learning.probes.v1; update it and retry"
                    )));
                    continue;
                }
                let work = LanguageWork {
                    package: package.clone(),
                    cancellation: Cancellation::durable(),
                    action: LanguageAction::Describe,
                };
                let revision = package.revision()?;
                let probes = work.review_probes(&due.material, &revision)?;
                for probe in probes {
                    if due
                        .schedules
                        .iter()
                        .any(|(id, schedule)| id == &probe.id && schedule.due_at > self.now)
                    {
                        continue;
                    }
                    let identity = serde_json::to_vec(&(
                        &due.material.id,
                        due.material.revision,
                        package_id,
                        &revision,
                        &probe.id,
                    ))
                    .map_err(|e| Failure::Operation(e.to_string()))?;
                    use sha2::{Digest, Sha256};
                    let work_id = ReviewWorkId(format!("{:x}", Sha256::digest(identity)));
                    if store
                        .review_work_untested(session_id, &work_id)
                        .map_err(storage_failure)?
                    {
                        continue;
                    }
                    admissions.push(ReviewAdmission {
                        work_id,
                        material_id: due.material.id.clone(),
                        material_revision: due.material.revision,
                        package_id: package_id.clone(),
                        package_version: package.manifest.version.clone(),
                        package_revision: revision.clone(),
                        probe,
                        source: due.material.content.source.clone(),
                        scheduler_version: REVIEW_POLICY_VERSION,
                    });
                    if admissions.len() == self.limit {
                        return Ok(admissions);
                    }
                }
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProbeOutput {
    contract_version: u32,
    probes: Vec<ReviewProbe>,
}

impl LanguageWork {
    fn review_probes(
        &self,
        material: &Material,
        revision: &str,
    ) -> Result<Vec<ReviewProbe>, Failure> {
        let content = &material.content;
        let entry = content
            .target_id
            .as_deref()
            .map(|id| self.entry(id))
            .transpose()?;
        let media = material
            .media
            .iter()
            .map(|media| {
                serde_json::json!({
                    "id": media.id,
                    "kind": media.kind,
                    "boundToTarget": target_bound_audio(material, &media.id),
                })
            })
            .collect::<Vec<_>>();
        let output = self.invoke(
            "learning.probes.v1",
            serde_json::json!({
                "materialId": material.id,
                "materialRevision": material.revision,
                "packageId": content.package_id,
                "packageRevision": revision,
                "targetId": content.target_id,
                "phrase": content.phrase,
                "reading": content.reading,
                "meaning": content.meaning,
                "context": content.context,
                "media": media,
            }),
        )?;
        let output: ProbeOutput = serde_json::from_value(output)
            .map_err(|e| Failure::Operation(format!("Invalid package Review probes: {e}")))?;
        validate_probes(material, entry.as_ref(), &output)?;
        Ok(output.probes)
    }
}

fn target_bound_audio(material: &Material, id: &mlearn_core::AuthoredMediaId) -> bool {
    if !material
        .media
        .iter()
        .any(|media| &media.id == id && media.kind == MaterialMediaKind::Audio)
    {
        return false;
    }
    material.content.attachments.iter().any(|attachment| {
        &attachment.media_id == id
            && attachment.audio_binding.as_ref().is_some_and(|binding| {
                binding.package_id == material.content.package_id
                    && binding.target_id == material.content.target_id
                    && binding.phrase == material.content.phrase
            })
    })
}

fn validate_probes(
    material: &Material,
    entry: Option<&mlearn_core::LexicalEntry>,
    output: &ProbeOutput,
) -> Result<(), Failure> {
    let mut ids = BTreeSet::new();
    let valid_key = |key: &mlearn_core::KnowledgeKey| {
        key.package_id == material.content.package_id
            && material.content.target_id.as_ref() == Some(&key.target_id)
            && entry.is_some_and(|entry| entry.capabilities.iter().any(|c| c.id == key.capability))
    };
    if output.contract_version != 1
        || output.probes.len() > 8
        || output.probes.iter().any(|probe| {
            let supplied = probe
                .supplied
                .iter()
                .map(|key| (&key.package_id, &key.target_id, &key.capability))
                .collect::<BTreeSet<_>>();
            !review_compatible(probe)
                || !ids.insert(&probe.id)
                || supplied.len() != probe.supplied.len()
                || probe.targets.iter().any(|target| {
                    target.mnemonic.as_ref().is_some_and(|s| s.len() > 4096)
                        || match (&material.content.target_id, &target.key) {
                            (Some(_), Some(key)) => !valid_key(key),
                            (None, None) => false,
                            (Some(_), None) | (None, Some(_)) => true,
                        }
                })
                || probe.supplied.iter().any(|key| !valid_key(key))
                || probe
                    .required_media
                    .as_ref()
                    .is_some_and(|id| !target_bound_audio(material, id))
        })
    {
        return Err(Failure::Operation(
            "Package produced invalid or incompatible Review probes".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use mlearn_core::AuthoredMediaId;
    use serde_json::json;

    fn runtime_with_package(root: &std::path::Path) -> Runtime {
        let artifacts = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/plugin-cdn");
        let manifests: Vec<crate::catalog::Manifest> =
            serde_json::from_slice(&std::fs::read(artifacts.join("bundle.json")).unwrap()).unwrap();
        let manifest = manifests
            .into_iter()
            .find(|m| m.id == "org.mlearn.english")
            .unwrap();
        let package = crate::BundledPlugin {
            code: std::fs::read(artifacts.join(&manifest.code.path)).unwrap(),
            assets: manifest
                .assets
                .iter()
                .map(|(key, artifact)| {
                    (
                        key.clone(),
                        std::fs::read(artifacts.join(&artifact.path))
                            .unwrap()
                            .into(),
                    )
                })
                .collect(),
            manifest,
        };
        let mut runtime = Runtime::open(
            root,
            mlearn_language_host::CodePolicy::MobileBundled,
            None,
            vec![package],
        )
        .unwrap();
        let mut content = material().content;
        content.package_id = "org.mlearn.english".into();
        let response: Response = serde_json::from_str(
            &runtime.execute(
                &json!({
                    "type":"create_material","command":{
                        "commandId":"material","content":content,"distinct":true
                    }
                })
                .to_string(),
            ),
        )
        .unwrap();
        assert!(
            matches!(response, Response::MaterialWritten { .. }),
            "{response:?}"
        );
        runtime
    }

    fn start_command() -> ReviewCommand {
        serde_json::from_value(json!({"kind":"start","start":{
            "commandId":"start","sessionId":"review","mode":{"kind":"continuous"}
        }}))
        .unwrap()
    }

    #[test]
    fn due_queue_omits_v2_grammar_and_preserves_lexical_work() {
        // Given ordinary saved vocabulary and a real package-owned grammar target.
        let directory = tempfile::tempdir().unwrap();
        let mut runtime = runtime_with_package(directory.path());
        let mut content = material().content;
        content.package_id = "org.mlearn.english".into();
        content.target_id = Some("org.mlearn.english:grammar/past-simple-negative".into());
        content.package_revision = Some(
            runtime
                .installed
                .get("org.mlearn.english")
                .unwrap()
                .revision()
                .unwrap(),
        );
        content.phrase = "Past simple negative".into();
        let written: Response = serde_json::from_str(
            &runtime.execute(
                &json!({
                    "type":"create_material","command":{
                        "commandId":"grammar-material","content":content,"distinct":true
                    }
                })
                .to_string(),
            ),
        )
        .unwrap();
        assert!(
            matches!(written, Response::MaterialWritten { .. }),
            "{written:?}"
        );
        let mut command = start_command();
        let ReviewCommand::Start { start } = &mut command else {
            unreachable!()
        };
        start.mode = ReviewMode::Finite { limit: 128 };
        // When the real due owner scans the whole finite candidate set and commits it.
        let Prepared::Work(GuestWork::Review(work)) = runtime.prepare_review(command).unwrap()
        else {
            unreachable!()
        };
        let admissions = work.run().unwrap();
        let Response::Review { commit } = runtime.complete_review(&work, &admissions).unwrap()
        else {
            unreachable!()
        };
        // Then grammar neither aborts the queue nor becomes a fake lexical question.
        assert_eq!(admissions.len(), 2);
        assert!(
            admissions
                .iter()
                .flat_map(|value| &value.probe.targets)
                .all(|row| row.key.is_none())
        );
        assert_eq!(commit.session.total, Some(2));
    }

    #[test]
    fn authenticated_grammar_tasks_execute_the_declared_finite_validator() {
        // Given the real bundled package, authenticated resources and Wasmi owner.
        let directory = tempfile::tempdir().unwrap();
        let runtime = runtime_with_package(directory.path());
        let package = runtime.installed.get("org.mlearn.english").unwrap().clone();
        let revision = package.revision().unwrap();
        let work = LanguageWork {
            package,
            cancellation: Cancellation::durable(),
            action: LanguageAction::Describe,
        };
        let target = "org.mlearn.english:grammar/past-simple-negative";
        let generated = work
            .invoke(
                "learning.probes.v2",
                json!({
                    "contractVersion":2,"packageId":"org.mlearn.english",
                    "packageRevision":revision,"targetId":target,
                    "eligibleKeys":[{"packageId":"org.mlearn.english","targetId":target,
                        "capability":"org.mlearn.english:grammar-form"}]
                }),
            )
            .unwrap();
        assert_eq!(generated["contractVersion"], 2);
        assert_eq!(generated["tasks"].as_array().unwrap().len(), 1);
        let task = &generated["tasks"][0];
        let task_id = format!("{target}/typed");
        let validator_id = format!("{task_id}/validator-v1");
        assert_eq!(task["probe"]["id"], task_id);
        assert_eq!(task["task"]["validatorId"], validator_id);
        // When actual package validation runs across all finite result classes.
        let outcomes: Vec<_> = [" DID NOT FOLD ", "did not folded", "never folded"]
            .into_iter()
            .map(|response| {
                work.invoke(
                    "learning.validate.v1",
                    json!({
                        "contractVersion":1,"packageId":"org.mlearn.english",
                        "packageRevision":revision,"taskId":task_id,"taskRevision":1,
                        "validatorId":validator_id,
                        "response":{"kind":"typed_text","text":response}
                    }),
                )
                .unwrap()
            })
            .collect();
        // Then real guest execution, not a declared validator, supplies the outcomes.
        for (output, result) in outcomes.iter().zip(["accepted", "rejected", "unassessed"]) {
            assert_eq!(output["contractVersion"], 1);
            assert_eq!(output["taskId"], task_id);
            assert_eq!(output["validatorId"], validator_id);
            assert_eq!(output["outcomes"].as_array().unwrap().len(), 1);
            assert_eq!(output["outcomes"][0]["targetId"], "answer");
            assert_eq!(output["outcomes"][0]["result"], result);
        }
    }

    #[test]
    fn authenticated_grammar_generation_does_not_substitute_an_unsupported_target() {
        // Given a valid envelope naming a genuinely unsupported grammar target.
        let directory = tempfile::tempdir().unwrap();
        let runtime = runtime_with_package(directory.path());
        let package = runtime.installed.get("org.mlearn.english").unwrap().clone();
        let revision = package.revision().unwrap();
        let work = LanguageWork {
            package,
            cancellation: Cancellation::durable(),
            action: LanguageAction::Describe,
        };
        let target = "org.mlearn.english:grammar/present-perfect";
        // When generation executes in the authenticated package.
        let result = work.invoke(
            "learning.probes.v2",
            json!({
                "contractVersion":2,"packageId":"org.mlearn.english",
                "packageRevision":revision,"targetId":target,
                "eligibleKeys":[{"packageId":"org.mlearn.english","targetId":target,
                    "capability":"org.mlearn.english:grammar-form"}]
            }),
        );
        // Then neither due Review nor an unrelated recall task replaces this request.
        assert!(matches!(result, Err(Failure::Operation(_))));
    }

    #[test]
    fn admitted_review_commit_is_independent_of_source_navigation_cancellation() {
        for practice in [false, true] {
            // Given genuine package output already admitted for durable Review work.
            let directory = tempfile::tempdir().unwrap();
            let mut runtime = runtime_with_package(directory.path());
            let mut command = start_command();
            if practice {
                let material = runtime
                    .store
                    .review_due_materials(None, 0, 1)
                    .unwrap()
                    .remove(0)
                    .material;
                let ReviewCommand::Start { start } = &mut command else {
                    unreachable!()
                };
                start.mode = ReviewMode::Practice {
                    items: vec![mlearn_core::PracticeItem {
                        material_id: material.id,
                        source: None,
                    }],
                };
            }
            let Prepared::Work(work) = runtime.prepare_review(command).unwrap() else {
                panic!("Expected real package work");
            };
            let mut output = work.run().unwrap();
            runtime
                .cancellation_handle()
                .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            // When completing after an unrelated source navigation cancels source work.
            let (response, retired) = runtime.complete(&work, &mut output).unwrap();
            drop(retired);
            // Then the durable Review action still commits its genuine admitted content.
            let Response::Review { commit } = response else {
                panic!("Expected Review commit")
            };
            assert_eq!(commit.session.encounter.unwrap().cue, "a phrase");
        }
    }

    #[test]
    fn authored_edit_during_package_work_rejects_stale_admission_without_receipt() {
        // Given package-generated content computed before an authored revision changes.
        let directory = tempfile::tempdir().unwrap();
        let mut runtime = runtime_with_package(directory.path());
        let command = start_command();
        let Prepared::Work(work) = runtime.prepare_review(command.clone()).unwrap() else {
            panic!("Expected real package work");
        };
        let mut output = work.run().unwrap();
        let crate::guest::GuestOutput::Review(admissions) = &output else {
            panic!("Expected probes")
        };
        let current = runtime.store.material(&admissions[0].material_id).unwrap();
        let mut content = current.content;
        content.phrase = "changed phrase".into();
        let updated: serde_json::Value = serde_json::from_str(
            &runtime.execute(
                &json!({
                    "type":"update_material","command":{
                        "commandId":"edit","id":current.id,"expectedRevision":current.revision,
                        "content":content,"excluded":false
                    }
                })
                .to_string(),
            ),
        )
        .unwrap();
        assert_eq!(updated["type"], "material_written");
        // When the old guest result attempts to publish.
        let result = runtime.complete(&work, &mut output);
        // Then the stale question does not commit a session or consume retry identity.
        assert!(matches!(result, Err(Failure::Protocol("conflict", _))));
        assert!(runtime.store.review_receipt(&command).unwrap().is_none());
    }

    fn material() -> Material {
        serde_json::from_value(json!({
            "id":"material","revision":1,"excluded":false,
            "content":{"packageId":"example.language","targetId":null,"packageRevision":null,
                "sense":null,"phrase":"a phrase","reading":"","meaning":"a meaning",
                "context":"","notes":"","examples":[],"source":null,"attachments":[]},
            "media":[]
        }))
        .unwrap()
    }

    fn output() -> ProbeOutput {
        serde_json::from_value(json!({"contractVersion":1,"probes":[{
            "id":"written","contractVersion":1,"direction":"written","cue":"a phrase",
            "answer":"a meaning","targets":[{"id":"meaning","label":"Meaning","mnemonic":null,"key":null}],
            "supplied":[],"requiredMedia":null
        }]})).unwrap()
    }

    #[test]
    fn local_authored_probe_cannot_promote_a_package_key() {
        // Given authored content with no canonical dictionary identity.
        let material = material();
        let mut output = output();
        output.probes[0].targets[0].key = Some(mlearn_core::KnowledgeKey {
            package_id: material.content.package_id.clone(),
            target_id: "fabricated".into(),
            capability: "example.language:meaning".into(),
        });
        // When validating guest output at its native admission boundary.
        let result = validate_probes(&material, None, &output);
        // Then no canonical observation target can be invented by the guest.
        assert!(result.is_err());
    }

    #[test]
    fn supplied_answer_rejects_otherwise_valid_linked_probe() {
        // Given a real declared capability both supplied by the cue and tested.
        let mut material = material();
        material.content.target_id = Some("canonical".into());
        let entry: mlearn_core::LexicalEntry = serde_json::from_value(json!({
            "targetId":"canonical","headword":"a phrase","reading":null,"partOfSpeech":"noun",
            "definition":"a meaning","summary":null,"senses":null,"attribution":"Dictionary",
            "capabilities":[{"id":"example.language:meaning","label":"Meaning"}]
        }))
        .unwrap();
        let mut output = output();
        let key = mlearn_core::KnowledgeKey {
            package_id: material.content.package_id.clone(),
            target_id: "canonical".into(),
            capability: "example.language:meaning".into(),
        };
        output.probes[0].targets[0].key = Some(key.clone());
        assert!(validate_probes(&material, Some(&entry), &output).is_ok());
        output.probes[0].supplied.push(key);
        // When admitting the contaminated cue.
        let result = validate_probes(&material, Some(&entry), &output);
        // Then the package cannot claim incompatible fresh retrieval.
        assert!(result.is_err());
    }

    #[test]
    fn explicit_audio_binding_does_not_survive_target_content_change() {
        // Given audio explicitly bound to the exact authored phrase and package.
        let mut material = material();
        material.media = serde_json::from_value(json!([{
            "id":"clip","kind":"audio","name":"clip.wav","mimeType":"audio/wav","byteLength":48
        }]))
        .unwrap();
        material.content.attachments = serde_json::from_value(json!([{
            "mediaId":"clip","segment":null,"audioBinding":{
                "packageId":"example.language","targetId":null,"phrase":"a phrase"
            }
        }]))
        .unwrap();
        assert!(target_bound_audio(
            &material,
            &AuthoredMediaId("clip".into())
        ));
        material.content.phrase = "different phrase".into();
        // When deriving media eligibility after an authored edit.
        let bound = target_bound_audio(&material, &AuthoredMediaId("clip".into()));
        // Then the historical binding cannot silently authorize new audio semantics.
        assert!(!bound);
    }

    #[test]
    fn arbitrary_audio_attachment_cannot_satisfy_required_delivery() {
        // Given a valid audio probe referring to an unbound authored attachment.
        let mut material = material();
        material.media = serde_json::from_value(json!([{
            "id":"clip","kind":"audio","name":"clip.wav","mimeType":"audio/wav","byteLength":48
        }]))
        .unwrap();
        material.content.attachments = serde_json::from_value(json!([{
            "mediaId":"clip","segment":null
        }]))
        .unwrap();
        let mut output = output();
        output.probes[0].direction = mlearn_core::ReviewDirection::Audio;
        output.probes[0].required_media = Some(AuthoredMediaId("clip".into()));
        // When generic native admission checks the guest-required media.
        let result = validate_probes(&material, None, &output);
        // Then attached audio alone is not evidence that it matches the target.
        assert!(result.is_err());
    }
}
