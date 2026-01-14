import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS } from '../shared/constants';

contextBridge.exposeInMainWorld('electronAPI', {
  getVersion: () => ipcRenderer.invoke(CHANNELS.GET_VERSION),
  sendMessage: (message: string) => ipcRenderer.send(CHANNELS.SEND_MESSAGE, message),
});
