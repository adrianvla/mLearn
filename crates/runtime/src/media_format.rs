use crate::execution::Failure;
use mlearn_core::MaterialMediaKind;

pub(super) fn mime(header: &[u8], kind: MaterialMediaKind) -> Result<&'static str, Failure> {
    let mime = match kind {
        MaterialMediaKind::Image if header.starts_with(b"\x89PNG\r\n\x1a\n") => "image/png",
        MaterialMediaKind::Image if header.starts_with(b"\xff\xd8\xff") => "image/jpeg",
        MaterialMediaKind::Image
            if header.starts_with(b"RIFF") && header.get(8..12) == Some(b"WEBP") =>
        {
            "image/webp"
        }
        MaterialMediaKind::Audio
            if header.starts_with(b"RIFF") && header.get(8..12) == Some(b"WAVE") =>
        {
            "audio/wav"
        }
        MaterialMediaKind::Audio
            if header.starts_with(b"ID3")
                || header.first() == Some(&255)
                    && header
                        .get(1)
                        .is_some_and(|b| b & 0xe0 == 0xe0 && b & 0x06 != 0) =>
        {
            "audio/mpeg"
        }
        MaterialMediaKind::Audio if header.starts_with(b"OggS") => "audio/ogg",
        MaterialMediaKind::Audio if header.get(4..8) == Some(b"ftyp") => "audio/mp4",
        MaterialMediaKind::Video
            if header.get(4..8) == Some(b"ftyp") && header.get(8..12) == Some(b"qt  ") =>
        {
            "video/quicktime"
        }
        MaterialMediaKind::Video if header.get(4..8) == Some(b"ftyp") => "video/mp4",
        MaterialMediaKind::Video if header.starts_with(b"\x1a\x45\xdf\xa3") => "video/webm",
        MaterialMediaKind::Image | MaterialMediaKind::Audio | MaterialMediaKind::Video => {
            return Err(Failure::Operation(
                "Unsupported media bytes for the selected media kind".into(),
            ));
        }
    };
    Ok(mime)
}
