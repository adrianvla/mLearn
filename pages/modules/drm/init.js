import './blockVideo.js';
import {saveSettings} from "../settings/settings.js";

let license = 0;
let licenseActivateCallbacks = [];

document.addEventListener('DOMContentLoaded', () => {
    window.electron_settings.getLicenseType();
});

window.electron_settings.onLicenseGet((message) => {
    license = message;
    console.log("%cLicense type received:", "color:lightblue", license);
});

function getLicenseType() {
    return 1;
    // return license;
}
function isLicenseActive() {
    return license > 0;
}

function activateLicense(key){
    return new Promise((resolve, reject) => {
        window.electron_settings.activateLicense(key);
        licenseActivateCallbacks.push({resolve, reject});
    });
}

window.electron_settings.onLicenseActivated((message) => {
    license = message.license;
    for(let i = 0; i < licenseActivateCallbacks.length; i++) {
        const callback = licenseActivateCallbacks[i];
        if (message.status) {
            callback.resolve(message.license);
            console.log("%cLicense activated successfully:", "color:lightgreen", message.license);
        } else {
            callback.reject(message.error);
            console.error("%cLicense activation failed:", "color:red", message);
        }
    }
    licenseActivateCallbacks = [];
});


function getLicenseName() {
    switch (getLicenseType()) {
        case 0:
            return "Free";
        case 1:
            return "Pro";
        default:
            return "Unknown";
    }
}

//for debug
function removeLicense() {
    license = 0;
    settings.MLEARN_LICENSE_SECRET = "";
    settings.licenseKey = "";
    saveSettings();
    window.electron_settings.removeLicense();
}
window.removeLicense = removeLicense;


export { getLicenseType, activateLicense, isLicenseActive, getLicenseName};