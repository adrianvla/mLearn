import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patchWebDialog } from '../patch-rn-dialog.mjs';

test('the pinned web dialog repair forwards modal without changing native runtime artifacts', () => {
  const dependency = new URL('../../node_modules/@rn-primitives/dialog/', import.meta.url);
  const { version } = JSON.parse(readFileSync(new URL('package.json', dependency), 'utf8'));
  for (const artifact of ['dialog.web.js', 'dialog.web.mjs', 'index.d.ts', 'index.d.mts']) {
    const shipped = readFileSync(new URL(`dist/${artifact}`, dependency), 'utf8');
    const upstream = shipped.replace('  modal = true,\n', '')
      .replace('<Dialog.Root modal={modal} ', '<Dialog.Root ')
      .replace('    modal?: boolean;\n', '');
    assert.notEqual(upstream, shipped);
    assert.equal(patchWebDialog(version, artifact, upstream), shipped);
    assert.equal(patchWebDialog(version, artifact, shipped), shipped);
    assert.throws(() => patchWebDialog('unreviewed', artifact, shipped), Error);
    assert.throws(() => patchWebDialog(version, artifact, `${shipped}\n`), Error);
  }
  for (const artifact of ['dialog.js', 'dialog.mjs']) {
    const native = readFileSync(new URL(`dist/${artifact}`, dependency), 'utf8');
    assert.throws(() => patchWebDialog(version, artifact, native), Error);
    assert.ok(!native.includes('modal = true'));
  }
});
