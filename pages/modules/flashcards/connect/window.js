import {$, destroy, stopTransmitByQRChunks} from "./openConnection.js";

let myWindow = null;
let hasLoaded = false;
export function openWindow(){
    if(myWindow) return;
    myWindow = window.open("connectQR.html", "QRWindow", "width=768,height=900");
    const winRef = myWindow;
    winRef.addEventListener('unload', () => {
        if(!hasLoaded) return;
        if (myWindow === winRef) myWindow = null;
        hasLoaded = false;
        destroy();
    });
    winRef.onload = () => {
        hasLoaded = true;
    };
}

export function closeWindow(){
    myWindow.close();
}
export function getDocument(){return myWindow.document;}