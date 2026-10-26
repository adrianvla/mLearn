import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const artifacts = {
  'dialog.web.js': '799d4e2cd8b2e57cbc48c118743e6d219c53bb3df4cd485099c62210b6062355',
  'dialog.web.mjs': 'ce1a6e6c3221b63cca9c64efa966f96d4bcb09ed387b9052540e94899327074f',
  'index.d.ts': '9d79c108c4b62b4f5ae6b0cc909b10805411d3728baaa8c8dfb54e346123654e',
  'index.d.mts': '9d79c108c4b62b4f5ae6b0cc909b10805411d3728baaa8c8dfb54e346123654e',
};
const runtimeChanges = [
  ['  defaultOpen,\n', '  defaultOpen,\n  modal = true,\n'],
  ['<Dialog.Root open={open}', '<Dialog.Root modal={modal} open={open}'],
];
const typeChanges = [['    defaultOpen?: boolean;\n', '    defaultOpen?: boolean;\n    modal?: boolean;\n']];

// RN Primitives 1.5.2 drops Radix's modal option at its web Root boundary.
// Remove this when upstream forwards it and the source/sidebar interaction passes.
export function patchWebDialog(version, artifact, source) {
  if (version !== '1.5.2') throw new Error(`Revalidate the dialog sidebar repair for ${version}`);
  const digest = artifacts[artifact];
  if (!digest) throw new Error(`Unexpected dialog artifact: ${artifact}`);
  const changes = artifact.startsWith('index.') ? typeChanges : runtimeChanges;
  const upstream = changes.reduce((text, [before, after]) => text.replace(after, before), source);
  if (createHash('sha256').update(upstream).digest('hex') !== digest) {
    throw new Error(`Unexpected dialog source; revalidate ${artifact}`);
  }
  const patched = changes.reduce((text, [before, after]) => text.replace(before, after), upstream);
  if (source !== upstream && source !== patched) throw new Error(`Partially patched dialog artifact: ${artifact}`);
  return patched;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const dependency = new URL('../node_modules/@rn-primitives/dialog/', import.meta.url);
  const { version } = JSON.parse(readFileSync(new URL('package.json', dependency), 'utf8'));
  const updates = Object.keys(artifacts).map(artifact => {
    const target = new URL(`dist/${artifact}`, dependency);
    const source = readFileSync(target, 'utf8');
    return { target, source, patched: patchWebDialog(version, artifact, source) };
  });
  for (const { target, source, patched } of updates) {
    if (patched !== source) writeFileSync(target, patched);
  }
}
