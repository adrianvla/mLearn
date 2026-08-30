import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Dev-time bridge to src/shared/graph/compact.ts. The packager and its tests run
// as plain .mjs under node --test, so the TypeScript encoder is bundled once via
// esbuild (already in node_modules for the preload bundle) into a content-hashed
// cache file and imported from there. No encoder logic is duplicated here.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..', '..');
const compactSourcePath = path.join(projectRoot, 'src', 'shared', 'graph', 'compact.ts');

/** Stable hash over every TS source reachable from compact.ts via relative imports. */
function graphSourceHash() {
  const hash = crypto.createHash('sha256');
  const seen = new Set();
  const visit = (sourcePath) => {
    const realPath = fs.realpathSync(sourcePath);
    if (seen.has(realPath)) return;
    seen.add(realPath);
    const code = fs.readFileSync(realPath);
    hash.update(realPath);
    hash.update(code);
    for (const match of code.toString('utf-8').matchAll(/(?:from|import)\s*['"](\.[^'"]+)['"]/g)) {
      const base = path.resolve(path.dirname(realPath), match[1]);
      const candidate = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.js`,
        `${base}.mjs`,
        path.join(base, 'index.ts'),
      ].find((filePath) => fs.existsSync(filePath) && fs.statSync(filePath).isFile());
      if (candidate) visit(candidate);
    }
  };
  visit(compactSourcePath);
  return hash.digest('hex').slice(0, 16);
}

let codecsPromise;

/**
 * Loads { encodeCompact, decodeCompact, COMPACT_ENTITY_KINDS } from
 * src/shared/graph/compact.ts. Bundles the module with esbuild and caches the
 * ESM output under node_modules/.cache keyed by the source hash, so repeated
 * runs import the cached file until any reachable TS source changes.
 */
export function loadGraphCompact() {
  codecsPromise ??= (async () => {
    const esbuildModule = await import('esbuild');
    const esbuild = esbuildModule.build ? esbuildModule : esbuildModule.default;
    const cacheFile = path.join(
      projectRoot,
      'node_modules',
      '.cache',
      'mlearn-graph-compact',
      `graph-compact-${graphSourceHash()}.mjs`,
    );
    if (!fs.existsSync(cacheFile)) {
      const entry = `export { COMPACT_ENTITY_KINDS, encodeCompact, decodeCompact } from ${JSON.stringify(compactSourcePath.split(path.sep).join('/'))};`;
      const result = await esbuild.build({
        stdin: {
          contents: entry,
          resolveDir: projectRoot,
          sourcefile: 'graph-compact-entry.ts',
          loader: 'ts',
        },
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'node',
        target: 'node18',
        sourcemap: false,
        logLevel: 'silent',
      });
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      const temporaryFile = `${cacheFile}.${process.pid}.tmp`;
      fs.writeFileSync(temporaryFile, result.outputFiles[0].text, 'utf-8');
      fs.renameSync(temporaryFile, cacheFile);
    }
    return import(pathToFileURL(cacheFile).href);
  })();
  return codecsPromise;
}

/** Plain LinguisticGraphAsset JSON: the top-level entities list is an array. */
export function isPlainGraphAsset(value) {
  return value !== null && typeof value === 'object' && Array.isArray(value.entities);
}

/**
 * Reads the graph JSON at sourcePath; when it is a plain LinguisticGraphAsset,
 * writes the compact asset JSON to outputPath (minified, same entity order) and
 * returns true. Already-compact files (stringTable, no top-level entities array)
 * are left untouched and return false so the caller can copy them verbatim.
 */
export async function writeCompactGraphAsset(sourcePath, outputPath) {
  const parsed = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
  if (!isPlainGraphAsset(parsed)) return false;
  const { encodeCompact } = await loadGraphCompact();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(encodeCompact(parsed)), 'utf-8');
  return true;
}
