"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTempDir = createTempDir;
exports.ensureDir = ensureDir;
const fs_1 = require("fs");
const os_1 = require("os");
const path_1 = require("path");
function createTempDir(prefix = 'mlearn-test-') {
    const dir = (0, fs_1.mkdtempSync)((0, path_1.join)((0, os_1.tmpdir)(), prefix));
    return {
        tmpDir: dir,
        cleanup: () => {
            try {
                (0, fs_1.rmSync)(dir, { recursive: true, force: true });
            }
            catch {
            }
        },
    };
}
function ensureDir(dirPath) {
    (0, fs_1.mkdirSync)(dirPath, { recursive: true });
}
//# sourceMappingURL=tempDir.js.map