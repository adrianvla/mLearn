import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildSync } from 'esbuild';

const require = createRequire(import.meta.url);
const electron = require('electron');
const source = fileURLToPath(new URL('../../src/electron/services/shutdownCheckpoint.ts', import.meta.url));

test('real Electron resumes quit after closing its last window and a settled checkpoint', {
  skip: process.platform === 'linux' && !process.env.DISPLAY,
}, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mlearn-acceptance-shutdown-'));
  try {
    const helper = path.join(root, 'shutdown.cjs');
    buildSync({ entryPoints: [source], outfile: helper, platform: 'node', format: 'cjs', bundle: true });
    const profile = path.join(root, 'profile');
    mkdirSync(profile);
    const fixture = path.join(root, 'main.cjs');
    writeFileSync(fixture, `
      const { app, BrowserWindow } = require('electron');
      const { resumeQuitAfterCheckpoint } = require('./shutdown.cjs');
      app.setPath('userData', ${JSON.stringify(profile)});
      let finished = false;
      app.on('will-quit', event => {
        if (finished) return;
        event.preventDefault();
        resumeQuitAfterCheckpoint(Promise.resolve(), error => { throw error; }, () => {
          finished = true;
          console.log('checkpoint completed');
          app.quit();
        });
      });
      app.on('quit', () => console.log('normal quit'));
      app.whenReady().then(() => {
        new BrowserWindow({ show: false });
        setImmediate(() => app.quit());
      });
    `);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(electron, [fixture], { env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.error, undefined, `${result.error}\n${result.stdout}\n${result.stderr}`);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /checkpoint completed\nnormal quit/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
