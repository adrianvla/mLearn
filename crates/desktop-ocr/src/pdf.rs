//! Portable, offline PDF rasterization. The host runs this in its cancellable
//! one-shot helper process, independently of optional OCR model installation.
use hayro::{
    PixmapSettings, RenderCache, RenderSettings,
    hayro_interpret::InterpreterSettings,
    hayro_syntax::{
        Pdf,
        content::{TypedIter, ops::TypedInstruction},
        object::{Dict, Name, Stream},
    },
    vello_cpu::color::palette::css::WHITE,
};
use image::{Rgb, RgbImage};
use std::{
    io::Read,
    path::Path,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

pub fn render(path: &Path, page_index: u32) -> Result<RgbImage, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > 8 * 1024 * 1024 {
        return Err("PDF exceeds its 8 MiB encoded source bound".into());
    }
    let mut bytes = Vec::new();
    file.take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("PDF exceeds its 8 MiB encoded source bound".into());
    }
    render_bytes(bytes, page_index)
}

fn render_bytes(bytes: Vec<u8>, page_index: u32) -> Result<RgbImage, String> {
    let pdf = Pdf::new(bytes).map_err(|e| format!("Cannot read admitted PDF: {e:?}"))?;
    if pdf.len() > 65536 {
        return Err("PDF exceeds its object bound".into());
    }
    let page = pdf
        .pages()
        .get(page_index as usize)
        .ok_or("PDF page is unavailable")?;
    // Budget the selected page's reachable XObjects, not the entire document.
    // Form resources and image masks share this one decoded-image budget.
    let resources = &page.resources().x_objects;
    let mut pending = resources
        .keys()
        .filter_map(|key| resources.get::<Stream<'_>>(key))
        .collect::<Vec<_>>();
    let mut seen = std::collections::HashSet::new();
    let mut image_pixels = 0_u64;
    budget_inline(&mut page.typed_operations(), &mut image_pixels)?;
    let mut visits = 0_usize;
    while let Some(stream) = pending.pop() {
        visits += 1;
        if visits > 4096 {
            return Err("PDF page exceeds its resource traversal bound".into());
        }
        let dict = stream.dict();
        if dict.obj_id().is_some_and(|id| !seen.insert(id)) {
            continue;
        }
        if dict
            .get::<Name<'_>>(b"Subtype")
            .is_some_and(|name| name.as_ref() == b"Image")
        {
            budget_image(dict, &mut image_pixels)?;
        } else if dict
            .get::<Name<'_>>(b"Subtype")
            .is_some_and(|name| name.as_ref() == b"Form")
        {
            let content = stream
                .decoded()
                .map_err(|_| "Cannot decode PDF form content")?;
            budget_inline(&mut TypedIter::new(&content), &mut image_pixels)?;
        }
        for name in [b"SMask".as_slice(), b"Mask"] {
            if let Some(mask) = dict.get::<Stream<'_>>(name) {
                pending.push(mask);
            }
        }
        if let Some(resources) = dict
            .get::<Dict<'_>>(b"Resources")
            .and_then(|dict| dict.get::<Dict<'_>>(b"XObject"))
        {
            pending.extend(
                resources
                    .keys()
                    .filter_map(|key| resources.get::<Stream<'_>>(key)),
            );
        }
    }
    let (width, height) = page.render_dimensions();
    if !width.is_finite()
        || !height.is_finite()
        || width < 1.0
        || height < 1.0
        || width.ceil() > 32768.0
        || height.ceil() > 32768.0
        || f64::from(width.ceil()) * f64::from(height.ceil()) > 16_777_216.0
    {
        return Err("PDF page exceeds its 16 megapixel raster bound".into());
    }
    let warned = Arc::new(AtomicBool::new(false));
    let warning = warned.clone();
    let interpreter = InterpreterSettings {
        warning_sink: Arc::new(move |_| {
            warning.store(true, Ordering::Relaxed);
        }),
        ..Default::default()
    };
    let pixmap = hayro::render(
        page,
        &RenderCache::new(),
        &interpreter,
        &RenderSettings::default(),
        &PixmapSettings {
            x_scale: width.ceil() / width,
            y_scale: height.ceil() / height,
            bg_color: WHITE,
        },
    );
    if warned.load(Ordering::Relaxed) {
        return Err("PDF contains content this raster provider cannot faithfully render".into());
    }
    let mut image = RgbImage::new(u32::from(pixmap.width()), u32::from(pixmap.height()));
    for (source, destination) in pixmap
        .data_as_u8_slice()
        .as_chunks::<4>()
        .0
        .iter()
        .zip(image.pixels_mut())
    {
        if source[3] != 255 {
            return Err("PDF raster did not produce an opaque source image".into());
        }
        *destination = Rgb([source[0], source[1], source[2]]);
    }
    Ok(image)
}

fn budget_image(dict: &Dict<'_>, total: &mut u64) -> Result<(), String> {
    // Inline-image abbreviations are PDF syntax, not a second image contract.
    let width = dict
        .get::<u32>(b"Width")
        .or_else(|| dict.get::<u32>(b"W"))
        .ok_or("PDF image width is invalid")?;
    let height = dict
        .get::<u32>(b"Height")
        .or_else(|| dict.get::<u32>(b"H"))
        .ok_or("PDF image height is invalid")?;
    let pixels = u64::from(width) * u64::from(height);
    if width == 0 || height == 0 || width.max(height) > 32768 || pixels > 16_777_216 {
        return Err("PDF embedded image exceeds its 16 megapixel bound".into());
    }
    *total += pixels;
    if *total > 33_554_432 {
        return Err("PDF embedded image inventory exceeds its decoded pixel bound".into());
    }
    Ok(())
}

fn budget_inline(operations: &mut TypedIter<'_>, total: &mut u64) -> Result<(), String> {
    while let Some(operation) = operations.next() {
        if let TypedInstruction::InlineImage(image) = operation {
            budget_image(image.0.dict(), total)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(
        width: u32,
        height: u32,
        rotation: u16,
        crop: &str,
        image: Option<(u32, u32)>,
    ) -> Vec<u8> {
        let commands = "1 0 0 rg 0 0 20 10 re f";
        let resources = if image.is_some() {
            "/XObject << /Im 5 0 R >>"
        } else {
            ""
        };
        let mut objects = vec![
            "<< /Type /Catalog /Pages 2 0 R >>".into(),
            "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".into(),
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] /Rotate {rotation} {crop} /Resources << {resources} >> /Contents 4 0 R >>"
            ),
            format!(
                "<< /Length {} >>\nstream\n{commands}\nendstream",
                commands.len()
            ),
        ];
        if let Some((width, height)) = image {
            objects.push(format!("<< /Type /XObject /Subtype /Image /Width {width} /Height {height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 0 >>\nstream\n\nendstream"));
        }
        document(objects)
    }
    fn document(objects: Vec<String>) -> Vec<u8> {
        let mut pdf = "%PDF-1.4\n".to_string();
        let mut offsets = Vec::new();
        for (index, object) in objects.iter().enumerate() {
            offsets.push(pdf.len());
            pdf.push_str(&format!("{} 0 obj\n{object}\nendobj\n", index + 1));
        }
        let xref = pdf.len();
        pdf.push_str(&format!(
            "xref\n0 {}\n0000000000 65535 f \n",
            objects.len() + 1
        ));
        for offset in offsets {
            pdf.push_str(&format!("{offset:010} 00000 n \n"));
        }
        pdf.push_str(&format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objects.len() + 1
        ));
        pdf.into_bytes()
    }
    #[test]
    fn compressed_inline_images_obey_the_same_decoded_pixel_budget() {
        use std::io::Read;
        for (width, height) in [(32769_u32, 1_u32), (4097, 4096)] {
            let mut compressed =
                flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::fast());
            // Stream the fixture bytes rather than allocating a giant test image.
            std::io::copy(
                &mut std::io::repeat(0).take(u64::from(width) * u64::from(height) * 3),
                &mut compressed,
            )
            .unwrap();
            let hex = compressed
                .finish()
                .unwrap()
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>();
            let commands = format!(
                "q 40 0 0 20 0 0 cm BI /W {width} /H {height} /CS /RGB /BPC 8 /F [/AHx /Fl] ID {hex}> EI Q"
            );
            let pdf = document(vec![
                "<< /Type /Catalog /Pages 2 0 R >>".into(),
                "<< /Type /Pages /Kids [3 0 R] /Count 1 >>".into(),
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 40 20] /Resources << >> /Contents 4 0 R >>".into(),
                format!("<< /Length {} >>\nstream\n{commands}\nendstream", commands.len()),
            ]);
            assert!(render_bytes(pdf, 0).unwrap_err().contains("embedded image"));
        }
    }
    #[test]
    fn rotation_and_crop_box_define_upright_original_coordinates() {
        let rotated = render_bytes(fixture(40, 20, 90, "", None), 0).unwrap();
        assert_eq!(rotated.dimensions(), (20, 40));
        assert_eq!(*rotated.get_pixel(5, 5), Rgb([255, 0, 0]));
        assert_eq!(*rotated.get_pixel(15, 5), Rgb([255, 255, 255]));
        let cropped = render_bytes(fixture(40, 20, 90, "/CropBox [0 0 20 10]", None), 0).unwrap();
        assert_eq!(cropped.dimensions(), (10, 20));
        assert!(cropped.pixels().all(|pixel| *pixel == Rgb([255, 0, 0])));
    }
    #[test]
    fn invalid_missing_and_oversized_pages_fail_without_blank_success() {
        assert!(render_bytes(b"not a PDF".to_vec(), 0).is_err());
        assert!(render_bytes(fixture(40, 20, 0, "", None), 1).is_err());
        assert!(
            render_bytes(fixture(8192, 8192, 0, "", None), 0)
                .unwrap_err()
                .contains("raster bound")
        );
    }
    #[test]
    fn oversized_embedded_image_is_rejected_before_decode() {
        assert!(
            render_bytes(fixture(40, 20, 0, "", Some((32768, 32768))), 0)
                .unwrap_err()
                .contains("embedded image")
        );
    }
    #[test]
    fn real_image_only_pdf_produces_nonempty_source_pixels_offline() {
        let image = render_bytes(
            include_bytes!("../../../tests/fixtures/ocr/vision/image-only.pdf").to_vec(),
            0,
        )
        .unwrap();
        assert!(image.width() > 100 && image.height() > 100);
        assert!(
            image
                .pixels()
                .any(|pixel| pixel.0.iter().all(|&channel| channel < 100))
        );
        assert!(image.pixels().any(|pixel| *pixel == Rgb([255, 255, 255])));
    }
}
