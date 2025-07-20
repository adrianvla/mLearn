import crypto from 'crypto';
import {loadSettings, saveSettings} from '../settings.js';
import {ipcMain} from "electron";
import {mainWindow} from "../allWindows.js";


let license = 0;
//license: // 0 = free, 1 = pro

ipcMain.on('remove-license', (event) => {
    let settings = loadSettings();
    license = 0;
    settings.MLEARN_LICENSE_SECRET = "";
    settings.licenseKey = "";
    saveSettings(settings);
});

function ensureEncryptionKeyInSettings() {
    let settings = loadSettings();
    if (!settings.MLEARN_LICENSE_SECRET) {
        settings.MLEARN_LICENSE_SECRET = crypto.randomBytes(32).toString('hex');
        saveSettings(settings);
    }
    return settings.MLEARN_LICENSE_SECRET;
}

const ENCRYPTION_KEY = crypto.createHash('sha256').update(ensureEncryptionKeyInSettings() || '').digest(); // Set LICENSE_SECRET in your environment
const IV = Buffer.alloc(16, 0); // Initialization vector (should be random in production)

const encrypt = (text) => {
    const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, IV);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
};

const decrypt = (encrypted) => {
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, IV);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
};

const checkLicense = (key) => {
    //placeholder to fetch from server
    return new Promise((resolve, reject) => {
        // Simulate a license check
        console.log('Checking license...', key);
        setTimeout(() => {
            resolve(1); //I have the pro version
        }, 1000);
    });
};

const init = async () => {
    try {
        let settings = loadSettings();
        const encryptedKey = settings.licenseKey;
        if (encryptedKey && encryptedKey.length > 0) {
            let key;
            try {
                key = decrypt(encryptedKey);
            } catch (e) {
                console.error('Failed to decrypt license key:', e);
                license = 0;
                return;
            }
            const status = await checkLicense(key);
            license = status;
            console.log(status === 1 ? 'Pro license detected.' : 'Free license.');
        } else {
            license = 0; // free
            console.log('Free license.');
        }
    } catch (err) {
        license = 0;
        console.error('License check failed:', err);
    }
};

const activateLicense = async (plainKey) => {
    try {
        const encryptedKey = encrypt(plainKey);
        let settings = loadSettings();
        settings.licenseKey = encryptedKey;
        saveSettings(settings);
        // Check license with server
        const status = await checkLicense(plainKey);
        license = status;
        console.log('License key activated. Status:', status === 1 ? 'Pro' : 'Free');
        return {status: true, license: status};
    } catch (err) {
        console.error('Failed to activate license key:', err);
        return {status: false, license: license, error: err};
    }
};

const getLicenseStatus = () => {
    return license;
}

(async function(){
    await init();
    mainWindow.webContents.send('license-type', getLicenseStatus());
})();

ipcMain.on('get-license-type', (event) => {
    event.reply('license-type', getLicenseStatus());
});

ipcMain.on('activate-license', async (event, key) => {
    let u = await activateLicense(key);
    event.reply('license-activated', u);
});