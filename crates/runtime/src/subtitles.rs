use mlearn_core::{Cue, SubtitleLimitation};

/// Text and timing of an attached subtitle file, plus what the file carried that is not reproduced.
pub struct Parsed {
    pub cues: Vec<Cue>,
    pub limitations: Vec<SubtitleLimitation>,
}

/// Supported external formats: SRT (styling tags removed), WebVTT (cue settings ignored) and
/// ASS/SSA (override tags, styles and effects ignored). Embedded media tracks are not read.
pub fn parse(text: &str, extension: &str) -> Result<Parsed, String> {
    if text.len() > 2 * 1024 * 1024 {
        return Err("Subtitle file exceeds 2 MiB".into());
    }
    let normalized = text
        .trim_start_matches('\u{feff}')
        .replace("\r\n", "\n")
        .replace('\r', "\n");
    let mut limitations = Vec::new();
    let mut cues = match extension {
        "srt" => srt(&normalized, &mut limitations)?,
        "vtt" => vtt(&normalized, &mut limitations)?,
        "ass" | "ssa" => ass(&normalized, &mut limitations)?,
        _ => return Err("Unsupported subtitle format".into()),
    };
    if cues.is_empty() {
        return Err("No subtitle cues found".into());
    }
    if cues.len() > 50000 {
        return Err("Subtitle file exceeds 50,000 cues".into());
    }
    // ASS events are not required to be chronological; cue indices follow playback order.
    cues.sort_by_key(|cue| (cue.start_ms, cue.end_ms));
    for (index, cue) in cues.iter_mut().enumerate() {
        cue.index = index as u32;
    }
    limitations.sort();
    limitations.dedup();
    Ok(Parsed { cues, limitations })
}

fn cue(start_ms: u32, end_ms: u32, text: String) -> Result<Option<Cue>, String> {
    if end_ms <= start_ms {
        return Err("Subtitle timestamps must have a positive duration".into());
    }
    let text = text
        .lines()
        .map(str::trim_end)
        .filter(|line| !line.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if text.len() > 16384 {
        return Err("Subtitle cue exceeds 16 KiB".into());
    }
    Ok((!text.is_empty()).then_some(Cue {
        index: 0,
        start_ms,
        end_ms,
        text,
    }))
}

/// Removes `<...>` markup (and `{...}` overrides when `braces`), reporting styling when any is found.
fn strip(text: &str, braces: bool, limitations: &mut Vec<SubtitleLimitation>) -> String {
    let mut out = String::with_capacity(text.len());
    let mut closing = None;
    for c in text.chars() {
        match closing {
            Some(end) if c == end => closing = None,
            Some(_) => {}
            None if c == '<' => closing = Some('>'),
            None if braces && c == '{' => closing = Some('}'),
            None => out.push(c),
        }
    }
    if out.len() != text.len() {
        limitations.push(SubtitleLimitation::Styling);
    }
    out.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
}

fn srt(text: &str, limitations: &mut Vec<SubtitleLimitation>) -> Result<Vec<Cue>, String> {
    let mut cues = Vec::new();
    for block in text.split("\n\n").filter(|b| !b.trim().is_empty()) {
        let mut lines = block.trim_matches('\n').lines();
        let number = lines.next().ok_or("Missing cue number")?;
        number
            .trim()
            .parse::<u32>()
            .map_err(|_| "Expected numbered SRT cue")?;
        let timing = lines.next().ok_or("Missing SRT timestamp")?;
        let (start, end) = timing
            .split_once("-->")
            .ok_or("Expected SRT start --> end")?;
        // Coordinates after the end time (X1:... Y2:...) are positioning hints.
        let mut end = end.split_whitespace();
        let end_ms = timestamp(end.next().unwrap_or_default())?;
        if end.next().is_some() {
            limitations.push(SubtitleLimitation::Positioning);
        }
        let body = lines.collect::<Vec<_>>().join("\n");
        if body.contains("{\\") {
            limitations.push(SubtitleLimitation::Positioning);
        }
        let start_ms = timestamp(start)?;
        if cues.last().is_some_and(|c: &Cue| c.start_ms > start_ms) {
            return Err("SRT timestamps must be ordered".into());
        }
        cues.extend(cue(start_ms, end_ms, strip(&body, true, limitations))?);
    }
    Ok(cues)
}

fn vtt(text: &str, limitations: &mut Vec<SubtitleLimitation>) -> Result<Vec<Cue>, String> {
    let mut blocks = text.split("\n\n").filter(|b| !b.trim().is_empty());
    if !blocks
        .next()
        .is_some_and(|header| header.trim_start().starts_with("WEBVTT"))
    {
        return Err("Expected a WEBVTT header".into());
    }
    let mut cues = Vec::new();
    for block in blocks {
        let lines: Vec<_> = block.trim_matches('\n').lines().collect();
        let first = lines.first().copied().unwrap_or_default();
        if ["NOTE", "STYLE", "REGION"]
            .iter()
            .any(|kind| first.starts_with(kind))
        {
            if !first.starts_with("NOTE") {
                limitations.push(SubtitleLimitation::Styling);
            }
            continue;
        }
        let Some(at) = lines.iter().position(|line| line.contains("-->")) else {
            return Err("Expected a WebVTT cue timing line".into());
        };
        let (start, rest) = lines[at].split_once("-->").unwrap_or_default();
        let mut rest = rest.split_whitespace();
        let end_ms = timestamp(rest.next().unwrap_or_default())?;
        if rest.next().is_some() {
            limitations.push(SubtitleLimitation::Positioning);
        }
        let body = lines[at + 1..].join("\n");
        cues.extend(cue(
            timestamp(start)?,
            end_ms,
            strip(&body, false, limitations),
        )?);
    }
    Ok(cues)
}

fn ass(text: &str, limitations: &mut Vec<SubtitleLimitation>) -> Result<Vec<Cue>, String> {
    let mut in_events = false;
    let mut format: Option<Vec<String>> = None;
    let mut cues = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_events = line.eq_ignore_ascii_case("[events]");
            if line.eq_ignore_ascii_case("[v4+ styles]") || line.eq_ignore_ascii_case("[v4 styles]")
            {
                limitations.push(SubtitleLimitation::Styling);
            }
            continue;
        }
        if !in_events {
            continue;
        }
        if let Some(fields) = line.strip_prefix("Format:") {
            format = Some(fields.split(',').map(|f| f.trim().to_lowercase()).collect());
            continue;
        }
        let Some(values) = line.strip_prefix("Dialogue:") else {
            continue;
        };
        let format = format.as_ref().ok_or("ASS events have no Format line")?;
        let field = |name: &str| format.iter().position(|f| f == name);
        let (Some(start), Some(end), Some(body)) = (field("start"), field("end"), field("text"))
        else {
            return Err("ASS Format line lacks Start, End or Text".into());
        };
        // Text is the last field and may itself contain commas.
        let values: Vec<_> = values.splitn(format.len(), ',').map(str::trim).collect();
        if values.len() != format.len() || body + 1 != format.len() {
            return Err("Malformed ASS Dialogue line".into());
        }
        if field("effect").is_some_and(|i| !values[i].is_empty()) {
            limitations.push(SubtitleLimitation::Effects);
        }
        let raw = values[body];
        if raw.contains("\\pos") || raw.contains("\\move") || raw.contains("\\an") {
            limitations.push(SubtitleLimitation::Positioning);
        }
        let text = strip(raw, true, limitations)
            .replace("\\N", "\n")
            .replace("\\n", "\n")
            .replace("\\h", " ");
        cues.extend(cue(ass_time(values[start])?, ass_time(values[end])?, text)?);
    }
    Ok(cues)
}

/// `H:MM:SS.cc` (centiseconds).
fn ass_time(value: &str) -> Result<u32, String> {
    let (clock, centiseconds) = value.trim().split_once('.').ok_or("Unsupported ASS time")?;
    let parts: Vec<u32> = clock
        .split(':')
        .map(|v| v.parse().map_err(|_| "Invalid ASS time".to_owned()))
        .collect::<Result<_, _>>()?;
    let centiseconds: u32 = centiseconds.parse().map_err(|_| "Invalid ASS time")?;
    if parts.len() != 3 || parts[1] > 59 || parts[2] > 59 || centiseconds > 99 {
        return Err("ASS time out of range".into());
    }
    Ok(((parts[0] * 60 + parts[1]) * 60 + parts[2]) * 1000 + centiseconds * 10)
}

/// `HH:MM:SS,mmm` (SRT) or `[HH:]MM:SS.mmm` (WebVTT).
fn timestamp(value: &str) -> Result<u32, String> {
    let fields: Vec<_> = value.trim().split([':', ',', '.']).collect();
    let fields = match fields.len() {
        3 => [&["0"][..], &fields[..]].concat(),
        4 => fields,
        _ => return Err("Unsupported subtitle timestamp".into()),
    };
    if fields[3].len() != 3 {
        return Err("Unsupported subtitle timestamp".into());
    }
    let n = fields
        .iter()
        .map(|v| {
            v.parse::<u32>()
                .map_err(|_| "Invalid subtitle time".to_owned())
        })
        .collect::<Result<Vec<_>, _>>()?;
    if n[0] > 999 || n[1] > 59 || n[2] > 59 || n[3] > 999 {
        return Err("Subtitle time out of range".into());
    }
    Ok(((n[0] * 60 + n[1]) * 60 + n[2]) * 1000 + n[3])
}

#[cfg(test)]
mod tests {
    use super::*;
    use SubtitleLimitation::*;

    #[test]
    fn preserves_unicode_lines_and_rejects_partial_import() {
        let parsed = parse(
            "1\r\n00:00:01,001 --> 00:00:03,002\r\n👩🏽‍💻 café\r\nsecond line\r\n",
            "srt",
        )
        .unwrap();
        assert_eq!(parsed.cues[0].text, "👩🏽‍💻 café\nsecond line");
        assert_eq!(parsed.cues[0].start_ms, 1001);
        assert!(parsed.limitations.is_empty());
        assert!(parse("1\n00:00:03,000 --> 00:00:01,000\nbad", "srt").is_err());
        assert!(parse(
            "1\n00:00:00,000 --> 00:00:01,000\nvalid\n\n2\nbroken\ninvalid",
            "srt"
        )
        .is_err());
    }

    #[test]
    fn styled_srt_keeps_text_and_reports_dropped_styling_and_position() {
        let parsed = parse(
            "1\n00:00:01,000 --> 00:00:02,000\n{\\an8}<i>Children</i> walked <font color=\"red\">home</font>.\n",
            "srt",
        )
        .unwrap();
        assert_eq!(parsed.cues[0].text, "Children walked home.");
        assert_eq!(parsed.limitations, vec![Styling, Positioning]);
    }

    #[test]
    fn webvtt_reads_short_timestamps_and_ignores_settings_and_voice_tags() {
        let parsed = parse(
            "WEBVTT - title\n\nNOTE a comment\n\nSTYLE\n::cue { color: red }\n\nintro\n00:01.500 --> 00:03.000 line:0 align:start\n<v Ana>Children</v> walked &amp; ran.\n\n00:00:04.000 --> 00:00:05.000\nHome.\n",
            "vtt",
        )
        .unwrap();
        assert_eq!(parsed.cues.len(), 2);
        assert_eq!(
            (parsed.cues[0].start_ms, parsed.cues[0].end_ms),
            (1500, 3000)
        );
        assert_eq!(parsed.cues[0].text, "Children walked & ran.");
        assert_eq!(parsed.limitations, vec![Styling, Positioning]);
        assert!(parse("1\n00:00:01,000 --> 00:00:02,000\nnot vtt\n", "vtt").is_err());
    }

    #[test]
    fn ass_orders_events_and_reports_styles_positions_and_effects() {
        let parsed = parse(
            "[Script Info]\nScriptType: v4.00+\n\n[V4+ Styles]\nFormat: Name, Fontname\nStyle: Default,Arial\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:04.00,0:00:05.50,Default,,0,0,0,,Second, with a comma\nDialogue: 0,0:00:01.25,0:00:03.00,Default,,0,0,0,Karaoke,{\\pos(10,20)}First\\Nline\\hend\nComment: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,ignored\n",
            "ass",
        )
        .unwrap();
        assert_eq!(
            parsed
                .cues
                .iter()
                .map(|c| (c.index, c.start_ms, c.text.as_str()))
                .collect::<Vec<_>>(),
            vec![
                (0, 1250, "First\nline end"),
                (1, 4000, "Second, with a comma")
            ]
        );
        assert_eq!(parsed.limitations, vec![Styling, Positioning, Effects]);
        assert!(parse("[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,x\n", "ass").is_err());
    }
}
