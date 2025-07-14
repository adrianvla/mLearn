import {subs} from "./subtitler.js";
import {parseASS, parseSRT} from "./subtitleParsers.js";
import {parseTime} from "./utils.js";

let lastIndex = 0;

const findCurrentSub = (currentTime) => {
    if (subs.length === 0) return null;

    // Check if the current time is within the range of the last found subtitle
    if (currentTime >= subs[lastIndex].start && currentTime <= subs[lastIndex].end) {
        return subs[lastIndex];
    }

    // Iterate from the last found index to find the current subtitle
    for (let i = lastIndex; i < subs.length; i++) {
        if (currentTime >= subs[i].start && currentTime <= subs[i].end) {
            lastIndex = i;
            return subs[i];
        }
    }

    // If not found, iterate from the beginning to the last found index
    for (let i = 0; i < lastIndex; i++) {
        if (currentTime >= subs[i].start && currentTime <= subs[i].end) {
            lastIndex = i;
            return subs[i];
        }
    }

    return null;
};

const findSub = time => {
    if (subs.length === 0) return null;

    // Iterate from the last found index to find the current subtitle
    for (let i = lastIndex; i < subs.length; i++) {
        if (time >= subs[i].start && time <= subs[i].end) {
            return i;
        }
    }

    // If not found, iterate from the beginning to the last found index
    for (let i = 0; i < lastIndex; i++) {
        if (time >= subs[i].start && time <= subs[i].end) {
            return i;
        }
    }
    let closestIndex = 0;
    let closestTimeDiff = Math.min(Math.abs(time - subs[0].start),Math.abs(time - subs[0].end));

    // Iterate through the subtitles to find the closest one
    for (let i = 1; i < subs.length; i++) {
        let timeDiff = Math.min(Math.abs(time - subs[i].start),Math.abs(time - subs[i].end));
        if (timeDiff < closestTimeDiff) {
            closestTimeDiff = timeDiff;
            closestIndex = i;
        }
    }

    return closestIndex;
};

const readSubtitleFile = (file) => {
    return new Promise((resolve, reject) => {
        lastIndex = 0;
        const reader = new FileReader();
        reader.onload = (event) => {
            const content = event.target.result;
            if (file.name.endsWith('.srt')) {
                let parsed = parseSRT(content);
                parsed.forEach((sub) => {
                    sub.start = parseTime(sub.start,",");
                    sub.end = parseTime(sub.end,",");
                });
                resolve(parsed);
            } else if (file.name.endsWith('.ass')) {
                let parsed = parseASS(content);
                parsed.forEach((sub) => {
                    sub.start = parseTime(sub.start,".");
                    sub.end = parseTime(sub.end,".");
                });
                resolve(parsed);
            } else {
                reject('Unsupported file type');
            }
        };
        reader.onerror = () => reject('Error reading file');
        reader.readAsText(file);
    });
};

export {findCurrentSub, findSub, readSubtitleFile, lastIndex};