//! MangaOCR's pinned PIL RGB -> L -> RGB, bilinear 224x224, float32 NCHW.
//! The fixed-point separable filter follows Pillow 12.1.1 Resample.c.
//! Adapted to Rust and to a single grayscale channel; see THIRD-PARTY.md.
use image::RgbImage;

const SIDE: usize = 224;
const PRECISION: u32 = 22;

fn coefficients(input: usize) -> Vec<(usize, Vec<i64>)> {
    let scale = input as f64 / SIDE as f64;
    let support = scale.max(1.0);
    (0..SIDE)
        .map(|index| {
            let center = (index as f64 + 0.5) * scale;
            // C's conversion truncates toward zero before clipping.
            let first = ((center - support + 0.5) as isize).max(0) as usize;
            let end = ((center + support + 0.5) as usize).min(input);
            let weights = (first..end)
                .map(|pixel| (1.0 - ((pixel as f64 - center + 0.5) / support).abs()).max(0.0))
                .collect::<Vec<_>>();
            let sum: f64 = weights.iter().sum();
            (
                first,
                weights
                    .into_iter()
                    .map(|weight| (0.5 + weight / sum * f64::from(1_u32 << PRECISION)) as i64)
                    .collect(),
            )
        })
        .collect()
}

fn grayscale(image: &RgbImage) -> Vec<u8> {
    image
        .pixels()
        .map(|pixel| {
            ((u32::from(pixel[0]) * 19595
                + u32::from(pixel[1]) * 38470
                + u32::from(pixel[2]) * 7471
                + 32768)
                >> 16) as u8
        })
        .collect()
}

pub fn resized_gray(image: &RgbImage) -> Result<Vec<u8>, String> {
    let (width, height) = (image.width() as usize, image.height() as usize);
    if width == 0
        || height == 0
        || width > 32768
        || height > 32768
        || width
            .checked_mul(height)
            .is_none_or(|pixels| pixels > 64 * 1024 * 1024)
    {
        return Err("Recognition crop exceeds its raster bounds".into());
    }
    let gray = grayscale(image);
    let horizontal = if width == SIDE {
        gray
    } else {
        let coefficients = coefficients(width);
        let mut output = vec![0; SIDE * height];
        for y in 0..height {
            for (x, (first, weights)) in coefficients.iter().enumerate() {
                let value = weights.iter().enumerate().fold(
                    1_i64 << (PRECISION - 1),
                    |value, (offset, weight)| {
                        value + i64::from(gray[y * width + first + offset]) * weight
                    },
                );
                output[y * SIDE + x] = (value >> PRECISION).clamp(0, 255) as u8;
            }
        }
        output
    };
    if height == SIDE {
        return Ok(horizontal);
    }
    let coefficients = coefficients(height);
    let mut output = vec![0; SIDE * SIDE];
    for (y, (first, weights)) in coefficients.iter().enumerate() {
        for x in 0..SIDE {
            let value = weights.iter().enumerate().fold(
                1_i64 << (PRECISION - 1),
                |value, (offset, weight)| {
                    value + i64::from(horizontal[(first + offset) * SIDE + x]) * weight
                },
            );
            output[y * SIDE + x] = (value >> PRECISION).clamp(0, 255) as u8;
        }
    }
    Ok(output)
}

pub fn tensor(image: &RgbImage) -> Result<Vec<f32>, String> {
    let gray = resized_gray(image)?;
    let channel = gray
        .iter()
        .map(|&value| {
            // The reference rescales in float64, casts to float32, then normalizes.
            let rescaled = (f64::from(value) / 255.0) as f32;
            (rescaled - 0.5) / 0.5
        })
        .collect::<Vec<_>>();
    Ok(channel.repeat(3))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    #[test]
    fn color_and_resampling_match_original_pil_and_processor_tensors() {
        // Captured with tools/reference-ocr-preprocessing.py, Pillow 12.1.1
        // and the original pinned MangaOCR ViTImageProcessorPil, no weights.
        for (width, height, gray_digest, tensor_digest) in [
            (
                2,
                1,
                "3f9a93a14ca85be73cc4edeebfef97f4a1440da1797aa3e614188bd02e130744",
                "b3c73b2ea3e20602e80c932ee51cb6780b4fb007fce5e6493e986239cd90fa9d",
            ),
            (
                7,
                13,
                "acb668c2d13d9618b5fcde37d561fcc403bfd84fe545e424560a8876e016260d",
                "7dbb4051d784daec7fd9a451be3ce46ce4bee7908debc20eee2155778a2bc705",
            ),
            (
                451,
                229,
                "9a30faca1c67d6e151308c206dfe82c2e90a899a7bed2497d63a31ce9339598c",
                "7c0873bf6533688fae3c8577499ac0e71bafbc7033f37a1582c8f1bd04d424aa",
            ),
            (
                224,
                224,
                "31b679ce097ae436489eae143401193f178e07b40767adce1b803791febffbab",
                "e4e28d1d817db7f497f70ca3156c564878cf874a3b2e7f6a23e650b293319a24",
            ),
        ] {
            let image = RgbImage::from_fn(width, height, |x, y| {
                image::Rgb([
                    ((17 * x + 31 * y) % 256) as u8,
                    ((97 * x + 3 * y) % 256) as u8,
                    ((7 * x + 113 * y) % 256) as u8,
                ])
            });
            assert_eq!(
                format!("{:x}", Sha256::digest(resized_gray(&image).unwrap())),
                gray_digest,
                "gray {width}x{height}"
            );
            let bytes = tensor(&image)
                .unwrap()
                .into_iter()
                .flat_map(f32::to_le_bytes)
                .collect::<Vec<_>>();
            assert_eq!(
                format!("{:x}", Sha256::digest(bytes)),
                tensor_digest,
                "tensor {width}x{height}"
            );
        }
    }
    #[test]
    fn pil_luminance_does_not_use_image_crate_rec709() {
        let image = RgbImage::from_raw(3, 1, vec![255, 0, 0, 0, 255, 0, 0, 0, 255]).unwrap();
        assert_eq!(grayscale(&image), [76, 150, 29]);
    }
    #[test]
    fn normalized_channels_preserve_black_white_and_rgb_replication() {
        let black = tensor(&RgbImage::from_pixel(1, 1, image::Rgb([0, 0, 0]))).unwrap();
        assert_eq!(black.len(), 3 * SIDE * SIDE);
        assert!(black.iter().all(|&value| value == -1.0));
        let white = tensor(&RgbImage::from_pixel(1, 1, image::Rgb([255, 255, 255]))).unwrap();
        assert!(white.iter().all(|&value| value == 1.0));
    }
}
