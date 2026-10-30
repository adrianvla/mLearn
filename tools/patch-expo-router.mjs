import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const before = `            if (record?.path === path && record?.state) {
                navigation.resetRoot(record.state);
                return;
            }`;
const after = `            if (record?.path === path && record?.state) {
                const previousState = navigation.getRootState();
                (0, react_dom_1.flushSync)(() => navigation.resetRoot(record.state));
                // A prevented removal must restore the browser's history cursor too.
                if (index !== previousIndex &&
                    !(0, fast_deep_equal_1.default)(previousState, record.state) &&
                    (0, fast_deep_equal_1.default)(navigation.getRootState(), previousState)) {
                    pendingPopStatePathRef.current = undefined;
                    previousIndexRef.current = previousIndex;
                    history.go(previousIndex - index)?.catch((error) => {
                        console.warn('Could not restore prevented navigation history:', error);
                    });
                }
                return;
            }`;
const cursorBefore = `                // This would happen if the user did a reset/conditionally changed navigators
                history.replace({ path, state });
            }
        };`;
const cursorAfter = `                // This would happen if the user did a reset/conditionally changed navigators
                history.replace({ path, state });
            }
            previousIndexRef.current = history.index;
        };`;
const artifacts = {
  'useLinking.js': {
    digest: 'ad70391f8ed7d7f70f0faef70a45b51d9f8cc9c6e986d94c6095da16bb69561a',
    changes: [
      ['const react_1 = require("react");', 'const react_1 = require("react");\nconst react_dom_1 = require("react-dom");'],
      [before, after], [cursorBefore, cursorAfter],
    ],
  },
  'createMemoryHistory.js': {
    digest: '6283ba26a72bea1424e1355d0c855e559b25c84d0ca6efbc1adf79143ca8ed49',
    changes: [[`        listen(listener) {
            const onPopState = () => {
                if (pending.length) {`, `        listen(listener) {
            const onPopState = () => {
                index = this.index;
                if (pending.length) {`]],
  },
};

// Expo Router 57.0.25 retains the guarded screen but not the browser cursor.
// Remove when upstream restores both and the held/failed Back regression passes.
export function patchRouterHistory(version, artifact, source) {
  if (version !== '57.0.25') throw new Error(`Revalidate the router history repair for ${version}`);
  const definition = artifacts[artifact];
  if (!definition) throw new Error(`Unexpected router history artifact: ${artifact}`);
  // The shipped artifact has no final newline; the managed patch adds one.
  const upstream = definition.changes.reduce((text, [before, after]) => text.replace(after, before),
    source.endsWith('\n') ? source.slice(0, -1) : source);
  if (createHash('sha256').update(upstream).digest('hex') !== definition.digest)
    throw new Error(`Unexpected router history source; revalidate ${artifact}`);
  const patched = `${definition.changes.reduce((text, [before, after]) => text.replace(before, after), upstream)}\n`;
  if (source !== upstream && source !== patched) throw new Error('Partially patched router history source');
  return patched;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const dependency = new URL('../node_modules/expo-router/', import.meta.url);
  const { version } = JSON.parse(readFileSync(new URL('package.json', dependency), 'utf8'));
  const updates = Object.keys(artifacts).map(artifact => {
    const target = new URL(`build/fork/${artifact}`, dependency);
    const source = readFileSync(target, 'utf8');
    return { target, source, patched: patchRouterHistory(version, artifact, source) };
  });
  for (const { target, source, patched } of updates) {
    if (patched !== source) writeFileSync(target, patched);
  }
}
