import fs from 'node:fs';
import path from 'node:path';

// These are the two source trees emitted by src/electron/tsconfig.json.
// The enclosing directory also holds downloaded Python runtimes and user data.
for (const directory of ['electron', 'shared']) {
  fs.rmSync(path.resolve('dist-electron', directory), { recursive: true, force: true });
}
