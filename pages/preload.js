const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron_settings', {
    getSettings: () => ipcRenderer.send('get-settings'),
    getLangData: () => ipcRenderer.send('get-lang-data'),
    saveSettings: (settings) => ipcRenderer.send('save-settings', settings),
    changeTrafficLights: (visibility) => ipcRenderer.send('traffic-lights', { visibility: visibility }),
    resizeWindow: (size) => ipcRenderer.send('changeWindowSize', size),
    showCtxMenu: () => ipcRenderer.send('show-ctx-menu'),
    showContact: () => ipcRenderer.send('show-contact'),
    restartApp: () => ipcRenderer.send('restart-app'),
    forceRestartApp: () => ipcRenderer.send('restart-app-force'),
    isLoaded: () => ipcRenderer.send('is-loaded'),
    isSuccess: () => ipcRenderer.send('is-successful-install'),
    installLanguage: (url) => ipcRenderer.send('install-lang', url),
    writeToClipboard: (text) => ipcRenderer.send('write-to-clipboard', text),
    makePiP: (size) => ipcRenderer.send('make-pip',size),
    unPiP: () => ipcRenderer.send('make-normal'),
    isWatchingTogether: () => ipcRenderer.send('is-watching-together'),
    watchTogetherSend: (message) => ipcRenderer.send('watch-together-send', message),
    onSettings: (callback) => ipcRenderer.on('settings', (event, settings) => callback(settings)),
    onLangData: (callback) => ipcRenderer.on('lang-data', (event, data) => callback(data)),
    onSettingsSaved: (callback) => ipcRenderer.on('settings-saved', (event, message) => callback(message)),
    onServerLoad: (callback) => ipcRenderer.on('server-load', (event, message) => callback(message)),
    onServerStatusUpdate: (callback) => ipcRenderer.on('server-status-update', (event, message) => callback(message)),
    onServerCriticalError: (callback) => ipcRenderer.on('server-critical-error', (event, message) => callback(message)),
    onOpenSettings: (callback) => ipcRenderer.on('show-settings', (event, message) => callback(message)),
    onOpenAside: (callback) => ipcRenderer.on('show-aside', (event, message) => callback(message)),
    onContextMenuCommand: (callback) => ipcRenderer.on('ctx-menu-command', (event, message) => callback(message)),
    onLanguageInstalled: (callback) => ipcRenderer.on('lang-installed', (event, message) => callback(message)),
    onLanguageInstallError: (callback) => ipcRenderer.on('lang-install-error', (event, message) => callback(message)),
    onPythonSuccess: (callback) => ipcRenderer.on('successful-install', (event, message) => callback(message)),
    onWatchTogetherLaunch: (callback) => ipcRenderer.on('watch-together', (event, message) => callback(message)),
    onWatchTogetherRequest: (callback) => ipcRenderer.on('watch-together-request', (event, message) => callback(message)),
});

window.addEventListener('DOMContentLoaded', () => {
    const replaceText = (selector, text) => {
        const element = document.getElementById(selector);
        if (element) element.innerText = text
    }

    for (const dependency of ['chrome', 'node', 'electron']) {
        replaceText(`${dependency}-version`, process.versions[dependency]);
    }
});

