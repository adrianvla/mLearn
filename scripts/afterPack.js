// Ensure empty env/ and py/ exist in Resources/app at pack time
// electron-builder will call this with { appOutDir, packager }, etc.
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  const appOutDir = context.appOutDir;
  const appResourcesDir = path.join(appOutDir, context.packager.platform === 'darwin' ? `${context.packager.appInfo.productFilename}.app/Contents/Resources/app` : 'resources/app');

  const ensureDir = (dir) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) {}
  };

  ensureDir(path.join(appResourcesDir, 'env'));
  ensureDir(path.join(appResourcesDir, 'py'));
};
