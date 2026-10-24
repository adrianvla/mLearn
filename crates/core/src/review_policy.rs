//! Honest deterministic retention policy, not a predictive learner model.
use crate::{AttemptQuality, ReviewAttemptId, ReviewDirection, ReviewProbe, ReviewSchedule};
use std::collections::BTreeSet;

pub const REVIEW_POLICY_VERSION: u32 = 1;

/// Admission checks semantics supplied by a package without naming capabilities.
pub fn review_compatible(probe: &ReviewProbe) -> bool {
    if probe.contract_version != 1
        || probe.id.is_empty()
        || probe.id.len() > 256
        || probe.cue.is_empty()
        || probe.cue.len() > 16_384
        || probe.answer.is_empty()
        || probe.answer.len() > 16_384
        || probe.targets.is_empty()
        || probe.targets.len() > 32
        || probe.supplied.len() > 64
    {
        return false;
    }
    match probe.direction {
        ReviewDirection::Audio if probe.required_media.is_none() => return false,
        ReviewDirection::Written | ReviewDirection::Focused if probe.required_media.is_some() => {
            return false;
        }
        _ => {}
    }
    if probe
        .required_media
        .as_ref()
        .is_some_and(|id| id.0.is_empty())
    {
        return false;
    }
    let mut row_ids = BTreeSet::new();
    let mut tested = BTreeSet::new();
    for target in &probe.targets {
        if target.id.is_empty()
            || target.id.len() > 256
            || target.label.is_empty()
            || target.label.len() > 256
            || !row_ids.insert(&target.id)
        {
            return false;
        }
        if let Some(key) = &target.key {
            let identity = (&key.package_id, &key.target_id, &key.capability);
            if key.package_id.is_empty()
                || key.target_id.is_empty()
                || key.capability.is_empty()
                || !tested.insert(identity)
                || probe.supplied.iter().any(|supplied| supplied == key)
            {
                return false;
            }
        }
    }
    true
}

/// Only assessed rows call this function. Unknown/untested has no transition.
/// Worked-out and assisted reports are classified by the evidence owner first.
pub fn review_schedule(
    previous: Option<&ReviewSchedule>,
    quality: AttemptQuality,
    easy: bool,
    now: i64,
    attempt: &ReviewAttemptId,
) -> ReviewSchedule {
    let previous_interval = previous.map_or(0, |schedule| schedule.interval_seconds);
    let interval_seconds = match quality {
        AttemptQuality::Missed => 60,
        AttemptQuality::Struggled => 600,
        AttemptQuality::Fluent => {
            let ordinary = previous_interval.saturating_mul(2).max(86_400);
            if easy {
                ordinary.saturating_mul(2)
            } else {
                ordinary
            }
        }
    }
    .min(31_536_000);
    ReviewSchedule {
        due_at: now.saturating_add(i64::from(interval_seconds)),
        interval_seconds,
        revision: previous.map_or(1, |schedule| schedule.revision.saturating_add(1)),
        owner_attempt: Some(attempt.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AuthoredMediaId, KnowledgeKey, ReviewTarget};

    fn key(capability: &str) -> KnowledgeKey {
        KnowledgeKey {
            package_id: "third.party".into(),
            target_id: "stable:target".into(),
            capability: capability.into(),
        }
    }

    fn probe() -> ReviewProbe {
        ReviewProbe {
            id: "package-written-meaning".into(),
            contract_version: 1,
            direction: ReviewDirection::Written,
            cue: "word".into(),
            answer: "definition".into(),
            targets: vec![ReviewTarget {
                id: "meaning-row".into(),
                label: "Meaning".into(),
                mnemonic: Some("m".into()),
                key: Some(key("package.meaning")),
            }],
            supplied: vec![key("package.written")],
            required_media: None,
        }
    }

    #[test]
    fn supplied_answers_cannot_be_tested_as_recall() {
        let mut candidate = probe();
        assert!(review_compatible(&candidate));
        candidate.supplied.push(key("package.meaning"));
        assert!(!review_compatible(&candidate));
    }

    #[test]
    fn listening_requires_real_media_and_keeps_distinct_capabilities() {
        let mut candidate = probe();
        candidate.direction = ReviewDirection::Audio;
        assert!(!review_compatible(&candidate));
        candidate.required_media = Some(AuthoredMediaId("authored-audio".into()));
        candidate.targets[0].key = Some(key("package.listening"));
        assert!(review_compatible(&candidate));
        candidate.supplied.push(key("package.listening"));
        assert!(!review_compatible(&candidate));
    }

    #[test]
    fn local_authored_rows_do_not_require_canonical_identity() {
        let mut candidate = probe();
        candidate.targets[0].key = None;
        assert!(review_compatible(&candidate));
        candidate.targets.push(candidate.targets[0].clone());
        assert!(!review_compatible(&candidate));
    }

    #[test]
    fn baseline_intervals_are_deterministic_and_easy_is_fluent_preference() {
        let attempt = ReviewAttemptId("attempt".into());
        let missed = review_schedule(None, AttemptQuality::Missed, false, 100, &attempt);
        let struggled = review_schedule(None, AttemptQuality::Struggled, false, 100, &attempt);
        let fluent = review_schedule(None, AttemptQuality::Fluent, false, 100, &attempt);
        let easy = review_schedule(None, AttemptQuality::Fluent, true, 100, &attempt);
        assert_eq!(missed.due_at, 160);
        assert_eq!(struggled.due_at, 700);
        assert_eq!(fluent.due_at, 86_500);
        assert_eq!(easy.due_at, 172_900);
        assert_eq!(
            review_schedule(None, AttemptQuality::Missed, true, 100, &attempt),
            missed
        );
    }

    #[test]
    fn advancing_caps_intervals_and_preserves_ownership() {
        let previous = ReviewSchedule {
            due_at: 10,
            interval_seconds: 31_536_000,
            revision: 17,
            owner_attempt: Some(ReviewAttemptId("older".into())),
        };
        let attempt = ReviewAttemptId("new".into());
        let next = review_schedule(Some(&previous), AttemptQuality::Fluent, true, 50, &attempt);
        assert_eq!(next.interval_seconds, 31_536_000);
        assert_eq!(next.revision, 18);
        assert_eq!(next.owner_attempt, Some(attempt));
        assert_eq!(previous.revision, 17);
    }
}
