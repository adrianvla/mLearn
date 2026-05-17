#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const tar = require("tar");

const ROOT = path.resolve(__dirname, "..");
const RELEASE_DIR = path.join(ROOT, "release");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function run(command, opts = {}) {
  console.log(`> ${command}`);
  execSync(command, {
    cwd: ROOT,
    stdio: "inherit",
    ...opts,
  });
}

function findUnpackedDir() {
  const entries = fs.readdirSync(RELEASE_DIR);
  const unpacked = entries.find(
    (e) =>
      fs.statSync(path.join(RELEASE_DIR, e)).isDirectory() &&
      (e.endsWith("-unpacked") || e.startsWith("mac") || e.startsWith("linux"))
  );
  if (!unpacked) {
    throw new Error("Could not find unpacked app directory in release/");
  }
  return path.join(RELEASE_DIR, unpacked);
}

async function pack() {
  if (fs.existsSync(RELEASE_DIR)) {
    fs.rmSync(RELEASE_DIR, { recursive: true });
  }
  ensureDir(RELEASE_DIR);

  run("npm run build");
  run("CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --dir");

  const unpackedDir = findUnpackedDir();
  const unpackedName = path.basename(unpackedDir);

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
  const { name, version } = pkg;
  const platform = process.platform;
  const arch = process.arch;
  const archiveName = `${name}-${version}-${platform}-${arch}.tar.gz`;
  const archivePath = path.join(RELEASE_DIR, archiveName);

  console.log(`\nPacking ${archiveName} from ${unpackedName} ...`);
  await tar.create(
    {
      gzip: true,
      file: archivePath,
      cwd: RELEASE_DIR,
      portable: true,
    },
    [unpackedName]
  );

  console.log(`\n✔ Archive created: ${archivePath}`);
}

pack().catch((err) => {
  console.error(err);
  process.exit(1);
});
