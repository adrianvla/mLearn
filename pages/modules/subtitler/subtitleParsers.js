
const parseSRT = (content) => {
    const subtitles = [];
    // Updated regex to handle both \n and \r\n
    const srtRegex = /(\d+)(?:\r?\n)(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})(?:\r?\n)([\s\S]*?)(?=\r?\n\d|\r?\n*$)/g;
    let match;

    while ((match = srtRegex.exec(content)) !== null) {
        subtitles.push({
            start: match[2],
            end: match[3],
            text: match[4].replace(/(?:\r?\n)/g, ' ') // Replace line breaks with space in the subtitle text
        });
    }

    return subtitles;
};


const parseASS = (content) => {
    const subtitles = [];
    const assRegex = /Dialogue:\s*(\d+),(\d+:\d+:\d+\.\d+),(\d+:\d+:\d+\.\d+),([^,]*),([^,]*),(\d+),(\d+),(\d+),([^,]*),(.+)/g;
    let match;
    while ((match = assRegex.exec(content)) !== null) {
        const text = match[10].replace(/\\N/g, ' ').replace(/{.*?}/g, ''); // Remove formatting tags
        subtitles.push({
            start: match[2],
            end: match[3],
            text: text
        });
    }
    return subtitles;
};

function parseSubtitleName(filename) {
    if (!filename) return "";

    // Step 1: Remove only short extensions (like .srt, .ass, .sub)
    let nameWithoutExtension = filename.replace(/\.[^.]{1,3}$/, "");

    // Step 2: Normalize separators (replace . and _ with spaces)
    let normalized = nameWithoutExtension.replace(/[._]/g, " ");

    // Step 3: Remove junk tags (common release tags, codecs, sources, etc.)
    normalized = normalized.replace(/\b(WEBRip|BluRay|HDTV|Netflix|AMZN|x264|x265|1080p|720p|480p|Subtitles)\b/gi, "");

    // Step 4: Keep season/episode identifiers like S01E02 intact
    // Make sure "S01E02" becomes "S01E2" (remove leading 0 in episode number)
    normalized = normalized.replace(/S(\d{1,2})E0?(\d{1,2})/gi, (m, s, e) => `S${s}E${parseInt(e)}`);

    normalized = normalized.replace(/\b(ja|en|fr|es|de|it|pt|ru|zh|ko)\b/gi, "");

    // Step 5: Remove bracketed/parenthesized junk
    normalized = normalized.replace(/\[[^\]]*\]|\{[^}]*\}|\([^)]*\)/g, "");

    // Step 6: Collapse multiple spaces, trim
    return normalized.replace(/ {2,}/g, " ").trim();
}


export {parseASS, parseSRT, parseSubtitleName};