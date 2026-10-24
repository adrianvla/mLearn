//! One upright original-raster contract for inference and non-Apple display.
use image::{AnimationDecoder, DynamicImage, ImageDecoder, ImageFormat, ImageReader, RgbImage};
use mlearn_core::OcrRect;
use num_traits::ToPrimitive;
use std::{
    io::{self, BufRead, Seek},
    path::Path,
};

fn bound(decoder: &mut impl ImageDecoder) -> Result<(), String> {
    let (width, height) = decoder.dimensions();
    if width == 0
        || height == 0
        || width.max(height) > 32768
        || u64::from(width) * u64::from(height) > 16_777_216
    {
        return Err("OCR source exceeds its 16 megapixel raster bound".into());
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(32768);
    limits.max_image_height = Some(32768);
    limits.max_alloc = Some(128 * 1024 * 1024);
    decoder
        .set_limits(limits)
        .map_err(|error| error.to_string())
}

fn upright(mut decoder: impl ImageDecoder) -> Result<RgbImage, String> {
    bound(&mut decoder)?;
    let orientation = decoder.orientation().map_err(|error| error.to_string())?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(|error| error.to_string())?;
    image.apply_orientation(orientation);
    Ok(on_white(image))
}

fn on_white(image: DynamicImage) -> RgbImage {
    if let DynamicImage::ImageRgb8(image) = image {
        return image;
    }
    let image = image.into_rgba8();
    RgbImage::from_fn(image.width(), image.height(), |x, y| {
        let pixel = image.get_pixel(x, y);
        let alpha = u16::from(pixel[3]);
        image::Rgb(
            [pixel[0], pixel[1], pixel[2]].map(|channel| {
                ((u16::from(channel) * alpha + 255 * (255 - alpha) + 127) / 255) as u8
            }),
        )
    })
}

fn decode(input: impl BufRead + Seek) -> Result<RgbImage, String> {
    let reader = ImageReader::new(input)
        .with_guessed_format()
        .map_err(|error| error.to_string())?;
    let format = reader.format().ok_or("Unsupported original image format")?;
    let input = reader.into_inner();
    match format {
        ImageFormat::Png => {
            let decoder =
                image::codecs::png::PngDecoder::new(input).map_err(|error| error.to_string())?;
            if decoder.is_apng().map_err(|error| error.to_string())? {
                return Err("OCR requires a single image frame".into());
            }
            upright(decoder)
        }
        ImageFormat::Jpeg => upright(
            image::codecs::jpeg::JpegDecoder::new(input).map_err(|error| error.to_string())?,
        ),
        ImageFormat::WebP => {
            let decoder =
                image::codecs::webp::WebPDecoder::new(input).map_err(|error| error.to_string())?;
            if decoder.has_animation() {
                return Err("OCR requires a single image frame".into());
            }
            upright(decoder)
        }
        ImageFormat::Gif => {
            let mut decoder =
                image::codecs::gif::GifDecoder::new(input).map_err(|error| error.to_string())?;
            bound(&mut decoder)?;
            let mut frames = decoder.into_frames();
            let first = frames
                .next()
                .transpose()
                .map_err(|error| error.to_string())?
                .ok_or("GIF has no image frame")?;
            if frames
                .next()
                .transpose()
                .map_err(|error| error.to_string())?
                .is_some()
            {
                return Err("OCR requires a single image frame".into());
            }
            Ok(on_white(DynamicImage::ImageRgba8(first.into_buffer())))
        }
        _ => Err("Unsupported original image format".into()),
    }
}

pub fn open(path: &Path, maximum_bytes: u64) -> Result<RgbImage, String> {
    let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let length = file.metadata().map_err(|error| error.to_string())?.len();
    if length == 0 || length > maximum_bytes {
        return Err("OCR source exceeds its encoded byte bound".into());
    }
    decode(io::BufReader::new(file))
}

/// OpenCV INTER_LINEAR's half-pixel sampling without downsampling antialiasing.
/// Both DB detection and CTC line preparation consume this same raster owner.
pub(crate) fn linear_resize(
    source: &RgbImage,
    width: u32,
    height: u32,
) -> Result<RgbImage, String> {
    if source.dimensions() == (width, height) {
        return Ok(source.clone());
    }
    let mut output = RgbImage::new(width, height);
    for y in 0..height {
        let sy =
            ((f64::from(y) + 0.5) * f64::from(source.height()) / f64::from(height) - 0.5).max(0.0);
        let y0 = sy
            .floor()
            .to_u32()
            .ok_or("Invalid resize coordinate")?
            .min(source.height() - 1);
        let fy = sy - f64::from(y0);
        for x in 0..width {
            let sx = ((f64::from(x) + 0.5) * f64::from(source.width()) / f64::from(width) - 0.5)
                .max(0.0);
            let x0 = sx
                .floor()
                .to_u32()
                .ok_or("Invalid resize coordinate")?
                .min(source.width() - 1);
            let fx = sx - f64::from(x0);
            let mut pixel = [0; 3];
            for (c, channel) in pixel.iter_mut().enumerate() {
                let top = f64::from(source.get_pixel(x0, y0)[c]) * (1.0 - fx)
                    + f64::from(source.get_pixel((x0 + 1).min(source.width() - 1), y0)[c]) * fx;
                let bottom = f64::from(source.get_pixel(x0, (y0 + 1).min(source.height() - 1))[c])
                    * (1.0 - fx)
                    + f64::from(
                        source.get_pixel(
                            (x0 + 1).min(source.width() - 1),
                            (y0 + 1).min(source.height() - 1),
                        )[c],
                    ) * fx;
                *channel = (top * (1.0 - fy) + bottom * fy)
                    .round()
                    .clamp(0.0, 255.0)
                    .to_u8()
                    .ok_or("Invalid resized RGB value")?;
            }
            output.put_pixel(x, y, image::Rgb(pixel));
        }
    }
    Ok(output)
}

/// Rapid/Paddle line crops use the original four corners, cubic sampling and
/// replicated borders. This differs deliberately from MangaOCR's axis crop.
pub fn rectified(image: &RgbImage, quad: &mlearn_core::OcrQuad) -> Result<RgbImage, String> {
    let points = [
        &quad.top_left,
        &quad.top_right,
        &quad.bottom_right,
        &quad.bottom_left,
    ];
    if points.iter().any(|point| {
        !point.x.is_finite()
            || !point.y.is_finite()
            || !(0.0..=1.0).contains(&point.x)
            || !(0.0..=1.0).contains(&point.y)
    }) {
        return Err("Recognition quad lies outside the upright original".into());
    }
    let points = points.map(|point| {
        (
            point.x * f64::from(image.width()),
            point.y * f64::from(image.height()),
        )
    });
    let distance =
        |a: usize, b: usize| (points[a].0 - points[b].0).hypot(points[a].1 - points[b].1);
    let width = distance(0, 1)
        .max(distance(2, 3))
        .to_u32()
        .ok_or("Invalid crop width")?;
    let height = distance(0, 3)
        .max(distance(1, 2))
        .to_u32()
        .ok_or("Invalid crop height")?;
    if width == 0
        || height == 0
        || width.max(height) > 32768
        || u64::from(width) * u64::from(height) > 16_777_216
    {
        return Err("Recognition quad exceeds its raster bounds".into());
    }
    let w = width.to_f32().ok_or("Invalid crop width")?;
    let h = height.to_f32().ok_or("Invalid crop height")?;
    let mut source = [(0.0_f32, 0.0_f32); 4];
    for (output, point) in source.iter_mut().zip(points) {
        *output = (
            point.0.to_f32().ok_or("Invalid crop point")?,
            point.1.to_f32().ok_or("Invalid crop point")?,
        );
    }
    let projection = imageproc::geometric_transformations::Projection::from_control_points(
        [(0.0, 0.0), (w, 0.0), (w, h), (0.0, h)],
        source,
    )
    .ok_or("Recognition quad is degenerate")?;
    let cubic = |value: f64| {
        let value = value.abs();
        if value <= 1.0 {
            (1.25 * value - 2.25) * value * value + 1.0
        } else if value < 2.0 {
            ((-0.75 * value + 3.75) * value - 6.0) * value + 3.0
        } else {
            0.0
        }
    };
    let mut output = RgbImage::new(width, height);
    for y in 0..height {
        for x in 0..width {
            let (sx, sy) = projection
                * (
                    x.to_f32().ok_or("Invalid crop coordinate")?,
                    y.to_f32().ok_or("Invalid crop coordinate")?,
                );
            if !sx.is_finite() || !sy.is_finite() {
                return Err("Recognition projection is nonfinite".into());
            }
            let (sx, sy) = (f64::from(sx), f64::from(sy));
            let left = sx.floor().to_i64().ok_or("Invalid crop coordinate")?;
            let top = sy.floor().to_i64().ok_or("Invalid crop coordinate")?;
            let mut channels = [0.0_f64; 3];
            for dy in -1..=2 {
                for dx in -1..=2 {
                    let ix = (left + dx).clamp(0, i64::from(image.width()) - 1);
                    let iy = (top + dy).clamp(0, i64::from(image.height()) - 1);
                    let pixel = image.get_pixel(
                        u32::try_from(ix).map_err(|error| error.to_string())?,
                        u32::try_from(iy).map_err(|error| error.to_string())?,
                    );
                    let weight = cubic(sx - (left + dx).to_f64().ok_or("Invalid sample")?)
                        * cubic(sy - (top + dy).to_f64().ok_or("Invalid sample")?);
                    for channel in 0..3 {
                        channels[channel] += weight * f64::from(pixel[channel]);
                    }
                }
            }
            let mut pixel = [0_u8; 3];
            for (value, channel) in pixel.iter_mut().zip(channels) {
                *value = channel
                    .round_ties_even()
                    .clamp(0.0, 255.0)
                    .to_u8()
                    .ok_or("Invalid cubic sample")?;
            }
            output.put_pixel(x, y, image::Rgb(pixel));
        }
    }
    Ok(if u64::from(height) * 2 >= u64::from(width) * 3 {
        image::imageops::rotate270(&output)
    } else {
        output
    })
}

pub fn actual_crop(crop: &OcrRect, width: u32, height: u32) -> Result<OcrRect, String> {
    if ![crop.x, crop.y, crop.width, crop.height]
        .into_iter()
        .all(f64::is_finite)
        || width == 0
        || height == 0
        || crop.x < 0.0
        || crop.y < 0.0
        || crop.width <= 0.0
        || crop.height <= 0.0
        || crop.x + crop.width > 1.0
        || crop.y + crop.height > 1.0
    {
        return Err("OCR crop lies outside the upright original".into());
    }
    let left = (crop.x * f64::from(width)).floor();
    let top = (crop.y * f64::from(height)).floor();
    let right = ((crop.x + crop.width) * f64::from(width)).ceil();
    let bottom = ((crop.y + crop.height) * f64::from(height)).ceil();
    Ok(OcrRect {
        x: left / f64::from(width),
        y: top / f64::from(height),
        width: (right - left) / f64::from(width),
        height: (bottom - top) / f64::from(height),
    })
}

pub fn display(path: &Path, crop: Option<&OcrRect>) -> Result<Vec<u8>, String> {
    display_pixels(open(path, 8 * 1024 * 1024)?, crop)
}

pub(crate) fn display_pixels(
    original: RgbImage,
    crop: Option<&OcrRect>,
) -> Result<Vec<u8>, String> {
    let image = if let Some(crop) = crop {
        let (width, height) = original.dimensions();
        let crop = actual_crop(crop, width, height)?;
        image::imageops::crop_imm(
            &original,
            (crop.x * f64::from(width)).round() as u32,
            (crop.y * f64::from(height)).round() as u32,
            (crop.width * f64::from(width)).round() as u32,
            (crop.height * f64::from(height)).round() as u32,
        )
        .to_image()
    } else {
        original
    };
    let mut output = io::Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(image)
        .write_to(&mut output, ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    let output = output.into_inner();
    if output.len() > (8 * 1024 * 1024 - 22) * 3 / 4 {
        return Err("Original-pixel display exceeds its 8 MiB transport bound".into());
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn transparent_pixels_are_composited_before_rgb_conversion() {
        let rgba = image::RgbaImage::from_fn(3, 1, |x, _| {
            image::Rgba(match x {
                0 => [0, 0, 0, 0],
                1 => [0, 0, 0, 255],
                _ => [255, 0, 0, 128],
            })
        });
        let mut png = io::Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(rgba.clone())
            .write_to(&mut png, ImageFormat::Png)
            .unwrap();
        let original = decode(io::Cursor::new(png.into_inner())).unwrap();
        assert_eq!(original.get_pixel(0, 0), &image::Rgb([255, 255, 255]));
        assert_eq!(original.get_pixel(1, 0), &image::Rgb([0, 0, 0]));
        assert_eq!(original.get_pixel(2, 0), &image::Rgb([255, 127, 127]));
        let mut gif = Vec::new();
        {
            let mut encoder = image::codecs::gif::GifEncoder::new(&mut gif);
            encoder.encode_frame(image::Frame::new(rgba)).unwrap();
        }
        let original = decode(io::Cursor::new(gif)).unwrap();
        assert_eq!(original.get_pixel(0, 0), &image::Rgb([255, 255, 255]));
        assert_eq!(original.get_pixel(1, 0), &image::Rgb([0, 0, 0]));
    }
    #[test]
    fn skewed_line_uses_its_quad_instead_of_an_axis_aligned_crop() {
        // Given a slanted text region over a coordinate-coded original.
        let image = RgbImage::from_fn(12, 10, |x, y| {
            image::Rgb([
                u8::try_from(x * 10).unwrap(),
                u8::try_from(y * 10).unwrap(),
                0,
            ])
        });
        let point = |x, y| mlearn_core::OcrPoint {
            x: x / 12.0,
            y: y / 10.0,
        };
        let quad = mlearn_core::OcrQuad {
            top_left: point(2.0, 3.0),
            top_right: point(8.0, 3.0),
            bottom_right: point(9.0, 7.0),
            bottom_left: point(3.0, 7.0),
        };
        // When preparing the rectified original-resolution line.
        let crop = rectified(&image, &quad).unwrap();
        // Then both ends follow the slanted original, not its bounding rectangle.
        assert_eq!(crop.dimensions(), (6, 4));
        assert_eq!(crop.get_pixel(0, 0), &image::Rgb([20, 30, 0]));
        assert!((27..=29).contains(&crop.get_pixel(0, 3)[0]));
        assert_eq!(crop.get_pixel(0, 3)[1], 60);
    }
    #[test]
    fn tall_generic_line_rotates_counterclockwise_after_source_sampling() {
        // Given a tall original with distinct columns.
        let image = RgbImage::from_fn(2, 8, |x, y| {
            image::Rgb([
                u8::try_from(x * 100).unwrap(),
                u8::try_from(y * 10).unwrap(),
                0,
            ])
        });
        let point = |x, y| mlearn_core::OcrPoint { x, y };
        let quad = mlearn_core::OcrQuad {
            top_left: point(0.0, 0.0),
            top_right: point(1.0, 0.0),
            bottom_right: point(1.0, 1.0),
            bottom_left: point(0.0, 1.0),
        };
        // When preparing the generic recognizer's line.
        let crop = rectified(&image, &quad).unwrap();
        // Then the source is rotated in the same direction as numpy.rot90.
        assert_eq!(crop.dimensions(), (8, 2));
        assert_eq!(crop.get_pixel(0, 0), &image::Rgb([100, 0, 0]));
        assert_eq!(crop.get_pixel(7, 1), &image::Rgb([0, 70, 0]));
    }
    #[test]
    fn jpeg_exif_orientation_is_applied_before_source_coordinates() {
        let original = RgbImage::from_fn(64, 32, |x, _| {
            if x < 32 {
                image::Rgb([240, 10, 0])
            } else {
                image::Rgb([0, 10, 240])
            }
        });
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 95)
            .encode_image(&DynamicImage::ImageRgb8(original))
            .unwrap();
        let exif = [
            0xff, 0xe1, 0x00, 0x22, b'E', b'x', b'i', b'f', 0, 0, b'I', b'I', 42, 0, 8, 0, 0, 0, 1,
            0, 0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
        ];
        jpeg.splice(2..2, exif);
        let upright = decode(io::Cursor::new(jpeg)).unwrap();
        assert_eq!(upright.dimensions(), (32, 64));
        assert!(upright.get_pixel(16, 16)[0] > 200 && upright.get_pixel(16, 16)[2] < 50);
        assert!(upright.get_pixel(16, 48)[2] > 200 && upright.get_pixel(16, 48)[0] < 50);
    }
    #[test]
    fn static_gif_preserves_pixels_but_animation_is_not_an_implicit_first_frame() {
        let frame = image::Frame::new(image::RgbaImage::from_pixel(
            2,
            3,
            image::Rgba([220, 30, 40, 255]),
        ));
        let encode = |count| {
            let mut bytes = Vec::new();
            {
                let mut encoder = image::codecs::gif::GifEncoder::new(&mut bytes);
                for _ in 0..count {
                    encoder.encode_frame(frame.clone()).unwrap();
                }
            }
            bytes
        };
        let original = decode(io::Cursor::new(encode(1))).unwrap();
        assert_eq!(original.dimensions(), (2, 3));
        assert_eq!(original.get_pixel(0, 0), &image::Rgb([220, 30, 40]));
        assert!(
            decode(io::Cursor::new(encode(2)))
                .unwrap_err()
                .contains("single image frame")
        );
    }
    #[test]
    fn ordinary_png_decoding_preserves_exact_original_rgb() {
        let original =
            RgbImage::from_fn(7, 13, |x, y| image::Rgb([x as u8, y as u8, (x * y) as u8]));
        let mut bytes = io::Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(original.clone())
            .write_to(&mut bytes, ImageFormat::Png)
            .unwrap();
        assert_eq!(
            decode(io::Cursor::new(bytes.into_inner())).unwrap(),
            original
        );
    }
}
