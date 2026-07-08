import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type { InstallOptions, LanguageDataMap } from '../../shared/types';
import { getLanguagePythonImportChecksForInstall, getLanguagePythonRequirementsForInstall } from '../../shared/languageFeatures';
import { getLogger } from '../../shared/utils/logger';
import { getPipCommandCandidates, getPythonExecutableCandidates, getRuntimeRootFromExecutable, type PipCommand } from './pythonRuntimePaths';
import { getUserDataPath } from '../utils/platform';

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

function validateImportChecks(language: string, importChecks: readonly string[]): Promise<boolean> {
  if (importChecks.length === 0) return Promise.resolve(true);

  const pythonExecutable = getPythonExecutableCandidates().find((candidate) => fs.existsSync(candidate));
  if (!pythonExecutable) return Promise.resolve(false);

  const script = [
    'import importlib',
    'import sys',
    `modules = ${JSON.stringify(importChecks)}`,
    'missing = []',
    'for module in modules:',
    '    try:',
    '        importlib.import_module(module)',
    '    except Exception as exc:',
    '        missing.append(f"{module}: {exc}")',
    'if missing:',
    `    print("Missing Python imports for ${language}: " + "; ".join(missing), file=sys.stderr)`,
    '    sys.exit(1)',
  ].join('\n');

  return new Promise((resolve) => {
    const process = spawn(pythonExecutable, ['-c', script], {
      cwd: getRuntimeRootFromExecutable(pythonExecutable),
    });
    process.stderr?.on('data', (data) => {
      log.warn(`python import check: ${data.toString().trim()}`);
    });
    process.on('error', () => resolve(false));
    process.on('close', (code) => resolve(code === 0 || code === null));
  });
}

interface EnsureLanguagePythonRequirementsOptions {
  skipIfCurrent?: boolean;
}

function getReceiptPath(language: string): string {
  const safeLanguage = language.replace(/[^a-z0-9_-]/gi, '_');
  return path.join(getUserDataPath(), 'language-data', '.python-requirements', `${safeLanguage}.json`);
}

function getRequirementsSignature(language: string, requirements: readonly string[]): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ language, requirements }))
    .digest('hex');
}

function isReceiptCurrent(language: string, requirements: readonly string[]): boolean {
  const receiptPath = getReceiptPath(language);
  try {
    if (!fs.existsSync(receiptPath)) return false;
    const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf-8')) as { signature?: string };
    return receipt.signature === getRequirementsSignature(language, requirements);
  } catch {
    return false;
  }
}

function writeReceipt(language: string, requirements: readonly string[]): void {
  const receiptPath = getReceiptPath(language);
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, JSON.stringify({
    language,
    requirements,
    signature: getRequirementsSignature(language, requirements),
    installedAt: new Date().toISOString(),
  }, null, 2), 'utf-8');
}

export async function ensureLanguagePythonRequirementsInstalled(
  language: string,
  langData: LanguageDataMap,
  options: InstallOptions,
  ensureOptions: EnsureLanguagePythonRequirementsOptions = {},
): Promise<boolean> {
  const data = langData[language];
  if (!data) return false;

  const requirements = getLanguagePythonRequirementsForInstall({ [language]: data }, options);
  const importChecks = getLanguagePythonImportChecksForInstall({ [language]: data }, options);
  if (requirements.length === 0) return false;
  if (
    ensureOptions.skipIfCurrent &&
    isReceiptCurrent(language, requirements) &&
    await validateImportChecks(language, importChecks)
  ) {
    return false;
  }

  const [pipCommand] = getPipCommandCandidates();
  if (!pipCommand) {
    throw new Error(`Cannot install Python requirements for ${language}; the local Python runtime is not installed.`);
  }

  await installRequirements(pipCommand, requirements);
  if (!await validateImportChecks(language, importChecks)) {
    throw new Error(`Python requirements for ${language} were installed, but runtime imports are still unavailable.`);
  }
  writeReceipt(language, requirements);
  return true;
}
