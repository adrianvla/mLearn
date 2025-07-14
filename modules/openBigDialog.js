import {BrowserWindow} from "electron";

function openBigDialog(title,text) {
    const win = new BrowserWindow({
        width: 600,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
        <html>
        <head>
            <title>${title}</title>
            <style>
                body { font-family: "Helvetica Neue", sans-serif; font-size: 1.5em; padding: 2em;
    background:#2a2a2a;color:#aaa }
            </style>
        </head>
        <body>${text.replaceAll("\n","<br>")}</body>
        </html>
    `));
}

export {openBigDialog};
