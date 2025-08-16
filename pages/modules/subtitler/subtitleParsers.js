
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
    // Remove the file extension (.srt, .ass, etc.)
    if(!filename) return "";
    let nameWithoutExtension = filename.replace(/(\.[^.]+)+$/, '');

    // Improved regex to capture the series title, numbers in parentheses, episode numbers, and ignore extra details like 1080p or Subtitles.
    let regex = /^([a-zA-Z0-9\s]+)(?:\s*\((\d+)\))?(?:\s+(\d+))?(?:\s*(S\d+))?(?:\s*(EP\d+))?(?:\s*(\d+))?/i;

    // Apply the regex to the filename
    let match = nameWithoutExtension.match(regex);

    let step1returnable = "";

    if (match) {
        // Combine the parts that matched, removing undefined parts and unnecessary descriptors
        let parsedName = match.slice(1).filter(Boolean).join(' ').trim();

        // Remove additional descriptors like 'Subtitles' and '1080p'
        step1returnable = parsedName.replace(/\b(Subtitles|1080p|720p|480p|x264|BluRay|HD)\b/gi, '').trim();


    } else {
        // Return the filename without extension if no match was found
        step1returnable = nameWithoutExtension;
    }
    step1returnable = step1returnable.replace(/-/g, "");

// Remove all content within [], {}, and () (including the brackets themselves)
    step1returnable = step1returnable.replace(/\[[^\]]*\]|\{[^}]*\}|\([^)]*\)/g, "");
    return step1returnable.replace(/ {2,}/g, ' ').trim();
}


export {parseASS, parseSRT, parseSubtitleName};