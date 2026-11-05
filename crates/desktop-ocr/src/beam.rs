//! MangaOCR's pinned deterministic generation profile; no model or session owner.
use std::{cmp::Ordering, fmt};

pub const START_ID: i64 = 2;
pub const EOS_ID: i64 = 3;
pub const PAD_ID: i64 = 0;
pub const VOCAB_SIZE: usize = 6144;
pub const NUM_BEAMS: usize = 4;
pub const MAX_LENGTH: usize = 300;
pub const VOCAB_SHA256: &str = "344fbb6b8bf18c57839e924e2c9365434697e0227fac00b88bb4899b78aa594d";

#[derive(Debug, Clone, PartialEq)]
pub struct Hypothesis {
    /// Includes start and, only if actually generated, EOS. No padding.
    pub token_ids: Vec<i64>,
    pub log_probability: f32,
    /// Cumulative log probability / (generated length)^2; start is excluded.
    pub score: f32,
}

#[derive(Debug, PartialEq)]
pub enum BeamError<E> {
    Cancelled,
    Decoder(E),
    InvalidLogits,
    NoContinuation,
}

impl<E: fmt::Display> fmt::Display for BeamError<E> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cancelled => f.write_str("OCR generation cancelled"),
            Self::Decoder(error) => write!(f, "OCR decoder: {error}"),
            Self::InvalidLogits => f.write_str("Invalid OCR decoder logits"),
            Self::NoContinuation => f.write_str("No legal OCR continuation"),
        }
    }
}

impl<E: std::error::Error + 'static> std::error::Error for BeamError<E> {}

/// Generate one crop using four beams, length penalty 2, no repeated trigrams,
/// early stopping, and max length 300 INCLUDING the single start token.
///
/// `decoder` receives 1..=4 equal-length full sequences in beam order and returns
/// one vocabulary-sized row of next-token (last position) logits per sequence.
/// It must share the crop's encoder output and must not assume KV-cache ancestry.
/// Cancellation is checked before and after each decoder call and before return;
/// the caller must also interrupt a running inference inside the callback.
///
/// # Errors
/// Propagates decoder failures; rejects malformed/non-finite logits (negative
/// infinity is permitted), impossible continuations, and cancellation.
pub fn generate<E>(
    decoder: impl FnMut(&[Vec<i64>]) -> Result<Vec<Vec<f32>>, E>,
    cancelled: impl FnMut() -> bool,
) -> Result<Hypothesis, BeamError<E>> {
    search(decoder, cancelled, VOCAB_SIZE, MAX_LENGTH)
}

#[derive(Clone, Copy)]
struct Candidate {
    beam: usize,
    token: i64,
    log_probability: f32,
}

fn candidate_order(a: &Candidate, b: &Candidate) -> Ordering {
    b.log_probability
        .total_cmp(&a.log_probability)
        .then(a.beam.cmp(&b.beam))
        .then(a.token.cmp(&b.token))
}

fn search<E>(
    mut decoder: impl FnMut(&[Vec<i64>]) -> Result<Vec<Vec<f32>>, E>,
    mut cancelled: impl FnMut() -> bool,
    vocab_size: usize,
    max_length: usize,
) -> Result<Hypothesis, BeamError<E>> {
    // Only the first initial beam has probability mass. Other initial beams in
    // Transformers are -1e9 placeholders, not four copies of the same hypothesis.
    let mut sequences = vec![vec![START_ID]];
    let mut scores = vec![0.0_f32];
    let mut finished: Vec<Hypothesis> = Vec::with_capacity(NUM_BEAMS);
    let mut candidates = Vec::with_capacity(NUM_BEAMS * vocab_size);

    for length in 2..=max_length {
        if cancelled() {
            return Err(BeamError::Cancelled);
        }
        let logits = decoder(&sequences).map_err(BeamError::Decoder)?;
        if cancelled() {
            return Err(BeamError::Cancelled);
        }
        if logits.len() != sequences.len() {
            return Err(BeamError::InvalidLogits);
        }
        candidates.clear();
        for (beam, row) in logits.iter().enumerate() {
            if row.len() != vocab_size || row.iter().any(|v| v.is_nan() || *v == f32::INFINITY) {
                return Err(BeamError::InvalidLogits);
            }
            let maximum = row.iter().copied().fold(f32::NEG_INFINITY, f32::max);
            if !maximum.is_finite() {
                return Err(BeamError::InvalidLogits);
            }
            let log_sum = row.iter().map(|v| (*v - maximum).exp()).sum::<f32>().ln();
            // Mask AFTER log_softmax, without renormalizing. The start token
            // participates in the n-gram history just as the decoder prompt does.
            let sequence = &sequences[beam];
            let mut banned = vec![false; vocab_size];
            if sequence.len() >= 2 {
                let suffix = &sequence[sequence.len() - 2..];
                for trigram in sequence.windows(3) {
                    if trigram[..2] == *suffix {
                        let token =
                            usize::try_from(trigram[2]).map_err(|_| BeamError::InvalidLogits)?;
                        banned[token] = true;
                    }
                }
            }
            for (token, value) in row.iter().enumerate() {
                let log_probability = scores[beam] + (*value - maximum - log_sum);
                if !banned[token] && log_probability.is_finite() {
                    candidates.push(Candidate {
                        beam,
                        token: i64::try_from(token).map_err(|_| BeamError::InvalidLogits)?,
                        log_probability,
                    });
                }
            }
        }
        // One EOS id: the global top 2*num_beams supplies four live backups.
        let keep = 2 * NUM_BEAMS;
        if candidates.len() > keep {
            candidates.select_nth_unstable_by(keep, candidate_order);
            candidates.truncate(keep);
        }
        candidates.sort_by(candidate_order);
        if candidates.is_empty() {
            return Err(BeamError::NoContinuation);
        }
        let mut next_sequences = Vec::with_capacity(NUM_BEAMS);
        let mut next_scores = Vec::with_capacity(NUM_BEAMS);
        for (rank, candidate) in candidates.iter().enumerate() {
            let stopping = candidate.token == EOS_ID || length == max_length;
            if stopping && rank >= NUM_BEAMS {
                continue;
            }
            if !stopping && next_sequences.len() == NUM_BEAMS {
                continue;
            }
            let mut tokens = sequences[candidate.beam].clone();
            tokens.push(candidate.token);
            if stopping {
                // The prompt length is one. EOS and the max-length token count.
                let generated =
                    f32::from(u16::try_from(length - 1).map_err(|_| BeamError::InvalidLogits)?);
                finished.push(Hypothesis {
                    token_ids: tokens,
                    log_probability: candidate.log_probability,
                    score: candidate.log_probability / generated.powi(2),
                });
            } else {
                next_sequences.push(tokens);
                next_scores.push(candidate.log_probability);
            }
        }
        // Stable sorting retains the older completion on equal normalized scores,
        // then the current candidate rank. No tensor-backend-dependent topk ties.
        finished.sort_by(|a, b| b.score.total_cmp(&a.score));
        finished.truncate(NUM_BEAMS);
        if finished.len() == NUM_BEAMS || length == max_length || next_sequences.is_empty() {
            break;
        }
        sequences = next_sequences;
        scores = next_scores;
    }
    if cancelled() {
        return Err(BeamError::Cancelled);
    }
    finished.into_iter().next().ok_or(BeamError::NoContinuation)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VocabularyError {
    InvalidVocabulary,
    InvalidToken(i64),
}

impl fmt::Display for VocabularyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidVocabulary => f.write_str("Invalid MangaOCR vocabulary"),
            Self::InvalidToken(id) => write!(f, "Invalid MangaOCR token id {id}"),
        }
    }
}

impl std::error::Error for VocabularyError {}

pub struct Vocabulary<'a> {
    tokens: Vec<&'a str>,
}

impl<'a> Vocabulary<'a> {
    /// Parse UTF-8 vocab.txt AFTER the resource owner verifies VOCAB_SHA256.
    /// This verifies its shape/special ids, not cryptographic provenance.
    pub fn from_verified_vocab(text: &'a str) -> Result<Self, VocabularyError> {
        let tokens: Vec<_> = text.lines().collect();
        if tokens.len() != VOCAB_SIZE
            || tokens[..5] != ["[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]"]
            || tokens.iter().any(|token| token.is_empty())
        {
            return Err(VocabularyError::InvalidVocabulary);
        }
        Ok(Self { tokens })
    }

    /// BertJapanese character-token intermediate text, skipping all five special
    /// ids. Package normalization (whitespace/ellipsis/full-width) happens later.
    pub fn decode(&self, ids: &[i64]) -> Result<String, VocabularyError> {
        let mut tokens = Vec::with_capacity(ids.len());
        for &id in ids {
            let index = usize::try_from(id).map_err(|_| VocabularyError::InvalidToken(id))?;
            let token = self
                .tokens
                .get(index)
                .ok_or(VocabularyError::InvalidToken(id))?;
            if index >= 5 {
                tokens.push(*token);
            }
        }
        Ok(tokens.join(" ").replace(" ##", "").trim().to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::Cell, convert::Infallible};

    fn probabilities(size: usize, entries: &[(usize, f32)]) -> Vec<f32> {
        let mut row = vec![f32::NEG_INFINITY; size];
        for &(token, probability) in entries {
            row[token] = probability.ln();
        }
        row
    }

    fn close(actual: f32, expected: f32) {
        assert!((actual - expected).abs() < 2e-6, "{actual} != {expected}");
    }

    #[test]
    fn cumulative_probability_beats_greedy_first_token() {
        // Given: token 5 is locally best, but token 6 has the best completion.
        let decoder = |sequences: &[Vec<i64>]| -> Result<_, Infallible> {
            Ok(sequences
                .iter()
                .map(|ids| match ids.as_slice() {
                    [2] => probabilities(10, &[(5, 0.55), (6, 0.45)]),
                    [2, 5] => probabilities(10, &[(3, 0.4), (7, 0.3), (8, 0.3)]),
                    [2, 6] => probabilities(10, &[(3, 0.9), (7, 0.1)]),
                    _ => panic!("unexpected decoder prefix"),
                })
                .collect())
        };
        // When
        let result = search(decoder, || false, 10, 3).unwrap();
        // Then: both token probabilities, including EOS, contribute.
        assert_eq!(result.token_ids, [2, 6, 3]);
        close(result.log_probability, (0.45_f32 * 0.9).ln());
        close(result.score, (0.45_f32 * 0.9).ln() / 4.0);
    }

    #[test]
    fn longer_completion_replaces_earlier_eos_using_generated_length() {
        // Given: an immediate EOS competes with a less probable longer path.
        let decoder = |sequences: &[Vec<i64>]| -> Result<_, Infallible> {
            Ok(sequences
                .iter()
                .map(|ids| match ids.as_slice() {
                    [2] => probabilities(10, &[(3, 0.6), (5, 0.4)]),
                    [2, 5] => probabilities(10, &[(6, 1.0)]),
                    [2, 5, 6] => probabilities(10, &[(7, 1.0)]),
                    [2, 5, 6, 7] => probabilities(10, &[(3, 1.0)]),
                    _ => panic!("finished sequence was decoded"),
                })
                .collect())
        };
        // When
        let result = search(decoder, || false, 10, 6).unwrap();
        // Then: start is excluded, EOS is included, and first EOS did not stop.
        assert_eq!(result.token_ids, [2, 5, 6, 7, 3]);
        close(result.score, 0.4_f32.ln() / 16.0);
    }

    #[test]
    fn eos_outside_global_top_four_is_not_admitted() {
        // Given: EOS ranks fifth, and its score would beat every cap completion.
        let decoder = |sequences: &[Vec<i64>]| -> Result<_, Infallible> {
            Ok(sequences
                .iter()
                .map(|ids| {
                    if ids.len() == 1 {
                        probabilities(
                            VOCAB_SIZE,
                            &[(5, 0.3), (6, 0.25), (7, 0.2), (8, 0.15), (3, 0.1)],
                        )
                    } else {
                        vec![0.0; VOCAB_SIZE]
                    }
                })
                .collect())
        };
        // When
        let result = search(decoder, || false, VOCAB_SIZE, 3).unwrap();
        // Then: rank-five EOS is neither a completion nor a live continuation.
        assert_eq!(result.token_ids, [2, 5, 0]);
        close(result.score, (0.3_f32.ln() - 6144.0_f32.ln()) / 4.0);
        assert!(result.score < 0.1_f32.ln());
    }

    #[test]
    fn eos_uses_backup_candidates_and_stops_at_four_completions() {
        // Given: EOS consumes a top-four slot; rank five must supply a live beam.
        let calls = Cell::new(0);
        let decoder = |sequences: &[Vec<i64>]| -> Result<_, Infallible> {
            calls.set(calls.get() + 1);
            if calls.get() == 1 {
                assert_eq!(sequences, &[vec![2]]);
                Ok(vec![probabilities(
                    10,
                    &[
                        (3, 0.4),
                        (5, 0.25),
                        (6, 0.15),
                        (7, 0.1),
                        (8, 0.06),
                        (9, 0.04),
                    ],
                )])
            } else {
                assert_eq!(sequences, &[vec![2, 5], vec![2, 6], vec![2, 7], vec![2, 8]]);
                // There are also live alternatives after this step. They must
                // not be decoded after the finished pool reaches four.
                Ok(sequences
                    .iter()
                    .map(|_| probabilities(10, &[(3, 0.9), (9, 0.1)]))
                    .collect())
            }
        };
        // When
        let result = search(decoder, || false, 10, 20).unwrap();
        // Then
        assert_eq!(calls.get(), 2);
        assert_eq!(result.token_ids, [2, 5, 3]);
        close(result.score, (0.25_f32 * 0.9).ln() / 4.0);
    }

    #[test]
    fn trigram_mask_includes_start_without_renormalizing() {
        // Given: [2,5,6] has appeared, and the suffix is again [2,5].
        let decoder = |sequences: &[Vec<i64>]| -> Result<_, Infallible> {
            Ok(sequences
                .iter()
                .map(|ids| match ids.len() {
                    1 => probabilities(10, &[(5, 1.0)]),
                    2 => probabilities(10, &[(6, 1.0)]),
                    3 => probabilities(10, &[(2, 1.0)]),
                    4 => probabilities(10, &[(5, 1.0)]),
                    5 => probabilities(10, &[(6, 0.9), (3, 0.1)]),
                    _ => panic!("repeated trigram was continued"),
                })
                .collect())
        };
        // When
        let result = search(decoder, || false, 10, 10).unwrap();
        // Then: suppress 6 but retain EOS's original log probability.
        assert_eq!(result.token_ids, [2, 5, 6, 2, 5, 3]);
        close(result.log_probability, 0.1_f32.ln());
        close(result.score, 0.1_f32.ln() / 25.0);
    }

    #[test]
    fn max_length_finalizes_live_beams_without_inventing_eos() {
        // Given: only one legal path and it never generates EOS or a trigram.
        let calls = Cell::new(0);
        let decoder = |sequences: &[Vec<i64>]| -> Result<_, Infallible> {
            calls.set(calls.get() + 1);
            Ok(sequences
                .iter()
                .map(|ids| probabilities(VOCAB_SIZE, &[(ids.len() + 4, 1.0)]))
                .collect())
        };
        // When: use the public fixed production profile.
        let result = generate(decoder, || false).unwrap();
        // Then: 299 decoder steps, exactly 300 ids including start.
        assert_eq!(calls.get(), 299);
        assert_eq!(result.token_ids.len(), 300);
        assert_eq!(result.token_ids[0], 2);
        assert_eq!(result.token_ids[299], 303);
        assert!(!result.token_ids.contains(&3));
        close(result.score, 0.0);
    }

    #[test]
    fn cap_keeps_better_earlier_completion() {
        // Given: immediate EOS is nearly certain, and remaining paths are poor.
        let decoder = |sequences: &[Vec<i64>]| -> Result<_, Infallible> {
            Ok(sequences
                .iter()
                .map(|ids| {
                    if ids.len() == 1 {
                        probabilities(10, &[(3, 0.999), (5, 0.001)])
                    } else {
                        probabilities(10, &[(6, 1.0)])
                    }
                })
                .collect())
        };
        // When
        let result = search(decoder, || false, 10, 3).unwrap();
        // Then: cap does not discard or extend the earlier completion.
        assert_eq!(result.token_ids, [2, 3]);
        close(result.score, 0.999_f32.ln());
    }

    #[test]
    fn ties_choose_parent_then_token() {
        // Given: all paths have equal scores at equal lengths.
        let decoder = |sequences: &[Vec<i64>]| -> Result<_, Infallible> {
            Ok(sequences
                .iter()
                .map(|ids| {
                    if ids.len() == 1 {
                        probabilities(10, &[(5, 0.5), (6, 0.5)])
                    } else {
                        probabilities(10, &[(7, 0.5), (8, 0.5)])
                    }
                })
                .collect())
        };
        // When
        let result = search(decoder, || false, 10, 3).unwrap();
        // Then
        assert_eq!(result.token_ids, [2, 5, 7]);
    }

    #[test]
    fn normalized_score_ties_keep_older_completion() {
        // Given: EOS at length 1 and EOS at length 2 both score ln(0.5).
        // Remaining probability mass is diluted at the cap below that score.
        let decoder = |sequences: &[Vec<i64>]| -> Result<_, Infallible> {
            Ok(sequences
                .iter()
                .map(|ids| match ids.len() {
                    1 => probabilities(VOCAB_SIZE, &[(3, 0.5), (5, 0.5)]),
                    2 => probabilities(VOCAB_SIZE, &[(3, 0.125), (6, 0.875)]),
                    3 => vec![0.0; VOCAB_SIZE],
                    _ => panic!("unexpected decoder prefix"),
                })
                .collect())
        };
        // When
        let result = search(decoder, || false, VOCAB_SIZE, 4).unwrap();
        // Then: insertion order is the deterministic finished-hypothesis tie rule.
        assert_eq!(result.token_ids, [2, 3]);
        close(result.score, 0.5_f32.ln());
    }

    #[test]
    fn cancellation_before_decoder_prevents_inference() {
        // Given / When
        let result = generate(
            |_| -> Result<Vec<Vec<f32>>, Infallible> { panic!("cancelled inference") },
            || true,
        );
        // Then
        assert_eq!(result, Err(BeamError::Cancelled));
    }

    #[test]
    fn cancellation_during_decoder_discards_even_completed_output() {
        // Given
        let cancelled = Cell::new(false);
        // When
        let result = generate(
            |_| -> Result<_, Infallible> {
                cancelled.set(true);
                Ok(vec![probabilities(VOCAB_SIZE, &[(3, 1.0)])])
            },
            || cancelled.get(),
        );
        // Then
        assert_eq!(result, Err(BeamError::Cancelled));
    }

    #[test]
    fn cancellation_between_steps_prevents_next_decoder() {
        // Given: cancellation changes exactly at the second step admission.
        let checks = Cell::new(0);
        let calls = Cell::new(0);
        // When
        let result = generate(
            |_| -> Result<_, Infallible> {
                calls.set(calls.get() + 1);
                Ok(vec![probabilities(VOCAB_SIZE, &[(5, 1.0)])])
            },
            || {
                checks.set(checks.get() + 1);
                checks.get() == 3
            },
        );
        // Then
        assert_eq!(result, Err(BeamError::Cancelled));
        assert_eq!(calls.get(), 1);
    }

    #[test]
    fn decoder_errors_and_invalid_logits_are_not_empty_success() {
        // Given: failures at the decoder boundary.
        let rows = [
            vec![],
            vec![vec![0.0; 2]],
            vec![vec![f32::NAN; VOCAB_SIZE]],
            vec![vec![f32::INFINITY; VOCAB_SIZE]],
            vec![vec![f32::NEG_INFINITY; VOCAB_SIZE]],
        ];
        // When / Then
        for row in rows {
            let result = generate(|_| Ok::<_, Infallible>(row.clone()), || false);
            assert_eq!(result, Err(BeamError::InvalidLogits));
        }
        assert_eq!(
            generate(|_| Err::<Vec<Vec<f32>>, _>("session failed"), || false),
            Err(BeamError::Decoder("session failed"))
        );
    }

    fn vocabulary_fixture() -> String {
        let mut tokens: Vec<_> = [
            "[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]", "日", "本", "A", "1", "…", "##x",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect();
        tokens.resize(VOCAB_SIZE, "字".to_owned());
        tokens.join("\n") + "\n"
    }

    #[test]
    fn vocabulary_preserves_intermediate_spacing_and_skips_special_ids() {
        // Given: a structurally valid vocabulary fixture, not a provenance claim.
        let text = vocabulary_fixture();
        let vocab = Vocabulary::from_verified_vocab(&text).unwrap();
        // When
        let decoded = vocab.decode(&[2, 5, 1, 6, 7, 10, 8, 9, 3, 0, 4]).unwrap();
        // Then: no package whitespace/ellipsis/full-width normalization here.
        assert_eq!(decoded, "日 本 Ax 1 …");
        assert_eq!(vocab.decode(&[-1]), Err(VocabularyError::InvalidToken(-1)));
        assert_eq!(
            vocab.decode(&[6144]),
            Err(VocabularyError::InvalidToken(6144))
        );
        assert_eq!(vocab.decode(&[0, 1, 2, 3, 4]).unwrap(), "");
    }

    #[test]
    fn vocabulary_rejects_wrong_size_special_map_and_empty_tokens() {
        // Given
        let valid = vocabulary_fixture();
        let wrong_special = valid.replacen("[CLS]", "[SEP]", 1);
        let empty_token = valid.replacen("\n日\n", "\n\n", 1);
        // When / Then
        for invalid in ["[PAD]\n", &wrong_special, &empty_token] {
            assert!(matches!(
                Vocabulary::from_verified_vocab(invalid),
                Err(VocabularyError::InvalidVocabulary)
            ));
        }
    }

    #[test]
    fn verified_installed_vocabulary_decodes_without_python() {
        // Given: optional offline reference input; no normal-test cache dependency.
        let Some(path) = std::env::var_os("MLEARN_BEAM_REFERENCE_VOCAB") else {
            return;
        };
        let text = std::fs::read_to_string(path).unwrap();
        let vocab = Vocabulary::from_verified_vocab(&text).unwrap();
        // When
        let decoded = vocab.decode(&[2, 15, 16, 17, 6143, 3]).unwrap();
        // Then: these are actual pinned vocab ids, not tokenizer encoding.
        assert_eq!(decoded, "! \" # \u{e0101}");
    }
}
