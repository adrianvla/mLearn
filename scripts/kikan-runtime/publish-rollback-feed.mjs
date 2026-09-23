#!/usr/bin/env node
/** Stage a verified, immutable generic updater feed for a signed release rollback. */
import fs from 'node:fs';
import path from 'node:path';
import { verifyUpdateArtifacts } from '../verify-update-artifacts.mjs';

const [releaseDirArg, version, publicationRootArg] = process.argv.slice(2);
if (!releaseDirArg || !/^\d+\.\d+\.\d+$/.test(version ?? '') || !publicationRootArg) {
  process.stderr.write('Usage: node scripts/kikan-runtime/publish-rollback-feed.mjs RELEASE_DIR TARGET_VERSION PUBLICATION_ROOT\n');
  process.exit(2);
}
const releaseDir = path.resolve(releaseDirArg);
const publicationRoot = path.resolve(publicationRootArg);
const metadataFiles = await verifyUpdateArtifacts(releaseDir, version);
const destination = path.join(publicationRoot, 'rollbacks', version);
if (fs.existsSync(destination)) throw new Error('Rollback feed already exists; releases are immutable');
const staging = `${destination}.staging-${process.pid}`;
fs.mkdirSync(staging, { recursive: true });
try {
  for (const metadataFile of metadataFiles) {
    const original = fs.readFileSync(path.join(releaseDir, metadataFile), 'utf8');
    const artifacts = [];
    const rewritten = original.replace(/^(\s*-\s*url:\s*)([^\r\n]+)/gim, (_match, prefix, rawUrl) => {
      let name;
      try { name = path.basename(decodeURIComponent(new URL(rawUrl.trim()).pathname)); }
      catch { name = path.basename(decodeURIComponent(rawUrl.trim().replace(/^['"]|['"]$/g, ''))); }
      if (!name || name === '.' || name === '..') throw new Error('Invalid updater artifact URL');
      artifacts.push(name);
      return `${prefix}${name}`;
    });
    if (artifacts.length === 0) throw new Error(`${metadataFile} has no artifacts`);
    fs.writeFileSync(path.join(staging, metadataFile), rewritten);
    for (const artifact of artifacts) {
      fs.copyFileSync(path.join(releaseDir, artifact), path.join(staging, artifact));
      const blockmap = `${artifact}.blockmap`;
      if (fs.existsSync(path.join(releaseDir, blockmap))) fs.copyFileSync(path.join(releaseDir, blockmap), path.join(staging, blockmap));
    }
  }
  await verifyUpdateArtifacts(staging, version);
  fs.renameSync(staging, destination);
} catch (error) {
  fs.rmSync(staging, { recursive: true, force: true });
  throw error;
}
process.stdout.write(`Published verified rollback feed ${version} at ${destination}\n`);
