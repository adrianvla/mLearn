/**
 * Speech Service
 * Handles STT (Speech-to-Text) and TTS (Text-to-Speech) via system APIs
 *
 * This is a lightweight implementation that uses:
 * - Web Speech API (renderer-side) for STT — forwarded via IPC
 * - say command (macOS) / espeak (Linux) for TTS
 *
 * A future version could integrate sherpa-onnx-node for offline models.
 */

import { ipcMain, type IpcMainEvent } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { execFile, type ChildProcess } from 'child_process';
import { isMac, isLinux } from '../utils/platform';

let ttsProcess: ChildProcess | null = null;

/**
 * Speak text using system TTS
 */
function speak(text: string, language: string, sender: Electron.WebContents): void {
  // Kill existing TTS if running
  stopSpeaking();

  if (!text.trim()) return;

  // Notify renderer that speaking started
  if (!sender.isDestroyed()) {
    sender.send(IPC_CHANNELS.TTS_STATUS, { speaking: true, progress: 0 });
  }

  const sanitized = text.replace(/\n/g, ' ').substring(0, 500);

  if (isMac) {
    // macOS: use built-in `say` command
    // Map language codes to macOS voice names
    const voiceMap: Record<string, string> = {
      ja: 'Kyoko',
      zh: 'Ting-Ting',
      ko: 'Yuna',
      en: 'Samantha',
      es: 'Monica',
      fr: 'Thomas',
      de: 'Anna',
      it: 'Alice',
      pt: 'Luciana',
      ru: 'Milena',
    };

    const voice = voiceMap[language] || voiceMap.en;
    ttsProcess = execFile('say', ['-v', voice, sanitized], () => {
      ttsProcess = null;
      if (!sender.isDestroyed()) {
        sender.send(IPC_CHANNELS.TTS_STATUS, { speaking: false, progress: 1 });
      }
    });
  } else if (isLinux) {
    // Linux: try espeak
    ttsProcess = execFile('espeak', ['-v', language, sanitized], () => {
      ttsProcess = null;
      if (!sender.isDestroyed()) {
        sender.send(IPC_CHANNELS.TTS_STATUS, { speaking: false, progress: 1 });
      }
    });
  } else {
    // Windows: use PowerShell
    const psCommand = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak('${sanitized.replace(/'/g, "''")}')`;
    ttsProcess = execFile('powershell', ['-Command', psCommand], () => {
      ttsProcess = null;
      if (!sender.isDestroyed()) {
        sender.send(IPC_CHANNELS.TTS_STATUS, { speaking: false, progress: 1 });
      }
    });
  }
}

/**
 * Stop any current TTS playback
 */
function stopSpeaking(): void {
  if (ttsProcess) {
    ttsProcess.kill();
    ttsProcess = null;
  }
}

/**
 * Register IPC handlers for speech
 */
export function setupSpeechIPC(): void {
  // TTS
  ipcMain.on(IPC_CHANNELS.TTS_SPEAK, (event: IpcMainEvent, text: string, language: string) => {
    speak(text, language, event.sender);
  });

  ipcMain.on(IPC_CHANNELS.TTS_STOP, () => {
    stopSpeaking();
  });

  // STT: handled entirely in the renderer via Web Speech API
  // These IPC channels exist for future native STT integration
  ipcMain.on(IPC_CHANNELS.STT_START, (_event: IpcMainEvent, _language: string) => {
    // Future: start native STT engine
  });

  ipcMain.on(IPC_CHANNELS.STT_STOP, () => {
    // Future: stop native STT engine
  });
}
