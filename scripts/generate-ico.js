#!/usr/bin/env node
/*
Generates build/icon.ico from available PNG sources using the png-to-ico CLI.
Prefers a globally installed `png-to-ico` if present; falls back to `npx -y png-to-ico`.
No local dependencies are required or bundled with the app.
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const buildDir = path.join(projectRoot, 'build');
const iconsDir = path.join(buildDir, 'icons');
const outIco = path.join(buildDir, 'icon.ico');

function findPngs() {
  const sizes = [16, 24, 32, 48, 64, 128, 256, 512];
  const files = [];
  try {
    for (const s of sizes) {
      const p = path.join(iconsDir, `${s}x${s}.png`);
      if (fs.existsSync(p)) files.push(p);
    }
  } catch {}

  // Fallbacks in build/
  const fallbackNames = ['icon-16.png', 'icon-32.png', 'icon-48.png', 'icon-64.png', 'icon-128.png', 'icon-256.png', 'icon-512.png', 'icon.png'];
  for (const name of fallbackNames) {
    const p = path.join(buildDir, name);
    if (fs.existsSync(p) && !files.includes(p)) files.push(p);
  }

  // Unique by size (prefer smallest set but include typical sizes)
  const bySize = new Map();
  for (const f of files) {
    const bn = path.basename(f);
    const m = bn.match(/(\d+)[xX](\d+)/);
    if (m) {
      const s = Number(m[1]);
      if (!bySize.has(s)) bySize.set(s, f);
    } else if (bn === 'icon.png') {
      if (!bySize.has(256)) bySize.set(256, f);
    }
  }
  const ordered = Array.from(bySize.keys()).sort((a,b)=>a-b).map(k=>bySize.get(k));
  if (ordered.length === 0) {
    const p = path.join(buildDir, 'icon.png');
    if (fs.existsSync(p)) return [p];
  }
  return ordered;
}

function runCli(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    const errChunks = [];
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => errChunks.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(Buffer.concat(errChunks).toString() || `exit ${code}`));
    });
  });
}

async function generateIco(sources) {
  // Try global binary first
  try {
    return await runCli('png-to-ico', sources);
  } catch (e1) {
    // Fallback to npx
    return await runCli('npx', ['-y', 'png-to-ico', ...sources]);
  }
}

async function main() {
  const sources = findPngs();
  if (!sources || sources.length === 0) {
    console.error('No PNG sources found to generate ICO. Expected files in build/icons/*.png or build/icon.png');
    process.exit(1);
  }
  try {
    const buf = await generateIco(sources);
    fs.writeFileSync(outIco, buf);
    const stat = fs.statSync(outIco);
    if (stat.size < 1000) {
      console.warn(`Generated ICO seems small (${stat.size} bytes).`);
    }
    console.log(`Wrote ${outIco} (${stat.size} bytes) from ${sources.length} PNG(s).`);
  } catch (err) {
    console.error('Failed to generate ICO via png-to-ico CLI:', err?.message || err);
    process.exit(1);
  }
}

main();
