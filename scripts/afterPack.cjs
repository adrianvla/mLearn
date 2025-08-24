// Ensure empty env/ and py/ exist in Resources/app at pack time
const fs = require('fs');
const path = require('path');

module.exports = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const productName = context.packager.appInfo.productFilename;
  const platformName = context.electronPlatformName || (context.packager?.platform?.name) || process.platform;
  const isMac = platformName === 'darwin' || platformName === 'mac';
  const appResourcesDir = isMac
    ? path.join(appOutDir, `${productName}.app`, 'Contents', 'Resources', 'app')
    : path.join(appOutDir, 'resources', 'app');

  const ensureDir = (dir) => {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  };

  ensureDir(path.join(appResourcesDir, 'env'));
  ensureDir(path.join(appResourcesDir, 'py'));

  // If a certs folder is bundled, add a helper script to trust it on macOS
  const projectCertsDir = path.join(context.packager.projectDir, 'certs');
  const certsDir = path.join(appResourcesDir, 'certs');

  if (fs.existsSync(projectCertsDir)) {
    ensureDir(certsDir);
    for (const name of fs.readdirSync(projectCertsDir)) {
      try {
        fs.copyFileSync(path.join(projectCertsDir, name), path.join(certsDir, name));
      } catch (_) {}
    }
  }

  // Always drop the macOS trust helper on mac (it will no-op if cert is missing)
  if (isMac) {
    const trustScript = `#!/bin/bash
set -e
CERT_DIR="$(cd "$(dirname "$0")" && pwd)/certs"
CERT_FILE="$CERT_DIR/localhost-cert.pem"
if [ ! -f "$CERT_FILE" ]; then
  echo "No cert found at $CERT_FILE"
  exit 1
fi
echo "Importing localhost cert into System keychain (you may be prompted for your password)..."
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$CERT_FILE" || true
echo "Done. Restart the app and your browser to use HTTPS."
`;
    const scriptPath = path.join(appResourcesDir, 'trust-cert-macos.sh');
    try {
      ensureDir(appResourcesDir);
      fs.writeFileSync(scriptPath, trustScript);
      fs.chmodSync(scriptPath, 0o755);
    } catch (e) {
      try { console.warn('afterPack: failed to write trust script:', e?.message || e); } catch(_) {}
    }
  }

  // Optionally copy a top-level post-install.sh into Resources/app for runtime use
  const projectPostInstall = path.join(context.packager.projectDir, 'post-install.sh');
  const appPostInstall = path.join(appResourcesDir, 'post-install.sh');
  if (fs.existsSync(projectPostInstall)) {
    try {
      fs.copyFileSync(projectPostInstall, appPostInstall);
      fs.chmodSync(appPostInstall, 0o755);
    } catch (_) {}
  }
};
