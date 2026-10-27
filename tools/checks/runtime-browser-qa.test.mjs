import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const exec = promisify(execFile);
const fixture = new URL('../runtime-browser-qa.mjs', import.meta.url).href;

test('native browser startup without trust does not retain a listener', async t => {
  // Given a clean, isolated fixture root without a development publisher.
  const root = await mkdtemp(path.join(tmpdir(), 'mlearn-browser-startup-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'target/plugin-cdn'), { recursive: true });
  const check = `
    import assert from 'node:assert/strict';
    import { startRuntimeBrowserQa } from ${JSON.stringify(fixture)};
    const listeners = () => process.getActiveResourcesInfo()
      .filter(kind => kind === 'TCPServerWrap').length;
    const before = listeners();
    // When startup rejects the missing authenticated fixture prerequisite.
    await assert.rejects(startRuntimeBrowserQa({ profile: 'profile' }), { code: 'ENOENT' });
    // Then it has not retained a listening server.
    assert.equal(listeners(), before);
  `;
  await exec(process.execPath, ['--input-type=module', '--eval', check],
    { cwd: root, timeout: 10000, maxBuffer: 16384 });
});
