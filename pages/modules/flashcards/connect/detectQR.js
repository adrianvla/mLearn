import {collectChunk} from "./openConnection.js";
import {getDocument} from "./window.js";
import jsQR from '../../../lib/jsqr.min.js';

let stopVideo = false;
let stopCamera = null;
export const startConnectionByQR = () => {
    let stream = null;
    const video = getDocument().getElementById('qr-video');
    if (!video) return;
    video.style.display = 'block';
    stopVideo = false;

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(s => {
            stream = s;
            video.srcObject = stream;
            video.setAttribute('playsinline', true); // for iOS
            video.play();
            requestAnimationFrame(tick);
        })
        .catch(err => {
            alert('Camera access denied or not available.');
        });

    stopCamera = ()=> {
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
        }
        video.style.display = 'none';
        $(video).off();
    };

    function tick() {
        if(stopVideo){
            stopVideo = false;
            return;
        }
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            const canvas = getDocument().createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, canvas.width, canvas.height);
            if (code) {
                // QR code detected
                console.log('QR code detected:', code);
                if (code.data && code.data.trim() !== '') {
                    collectChunk(code.data);
                } else {
                    console.warn('QR code detected but data is empty:', code);
                }
            }
        }
        requestAnimationFrame(tick);
    }
};

export function stopDetection(){
    stopCamera();
    stopVideo = true;
}