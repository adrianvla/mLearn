import {pythonChildProcess, serverLoaded} from "./loadBackend.js";
import {app, ipcMain} from "electron";

const restartApp = () => {
    if(!serverLoaded) return;
    pythonChildProcess.kill("SIGINT");
    console.log("Restarting app");
    setTimeout(() => {
        app.relaunch();
        app.exit();
    },1000);
};


const restartAppForce = () => {
    if(pythonChildProcess)
        pythonChildProcess.kill("SIGINT");
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