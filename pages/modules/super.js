import {settings} from "./settings/settings.js";

let restarting = false;
const restartAppAndServer = ()=>{
    if(restarting) return;
    restarting = true;
    window.electron_settings.restartApp();
    const xhr = new XMLHttpRequest();
    // xhr.addEventListener('error', () => reject('failed to issue request'));
    xhr.addEventListener('load', () => {
    });

    xhr.open('POST', settings.tokeniserUrl.replace("/tokenise","/quit"));
    //send json
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send("{}");
};

export {restartAppAndServer};