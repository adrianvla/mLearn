export interface ParsedSubtitle {
  start: number;
  end: number;
  text: string;
}

export function parseSRT(content: string): ParsedSubtitle[] {
  const subtitles: ParsedSubtitle[] = [];
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.trim().split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length < 3) continue;

    const timeLine = lines[1];
    const timeMatch = timeLine.match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
    );

    if (!timeMatch) continue;

    const start =
      parseInt(timeMatch[1]) * 3600 +
      parseInt(timeMatch[2]) * 60 +
      parseInt(timeMatch[3]) +
      parseInt(timeMatch[4]) / 1000;

    const end =
      parseInt(timeMatch[5]) * 3600 +
      parseInt(timeMatch[6]) * 60 +
      parseInt(timeMatch[7]) +
      parseInt(timeMatch[8]) / 1000;

    const text = lines.slice(2).join('\n').replace(/<[^>]*>/g, '');

    subtitles.push({ start, end, text });
  }

  return subtitles;
}

export function parseVTT(content: string): ParsedSubtitle[] {
  const subtitles: ParsedSubtitle[] = [];
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  let i = 0;

  while (i < lines.length && !lines[i].includes('-->')) {
    i++;
  }

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line || !line.includes('-->')) {
      if (line && !line.match(/^\d{2}:/)) {
        i++;
        continue;
      }
      if (!line) {
        i++;
        continue;
      }
    }

    const timeLine = lines[i];
    const timeMatch = timeLine.match(
      /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/
    );

    let start = 0;
    let end = 0;
    let parsed = false;

    if (timeMatch) {
      start =
        parseInt(timeMatch[1]) * 3600 +
        parseInt(timeMatch[2]) * 60 +
        parseInt(timeMatch[3]) +
        parseInt(timeMatch[4]) / 1000;

      end =
        parseInt(timeMatch[5]) * 3600 +
        parseInt(timeMatch[6]) * 60 +
        parseInt(timeMatch[7]) +
        parseInt(timeMatch[8]) / 1000;
      parsed = true;
    } else {
      const shortMatch = timeLine.match(
        /(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{2}):(\d{2})[.,](\d{3})/
      );

      if (shortMatch) {
        start =
          parseInt(shortMatch[1]) * 60 +
          parseInt(shortMatch[2]) +
          parseInt(shortMatch[3]) / 1000;
        end =
          parseInt(shortMatch[4]) * 60 +
          parseInt(shortMatch[5]) +
          parseInt(shortMatch[6]) / 1000;
        parsed = true;
      }
    }

    if (!parsed) {
      i++;
      continue;
    }

    i++;
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].includes('-->')) {
      textLines.push(lines[i].replace(/<[^>]*>/g, ''));
      i++;
    }

    if (textLines.length > 0) {
      subtitles.push({ start, end, text: textLines.join('\n') });
    }
  }

  return subtitles;
}

export function parseASS(content: string): ParsedSubtitle[] {
  const subtitles: ParsedSubtitle[] = [];
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  let inEvents = false;
  let formatFields: string[] = [];

  for (const line of lines) {
    if (line.startsWith('[Events]')) {
      inEvents = true;
      continue;
    }

    if (line.startsWith('[') && inEvents) {
      break;
    }

    if (inEvents) {
      if (line.startsWith('Format:')) {
        formatFields = line.substring(7).split(',').map(f => f.trim().toLowerCase());
        continue;
      }

      if (line.startsWith('Dialogue:')) {
        let dialogueLine = line;
        if (dialogueLine.includes('Marked=')) {
          dialogueLine = dialogueLine.replace(/Marked=\d+/, '');
        }

        const parts = dialogueLine.substring(9).split(',');
        const startIdx = formatFields.indexOf('start');
        const endIdx = formatFields.indexOf('end');
        const textIdx = formatFields.indexOf('text');

        if (startIdx === -1 || endIdx === -1 || textIdx === -1) continue;

        const parseTime = (timeStr: string): number => {
          const match = timeStr.trim().match(/(\d+):(\d{2}):(\d{2})\.(\d{2})/);
          if (!match) return 0;
          return (
            parseInt(match[1]) * 3600 +
            parseInt(match[2]) * 60 +
            parseInt(match[3]) +
            parseInt(match[4]) / 100
          );
        };

        const start = parseTime(parts[startIdx]);
        const end = parseTime(parts[endIdx]);

        let text = parts.slice(textIdx).join(',');
        text = text.replace(/\{[^}]*\}/g, '').replace(/\\N/g, '\n').replace(/\\n/g, '\n');

        subtitles.push({ start, end, text: text.trim() });
      }
    }
  }

  return subtitles;
}

export function detectSubtitleFormat(content: string): 'srt' | 'vtt' | 'ass' {
  if (content.includes('WEBVTT')) {
    return 'vtt';
  }
  if (content.includes('[Script Info]') || content.includes('[V4+ Styles]')) {
    return 'ass';
  }
  return 'srt';
}

export function parseSubtitles(content: string, format?: 'srt' | 'vtt' | 'ass'): ParsedSubtitle[] {
  const detectedFormat = format || detectSubtitleFormat(content);

  switch (detectedFormat) {
    case 'vtt':
      return parseVTT(content);
    case 'ass':
      return parseASS(content);
    default:
      return parseSRT(content);
  }
}

export function findCurrentSubtitle(subtitles: ParsedSubtitle[], time: number, offset: number): ParsedSubtitle | null {
  const adjustedTime = time + offset;

  let lo = 0;
  let hi = subtitles.length - 1;
  let found = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (subtitles[mid].start <= adjustedTime) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (found === -1) return null;
  if (adjustedTime > subtitles[found].end) return null;
  return subtitles[found];
}