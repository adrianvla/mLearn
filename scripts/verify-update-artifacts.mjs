import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

function scalarValue(metadata, key) {
  const match = metadata.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'im'));
  return match?.[1].replace(/^['"]|['"]$/g, '');
}

function fileSha512(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha512');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('base64')));
  });
}

function parseFileEntries(metadata, metadataFile) {
  const lines = metadata.split(/\r?\n/);
  const entries = [];
  for (let index = 0; index < lines.length; index += 1) {
    const urlMatch = lines[index].match(/^\s*-\s*url:\s*(.+?)\s*$/i);
    if (!urlMatch) continue;
    const url = urlMatch[1].replace(/^['"]|['"]$/g, '');
    let checksum;
    for (let detailIndex = index + 1; detailIndex < lines.length; detailIndex += 1) {
      const detailLine = lines[detailIndex];
      if (/^\s*-\s*url:/i.test(detailLine) || /^\S/.test(detailLine)) break;
      const checksumMatch = detailLine.match(/^\s+sha512:\s*(.+?)\s*$/i);
      if (checksumMatch) {
        checksum = checksumMatch[1].replace(/^['"]|['"]$/g, '');
        break;
      }
    }
    if (!checksum) throw new Error(`${metadataFile} has no SHA-512 checksum for ${url}`);
    entries.push({ url, checksum });
  }
  return entries;
}

export async function verifyUpdateArtifacts(releaseDirectory, expectedVersion) {
  const metadataFiles = fs.readdirSync(releaseDirectory)
    .filter((name) => /^latest(?:-[a-z0-9]+)*\.ya?ml$/i.test(name))
    .sort();

  if (metadataFiles.length === 0) {
    throw new Error(`No updater metadata found in ${releaseDirectory}`);
  }

  for (const metadataFile of metadataFiles) {
    const metadata = fs.readFileSync(path.join(releaseDirectory, metadataFile), 'utf8');
    const metadataVersion = scalarValue(metadata, 'version');
    if (!metadataVersion) {
      throw new Error(`${metadataFile} does not declare a version`);
    }
    if (expectedVersion && metadataVersion !== expectedVersion) {
      throw new Error(`${metadataFile} declares version ${metadataVersion}, expected ${expectedVersion}`);
    }
    const artifacts = parseFileEntries(metadata, metadataFile).map((entry) => ({
      ...entry,
      name: (() => {
        try {
          return path.basename(decodeURIComponent(new URL(entry.url).pathname));
        } catch {
          return path.basename(decodeURIComponent(entry.url));
        }
      })(),
    }));

    if (artifacts.length === 0) {
      throw new Error(`${metadataFile} does not reference an update artifact`);
    }

    for (const artifact of artifacts) {
      const artifactPath = path.join(releaseDirectory, artifact.name);
      if (!fs.existsSync(artifactPath)) {
        throw new Error(`${metadataFile} references missing artifact ${artifact.name}`);
      }
      const actualChecksum = await fileSha512(artifactPath);
      if (actualChecksum !== artifact.checksum) {
        throw new Error(`${metadataFile} has an invalid SHA-512 checksum for ${artifact.name}`);
      }
    }
  }

  return metadataFiles;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const releaseDirectory = path.resolve(process.argv[2] ?? 'release');
  const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
  const metadataFiles = await verifyUpdateArtifacts(releaseDirectory, packageJson.version);
  process.stdout.write(`Verified ${metadataFiles.length} updater metadata file(s).\n`);
}
