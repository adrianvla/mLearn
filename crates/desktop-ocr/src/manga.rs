use crate::{
    beam::{self, Vocabulary},
    manga_pixels,
    session::Graph,
};
use image::RgbImage;
use ort::value::Tensor;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{path::Path, time::Instant};

pub struct Manga {
    encoder: Graph,
    decoder: Graph,
    vocabulary: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recognition {
    pub raw_text: String,
    pub token_ids: Vec<i64>,
    pub metrics: serde_json::Value,
}

impl Manga {
    /// Paths come from the authenticated optional model installation. No hub,
    /// Python, tokenizer encoding dependency, auto-download or hidden warmup.
    pub fn open(directory: &Path, cpu_only: bool) -> Result<Self, String> {
        Self::open_profiled(directory, cpu_only, None)
    }

    pub fn open_profiled(
        directory: &Path,
        cpu_only: bool,
        profile_directory: Option<&Path>,
    ) -> Result<Self, String> {
        let vocabulary =
            crate::bounded_text(&directory.join("vocab.txt"), 65536)?.replace("\r\n", "\n");
        if format!("{:x}", Sha256::digest(vocabulary.as_bytes())) != beam::VOCAB_SHA256 {
            return Err("MangaOCR vocabulary differs from the pinned token mapping".into());
        }
        Vocabulary::from_verified_vocab(&vocabulary).map_err(|error| error.to_string())?;
        let encoder_profile = profile_directory.map(|directory| directory.join("encoder"));
        let decoder_profile = profile_directory.map(|directory| directory.join("decoder"));
        let encoder = Graph::open_profiled(
            &directory.join("encoder_model.onnx"),
            cpu_only,
            encoder_profile.as_deref(),
        )?;
        let decoder = Graph::open_profiled(
            &directory.join("decoder_model.onnx"),
            cpu_only,
            decoder_profile.as_deref(),
        )?;
        Ok(Self {
            encoder,
            decoder,
            vocabulary,
        })
    }

    pub fn finish_profiling(&mut self) -> Result<Vec<String>, String> {
        Ok(vec![
            self.encoder.finish_profiling()?,
            self.decoder.finish_profiling()?,
        ])
    }

    pub fn recognize(
        &mut self,
        original_crop: &RgbImage,
        cancelled: impl Fn() -> bool,
    ) -> Result<Recognition, String> {
        if cancelled() {
            return Err("OCR generation cancelled".into());
        }
        let start = Instant::now();
        let input =
            Tensor::from_array(([1_i64, 3, 224, 224], manga_pixels::tensor(original_crop)?))
                .map_err(|error| error.to_string())?;
        let mut encoded = self
            .encoder
            .run(vec![("pixel_values".into(), input.into_dyn())])?;
        let hidden = encoded
            .remove("last_hidden_state")
            .ok_or("Encoder hidden state is missing")?;
        let (shape, _) = hidden
            .try_extract_tensor::<f32>()
            .map_err(|error| error.to_string())?;
        if shape.as_ref() != [1, 197, 768] {
            return Err("Manga encoder output shape does not match its pinned profile".into());
        }
        drop(encoded);
        let encoded_ms = start.elapsed().as_secs_f64() * 1000.0;
        let decode = Instant::now();
        let mut steps = 0_u32;
        let mut prefixes = 0_u32;
        let hypothesis = beam::generate(
            |sequences| -> Result<Vec<Vec<f32>>, String> {
                steps += 1;
                sequences
                    .iter()
                    .map(|sequence| {
                        if cancelled() {
                            return Err("OCR generation cancelled".into());
                        }
                        prefixes += 1;
                        let ids =
                            Tensor::from_array(([1_i64, sequence.len() as i64], sequence.clone()))
                                .map_err(|error| error.to_string())?;
                        let mut decoded = self.decoder.run_inputs(vec![
                            ("input_ids".into(), ids.into()),
                            ("encoder_hidden_states".into(), hidden.view().into()),
                        ])?;
                        let logits = decoded
                            .remove("logits")
                            .ok_or("Decoder logits are missing")?;
                        let (shape, values) = logits
                            .try_extract_tensor::<f32>()
                            .map_err(|error| error.to_string())?;
                        if shape.as_ref() != [1, sequence.len() as i64, beam::VOCAB_SIZE as i64]
                            || values.len() != sequence.len() * beam::VOCAB_SIZE
                        {
                            return Err(
                                "Manga decoder output shape does not match its pinned profile"
                                    .into(),
                            );
                        }
                        Ok(values[values.len() - beam::VOCAB_SIZE..].to_vec())
                    })
                    .collect()
            },
            &cancelled,
        )
        .map_err(|error| error.to_string())?;
        let raw_text = Vocabulary::from_verified_vocab(&self.vocabulary)
            .and_then(|vocabulary| vocabulary.decode(&hypothesis.token_ids))
            .map_err(|error| error.to_string())?;
        Ok(Recognition {
            raw_text,
            token_ids: hypothesis.token_ids,
            metrics: serde_json::json!({
                "encoderMs": encoded_ms, "decoderMs": decode.elapsed().as_secs_f64()*1000.0,
                "steps": steps, "prefixes": prefixes,
                "encoderBackend": self.encoder.backend, "decoderBackend": self.decoder.backend,
            }),
        })
    }
}
