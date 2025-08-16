import {settings} from "./settings/settings.js";
import $ from '../lib/jquery.min.js'

const show_notification = (m) => {
    let notification = $(`<div class="custom-notification">
        <div class="header">
            <div class="btn close"><img src="assets/icons/cross.svg"></div>
        </div>
        <div class="content">
            <span>${m}</span>
        </div>
    </div>`);
    notification.css("right","-100%");
    $("body").append(notification);
    //animate
    notification.animate({right: 10});
    notification.find(".close").click(()=>{
        notification.animate({right: "-100%"},()=>{notification.remove()});
    });
};

async function toUniqueIdentifier(nonLatinString) {
    // Encode the string into Base64
    const base64String = btoa(unescape(encodeURIComponent(nonLatinString)));

    // Convert the Base64 string to a Uint8Array
    const encoder = new TextEncoder();
    const data = encoder.encode(base64String);

    // Hash the data using SHA-256
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);

    // Convert the hash to a hexadecimal string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');

    return hashHex;
}

const randomUUID = () => {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};


const screenshotVideo = () => {
    try{
        let picture_data_url = "";
        let video = $("video").get(0);
        if(!video) throw "No video found";
        let canvas = document.createElement("canvas");
        let ctx = canvas.getContext("2d");
        let width = 480;
        let height = video.videoHeight * (width / video.videoWidth);
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        picture_data_url = canvas.toDataURL("image/jpeg",0.5);
        return picture_data_url;
    }catch(e){console.log(e);}
};



const blurWord = (newEl)=>{
    if(settings.blur_words){
        newEl.addClass("blur");
    }
};

function isNotAllKana(word) {
    // Regular expression to match any character that is not Hiragana or Katakana
    const nonKanaRegex = /[^\u3040-\u30FF]/;
    return nonKanaRegex.test(word);
}


const parseTime = (timeString,type) => {
    let timeRegex = null;
    if(type=="."){
        timeRegex = /(\d+):(\d{2}):(\d{2}\.\d{2})/;
    }else{
        timeRegex = /(\d+):(\d{2}):(\d{2},\d{3})/;
    }
    const match = timeRegex.exec(timeString);
    if (!match) {
        throw new Error('Invalid time format');
    }
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = parseFloat(match[3].replaceAll(",","."));
    return (hours * 3600) + (minutes * 60) + seconds;
}


window.mLearnIPC.onServerCriticalError((message) => {
    $(".critical-error-c").remove();
    $("body").append(`<div class="critical-error-c"><div class="critical-error"><span>${message}</span></div></div>`);
    $(".critical-error-c .restart-app").click(()=>{
        restartAppAndServer();
    });
});

export {show_notification, blurWord, isNotAllKana, randomUUID, screenshotVideo, toUniqueIdentifier, parseTime}