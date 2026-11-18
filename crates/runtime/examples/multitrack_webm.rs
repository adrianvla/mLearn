//! Development fixture: remuxes a WebM to add a second audio track and embedded subtitle tracks
//! (UTF-8 text, ASS and an image-based PGS track without data). Seek index elements are dropped
//! because their byte offsets no longer apply.
//! Usage: cargo run -p mlearn-runtime --example multitrack_webm -- INPUT.webm OUTPUT.webm
use std::fs::File;
use std::io::{BufReader, BufWriter};
use webm_iterable::matroska_spec::{Block, Master, MatroskaSpec};
use webm_iterable::{WebmIterator, WebmWriter};

const SECOND_AUDIO: u64 = 101;
fn subtitle_block(track: u8, timestamp: i16, payload: &str) -> Vec<u8> {
    let mut data = vec![0x80 | track];
    data.extend_from_slice(&timestamp.to_be_bytes());
    data.push(0);
    data.extend_from_slice(payload.as_bytes());
    data
}
fn entry(number: u64, kind: u64, codec: &str, language: &str, name: &str, private: Option<&[u8]>) -> MatroskaSpec {
    let mut children = vec![
        MatroskaSpec::TrackNumber(number),
        MatroskaSpec::TrackUID(number),
        MatroskaSpec::TrackType(kind),
        MatroskaSpec::FlagDefault(0),
        MatroskaSpec::CodecID(codec.into()),
        MatroskaSpec::Language(language.into()),
        MatroskaSpec::Name(name.into()),
    ];
    if let Some(private) = private {
        children.push(MatroskaSpec::CodecPrivate(private.to_vec()));
    }
    MatroskaSpec::TrackEntry(Master::Full(children))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut arguments = std::env::args().skip(1);
    let (input, output) = (arguments.next().ok_or("input")?, arguments.next().ok_or("output")?);
    let source = WebmIterator::new(BufReader::new(File::open(input)?), &[MatroskaSpec::TrackEntry(Master::Start)]);
    let mut destination = BufWriter::new(File::create(output)?);
    let mut writer = WebmWriter::new(&mut destination);
    let mut audio = None;
    let mut first_cluster = true;
    let mut skipping = 0usize;
    for tag in source {
        let tag = tag?;
        if skipping > 0 {
            match &tag {
                MatroskaSpec::SeekHead(Master::Start) | MatroskaSpec::Cues(Master::Start) => skipping += 1,
                MatroskaSpec::SeekHead(Master::End) | MatroskaSpec::Cues(Master::End) => skipping -= 1,
                _ => {}
            }
            continue;
        }
        match tag {
            MatroskaSpec::SeekHead(Master::Start) | MatroskaSpec::Cues(Master::Start) => skipping = 1,
            MatroskaSpec::SeekHead(_) | MatroskaSpec::Cues(_) => {}
            MatroskaSpec::Segment(Master::Start) => writer.write_advanced(&tag, webm_iterable::WriteOptions::is_unknown_sized_element())?,
            MatroskaSpec::TrackEntry(Master::Full(ref children)) => {
                writer.write(&tag)?;
                if children.contains(&MatroskaSpec::TrackType(2)) && audio.is_none() {
                    let mut copy: Vec<MatroskaSpec> = children
                        .iter()
                        .filter(|child| !matches!(child, MatroskaSpec::TrackNumber(_) | MatroskaSpec::TrackUID(_) | MatroskaSpec::FlagDefault(_) | MatroskaSpec::Language(_) | MatroskaSpec::Name(_)))
                        .cloned()
                        .collect();
                    audio = children.iter().find_map(|child| match child { MatroskaSpec::TrackNumber(n) => Some(*n), _ => None });
                    copy.extend([MatroskaSpec::TrackNumber(SECOND_AUDIO), MatroskaSpec::TrackUID(SECOND_AUDIO), MatroskaSpec::FlagDefault(0),
                        MatroskaSpec::Language("jpn".into()), MatroskaSpec::Name("Commentary".into())]);
                    writer.write(&MatroskaSpec::TrackEntry(Master::Full(copy)))?;
                }
            }
            MatroskaSpec::Tracks(Master::End) => {
                writer.write(&entry(102, 17, "S_TEXT/UTF8", "eng", "English", None))?;
                writer.write(&entry(103, 17, "S_TEXT/ASS", "jpn", "Signs", Some(b"[Script Info]\nScriptType: v4.00+\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")))?;
                writer.write(&entry(104, 17, "S_HDMV/PGS", "eng", "Pictures", None))?;
                writer.write(&tag)?;
            }
            MatroskaSpec::Timestamp(_) if first_cluster => {
                first_cluster = false;
                writer.write(&tag)?;
                for (track, at, text) in [(102u8, 0i16, "Ships rest in the harbour."), (102, 3000, "The bridge is quiet."), (103, 1000, "0,0,Default,,0,0,0,,{\\i1}Harbour{\\i0}")] {
                    writer.write(&MatroskaSpec::BlockGroup(Master::Full(vec![MatroskaSpec::Block(subtitle_block(track, at, text)), MatroskaSpec::BlockDuration(2500)])))?;
                }
            }
            MatroskaSpec::SimpleBlock(ref data) if audio.is_some() => {
                writer.write(&tag)?;
                let block: Block = data.try_into()?;
                if Some(block.track) == audio {
                    let mut copy = data.clone();
                    copy[0] = 0x80 | SECOND_AUDIO as u8;
                    writer.write(&MatroskaSpec::SimpleBlock(copy))?;
                }
            }
            _ => writer.write(&tag)?,
        }
    }
    writer.flush()?;
    Ok(())
}
