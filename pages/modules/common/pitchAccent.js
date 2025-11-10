const SMALL_KANA_CHARS = new Set([
    "ゃ","ゅ","ょ","ャ","ュ","ョ",
    "ぁ","ぃ","ぅ","ぇ","ぉ","ァ","ィ","ゥ","ェ","ォ",
    "ゎ","ゕ","ゖ"
]);

function buildAccentPattern(accentType, reading){
    const chars = Array.from(typeof reading === "string" ? reading : String(reading ?? ""));
    const count = chars.length;
    const pattern = [];
    for(let i = 0; i < count; i++){
        switch(accentType){
            case 0:
                pattern.push(i !== 0);
                break;
            case 1:
                pattern.push(i === 0);
                break;
            case 2:
                pattern.push(i === 1);
                break;
            case 3:
                pattern.push(i !== 0 && i < count - 1);
                break;
            default:
                pattern.push(i !== 0 && i < accentType);
                break;
        }
    }

    for(let i = 0; i < count - 1; i++){
        const nextIndex = i + 1;
        if(pattern[nextIndex] === undefined) break;
        if(pattern[i] === pattern[nextIndex]) continue;
        if(!SMALL_KANA_CHARS.has(chars[nextIndex])) continue;
        const desiredValue = pattern[nextIndex];
        let shiftIndex = nextIndex;
        while(shiftIndex < count && SMALL_KANA_CHARS.has(chars[shiftIndex])){
            pattern[shiftIndex] = pattern[i];
            shiftIndex++;
        }
        if(shiftIndex < count){
            pattern[shiftIndex] = desiredValue;
            i = shiftIndex - 1;
        }
    }
    return pattern;
}

export function getPitchAccentInfo(accentType, reading){
    if(accentType === undefined || accentType === null) return null;
    if(typeof reading !== "string" || reading.length <= 1) return null;
    const pattern = buildAccentPattern(accentType, reading);
    if(pattern.length <= 1) return null;
    return {
        accentType,
        pattern,
        particleAccent: accentType === 0,
        length: pattern.length,
    };
}

export function buildPitchAccentHtml(info, realWordLength, options = {}){
    if(!info) return "";
    const {pattern, particleAccent} = info;
    const unitCount = info.length ?? pattern.length;
    const includeParticleBox = options.includeParticleBox !== false;
    const marginPercent = options.particleMarginPercent ?? (-100 / Math.max(1, unitCount));
    const padTo = Number.isFinite(options.padTo) ? options.padTo : realWordLength;
    let html = "";

    for(let i = 0; i < unitCount; i++){
        const top = !!pattern[i];
        const bottom = !top;
        const left = i >= 1 ? pattern[i - 1] !== pattern[i] : false;
        let classString = "box";
        if(bottom) classString += " bottom";
        if(top) classString += " top";
        if(left) classString += " left";
        html += `<div class="${classString}"></div>`;
    }

    if(includeParticleBox){
        const bottom = !particleAccent;
        const top = particleAccent;
        const prev = unitCount ? pattern[unitCount - 1] : false;
        const left = prev !== particleAccent;
        let classString = `box ${options.homogenous ? '' : 'particle-box'}`;
        if(bottom) classString += " bottom";
        if(top) classString += " top";
        if(left) classString += " left";
        html += `<div class="${classString}" ${options.homogenous ? '' : `style="margin-right:${marginPercent}%;"`}></div>`;
    }

    if(padTo && padTo > unitCount){
        for(let i = unitCount; i < padTo; i++){
            html += '<div class="box"></div>';
        }
    }

    return html;
}
