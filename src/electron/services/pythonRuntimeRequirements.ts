import { spawn } from 'child_process';
import type { InstallOptions, LanguageDataMap } from '../../shared/types';
import { getLanguagePythonRequirementsForInstall } from '../../shared/languageFeatures';
import { getLogger } from '../../shared/utils/logger';
import { getPipCommandCandidates, type PipCommand } from './pythonRuntimePaths';

const log = getLogger('electron.pythonRuntimeRequirements');

function installRequirements(command: PipCommand, requirements: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const pipProcess = spawn(command.command, [...command.argsPrefix, 'install', ...requirements], {
      cwd: command.cwd,
    });

    pipProcess.stdout?.on('data', (data) => {
      log.info(`pip: ${data.toString().trim()}`);
    });
    pipProcess.stderr?.on('data', (data) => {
      log.warn(`pip: ${data.toString().trim()}`);
    });
    pipProcess.on('error', reject);
    pipProcess.on('close', (code) => {
      if (code === 0 || code === null) {
        resolve();
        return;
      }
      reject(new Error(`pip exited with code ${code}`));
    });
  });
}

export async function ensureLanguagePythonRequirementsInstalled(
  language: string,
  langData: LanguageDataMap,
  options: InstallOptions,
): Promise<void> {
  const data = langData[language];
  if (!data) return;

  const requirements = getLanguagePythonRequirementsForInstall({ [language]: data }, options);
  if (requirements.length === 0) return;

  const [pipCommand] = getPipCommandCandidates();
  if (!pipCommand) {
    throw new Error(`Cannot install Python requirements for ${language}; the local Python runtime is not installed.`);
  }

  await installRequirements(pipCommand, requirements);
}
