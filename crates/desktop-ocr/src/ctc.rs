//! Generic Paddle/Rapid CTC recognition. No MangaOCR or language-code dispatch.
use crate::{raster::linear_resize, session::Graph};
use image::RgbImage;
use ort::value::Tensor;

const HEIGHT: u32 = 48;
const MIN_WIDTH: u32 = 320;
const MAX_WIDTH: u32 = 4096;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("CTC alphabet is missing or exceeds its supported bounds")]
    Alphabet,
    #[error("CTC input is empty or exceeds the supported line width")]
    Input,
    #[error("CTC output violates its pinned tensor/probability contract")]
    Output,
    #[error("CTC inference: {0}")]
    Runtime(String),
}

pub struct Alphabet {
    // Index zero is CTC blank. A real space remains the final class, as in
    // RapidOCR's get_character; neither entry comes from a guessed dictionary.
    labels: Vec<String>,
}

#[derive(Debug, PartialEq)]
pub struct Prediction {
    pub text: String,
    pub confidence: Option<f64>,
}

impl Alphabet {
    pub fn from_model_metadata(value: &str) -> Result<Self, Error> {
        if value.len() > 256 * 1024 {
            return Err(Error::Alphabet);
        }
        let mut labels = vec![String::new()];
        for label in value.lines() {
            if label.is_empty() || label.len() > 64 || labels.len() >= 65535 {
                return Err(Error::Alphabet);
            }
            labels.push(label.to_owned());
        }
        if labels.len() < 2 {
            return Err(Error::Alphabet);
        }
        labels.push(" ".into());
        Ok(Self { labels })
    }

    pub fn classes(&self) -> usize {
        self.labels.len()
    }

    pub fn decode(&self, probabilities: &[f32], steps: usize) -> Result<Prediction, Error> {
        if steps == 0
            || steps > 2048
            || steps.checked_mul(self.classes()) != Some(probabilities.len())
        {
            return Err(Error::Output);
        }
        let mut text = String::new();
        let mut previous = 0;
        let mut confidence = 0.0;
        let mut emitted = 0_u32;
        for row in probabilities.chunks_exact(self.classes()) {
            let mut best = 0;
            let mut sum = 0.0;
            for (index, &value) in row.iter().enumerate() {
                if !value.is_finite() || !(0.0..=1.0).contains(&value) {
                    return Err(Error::Output);
                }
                sum += f64::from(value);
                if value > row[best] {
                    best = index;
                }
            }
            if !(0.999..=1.001).contains(&sum) {
                return Err(Error::Output);
            }
            if best != 0 && best != previous {
                text.push_str(&self.labels[best]);
                // The retained Rapid decoder rounds each selected probability
                // and then its arithmetic mean to five decimal places.
                confidence += (f64::from(row[best]) * 100_000.0).round_ties_even() / 100_000.0;
                emitted += 1;
            }
            previous = best;
        }
        Ok(Prediction {
            text,
            confidence: (emitted > 0).then(|| {
                (confidence / f64::from(emitted) * 100_000.0).round_ties_even() / 100_000.0
            }),
        })
    }
}

pub struct Prepared {
    pub data: Vec<f32>,
    pub width: u32,
}

pub fn preprocess(original: &RgbImage) -> Result<Prepared, Error> {
    if original.width() == 0 || original.height() == 0 {
        return Err(Error::Input);
    }
    let width = u64::from(HEIGHT)
        .checked_mul(u64::from(original.width()))
        .ok_or(Error::Input)?
        .div_ceil(u64::from(original.height()));
    let resized_width = u32::try_from(width).map_err(|_| Error::Input)?;
    let width = resized_width.max(MIN_WIDTH);
    if width > MAX_WIDTH {
        return Err(Error::Input);
    }
    let resized = linear_resize(original, resized_width, HEIGHT).map_err(Error::Runtime)?;
    let plane = usize::try_from(u64::from(width) * u64::from(HEIGHT)).map_err(|_| Error::Input)?;
    let mut data = vec![0.0; 3 * plane];
    for (x, y, pixel) in resized.enumerate_pixels() {
        let offset = usize::try_from(u64::from(y) * u64::from(width) + u64::from(x))
            .map_err(|_| Error::Input)?;
        for channel in 0..3 {
            data[channel * plane + offset] = (f32::from(pixel[channel]) / 255.0 - 0.5) / 0.5;
        }
    }
    Ok(Prepared { data, width })
}

pub struct Ctc {
    pub graph: Graph,
    alphabet: Alphabet,
    input: String,
    output: String,
}

impl Ctc {
    pub fn open(
        path: &std::path::Path,
        input: &str,
        output: &str,
        cpu_only: bool,
    ) -> Result<Self, Error> {
        if input.is_empty() || output.is_empty() {
            return Err(Error::Input);
        }
        let graph = Graph::open(path, cpu_only).map_err(Error::Runtime)?;
        let metadata = graph
            .metadata("character")
            .map_err(Error::Runtime)?
            .ok_or(Error::Alphabet)?;
        let alphabet = Alphabet::from_model_metadata(&metadata)?;
        Ok(Self {
            graph,
            alphabet,
            input: input.into(),
            output: output.into(),
        })
    }

    pub fn recognize(&mut self, image: &RgbImage) -> Result<Prediction, Error> {
        let prepared = preprocess(image)?;
        let tensor = Tensor::from_array((
            [1_i64, 3, i64::from(HEIGHT), i64::from(prepared.width)],
            prepared.data,
        ))
        .map_err(|error| Error::Runtime(error.to_string()))?;
        let outputs = self
            .graph
            .run(vec![(self.input.clone(), tensor.into_dyn())])
            .map_err(Error::Runtime)?;
        let values = outputs.get(&self.output).ok_or(Error::Output)?;
        let (shape, data) = values
            .try_extract_tensor::<f32>()
            .map_err(|_| Error::Output)?;
        let [1, steps, classes] = &shape[..] else {
            return Err(Error::Output);
        };
        if usize::try_from(*classes).map_err(|_| Error::Output)? != self.alphabet.classes() {
            return Err(Error::Output);
        }
        self.alphabet
            .decode(data, usize::try_from(*steps).map_err(|_| Error::Output)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blanks_separate_repeated_letters_and_real_space_is_not_dropped() {
        // Given the embedded alphabet plus the model's blank and final space.
        let alphabet = Alphabet::from_model_metadata("a\r\nb\r\n").unwrap();
        let rows = [
            [0.05, 0.9, 0.03, 0.02],
            [0.1, 0.8, 0.05, 0.05],
            [0.7, 0.1, 0.1, 0.1],
            [0.01, 0.95, 0.02, 0.02],
            [0.1, 0.05, 0.05, 0.8],
            [0.05, 0.03, 0.9, 0.02],
        ];
        // When decoding repeated IDs with an intervening blank.
        let prediction = alphabet.decode(&rows.concat(), rows.len()).unwrap();
        // Then space, both distinct 'a's and only emitted-character scores survive.
        assert_eq!(
            prediction,
            Prediction {
                text: "aa b".into(),
                confidence: Some(0.8875)
            }
        );
    }

    #[test]
    fn blank_prediction_has_no_invented_character_confidence() {
        // Given a real blank class probability.
        let alphabet = Alphabet::from_model_metadata("x").unwrap();
        // When no character is selected.
        let prediction = alphabet.decode(&[1.0, 0.0, 0.0], 1).unwrap();
        // Then no probability is fabricated for an absent character.
        assert_eq!(
            prediction,
            Prediction {
                text: String::new(),
                confidence: None
            }
        );
    }

    #[test]
    fn unicode_symbols_remain_dictionary_values_not_language_branches() {
        // Given arbitrary multi-byte dictionary values.
        let alphabet = Alphabet::from_model_metadata("é\nが").unwrap();
        // When both classes are emitted.
        let prediction = alphabet
            .decode(&[0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0], 2)
            .unwrap();
        // Then original Unicode is retained.
        assert_eq!(prediction.text, "éが");
    }

    #[test]
    fn wrong_class_count_or_invalid_probabilities_are_errors_not_empty_success() {
        // Given a three-class model contract.
        let alphabet = Alphabet::from_model_metadata("x").unwrap();
        // When a graph violates that contract.
        for row in [
            &[0.0, 1.0][..],
            &[0.0, f32::NAN, 0.0],
            &[0.0, 1.1, 0.0],
            &[0.0, 0.0, 0.0],
        ] {
            // Then the decoding boundary rejects the result.
            assert!(alphabet.decode(row, 1).is_err());
        }
    }

    #[test]
    fn rgb_channels_and_normalized_zero_padding_match_the_reference() {
        // Given a one-pixel RGB crop.
        let image = RgbImage::from_pixel(1, 1, image::Rgb([255, 0, 255]));
        // When preparing the fixed-height, minimum-width tensor.
        let prepared = preprocess(&image).unwrap();
        // Then channels remain RGB and padding is normalized zero, not black.
        let plane = usize::try_from(HEIGHT * MIN_WIDTH).unwrap();
        assert_eq!(prepared.width, MIN_WIDTH);
        assert_eq!(
            [
                prepared.data[0],
                prepared.data[plane],
                prepared.data[2 * plane]
            ],
            [1.0, -1.0, 1.0]
        );
        assert_eq!(
            [
                prepared.data[48],
                prepared.data[plane + 48],
                prepared.data[2 * plane + 48]
            ],
            [0.0; 3]
        );
    }

    #[test]
    fn overly_wide_lines_fail_instead_of_silently_squashing_the_source() {
        // Given a source exceeding the finite recognition width.
        let image = RgbImage::new(100, 1);
        // When preparing it.
        let result = preprocess(&image);
        // Then the user must choose a smaller source crop.
        assert!(matches!(result, Err(Error::Input)));
    }
}
