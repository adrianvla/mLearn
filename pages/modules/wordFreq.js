
let foundFreq = {};
const countFreq = (freq) => {
    if(freq in foundFreq) {
        foundFreq[freq]++;
    }else{
        foundFreq[freq] = 1;
    }
};

export {foundFreq, countFreq}