import fs from 'fs';
import path from 'path';
import {
  getPipExecutablePath,
  getPythonExecutablePath,
  getResourcePath,
  getUserDataPath,
  isPackaged,
  isWindows,
} from '../utils/platform';

export interface PipCommand {
  command: string;
  argsPrefix: string[];
  cwd: string;
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((candidate) => {
    if (!candidate || seen.has(candidate)) return false;
    seen.add(candidate);
    return true;
  });
}

export function getRuntimeRootFromExecutable(executablePath: string): string {
  return isWindows
    ? path.dirname(executablePath)
    : path.dirname(path.dirname(executablePath));
}

function getDevelopmentRuntimeRoots(): string[] {
  if (isPackaged) return [];
  return uniquePaths([
    path.join(process.cwd(), 'dist-electron', 'env'),
    path.join(getResourcePath(), 'env'),
  ]);
}

function getResourceRuntimeRoots(): string[] {
  const roots = [
    typeof process.resourcesPath === 'string' ? process.resourcesPath : '',
    getResourcePath(),
  ];
  return uniquePaths(roots.map((root) => path.join(root, 'env')));
}

function pythonExecutableInRuntimeRoot(runtimeRoot: string): string {
  return isWindows
    ? path.join(runtimeRoot, 'python.exe')
    : path.join(runtimeRoot, 'bin', 'python3');
}

function pipExecutableInRuntimeRoot(runtimeRoot: string): string {
  return isWindows
    ? path.join(runtimeRoot, 'python.exe')
    : path.join(runtimeRoot, 'bin', 'pip3');
}

export function getPythonExecutableCandidates(): string[] {
  const userRuntimeRoot = path.join(getUserDataPath(), 'env');

  return uniquePaths([
    pythonExecutableInRuntimeRoot(userRuntimeRoot),
    getPythonExecutablePath(),
    ...getDevelopmentRuntimeRoots().map((runtimeRoot) => pythonExecutableInRuntimeRoot(runtimeRoot)),
    ...getResourceRuntimeRoots().map((runtimeRoot) => pythonExecutableInRuntimeRoot(runtimeRoot)),
  ]);
}

export function getPipCommandCandidates(): PipCommand[] {
  const userRuntimeRoot = path.join(getUserDataPath(), 'env');
  const executableCandidates = uniquePaths([
    pipExecutableInRuntimeRoot(userRuntimeRoot),
    getPipExecutablePath(),
    ...getDevelopmentRuntimeRoots().flatMap((runtimeRoot) => [
      pipExecutableInRuntimeRoot(runtimeRoot),
      pythonExecutableInRuntimeRoot(runtimeRoot),
    ]),
    pythonExecutableInRuntimeRoot(userRuntimeRoot),
    getPythonExecutablePath(),
    ...getResourceRuntimeRoots().flatMap((runtimeRoot) => [
      pipExecutableInRuntimeRoot(runtimeRoot),
      pythonExecutableInRuntimeRoot(runtimeRoot),
    ]),
  ]);

  return executableCandidates
    .filter((candidate) => fs.existsSync(candidate))
    .map((candidate) => {
      const basename = path.basename(candidate).toLowerCase();
      const isPython = isWindows || basename.startsWith('python');
      return {
        command: candidate,
        argsPrefix: isPython ? ['-m', 'pip'] : [],
        cwd: getRuntimeRootFromExecutable(candidate),
      };
    });
}
