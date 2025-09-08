import SimplePeer from '../../../lib/simplepeer.min.js';
import J from '../../../lib/jquery.min.js';
import QRCode from "../../../lib/qrcode.js";
import {getDocument, openWindow} from "./window.js";
import {startConnectionByQR, stopDetection} from "./detectQR.js";
import {onFlashcards, sync} from "./sync.js";
export const $ = s=>J(s,getDocument());



let peer = null;
// Function to connect to another peer using their signal data
export function connectToPeer(otherPeerSignal) {
    try {
        const signalData = typeof otherPeerSignal === 'string' ? JSON.parse(otherPeerSignal) : otherPeerSignal;
        peer.signal(signalData);
        console.log('Connecting to peer...');
    } catch (e) {
        console.error('Invalid peer signal data:', e);
    }
}

function transmitByQR(data){
    let el = getDocument().getElementById("qrcode");
    el.innerHTML = "";
    let qrcode = new QRCode(el, {
        text: data,
        width: 650,
        height: 650,
        colorDark : "#000",
        colorLight : "#ffffff",
        // correctLevel : QRCode.CorrectLevel.H
    });
}
function splitInChunks(str, n) {
    if (n <= 0) throw new Error("Number of chunks must be greater than 0");
    const chunkSize = Math.ceil(str.length / n);
    const chunks = [];
    for (let i = 0; i < str.length; i += chunkSize) {
        chunks.push(str.slice(i, i + chunkSize));
    }
    return chunks;
}
let chunkedData = [];
let chunkIndex = 0;
let chunkInterval = null;
let numberOfChunks = 30;
function transmitByQRChunks(data){
    clearInterval(chunkInterval);

    //calculate number of chunks needed
    numberOfChunks = Math.ceil(data.length / 60);
    chunkIndex = 0;
    chunkedData = splitInChunks(data, numberOfChunks);
    const tick = ()=>{
        chunkIndex++;
        chunkIndex = chunkIndex % chunkedData.length;
        transmitByQR(JSON.stringify([
            chunkIndex,
            chunkedData[chunkIndex]
        ]));
    };
    chunkInterval = setInterval(tick, 50);
    tick();
}
export function stopTransmitByQRChunks(){
    clearInterval(chunkInterval);
}

export function destroy(){
    try{
        if(peer) peer.destroy();
    }catch(e){console.log(e)}
    stopTransmitByQRChunks();

}

let collectedChunks = {};

export const collectChunk = (chunk)=>{
    try{chunk = JSON.parse(chunk);}catch(e){
        console.log("Invalid chunk received: " + chunk);
        return;
    }
    collectedChunks[chunk[0]] = chunk[1];
    getDocument().getElementById('progress').style.width = (Object.keys(collectedChunks).length / numberOfChunks * 100)+"%";
    console.log("Collected chunk " + chunk[0] + " of " + numberOfChunks);
    if(Object.keys(collectedChunks).length === numberOfChunks){
        console.log("All chunks collected");
        //concat data
        let data = "";
        for(let i = 0; i < numberOfChunks; i++){
            data += collectedChunks[i];
        }
        console.log(collectedChunks, JSON.parse(data));
        peer.signal(JSON.parse(data));
        collectedChunks = {};
        getDocument().querySelector('.progress-c').style.display = 'none';
        getDocument().getElementById('progress').style.display = "none";
    }
};

export function openConnection(){
    console.log("Opening connection");
    openWindow();
// Create a peer in initiator mode (to generate a peer ID)
    try{
        if(peer) peer.destroy();
    }catch(e){console.log(e)}
    peer = new SimplePeer({ initiator: true, trickle: false });

// Print your peer ID (signal data) to the console when ready
    peer.on('signal', data => {
        //split data into 2 parts
        console.log('Your peer ID (signal data):', data);
        transmitByQRChunks(JSON.stringify(data));
        $("#qrcode,button").show();
        $("span#additional-info").html(`Enter <b>${numberOfChunks}</b> in the mLearn app, then`);
        $("span#other-info").text("scan this with it to connect.");
        $("button").on("click",()=>{
            $("#qrcode,button").hide();
            $("span#other-info").text("Point your camera at the QR code to connect.");
            $("span#additional-info").hide();
            stopTransmitByQRChunks();
            startConnectionByQR();

        });
    });
    function processEvent(d){
        if (typeof d !== 'string') d = d.toString();
        try {
            d = JSON.parse(d);
        } catch (e) {
            console.log('Invalid event data:', d);
            return;
        }
        switch(d.type){
            case "ping":
                break;
            case "sync-chunk":
                // onFlashcards(peer, d.data);
                processChunk(d.data);
                break;
        }
    }
    let queuedEvents = [];

    let chunks = {};

    function processChunk(c){
        //[index, data, total]
        console.log("Got chunk",c[0]);
        chunks[c[0]] = c[1];
        const total = c[2];
        if(Object.keys(chunks).length < total) return;
        let data = "";
        for(let i = 0; i < total; i++){
            if(!(i in chunks)) {
                console.error("Missing chunk", i, chunks);
                return;
            }
            data += chunks[i];
        }
        onFlashcards(peer, JSON.parse(data));
    }
// Listen for connection
    let isConnected = false;
    peer.on('connect', () => {
        console.log('Connected to peer!');
        $("span").text("Connected!");
        peer.send('{"type":"ping"}');
        $("video").hide();
        stopDetection();
        sync(peer); //sends wordFreq
        queuedEvents.forEach(processEvent);
        queuedEvents = [];
        isConnected = true;
    });


// Listen for data (optional)
    peer.on('data', d => {
        const str = (typeof d === 'string') ? d : d.toString();
        if(!isConnected) queuedEvents.push(str);
        else processEvent(str);
    });

}

export function Peer(){
    return peer;
}