import { spawn } from 'child_process';
import path from 'path';
import type { InstallOptions, LanguageDataMap } from '../../shared/types';
import {
  getLanguagePythonImportChecksForInstall,
  getLanguagePythonRequirementsForInstall,
} from '../../shared/languageFeatures';
import { getLogger } from '../../shared/utils/logger';
import { getPipCommandCandidates, type PipCommand } from './pythonRuntimePaths';
import { isWindows } from '../utils/platform';

const log = getLogger('electron.pythonRuntimeRequirements');

interface LanguagePythonRequirementInstallCallbacks {
  onStatus?: (message: string) => void;
}

function emitStatus(callbacks: LanguagePythonRequirementInstallCallbacks | undefined, message: string): void {
  callbacks?.onStatus?.(message);
}

function installRequirements(
  command: PipCommand,
  requirements: string[],
  callbacks?: LanguagePythonRequirementInstallCallbacks,
): Promise<void> {
  return new Promise((resolve, reject) => {
    emitStatus(callbacks, `Installing language Python packages: ${requirements.join(', ')}`);
    const pipProcess = spawn(command.command, [...command.argsPrefix, 'install', ...requirements], {
      cwd: command.cwd,
    });

    pipProcess.stdout?.on('data', (data) => {
      const message = data.toString().trim();
      log.info(`pip: ${message}`);
      if (message) emitStatus(callbacks, message);
    });
    pipProcess.stderr?.on('data', (data) => {
      const message = data.toString().trim();
      log.warn(`pip: ${message}`);
      if (message) emitStatus(callbacks, message);
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

function getPythonCommandForRuntime(command: PipCommand): { command: string; argsPrefix: string[] } {
  const basename = path.basename(command.command).toLowerCase();
  if (isWindows || basename.startsWith('python')) {
    return { command: command.command, argsPrefix: [] };
  }

  return {
    command: path.join(command.cwd, 'bin', 'python3'),
    argsPrefix: [],
  };
}

function verifyImportChecks(
  command: PipCommand,
  imports: string[],
  callbacks?: LanguagePythonRequirementInstallCallbacks,
): Promise<void> {
  if (imports.length === 0) return Promise.resolve();
  emitStatus(callbacks, `Verifying language Python imports: ${imports.join(', ')}`);
  const pythonCommand = getPythonCommandForRuntime(command);
  const script = `
import importlib
import json
import sys

failed = []
for module_name in json.loads(sys.argv[1]):
    try:
        importlib.import_module(module_name)
    except Exception as exc:
        failed.append(f"{module_name}: {exc}")

if failed:
    for failure in failed:
        print(f"FAIL:{failure}")
    raise SystemExit(1)
`.trim();

  return new Promise((resolve, reject) => {
    const verifyProcess = spawn(
      pythonCommand.command,
      [...pythonCommand.argsPrefix, '-c', script, JSON.stringify(imports)],
      { cwd: command.cwd },
    );
    let output = '';
    verifyProcess.stdout?.on('data', (data) => { output += data.toString(); });
    verifyProcess.stderr?.on('data', (data) => { output += data.toString(); });
    verifyProcess.on('error', reject);
    verifyProcess.on('close', (code) => {
      if (code === 0 || code === null) {
        resolve();
        return;
      }
      reject(new Error(`Python requirement import checks failed: ${output.trim() || `exit ${code}`}`));
    });
  });
}

export async function ensureLanguagePythonRequirementsInstalled(
  language: string,
  langData: LanguageDataMap,
  options: InstallOptions,
  callbacks?: LanguagePythonRequirementInstallCallbacks,
): Promise<void> {
  const data = langData[language];
  if (!data) return;

  const requirements = getLanguagePythonRequirementsForInstall({ [language]: data }, options);
  const importChecks = getLanguagePythonImportChecksForInstall({ [language]: data }, options);
  if (requirements.length === 0 && importChecks.length === 0) return;

  const [pipCommand] = getPipCommandCandidates();
  if (!pipCommand) {
    throw new Error(`Cannot install Python requirements for ${language}; the local Python runtime is not installed.`);
  }

  if (requirements.length > 0) {
    await installRequirements(pipCommand, requirements, callbacks);
  }
  await verifyImportChecks(pipCommand, importChecks, callbacks);
}
