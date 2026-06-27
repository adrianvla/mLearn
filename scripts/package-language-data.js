const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const rootOfApp = path.join(projectRoot, 'src', 'root-of-app');
const languagesDir = path.join(rootOfApp, 'languages');
const outputDir = path.join(projectRoot, 'release', 'language-data');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function fileNameFromUrl(url) {
  const parsed = new URL(url);
  const fileName = path.basename(parsed.pathname);
  if (!fileName) {
    throw new Error(`Language data URL has no file name: ${url}`);
  }
  return fileName;
}

function copyAsset(language, asset) {
  if (!asset.bundledPath) {
    throw new Error(`${language}:${asset.id} is missing bundledPath`);
  }
  if (!asset.url) {
    throw new Error(`${language}:${asset.id} is missing url`);
  }

  const sourcePath = path.join(rootOfApp, asset.bundledPath);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing language data source for ${language}:${asset.id}: ${sourcePath}`);
  }

  const fileName = fileNameFromUrl(asset.url);
  const outputPath = path.join(outputDir, fileName);
  fs.copyFileSync(sourcePath, outputPath);

  return {
    language,
    id: asset.id,
    fileName,
    sourcePath: path.relative(projectRoot, sourcePath),
    sizeBytes: fs.statSync(outputPath).size,
    sha256: asset.sha256,
  };
}

function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const manifest = [];

  for (const fileName of fs.readdirSync(languagesDir).sort()) {
    if (!fileName.endsWith('.json')) continue;
    const language = path.basename(fileName, '.json');
    const metadata = readJson(path.join(languagesDir, fileName));
    const assets = metadata.languageData?.assets ?? [];
    for (const asset of assets) {
      manifest.push(copyAsset(language, asset));
    }
  }

  fs.writeFileSync(
    path.join(outputDir, 'manifest.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), assets: manifest }, null, 2) + '\n',
    'utf-8',
  );
  console.log(`Prepared ${manifest.length} language data asset(s) in ${outputDir}`);
}

main();
