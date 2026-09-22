import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const launcher = fileURLToPath(new URL('./launch-isolated.mjs', import.meta.url));

test('packaged app launch always gets a marked disposable profile and can reuse only that profile', () => {
  const marker = `acceptance-launch-${process.pid}-${Date.now()}`;
  const childScript = `require('node:fs').writeFileSync(require('node:path').join(process.env.MLEARN_USER_DATA, '${marker}'), process.env.MLEARN_USER_DATA)`;
  const run = (args) => execFileSync(process.execPath, [launcher, process.execPath, ...args, '--', '-e', childScript], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let profile;

  try {
    const firstLaunch = run([]);
    const profileLine = firstLaunch.split('\n').find((line) => line.startsWith('ISOLATED_MLEARN_USER_DATA='));
    assert.ok(profileLine, firstLaunch);
    profile = profileLine.slice('ISOLATED_MLEARN_USER_DATA='.length);
    assert.ok(profile.startsWith(`${realpathSync(os.tmpdir())}${path.sep}`));
    assert.ok(existsSync(path.join(profile, '.mlearn-acceptance-profile.json')));
    assert.equal(readFileSync(path.join(profile, marker), 'utf8'), profile);

    run(['--profile', profile]);
    assert.equal(readFileSync(path.join(profile, marker), 'utf8'), profile);

    const unsafeProfile = spawnSync(process.execPath, [launcher, process.execPath, '--profile', process.cwd()], {
      encoding: 'utf8',
    });
    assert.equal(unsafeProfile.status, 2);
    assert.match(unsafeProfile.stderr, /Acceptance profile must be a real mLearn acceptance directory/);
  } finally {
    if (profile) rmSync(profile, { recursive: true, force: true });
  }
});
