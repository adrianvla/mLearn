import { execFile } from 'child_process';
import type { LanguageTtsRuntimeConfig } from '../../shared/types';

/** A language package selects its native voice; OS defaults cannot establish source-language support. */
export function systemVoiceForRuntime(runtime: LanguageTtsRuntimeConfig, platform: NodeJS.Platform): string {
  const voice = platform === 'darwin' ? runtime.macosVoice : platform === 'linux' ? runtime.espeakVoice : runtime.windowsVoice;
  if (typeof voice !== 'string' || !voice.trim()) throw new Error('System TTS voice is not declared by this language package for the current platform');
  return voice.trim();
}

function enumerate(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => execFile(command, args, { encoding: 'utf8' }, (error, stdout) => error ? reject(error) : resolve(stdout)));
}

/** Readiness enumerates installed voices without speaking or inferring a voice from the language code. */
export async function ensureSystemTtsRuntimeReady(runtime: LanguageTtsRuntimeConfig, platform: NodeJS.Platform = process.platform): Promise<void> {
  const voice = systemVoiceForRuntime(runtime, platform);
  if (platform === 'darwin') {
    const installed = await enumerate('say', ['-v', '?']);
    if (!installed.split('\n').some(line => line.match(/^(.+?)\s+[a-z]{2,3}_[A-Za-z0-9_-]+\s+#/)?.[1]?.trim() === voice)) throw new Error(`System TTS voice is unavailable: ${voice}`);
  } else if (platform === 'linux') {
    let installed: string;
    try { installed = await enumerate('espeak-ng', ['--voices']); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      installed = await enumerate('espeak', ['--voices']);
    }
    if (!installed.split('\n').some(line => { const fields = line.trim().split(/\s+/); return fields[1] === voice || fields[3] === voice || fields[4] === voice; })) throw new Error(`System TTS voice is unavailable: ${voice}`);
  } else if (platform === 'win32') {
    const installed = JSON.parse(await enumerate('powershell', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ConvertTo-Json -InputObject @($s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }); $s.Dispose()'])) as unknown;
    if (!Array.isArray(installed) || !installed.includes(voice)) throw new Error(`System TTS voice is unavailable: ${voice}`);
  } else throw new Error(`System TTS is unavailable on platform ${platform}`);
}
