//! Tracks embedded in Matroska/WebM media. Listing reads only the track headers; extraction
//! turns one text subtitle track into a subtitle document the ordinary subtitle import reads.
use mlearn_core::{MediaTrack, MediaTrackKind, TrackAvailability};
use std::{fs::File, io::BufReader, path::Path};
use webm_iterable::{
    matroska_spec::{Block, Master, MatroskaSpec},
    WebmIterator,
};

const AUDIO: u64 = 2;
const SUBTITLES: u64 = 17;
/// The same bound as a picked subtitle file.
const MAX_DOCUMENT: usize = 2 * 1024 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum TextFormat {
    Srt,
    Ass,
    Vtt,
}
impl TextFormat {
    pub(crate) fn extension(self) -> &'static str {
        match self {
            Self::Srt => "srt",
            Self::Ass => "ass",
            Self::Vtt => "vtt",
        }
    }
}

fn text_format(codec: &str) -> Option<TextFormat> {
    match codec {
        "S_TEXT/UTF8" | "S_TEXT/ASCII" => Some(TextFormat::Srt),
        "S_TEXT/ASS" | "S_TEXT/SSA" | "S_ASS" | "S_SSA" => Some(TextFormat::Ass),
        "S_TEXT/WEBVTT" | "D_WEBVTT/SUBTITLES" | "D_WEBVTT/CAPTIONS" => Some(TextFormat::Vtt),
        _ => None,
    }
}
fn is_image(codec: &str) -> bool {
    matches!(
        codec,
        "S_HDMV/PGS" | "S_VOBSUB" | "S_DVBSUB" | "S_IMAGE/BMP"
    )
}

struct Entry {
    number: u64,
    kind: u64,
    codec: String,
    language: Option<String>,
    name: Option<String>,
    default: bool,
    private: Vec<u8>,
}
fn entry(children: &[MatroskaSpec]) -> Entry {
    let mut value = Entry {
        number: 0,
        kind: 0,
        codec: String::new(),
        language: None,
        name: None,
        default: true,
        private: Vec::new(),
    };
    let mut bcp47 = None;
    for child in children {
        match child {
            MatroskaSpec::TrackNumber(n) => value.number = *n,
            MatroskaSpec::TrackType(n) => value.kind = *n,
            MatroskaSpec::CodecID(s) => value.codec = s.clone(),
            MatroskaSpec::CodecPrivate(bytes) => value.private = bytes.clone(),
            MatroskaSpec::Language(s) if s != "und" => value.language = Some(s.clone()),
            MatroskaSpec::LanguageIETF(s) if s != "und" => bcp47 = Some(s.clone()),
            MatroskaSpec::Name(s) if !s.trim().is_empty() => value.name = Some(s.clone()),
            MatroskaSpec::FlagDefault(n) => value.default = *n != 0,
            _ => {}
        }
    }
    value.language = bcp47.or(value.language);
    value
}

fn open(path: &Path) -> Result<WebmIterator<BufReader<File>>, String> {
    let file = File::open(path).map_err(|e| format!("The video file can't be read: {e}"))?;
    Ok(WebmIterator::new(
        BufReader::new(file),
        &[
            MatroskaSpec::TrackEntry(Master::Start),
            MatroskaSpec::BlockGroup(Master::Start),
        ],
    ))
}

fn entries(path: &Path) -> Result<(Vec<Entry>, u64), String> {
    let mut found = Vec::new();
    let mut scale = 1_000_000;
    for tag in open(path)? {
        match tag.map_err(|e| format!("This video's tracks can't be read: {e}"))? {
            MatroskaSpec::TimestampScale(value) if value > 0 => scale = value,
            MatroskaSpec::TrackEntry(Master::Full(children)) => found.push(entry(&children)),
            // Track headers precede the first cluster; media data is not read for a listing.
            MatroskaSpec::Cluster(_) => break,
            _ => {}
        }
    }
    Ok((found, scale))
}

/// Audio and subtitle tracks in file order. Non-Matroska files report none.
pub(crate) fn tracks(path: &Path) -> Result<Vec<MediaTrack>, String> {
    if !is_matroska(path)? {
        return Ok(Vec::new());
    }
    let (found, _) = entries(path)?;
    let (mut audio, mut subtitles) = (0, 0);
    Ok(found
        .into_iter()
        .filter_map(|entry| {
            let (kind, ordinal, availability) = match entry.kind {
                AUDIO => (
                    MediaTrackKind::Audio,
                    &mut audio,
                    TrackAvailability::Available,
                ),
                SUBTITLES => (
                    MediaTrackKind::Subtitles,
                    &mut subtitles,
                    if text_format(&entry.codec).is_some() {
                        TrackAvailability::Available
                    } else if is_image(&entry.codec) {
                        TrackAvailability::ImageSubtitles
                    } else {
                        TrackAvailability::UnsupportedCodec
                    },
                ),
                _ => return None,
            };
            let track = MediaTrack {
                kind,
                ordinal: *ordinal,
                number: u32::try_from(entry.number).ok()?,
                language: entry.language,
                name: entry.name,
                default: entry.default,
                availability,
            };
            *ordinal += 1;
            Some(track)
        })
        .collect())
}

fn is_matroska(path: &Path) -> Result<bool, String> {
    use std::io::Read;
    let mut magic = [0u8; 4];
    let read = File::open(path)
        .and_then(|mut file| file.read(&mut magic))
        .map_err(|e| format!("The video file can't be read: {e}"))?;
    Ok(read == 4 && magic == [0x1A, 0x45, 0xDF, 0xA3])
}

struct Cue {
    start: u64,
    end: Option<u64>,
    text: String,
}

/// Extracts one text subtitle track as a subtitle document. `stopped` is polled between blocks.
pub(crate) fn extract(
    path: &Path,
    number: u32,
    stopped: &dyn Fn() -> bool,
) -> Result<(String, TextFormat), String> {
    let (found, scale) = entries(path)?;
    let track = found
        .iter()
        .find(|entry| entry.kind == SUBTITLES && entry.number == u64::from(number))
        .ok_or("This subtitle track is not in the video")?;
    let format = text_format(&track.codec).ok_or("This subtitle track can't be shown as text")?;
    let to_ms = |units: u64| units.saturating_mul(scale) / 1_000_000;
    let mut cluster = 0u64;
    let mut cues = Vec::new();
    let mut bytes = 0usize;
    let mut push = |data: &Vec<u8>, duration: Option<u64>, cluster: u64| -> Result<(), String> {
        let block: Block = data
            .try_into()
            .map_err(|e| format!("A subtitle block is damaged: {e:?}"))?;
        if block.track != u64::from(number) {
            return Ok(());
        }
        let start = cluster.saturating_add_signed(i64::from(block.timestamp));
        let text = String::from_utf8_lossy(block.raw_frame_data())
            .trim_end_matches('\0')
            .to_string();
        bytes += text.len();
        if bytes > MAX_DOCUMENT {
            return Err("This subtitle track exceeds 2 MiB".into());
        }
        cues.push(Cue {
            start: to_ms(start),
            end: duration.map(|d| to_ms(start.saturating_add(d))),
            text,
        });
        Ok(())
    };
    for tag in open(path)? {
        if stopped() {
            return Err("Subtitle extraction was cancelled".into());
        }
        match tag.map_err(|e| format!("This video's subtitles can't be read: {e}"))? {
            MatroskaSpec::Timestamp(value) => cluster = value,
            MatroskaSpec::SimpleBlock(data) => push(&data, None, cluster)?,
            MatroskaSpec::BlockGroup(Master::Full(children)) => {
                let duration = children.iter().find_map(|child| match child {
                    MatroskaSpec::BlockDuration(d) => Some(*d),
                    _ => None,
                });
                if let Some(MatroskaSpec::Block(data)) = children
                    .iter()
                    .find(|child| matches!(child, MatroskaSpec::Block(_)))
                {
                    push(data, duration, cluster)?;
                }
            }
            _ => {}
        }
    }
    if cues.is_empty() {
        return Err("This subtitle track has no lines".into());
    }
    cues.sort_by_key(|cue| cue.start);
    // A cue without a stored duration lasts until the next one, at most a few seconds.
    let starts: Vec<u64> = cues.iter().map(|cue| cue.start).collect();
    for (index, cue) in cues.iter_mut().enumerate() {
        if cue.end.is_none() {
            let next = starts.get(index + 1).copied().unwrap_or(cue.start + 3000);
            cue.end = Some(next.min(cue.start + 3000).max(cue.start + 1));
        }
    }
    Ok((document(format, &track.private, &cues), format))
}

fn clock(ms: u64, fraction: char) -> String {
    let (h, m, s) = (ms / 3_600_000, ms / 60_000 % 60, ms / 1000 % 60);
    format!("{h:02}:{m:02}:{s:02}{fraction}{:03}", ms % 1000)
}

/// ASS writes hours without padding and hundredths of a second: 0:00:01.50.
fn ass_clock(ms: u64) -> String {
    format!("{}:{:02}:{:02}.{:02}", ms / 3_600_000, ms / 60_000 % 60, ms / 1000 % 60, ms % 1000 / 10)
}

fn document(format: TextFormat, private: &[u8], cues: &[Cue]) -> String {
    let mut out = String::new();
    match format {
        TextFormat::Srt => {
            for (index, cue) in cues.iter().enumerate() {
                let end = cue.end.unwrap_or(cue.start);
                out += &format!(
                    "{}\n{} --> {}\n{}\n\n",
                    index + 1,
                    clock(cue.start, ','),
                    clock(end, ','),
                    cue.text
                );
            }
        }
        TextFormat::Vtt => {
            out += "WEBVTT\n\n";
            for cue in cues {
                let end = cue.end.unwrap_or(cue.start);
                out += &format!(
                    "{} --> {}\n{}\n\n",
                    clock(cue.start, '.'),
                    clock(end, '.'),
                    cue.text
                );
            }
        }
        TextFormat::Ass => {
            // Matroska keeps the script header in CodecPrivate and each line as
            // "ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text".
            let header = String::from_utf8_lossy(private).into_owned();
            out += header.trim_end();
            if !header.contains("[Events]") {
                out += "\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text";
            }
            out += "\n";
            for cue in cues {
                let fields: Vec<&str> = cue.text.splitn(9, ',').collect();
                if fields.len() < 9 {
                    continue;
                }
                let end = cue.end.unwrap_or(cue.start);
                out += &format!(
                    "Dialogue: {},{},{},{}\n",
                    fields[1],
                    ass_clock(cue.start),
                    ass_clock(end),
                    fields[2..].join(",")
                );
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use webm_iterable::WebmWriter;

    fn block(track: u8, timestamp: i16, payload: &str) -> Vec<u8> {
        let mut data = vec![0x80 | track];
        data.extend_from_slice(&timestamp.to_be_bytes());
        data.push(0);
        data.extend_from_slice(payload.as_bytes());
        data
    }
    fn track(number: u64, kind: u64, codec: &str, extra: Vec<MatroskaSpec>) -> MatroskaSpec {
        let mut children = vec![
            MatroskaSpec::TrackNumber(number),
            MatroskaSpec::TrackUID(number),
            MatroskaSpec::TrackType(kind),
            MatroskaSpec::CodecID(codec.into()),
        ];
        children.extend(extra);
        MatroskaSpec::TrackEntry(Master::Full(children))
    }
    fn fixture(path: &Path) {
        let mut file = File::create(path).unwrap();
        let mut writer = WebmWriter::new(&mut file);
        writer.write(&MatroskaSpec::Ebml(Master::Full(vec![MatroskaSpec::DocType("webm".into())]))).unwrap();
        writer.write_advanced(&MatroskaSpec::Segment(Master::Start), webm_iterable::WriteOptions::is_unknown_sized_element()).unwrap();
        writer.write(&MatroskaSpec::Info(Master::Full(vec![MatroskaSpec::TimestampScale(1_000_000)]))).unwrap();
        writer.write(&MatroskaSpec::Tracks(Master::Full(vec![
            track(1, AUDIO, "A_OPUS", vec![MatroskaSpec::Language("eng".into()), MatroskaSpec::Name("Main".into())]),
            track(2, AUDIO, "A_OPUS", vec![MatroskaSpec::Language("jpn".into()), MatroskaSpec::FlagDefault(0)]),
            track(3, SUBTITLES, "S_TEXT/UTF8", vec![MatroskaSpec::Language("eng".into()), MatroskaSpec::Name("English".into())]),
            track(4, SUBTITLES, "S_TEXT/ASS", vec![MatroskaSpec::CodecPrivate(b"[Script Info]\nScriptType: v4.00+\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n".to_vec())]),
            track(5, SUBTITLES, "S_HDMV/PGS", vec![]),
        ]))).unwrap();
        writer.write(&MatroskaSpec::Cluster(Master::Full(vec![
            MatroskaSpec::Timestamp(1000),
            MatroskaSpec::BlockGroup(Master::Full(vec![MatroskaSpec::Block(block(3, 0, "Children walked home.")), MatroskaSpec::BlockDuration(1500)])),
            MatroskaSpec::BlockGroup(Master::Full(vec![MatroskaSpec::Block(block(4, 500, "0,0,Default,,0,0,0,,{\\b1}Ships{\\b0} rest.")), MatroskaSpec::BlockDuration(1000)])),
            MatroskaSpec::SimpleBlock(block(3, 2500, "The bridge is quiet.")),
        ]))).unwrap();
        writer.write(&MatroskaSpec::Segment(Master::End)).unwrap();
        writer.flush().unwrap();
    }

    #[test]
    fn lists_audio_and_subtitle_tracks_with_availability() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("tracks.webm");
        fixture(&path);
        let found = tracks(&path).unwrap();
        let summary: Vec<_> = found.iter().map(|t| (t.kind, t.ordinal, t.number, t.language.as_deref(), t.availability)).collect();
        assert_eq!(summary, vec![
            (MediaTrackKind::Audio, 0, 1, Some("eng"), TrackAvailability::Available),
            (MediaTrackKind::Audio, 1, 2, Some("jpn"), TrackAvailability::Available),
            (MediaTrackKind::Subtitles, 0, 3, Some("eng"), TrackAvailability::Available),
            (MediaTrackKind::Subtitles, 1, 4, None, TrackAvailability::Available),
            (MediaTrackKind::Subtitles, 2, 5, None, TrackAvailability::ImageSubtitles),
        ]);
        assert_eq!(found[0].name.as_deref(), Some("Main"));
        assert!(!found[1].default);
        let other = directory.path().join("plain.mp4");
        std::fs::write(&other, b"\0\0\0\x18ftypmp42").unwrap();
        assert!(tracks(&other).unwrap().is_empty());
    }

    #[test]
    fn extracts_text_tracks_as_subtitle_documents_the_parser_reads() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("tracks.webm");
        fixture(&path);
        let (srt, format) = extract(&path, 3, &|| false).unwrap();
        assert_eq!(format, TextFormat::Srt);
        let parsed = crate::watch::subtitles::parse(&srt, "srt").unwrap();
        let cues: Vec<_> = parsed.cues.iter().map(|c| (c.start_ms, c.end_ms, c.text.as_str())).collect();
        // The simple block has no stored duration and is the last line, so it lasts three seconds.
        assert_eq!(cues, vec![(1000, 2500, "Children walked home."), (3500, 6500, "The bridge is quiet.")]);

        let (ass, format) = extract(&path, 4, &|| false).unwrap();
        assert_eq!(format, TextFormat::Ass);
        let parsed = crate::watch::subtitles::parse(&ass, "ass").unwrap();
        assert_eq!(parsed.cues.iter().map(|c| (c.start_ms, c.end_ms, c.text.as_str())).collect::<Vec<_>>(), vec![(1500, 2500, "Ships rest.")]);
        assert!(!parsed.limitations.is_empty(), "styling in the embedded track is reported");

        assert!(extract(&path, 5, &|| false).unwrap_err().contains("can't be shown as text"));
        assert!(extract(&path, 9, &|| false).is_err());
        assert!(extract(&path, 3, &|| true).unwrap_err().contains("cancelled"));
    }
}
