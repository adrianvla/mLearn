import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { FileMatcher } from 'app-builder-lib/out/fileMatcher.js';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compiler = path.join(repository, 'node_modules/typescript/bin/tsc');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mlearn-electron-output-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.copyFileSync(path.join(repository, 'package.json'), path.join(directory, 'package.json'));
  fs.cpSync(path.join(repository, 'scripts'), path.join(directory, 'scripts'), {
    recursive: true,
    filter: (source) => source === path.join(repository, 'scripts') || path.basename(source) === 'clean-electron-output.mjs',
  });
  return directory;
}

function write(directory, relative, content = 'preserved') {
  const filename = path.join(directory, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, content);
}

function prebuild(directory) {
  execFileSync('npm', ['run', 'prebuild'], { cwd: directory, stdio: 'pipe' });
}

test('rebuilding after deleting source removes every artifact of the old Electron generation', (t) => {
  const directory = fixture(t);
  write(directory, 'tsconfig.json', JSON.stringify({
    compilerOptions: {
      rootDir: 'src', outDir: 'dist-electron', types: [],
      declaration: true, declarationMap: true, sourceMap: true,
    },
    include: ['src/**/*.ts'],
  }));
  write(directory, 'src/electron/main.ts', 'export const current = true;');
  write(directory, 'src/electron/retired.ts', 'export const retired = true;');
  write(directory, 'src/shared/retired.ts', 'export const retired = true;');
  const compile = () => execFileSync(process.execPath, [compiler, '-p', 'tsconfig.json'], { cwd: directory, stdio: 'pipe' });
  compile();
  fs.rmSync(path.join(directory, 'src/electron/retired.ts'));
  fs.rmSync(path.join(directory, 'src/shared/retired.ts'));

  // Characterize the compiler: recompilation alone leaves deleted-source output.
  compile();
  assert.equal(fs.existsSync(path.join(directory, 'dist-electron/electron/retired.js')), true);

  prebuild(directory);
  compile();
  assert.equal(fs.existsSync(path.join(directory, 'dist-electron/electron/main.js')), true);
  for (const folder of ['electron', 'shared']) {
    for (const suffix of ['.js', '.js.map', '.d.ts', '.d.ts.map']) {
      assert.equal(fs.existsSync(path.join(directory, `dist-electron/${folder}/retired${suffix}`)), false);
    }
  }
});

test('build preparation preserves downloaded runtimes and data outside compiler output', (t) => {
  const directory = fixture(t);
  const preserved = [
    'env/bin/python', 'env/lib/runtime.js', 'py/python', 'python.tar.gz',
    'languages/custom.json', 'assets/model.bin', 'locales/lang.en.json',
    'dictionaries/custom.sqlite3', 'server.py', 'version-info.json',
  ];
  for (const relative of preserved) write(directory, `dist-electron/${relative}`);
  write(directory, 'dist-electron/electron/retired.js');
  write(directory, 'dist-electron/shared/retired.d.ts.map');
  prebuild(directory);
  prebuild(directory);
  for (const relative of preserved) {
    assert.equal(fs.readFileSync(path.join(directory, 'dist-electron', relative), 'utf8'), 'preserved');
  }
  assert.equal(fs.existsSync(path.join(directory, 'dist-electron/electron/retired.js')), false);
  assert.equal(fs.existsSync(path.join(directory, 'dist-electron/shared/retired.d.ts.map')), false);
});

test('build preparation succeeds before an output directory exists', (t) => {
  prebuild(fixture(t));
});

test('packaging excludes emitted tests and compile-only checks while retaining application modules', (t) => {
  const directory = fixture(t);
  const { build } = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
  const filter = new FileMatcher(directory, path.join(directory, 'package'), (value) => value, build.files).createFilter();
  for (const relative of [
    'dist-electron/electron/main.js',
    'dist-electron/electron/preload.js',
    'dist-electron/shared/types.js',
  ]) {
    write(directory, relative);
    const filename = path.join(directory, relative);
    assert.equal(filter(filename, fs.statSync(filename)), true, relative);
  }
  for (const relative of [
    'dist-electron/shared/languageMetadataExtensibility.typecheck.js',
    'dist-electron/shared/languageMetadataExtensibility.typecheck.d.ts.map',
    'dist-electron/electron/services/retired.test.js',
    'dist-electron/electron/services/retired.test.js.map',
  ]) {
    write(directory, relative);
    const filename = path.join(directory, relative);
    assert.equal(filter(filename, fs.statSync(filename)), false, relative);
  }
});
