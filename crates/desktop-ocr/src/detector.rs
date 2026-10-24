//! Paddle DB detection on borrowed, already upright RGB originals.
//!
//! Geometry adapted from Craun718/PaddleOCR-rs, src/det.rs, revision
//! 27fd3d77effa3f0032786a45d3566b64edcbe631. The preprocessing, thresholds,
//! Clipper offset, source mapping and session ownership here are deliberately
//! different from that candidate's defaults.
//!
//! MIT License
//! Copyright (c) 2026 Craun718
//!
//! Permission is hereby granted, free of charge, to any person obtaining a copy
//! of this software and associated documentation files (the "Software"), to deal
//! in the Software without restriction, including without limitation the rights
//! to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//! copies of the Software, and to permit persons to whom the Software is
//! furnished to do so, subject to the following conditions:
//!
//! The above copyright notice and this permission notice shall be included in all
//! copies or substantial portions of the Software.
//!
//! THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//! IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//! FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//! AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//! LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//! OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//! SOFTWARE.

use crate::{raster::linear_resize, session::Graph};
use clipper2_rust::{EndType, JoinType, Point64, inflate_paths_64};
use geo::{Area, LineString, MinimumRotatedRect, Polygon};
use image::{GrayImage, Luma, RgbImage, imageops};
use imageproc::{contours::find_contours, drawing::draw_polygon_mut, point::Point};
use num_traits::ToPrimitive;
use ort::value::Tensor;
use std::path::Path;

const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const STD: [f32; 3] = [0.229, 0.224, 0.225];
const MAX_MAP_SIDE: u32 = 4000;
const MAX_OBSERVATIONS: usize = 512;

/// TL, TR, BR, BL in normalized original upright coordinates, not tensor pixels.
pub type Quad = [[f64; 2]; 4];

#[derive(Clone, Copy)]
pub enum Preset {
    PaddleManga,
    Rapid,
}

pub struct Detection {
    pub width: u32,
    pub height: u32,
    /// Raw DB order. Language grouping/reading order belongs to the package.
    pub quads: Vec<Quad>,
}

/// Owns one reusable graph; the worker owns cancellation and unloading.
pub struct Detector {
    pub graph: Graph,
    input_name: String,
    output_name: String,
    preset: Preset,
}

impl Detector {
    /// Names must come from the authenticated export manifest, not guessed here.
    pub fn open(
        path: &Path,
        input_name: &str,
        output_name: &str,
        preset: Preset,
        cpu_only: bool,
    ) -> Result<Self, String> {
        if input_name.is_empty() || output_name.is_empty() {
            return Err("Detector graph names are missing".into());
        }
        Ok(Self {
            graph: Graph::open(path, cpu_only)?,
            input_name: input_name.into(),
            output_name: output_name.into(),
            preset,
        })
    }

    pub fn detect(&mut self, original: &RgbImage) -> Result<Detection, String> {
        let mut prepared = preprocess(original, self.preset)?;
        let tensor = Tensor::from_array((
            [1, 3, prepared.height, prepared.width],
            std::mem::take(&mut prepared.data).into_boxed_slice(),
        ))
        .map_err(|error| error.to_string())?;
        let outputs = self
            .graph
            .run(vec![(self.input_name.clone(), tensor.into_dyn())])?;
        let output = outputs
            .get(&self.output_name)
            .ok_or("Detector graph output is missing")?;
        let (shape, probabilities) = output
            .try_extract_tensor::<f32>()
            .map_err(|error| error.to_string())?;
        let [1, 1, height, width] = &shape[..] else {
            return Err("Detector graph must return one NCHW probability plane".into());
        };
        prepared.postprocess(
            probabilities,
            u32::try_from(*width).map_err(|_| "Invalid detector output width")?,
            u32::try_from(*height).map_err(|_| "Invalid detector output height")?,
        )
    }
}

/// Bounded NCHW float32 input, with both independent resize steps retained.
pub struct Prepared {
    pub data: Vec<f32>,
    pub width: usize,
    pub height: usize,
    source_width: u32,
    source_height: u32,
    outer_width: u32,
    outer_height: u32,
    padded_width: u32,
    padded_height: u32,
    padding_top: u32,
    preset: Preset,
}

fn multiple_32(value: u32) -> u32 {
    // Python round uses ties-to-even, unlike f64::round().
    let quotient = value / 32;
    let remainder = value % 32;
    let up = remainder > 16 || (remainder == 16 && quotient % 2 == 1);
    (quotient + u32::from(up)) * 32
}
fn nearest_32(value: u32) -> u32 {
    multiple_32(value).max(32)
}

fn scaled(value: u32, numerator: u32, denominator: u32) -> Result<u32, String> {
    u32::try_from(u64::from(value) * u64::from(numerator) / u64::from(denominator))
        .map_err(|_| "Detector resize dimension overflow".into())
}

fn model_dimensions(width: u32, height: u32, minimum: u32) -> Result<(u32, u32), String> {
    let short = width.min(height);
    let (mut w, mut h) = if short < minimum {
        (
            scaled(width, minimum, short)?,
            scaled(height, minimum, short)?,
        )
    } else {
        (width, height)
    };
    let long = w.max(h);
    if long > MAX_MAP_SIDE {
        w = scaled(w, MAX_MAP_SIDE, long)?;
        h = scaled(h, MAX_MAP_SIDE, long)?;
    }
    Ok((nearest_32(w), nearest_32(h)))
}

pub(crate) fn rapid_outer(original: &RgbImage) -> Result<RgbImage, String> {
    let mut image = original.clone();
    for (limit, reducing) in [(2000, true), (30, false)] {
        let (width, height) = image.dimensions();
        let side = if reducing {
            width.max(height)
        } else {
            width.min(height)
        };
        if (reducing && side <= limit) || (!reducing && side >= limit) {
            continue;
        }
        let width = multiple_32(scaled(width, limit, side)?);
        let height = multiple_32(scaled(height, limit, side)?);
        if width == 0 || height == 0 || width.max(height) > MAX_MAP_SIDE {
            return Err("Generic OCR resize exceeds supported raster bounds".into());
        }
        image = linear_resize(&image, width, height)?;
    }
    Ok(image)
}

pub fn preprocess(original: &RgbImage, preset: Preset) -> Result<Prepared, String> {
    let (source_width, source_height) = original.dimensions();
    if source_width == 0
        || source_height == 0
        || source_width.max(source_height) > 32768
        || u64::from(source_width) * u64::from(source_height) > 16_777_216
    {
        return Err("Detector source exceeds admitted upright pixel bounds".into());
    }
    let long = source_width.max(source_height);
    let (outer_width, outer_height) = if long > 2000 {
        (
            scaled(source_width, 2000, long)?.max(1),
            scaled(source_height, 2000, long)?.max(1),
        )
    } else {
        (source_width, source_height)
    };
    // Pillow RGB resize defaults to bicubic. CatmullRom uses its same cubic
    // kernel and reduction-aware support; coefficient/quantization parity must
    // still be checked against the retained processor tensors.
    let outer = match preset {
        Preset::PaddleManga => {
            if original.dimensions() == (outer_width, outer_height) {
                original.clone()
            } else {
                imageops::resize(
                    original,
                    outer_width,
                    outer_height,
                    imageops::FilterType::CatmullRom,
                )
            }
        }
        Preset::Rapid => rapid_outer(original)?,
    };
    let (outer_width, outer_height) = outer.dimensions();
    let (padded_width, padded_height, padding_top) = match preset {
        Preset::PaddleManga => {
            if outer_width + outer_height < 64 {
                (outer_width.max(32), outer_height.max(32), 0)
            } else {
                (outer_width, outer_height, 0)
            }
        }
        Preset::Rapid => {
            let top = if outer_height <= 30 || outer_width > 8 * outer_height {
                (2 * (outer_width / 8).max(30)).abs_diff(outer_height) / 2
            } else {
                0
            };
            (outer_width, outer_height + 2 * top, top)
        }
    };
    let padded = if outer.dimensions() == (padded_width, padded_height) {
        outer
    } else {
        let mut padded = RgbImage::new(padded_width, padded_height);
        imageops::replace(&mut padded, &outer, 0, i64::from(padding_top));
        padded
    };
    let (minimum, mean, std) = match preset {
        Preset::PaddleManga => (64, MEAN, STD),
        Preset::Rapid => (736, [0.5; 3], [0.5; 3]),
    };
    let (width, height) = model_dimensions(padded_width, padded_height, minimum)?;
    let resized = linear_resize(&padded, width, height)?;
    let plane = usize::try_from(u64::from(width) * u64::from(height))
        .map_err(|_| "Detector tensor size overflow")?;
    let mut data = Vec::with_capacity(3 * plane);
    for c in 0..3 {
        let scale = 1.0 / 255.0 / std[c];
        let offset = -mean[c] / std[c];
        for pixel in resized.pixels() {
            data.push(f32::from(pixel[c]) * scale + offset);
        }
    }
    Ok(Prepared {
        data,
        width: usize::try_from(width).map_err(|_| "Invalid model width")?,
        height: usize::try_from(height).map_err(|_| "Invalid model height")?,
        source_width,
        source_height,
        outer_width,
        outer_height,
        padded_width,
        padded_height,
        padding_top,
        preset,
    })
}

impl Prepared {
    fn map_quad(&self, points: Quad, map_width: u32, map_height: u32) -> Quad {
        points.map(|[x, y]| {
            // map -> tensor -> padded outer pixels, then remove right/bottom
            // padding by clipping. Independent axis ratios survive both rounds.
            // Divide by actual outer dimensions, never the ideal 2000/long ratio.
            let x = (x * f64::from(self.padded_width) / f64::from(map_width))
                .round_ties_even()
                .clamp(0.0, f64::from(self.outer_width));
            let y = ((y * f64::from(self.padded_height) / f64::from(map_height)).round_ties_even()
                - f64::from(self.padding_top))
            .clamp(0.0, f64::from(self.outer_height));
            [
                x / f64::from(self.outer_width),
                y / f64::from(self.outer_height),
            ]
        })
    }

    pub fn postprocess(
        &self,
        probabilities: &[f32],
        width: u32,
        height: u32,
    ) -> Result<Detection, String> {
        let length = usize::try_from(u64::from(width) * u64::from(height))
            .map_err(|_| "Detector map length overflow")?;
        if width == 0
            || height == 0
            || width.max(height) > MAX_MAP_SIDE
            || length != probabilities.len()
            || probabilities
                .iter()
                .any(|p| !p.is_finite() || !(0.0..=1.0).contains(p))
        {
            return Err("Detector returned an invalid or unbounded probability map".into());
        }
        let mut binary = GrayImage::from_raw(
            width,
            height,
            probabilities
                .iter()
                .map(|p| if *p > 0.3 { 255 } else { 0 })
                .collect(),
        )
        .ok_or("Invalid detector bitmap")?;
        let (candidates, threshold, ratio) = match self.preset {
            Preset::PaddleManga => (3000, 0.6, 1.5),
            Preset::Rapid => {
                let source = binary.clone();
                for (x, y, pixel) in source.enumerate_pixels() {
                    if pixel[0] == 0 {
                        continue;
                    }
                    for dy in 0..=1 {
                        for dx in 0..=1 {
                            if x + dx < width && y + dy < height {
                                binary.put_pixel(x + dx, y + dy, Luma([255]));
                            }
                        }
                    }
                }
                (1000, 0.5, 1.6)
            }
        };
        let contours = find_contours::<i32>(&binary);
        let mut quads = Vec::new();
        // Suzuki border discovery is raster order; OpenCV RETR_LIST prepends
        // discovered borders. Reverse that enumeration, not spatial box order.
        for contour in contours.into_iter().rev().take(candidates) {
            let points: Vec<_> = contour
                .points
                .iter()
                .map(|p| (f64::from(p.x), f64::from(p.y)))
                .collect();
            let Some((quad, short)) = mini_box(&points) else {
                continue;
            };
            if short < 3.0 || box_score(probabilities, width, height, &quad)? < threshold {
                continue;
            }
            let Some(expanded) = unclip(&quad, ratio) else {
                continue;
            };
            let Some((quad, short)) = mini_box(&expanded) else {
                continue;
            };
            if short < 5.0 {
                continue;
            }
            let mapped = self.map_quad(quad, width, height);
            if distance(mapped[0], mapped[1]) == 0.0 || distance(mapped[0], mapped[3]) == 0.0 {
                continue;
            }
            if quads.len() == MAX_OBSERVATIONS {
                return Err("Detector exceeded 512 observations".into());
            }
            quads.push(mapped);
        }
        Ok(Detection {
            width: self.source_width,
            height: self.source_height,
            quads,
        })
    }
}

fn distance(a: [f64; 2], b: [f64; 2]) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}

fn mini_box(points: &[(f64, f64)]) -> Option<(Quad, f64)> {
    let rect = LineString::from(points.to_vec()).minimum_rotated_rect()?;
    let mut points = [[0.0; 2]; 4];
    for (point, coord) in points.iter_mut().zip(rect.exterior().0.iter().take(4)) {
        *point = [coord.x, coord.y];
    }
    points.sort_by(|a, b| a[0].total_cmp(&b[0]));
    let [a, b, c, d] = points;
    let (tl, bl) = if a[1] < b[1] { (a, b) } else { (b, a) };
    let (tr, br) = if c[1] < d[1] { (c, d) } else { (d, c) };
    let quad = [tl, tr, br, bl];
    Some((quad, distance(tl, tr).min(distance(tl, bl))))
}

fn unclip(quad: &Quad, ratio: f64) -> Option<Vec<(f64, f64)>> {
    let polygon = Polygon::new(
        LineString::from(quad.map(|p| (p[0], p[1])).to_vec()),
        vec![],
    );
    let perimeter: f64 = (0..4).map(|i| distance(quad[i], quad[(i + 1) % 4])).sum();
    if perimeter <= 0.0 {
        return None;
    }
    let delta = polygon.unsigned_area() * ratio / perimeter;
    // Pyclipper receives integer coordinates, truncating the float min rectangle.
    let path: Option<Vec<_>> = quad
        .iter()
        .map(|p| Some(Point64::new(p[0].to_i64()?, p[1].to_i64()?)))
        .collect();
    let paths = inflate_paths_64(
        &vec![path?],
        delta,
        JoinType::Round,
        EndType::Polygon,
        2.0,
        0.25,
    );
    paths
        .into_iter()
        .flatten()
        .map(|p| Some((p.x.to_f64()?, p.y.to_f64()?)))
        .collect::<Option<Vec<_>>>()
}

fn box_score(probabilities: &[f32], width: u32, height: u32, quad: &Quad) -> Result<f64, String> {
    let bound = |axis: usize, maximum: bool, limit: u32| -> Result<u32, String> {
        let value = quad
            .iter()
            .map(|p| p[axis])
            .reduce(if maximum { f64::max } else { f64::min })
            .ok_or("Missing score polygon")?;
        (if maximum { value.ceil() } else { value.floor() })
            .clamp(0.0, f64::from(limit - 1))
            .to_u32()
            .ok_or("Invalid score bound".into())
    };
    let (left, right, top, bottom) = (
        bound(0, false, width)?,
        bound(0, true, width)?,
        bound(1, false, height)?,
        bound(1, true, height)?,
    );
    let points = quad
        .iter()
        .map(|p| {
            Ok(Point::new(
                (p[0] - f64::from(left)).to_i32().ok_or("Invalid mask x")?,
                (p[1] - f64::from(top)).to_i32().ok_or("Invalid mask y")?,
            ))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let mut mask = GrayImage::new(right - left + 1, bottom - top + 1);
    draw_polygon_mut(&mut mask, &points, Luma([1]));
    let mut sum = 0.0;
    let mut count = 0u32;
    for (x, y, pixel) in mask.enumerate_pixels() {
        if pixel[0] != 0 {
            let index =
                usize::try_from(u64::from(y + top) * u64::from(width) + u64::from(x + left))
                    .map_err(|_| "Score index overflow")?;
            sum += f64::from(probabilities[index]);
            count += 1;
        }
    }
    Ok(if count == 0 {
        0.0
    } else {
        sum / f64::from(count)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::Rgb;

    fn prepared(width: u32, height: u32) -> Prepared {
        preprocess(&RgbImage::new(width, height), Preset::PaddleManga).unwrap()
    }

    fn fill(map: &mut [f32], width: usize, rect: [usize; 4], value: f32) {
        for y in rect[1]..rect[3] {
            for x in rect[0]..rect[2] {
                map[y * width + x] = value;
            }
        }
    }

    #[test]
    fn rgb_channels_and_nchw_positions_when_source_is_asymmetric() {
        // Given an asymmetric source already at model-compatible dimensions.
        let mut original = RgbImage::new(96, 64);
        original.put_pixel(7, 11, Rgb([255, 128, 16]));
        // When preparing the borrowed source.
        let input = preprocess(&original, Preset::PaddleManga).unwrap();
        // Then RGB is not swapped, normalization is affine, and planes are CHW.
        assert_eq!((input.width, input.height), (96, 64));
        assert_eq!(input.data.len(), 3 * 96 * 64);
        for (c, value) in [255u8, 128, 16].into_iter().enumerate() {
            let expected = f32::from(value) * (1.0 / 255.0 / STD[c]) - MEAN[c] / STD[c];
            assert!((input.data[c * 96 * 64 + 11 * 96 + 7] - expected).abs() < 1e-6);
        }
        assert_eq!(*original.get_pixel(7, 11), Rgb([255, 128, 16]));
    }

    #[test]
    fn rapid_rgb_normalization_uses_its_own_mean_and_scale() {
        let original = RgbImage::from_pixel(736, 736, Rgb([255, 128, 0]));
        let input = preprocess(&original, Preset::Rapid).unwrap();
        assert_eq!((input.width, input.height), (736, 736));
        let plane = 736 * 736;
        assert_eq!(input.data[0], 1.0);
        assert!((input.data[plane] - (256.0 / 255.0 - 1.0)).abs() < 1e-6);
        assert_eq!(input.data[2 * plane], -1.0);
    }

    #[test]
    fn rapid_tall_padding_is_removed_from_original_coordinates() {
        let original = RgbImage::from_pixel(320, 32, Rgb([255, 255, 255]));
        let input = preprocess(&original, Preset::Rapid).unwrap();
        assert_eq!((input.outer_width, input.outer_height), (320, 32));
        assert_eq!((input.padded_width, input.padded_height), (320, 80));
        assert_eq!(input.padding_top, 24);
        let quad = input.map_quad(
            [[0.0, 24.0], [320.0, 24.0], [320.0, 56.0], [0.0, 56.0]],
            320,
            80,
        );
        assert_eq!(quad, [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]);
        assert_eq!(input.data[0], -1.0);
    }

    #[test]
    fn nearest_multiple_uses_ties_even_not_next_multiple_padding() {
        // Given dimensions straddling two halfway cases.
        let dimensions = [79, 80, 81, 111, 112, 113];
        // When applying model rounding.
        let rounded = dimensions.map(nearest_32);
        // Then both ties follow Python, rather than ceil padding.
        assert_eq!(rounded, [64, 64, 96, 96, 128, 128]);
        assert_eq!(model_dimensions(81, 113, 64).unwrap(), (96, 128));
        assert_eq!(model_dimensions(10, 2000, 64).unwrap(), (32, 4000));
    }

    #[test]
    fn independent_outer_axes_when_long_image_has_fractional_reduction() {
        // Given a size whose outer height is truncated independently.
        let input = prepared(3001, 1000);
        // When restoring the full outer extent.
        let quad = input.map_quad(
            [[0.0, 0.0], [2000.0, 0.0], [2000.0, 666.0], [0.0, 666.0]],
            2000,
            666,
        );
        // Then normalized points reach the full original extent on each axis.
        assert_eq!((input.outer_width, input.outer_height), (2000, 666));
        assert_eq!((input.width, input.height), (1984, 672));
        assert_eq!(quad, [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]);
        assert_eq!((input.source_width, input.source_height), (3001, 1000));
    }

    #[test]
    fn tiny_input_padding_is_black_and_removed_in_source_mapping() {
        // Given a tiny source triggering only the reference small-image pad.
        let original = RgbImage::from_pixel(9, 17, Rgb([255, 255, 255]));
        // When preparing and mapping its real content extent.
        let input = preprocess(&original, Preset::PaddleManga).unwrap();
        let quad = input.map_quad(
            [[-10.0, -10.0], [18.0, 0.0], [64.0, 64.0], [0.0, 34.0]],
            64,
            64,
        );
        // Then padding is black and cannot shift/shrink source coordinates.
        assert_eq!((input.padded_width, input.padded_height), (32, 32));
        assert_eq!((input.width, input.height), (64, 64));
        assert!((input.data[63] - (-MEAN[0] / STD[0])).abs() < 1e-6);
        assert_eq!(quad, [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]]);
    }

    #[test]
    fn linear_model_reduction_does_not_widen_antialias_kernel() {
        // Given an impulse in a four-pixel row.
        let mut source = RgbImage::new(4, 1);
        source.put_pixel(1, 0, Rgb([200, 100, 40]));
        // When reducing by two using half-pixel linear sampling.
        let reduced = linear_resize(&source, 2, 1).unwrap();
        // Then only the two bracketing input pixels contribute.
        assert_eq!(*reduced.get_pixel(0, 0), Rgb([100, 50, 20]));
        assert_eq!(*reduced.get_pixel(1, 0), Rgb([0, 0, 0]));
    }

    #[test]
    fn empty_detection_when_probability_does_not_exceed_threshold() {
        // Given probabilities exactly equal to the bitmap threshold.
        let input = prepared(64, 64);
        let map = vec![0.3; 64 * 64];
        // When running DB postprocessing.
        let detected = input.postprocess(&map, 64, 64).unwrap();
        // Then empty is success, not a fabricated whole-page box.
        assert!(detected.quads.is_empty());
    }

    #[test]
    fn db_box_expands_with_round_unclip_and_retains_raw_order() {
        // Given two separated confident rectangular regions.
        let input = prepared(64, 64);
        let mut map = vec![0.0; 64 * 64];
        fill(&mut map, 64, [10, 10, 25, 25], 0.9);
        fill(&mut map, 64, [40, 40, 55, 55], 0.9);
        // When extracting boxes.
        let detected = input.postprocess(&map, 64, 64).unwrap();
        // Then raw RETR_LIST order is bottom first and unclip1.5 adds about 5px,
        // not unclip2's 7px, to each side of the 14px rectangle.
        assert_eq!(detected.quads.len(), 2);
        let first = detected.quads[0];
        assert!(first[0][0] > 0.5 && first[0][1] > 0.5);
        assert!((first[0][0] * 64.0 - 35.0).abs() <= 1.0);
        assert!((first[2][0] * 64.0 - 59.0).abs() <= 1.0);
        assert_eq!((detected.width, detected.height), (64, 64));
    }

    #[test]
    fn rotated_probability_region_keeps_rotated_bounded_quad() {
        // Given a confident diamond at an asymmetric vertical location.
        let input = prepared(64, 96);
        let mut map = vec![0.0; 64 * 96];
        for y in 20i32..61 {
            for x in 12i32..53 {
                if (x - 32).abs() + (y - 40).abs() <= 18 {
                    map[usize::try_from(y * 64 + x).unwrap()] = 0.95;
                }
            }
        }
        // When extracting its minimum rectangle.
        let detected = input.postprocess(&map, 64, 96).unwrap();
        // Then orientation survives instead of becoming an axis-aligned crop.
        assert_eq!(detected.quads.len(), 1);
        let q = detected.quads[0];
        assert!((q[0][0] - q[1][0]).abs() > 0.1);
        assert!((q[0][1] - q[1][1]).abs() > 0.1);
        assert!(
            q.iter()
                .flatten()
                .all(|v| v.is_finite() && (0.0..=1.0).contains(v))
        );
    }

    #[test]
    fn weak_scores_and_short_edges_are_filtered() {
        // Given one segmented but low-score box and one confident thin line.
        let input = prepared(64, 64);
        let mut map = vec![0.0; 64 * 64];
        fill(&mut map, 64, [8, 8, 24, 24], 0.59);
        fill(&mut map, 64, [40, 32, 43, 55], 0.99);
        // When applying both DB acceptance gates.
        let detected = input.postprocess(&map, 64, 64).unwrap();
        // Then neither candidate is published.
        assert!(detected.quads.is_empty());
    }

    #[test]
    fn border_expansion_is_clipped_to_inclusive_source_extent() {
        // Given a confident box touching the top and left source edges.
        let input = prepared(64, 64);
        let mut map = vec![0.0; 64 * 64];
        fill(&mut map, 64, [0, 0, 20, 20], 0.99);
        // When round expansion extends outside the probability plane.
        let detected = input.postprocess(&map, 64, 64).unwrap();
        // Then source coordinates remain normalized and start at the border.
        assert_eq!(detected.quads.len(), 1);
        assert_eq!(detected.quads[0][0], [0.0, 0.0]);
        assert!(
            detected.quads[0]
                .iter()
                .flatten()
                .all(|v| (0.0..=1.0).contains(v))
        );
    }

    #[test]
    fn invalid_probability_map_is_explicit_failure() {
        // Given a prepared image but a nonfinite network result.
        let input = prepared(64, 64);
        let mut map = vec![0.0; 64 * 64];
        map[100] = f32::NAN;
        // When parsing the network result.
        let result = input.postprocess(&map, 64, 64);
        // Then failure cannot silently become empty detection.
        assert!(result.is_err());
        assert!(input.postprocess(&[], 4001, 1).is_err());
        assert!(input.postprocess(&[], 0, 0).is_err());
    }

    #[test]
    fn observation_bound_fails_instead_of_truncating_evidence() {
        // Given 625 valid separated regions, above the host observation bound.
        let input = prepared(512, 512);
        let mut map = vec![0.0; 512 * 512];
        for row in 0..25 {
            for col in 0..25 {
                fill(
                    &mut map,
                    512,
                    [col * 20 + 2, row * 20 + 2, col * 20 + 10, row * 20 + 10],
                    0.99,
                );
            }
        }
        // When extracting raw evidence.
        let result = input.postprocess(&map, 512, 512);
        // Then a recoverable failure replaces partial success.
        assert!(result.err().unwrap().contains("512"));
    }
}
