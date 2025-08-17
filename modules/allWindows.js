import {app, BrowserWindow, clipboard, dialog, ipcMain, Menu, shell} from "electron";
import path from "node:path";
import {isMac, isPackaged, isWindows, resPath} from "./archPlatform.js";
import {firstTimeSetup, isFirstTimeSetup, setFirstTimeSetup} from "./loadBackend.js";
import fs from "node:fs";
import {PORT, setAllowed, startWebSocketServer} from "./webServer.js";
import {openBigDialog} from "./openBigDialog.js";
import {initDRMIPC} from "./drm/init.js";

let mainWindow;
let currentWindow = null;

export const getCurrentWindow = () => currentWindow;
export const getMainWindow = () => mainWindow;

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
            preload: path.join(resPath, '/pages/IPC/preload.js')
        },
        titleBarStyle: isMac ? 'hidden' : 'hiddenInset'
    });
    mainWindow.loadFile('pages/index.html');
    currentWindow = mainWindow;
    initDRMIPC();
}
const createWelcomeWindow = () => {

    let welcomeWindow = new BrowserWindow({
        width: 800,
        height: 700,
        webPreferences: {
            preload: path.join(resPath, '/pages/IPC/preload.js')
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
            preload: path.join(resPath, '/pages/IPC/preload.js')
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
            {
                label: 'Settings',
                click: async () => {
                    mainWindow.webContents.send('show-settings');
                }
            },
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
            // ...(isMac ? [{ type: 'separator' }] : []),
        ]
    },
    {
        label: 'Connect',
        submenu: [
            {
                label: 'Allow Connections',
                click: async () => {
                    mainWindow.webContents.send('watch-together');
                    setAllowed(true);
                    dialog.showMessageBox(null, {
                        type: 'info',
                        title: 'Allowed Connections to Server!',
                        message: 'Allowed connections to \nhttp://127.0.0.1:'+PORT+`.\n\nFor more information, open the Help menu.`
                    });
                }
            },
            {
                label: 'Copy Page Injector Script',
                click: async () => {
                    let text = '';
                    try {
                        text = fs.readFileSync(path.join(resPath, 'modules', 'scripts', 'injector.js'), 'utf-8');
                    }catch(e){console.log(e);}
                    clipboard.writeText(text);
                    dialog.showMessageBox(null, {
                       type: 'info',
                       title: 'Copied!',
                       message: 'Copied!\n\nMore information about how to use it in Online Browser Mode is available in the Help menu.'
                    });
                }
            },
            {
                label: 'Install UserScript',
                click: async ()=>{
                    dialog.showMessageBox(null, {
                        type:'question',
                        title: 'Install UserScript',
                        message: 'To use mLearn in Online Browser Mode, you need to install the mLearn UserScript on your browser.',
                        buttons: ['Proceed', 'No'],
                        defaultId: 0,
                        cancelId: 1
                    }).then((result) => {
                        if (result.response !== 0) return;
                        shell.openExternal(`http://127.0.0.1:${PORT}/mLearn.user.js`);
                    });
                }
            }
        ]
    },
    {
        label: 'Help',
        submenu: [
            {
                label: 'About Watch Together',
                click: async () => {
                    openBigDialog("Help - About Watch Together", `
                        Watch Together is a feature that allows you to watch videos with others in real-time. You can use it to share your video watching experience with friends or family, no matter where they are.\n\nTo use it, first Allow Connections (in the Connect menu).\nThen, this device's ${PORT} port if you want to use Watch Together with others.\nGo to https://mlearn.morisinc.net/watch-together to join the session.\n\nIf you are using mLearn in Online Browser mode, on the other device using the Userscript, paste the port-forwarded URL into the dialog. 
                    `);
                }
            },
            {
                label: 'About Online Browser Mode',
                click: async () => {
                    openBigDialog("Help - About Online Browser Mode", `
                        Online Browser Mode allows you to use mLearn in a browser with a video. \nYou just have to right-click on the video, then click "Inspect Element" to open the browser's DevTools.\nThen, go to the Console tab and paste the script that you can copy by clicking "Copy Page Injector Script" in the Connect menu.\n\nThis will inject mLearn into the page, allowing you to use it with the video.\n\nTo interact with it, right-click on the video.
                    `);
                }
            },
            {
                label: 'About mLearn Tethered Mode',
                click: async () => {
                    openBigDialog("Help - About Online Browser Mode", `
                        mLearn Tethered Mode allows you to use mLearn on a different device, such as a phone or a tablet, even if it's not your own device!\nIf you want to watch together with someone else, they will have to install the mLearn UserScript on their browser, and then paste your port-forwarded URL into the dialog that appears on every page that has a video in it (click Install UserScript for more details).\n\nTo use it, first Allow Connections (in the Connect menu).\nThen, copy the port-forwarded URL and paste it into the dialog that appears on the other device.\n\nYou can also use it to watch videos on your own device, but you will have to install the mLearn UserScript on your browser.
                    `);
                }
            },
            ...(isMac ? [{ type: 'separator' }] : []),
            {
                label: 'How to use mLearn on Mobile',
                click: async () => {
                    openBigDialog("Help - mLearn Mobile ", `
                        mLearn Mobile is mLearn running in Tethered Mode. You'll have to install the mLearn UserScript on your mobile device's browser to use it.\n\nmLearn will have to be running on your computer, and you will have to Allow Connections (in the Connect menu), in order for it to work.\n\nFor more information on how to install UserScripts on Mobile, please refer to this Help menu.
                    `);
                }
            },
            {
                label: 'How to install mLearn on Mobile',
                click: async () =>{
                    openBigDialog("Help - How to install mLearn on Mobile", `
                        You'll have to port-forward port ${PORT} of this computer. \nYou can use a service like ngrok or localtunnel to do this.\n\nFor ngrok, you can use the command:\n\n<pre>ngrok http ${PORT}</pre>\n\nThis will give you a URL that you can use to access mLearn from your mobile device.\n\nThen, you can open the URL in your mobile browser and install the mLearn UserScript from there.\n\nYou'll have to have an extension that supports UserScripts, such as Tampermonkey installed on your mobile browser.\n\nOnce you have installed the UserScript, you can use mLearn on your mobile device.
                    `);
                }
            },
            ...(isMac ? [{ type: 'separator' }] : []),
            {
                label: 'Troubleshooting mLearn in Browser/Tethered Mode',
                click: async () =>{
                    openBigDialog("Help - Troubleshooting mLearn in Browser/Tethered Mode", `
                        Some websites with advanced security (like youtube.com) may not allow mLearn to run properly.\n\nIf you are having issues with mLearn in Browser/Tethered Mode, try the following:\n\nInstall an extension that would disable the website's security features, such as <a href="https://chromewebstore.google.com/detail/disable-content-security/ieelmcmcagommplceebfedjlakkhpden">Disable CSP</a> or <a href="https://chromewebstore.google.com/detail/allow-cors-access-control/lhobafahddgcelffkeicbaginigeejlf">Allow CORS</a>. These extensions may put at risk your browsing security, if you'll go on e-Banking websites or other websites that require high security, so only enable those extensions when you are using mLearn in Browser/Tethered Mode on a specific website.\n\nIf you are using mLearn in Tethered Mode, make sure that the port-forwarded URL is correct and that the mLearn UserScript is installed on your mobile browser.
                    `);
                }
            },
            ...(isMac ? [{ type: 'separator' }] : []),
            {
                label: 'About mLearn',
                click: async () => {
                    mainWindow.webContents.send('show-settings','About');
                }
            },
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