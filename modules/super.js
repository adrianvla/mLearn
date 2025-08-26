import {pythonChildProcess, serverLoaded} from "./loadBackend.js";
import {app, ipcMain} from "electron";
import http from "http";

const restartApp = () => {
    if(!serverLoaded) return;
    killPython();
    console.log("Restarting app");
    setTimeout(() => {
        app.relaunch();
        app.exit();
    },1000);
};


const restartAppForce = () => {
    killPython();
    console.log("Restarting app");
    setTimeout(() => {
        app.relaunch();
        app.exit();
    },1000);
};

ipcMain.on('restart-app', (event) => {
    restartApp();
});
ipcMain.on('restart-app-force',(event)=>{
    restartAppForce();
});

export const killPython = () => {
    const options = {
        hostname: '127.0.0.1',
        port: 7752,
        path: '/quit',
        method: 'POST',
        timeout: 2000
    };
    const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
            console.log('killPython response:', res.statusCode, data);
        });
    });
    req.on('error', (err) => {
        console.error('killPython error:', err.message);
    });
    req.end();
    if(pythonChildProcess)
        pythonChildProcess.kill("SIGINT");
}