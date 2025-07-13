import {app, BrowserWindow, dialog, ipcMain, Menu} from "electron";
import path from "node:path";
import {isMac, isPackaged, isWindows, resPath} from "./archPlatform.js";
import {firstTimeSetup, isFirstTimeSetup, setFirstTimeSetup} from "./loadBackend.js";
import fs from "node:fs";
import {PORT, startWebSocketServer} from "./webServer.js";

let mainWindow;
let currentWindow = null;

let oldWindowState = {width:null, height:null, fullscreen:false, trafficLights:true};
const makeMainWindowPIP = (w,h) => {
    oldWindowState.width = mainWindow.getBounds().width;
    oldWindowState.height = mainWindow.getBounds().height;
    oldWindowState.fullscreen = mainWindow.isFullScreen();
    mainWindow.setBounds({ width: w, height: h, x: 50, y: 50 },true); // Adjust size and position
    mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
    mainWindow.setResizable(true); // Allow resizing if desired
    mainWindow.setFocusable(false); // Optional: Prevent focus on PiP mode
    mainWindow.setFullScreenable(false); // Disable fullscreen
    mainWindow.setMinimizable(false); // Disable minimize
    mainWindow.setWindowButtonVisibility(false);
    mainWindow.setFullScreen(false);
};

const makeMainWindowNormal = () => {
    mainWindow.setBounds({ width: oldWindowState.width, height: oldWindowState.height },true); // Adjust size and position
    mainWindow.setAlwaysOnTop(false); // Disable always on top
    mainWindow.setResizable(true); // Allow resizing
    mainWindow.setFocusable(true); // Allow focus
    mainWindow.setFullScreenable(true); // Enable fullscreen
    mainWindow.setMinimizable(true); // Enable minimize
    mainWindow.setWindowButtonVisibility(oldWindowState.trafficLights);
    mainWindow.setFullScreen(oldWindowState.fullscreen);
};

const createWindow = () => {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 700,
        webPreferences: {
            preload: path.join(resPath, '/pages/preload.js')
        },
        titleBarStyle: isMac ? 'hidden' : 'hiddenInset'
    });
    mainWindow.loadFile('pages/index.html');
    currentWindow = mainWindow;
}
const createWelcomeWindow = () => {

    let welcomeWindow = new BrowserWindow({
        width: 800,
        height: 700,
        webPreferences: {
            preload: path.join(resPath, '/pages/preload.js')
        }
    });
    welcomeWindow.loadFile('pages/welcome.html');
    currentWindow = welcomeWindow;
};

const createUpdateWindow = () => {
    let updateWindow = new BrowserWindow({
        width: 800,
        height: 400,
        webPreferences: {
            preload: path.join(resPath, '/pages/preload.js')
        }
    });
    updateWindow.loadFile('pages/update.html');
    currentWindow = updateWindow;
};


const appMenu = [
    {
        label: 'About mLearn',
        click: async () => {
            //if(serverLoaded)
            mainWindow.webContents.send('show-settings','About');
        }
    },
    { type: 'separator' },
    {
        label: 'Settings',
        click: async () => {
            // if(serverLoaded)
            mainWindow.webContents.send('show-settings');
        }
    },
    { type: 'separator' },
    { role: 'hide' },
    { type: 'separator' },
    { role: 'hideOthers' },
    { role: 'unhide' },
    { type: 'separator' },
    { role: 'quit' }
];

const template = [
    // { role: 'appMenu' }
    ...(isMac
        ? [{
            label: app.name,
            submenu: appMenu
        }]
        : []),
    // { role: 'fileMenu' }
    {
        label: 'File',
        submenu: [
            isMac ? { role: 'close' } : { role: 'quit' },
            ...(isMac
                    ? []
                    : appMenu
            )
        ]
    },
    // { role: 'editMenu' }
    {
        label: 'Edit',
        submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            ...(isMac
                ? [
                    { role: 'pasteAndMatchStyle' },
                    { role: 'delete' },
                    { role: 'selectAll' }
                ]
                : [
                    { role: 'delete' },
                    { type: 'separator' },
                    { role: 'selectAll' }
                ])
        ]
    },
    // { role: 'viewMenu' }
    {
        label: 'View',
        submenu: [
            {
                label: 'Open Live Word Translator',
                click: async () => {
                    mainWindow.webContents.send('show-aside');
                }
            },
            { type: 'separator' },
            { role: 'togglefullscreen' },
            ...(!isPackaged
                ? [
                    { label: 'Open DevTools', role: 'toggleDevTools' }
                ]
                : [
                ])

        ]
    },
    // { role: 'windowMenu' }
    {
        label: 'Window',
        submenu: [
            { role: 'minimize' },
            { role: 'zoom' },
            ...(isMac
                ? [
                    { type: 'separator' },
                    { role: 'front' },
                    { type: 'separator' },
                    { role: 'window' }
                ]
                : [
                    { role: 'close' }
                ])
        ]
    },
    {
        label: 'Video',
        submenu: [
            {
                label: 'Sync Subtitles with Video',
                click: async () => {
                    mainWindow.webContents.send('ctx-menu-command', 'sync-subs');
                }
            },
            {
                label: 'Copy Subtitle',
                click: async () => {
                    mainWindow.webContents.send('ctx-menu-command', 'copy-sub');
                }
            },
            ...(isMac ? [{ type: 'separator' }] : []),
            {
                label: 'Start Server (For Watch Together / Online Extension / Tethered Mode)', //TODO: add Tethered Mode
                click: async () => {
                    mainWindow.webContents.send('watch-together');
                    dialog.showMessageBox(null, {
                        type: 'info',
                        title: 'Watch Together',
                        message: 'Started Watch Together Server at \nhttp://127.0.0.1:'+PORT+'\n\nPlease port forward this device\'s 7753 port if you want to share it with others. \n\nGo to https://mlearn.morisinc.net/watch-together to join the session.\n\nIf you want to use the online extension, please paste the script into the DevTools console.',
                    });
                    startWebSocketServer(); //TODO: auto-run this
                }
            }
        ]
    }
];

const menu = Menu.buildFromTemplate(template);
Menu.setApplicationMenu(menu);


app.whenReady().then(() => {
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            if(isFirstTimeSetup){
                createWelcomeWindow();
            }else{
                createWindow();
            }
        }
    });
    if(isFirstTimeSetup){
        firstTimeSetup();
        return;
    }
    createWindow();

});


ipcMain.on('traffic-lights', (event, arg) => {
    if(!isWindows)
        mainWindow.setWindowButtonVisibility(arg.visibility);
    oldWindowState.trafficLights = arg.visibility;
});

ipcMain.on('changeWindowSize', (event, arg) => {
    mainWindow.setSize(arg.width, arg.height, true);
});

ipcMain.on('make-pip', (event, arg) => {
    makeMainWindowPIP(arg.width, arg.height);
});
ipcMain.on('make-normal', (event) => {
    makeMainWindowNormal();
});

ipcMain.on('show-ctx-menu', (event) => {
    const template = [
        {
            label: 'Sync Subtitles with Video',
            click: () => { event.sender.send('ctx-menu-command', 'sync-subs') }
        },
        {
            label: 'Open Live Word Translator',
            click: () => {mainWindow.webContents.send('show-aside');}
        },
        {
            type: 'separator'
        },
        {
            label: 'Copy Subtitle',
            click: () => { event.sender.send('ctx-menu-command', 'copy-sub') }
        }
        // { type: 'separator' },
        // { label: 'Menu Item 2', type: 'checkbox', checked: true }
    ];
    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
});
export {createWindow, createWelcomeWindow, createUpdateWindow, currentWindow, mainWindow};