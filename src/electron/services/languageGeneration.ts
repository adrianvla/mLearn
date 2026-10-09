import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const queues = new Map<string, Promise<unknown>>();
const POINTER = '.active-generation.json';
const GENERATIONS = '.generations';

/** Resolve once at admission. Previously returned roots remain available. */
export function resolveLanguageDataRoot(controllerRoot: string, admittedGeneration?: string): string {
  if (admittedGeneration !== undefined) {
    if (!/^[a-f0-9-]{36}$/u.test(admittedGeneration)) throw new Error('Invalid admitted language generation');
    const admitted = path.join(controllerRoot, GENERATIONS, admittedGeneration);
    if (!fs.statSync(admitted).isDirectory()) throw new Error('Admitted language generation is missing');
    return admitted;
  }
  const pointer = path.join(controllerRoot, POINTER);
  if (!fs.existsSync(pointer)) return controllerRoot;
  const parsed: unknown = JSON.parse(fs.readFileSync(pointer, 'utf8'));
  const generation = (parsed as { generation?: unknown })?.generation;
  if (typeof generation !== 'string' || !/^[a-f0-9-]{36}$/u.test(generation)) {
    throw new Error('Invalid active language generation');
  }
  const root = path.join(controllerRoot, GENERATIONS, generation);
  if (!fs.statSync(root).isDirectory()) throw new Error('Active language generation is missing');
  return root;
}

function copyRuntimeTree(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  if (!fs.existsSync(source)) return;
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    // Controller state and unpublished attempts never become runtime assets.
    if (entry.name === GENERATIONS || entry.name === POINTER || entry.name === '.downloads'
      || entry.name.startsWith('.active-generation.')) continue;
    const from = path.join(source, entry.name); const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyRuntimeTree(from, to);
    else if (entry.isFile()) fs.copyFileSync(from, to, fs.constants.COPYFILE_FICLONE);
    else throw new Error(`Unsupported installed language asset: ${from}`);
  }
}

function syncDirectory(directory: string): void {
  let fd: number | undefined;
  try { fd = fs.openSync(directory, 'r'); fs.fsyncSync(fd); }
  catch (error) {
    // Windows does not support opening directories for fsync.
    if (process.platform !== 'win32') throw error;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

/** One transaction across metadata, dictionaries, graphs, adapters and fonts. */
export function activateLanguageGeneration(
  controllerRoot: string,
  prepare: (candidateRoot: string) => Promise<void>,
): Promise<string> {
  const key = path.resolve(controllerRoot);
  const previous = queues.get(key) ?? Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    fs.mkdirSync(controllerRoot, { recursive: true });
    const previousPointer = path.join(controllerRoot, POINTER);
    const previousBytes = fs.existsSync(previousPointer) ? fs.readFileSync(previousPointer) : undefined;
    const revision = fs.existsSync(previousPointer) ? (JSON.parse(fs.readFileSync(previousPointer, 'utf8')) as { revision?: number }).revision ?? 0 : 0;
    const generation = crypto.randomUUID();
    const candidate = path.join(controllerRoot, GENERATIONS, generation);
    const pointerTemp = path.join(controllerRoot, `.active-generation.${generation}.tmp`);
    let published = false;
    try {
      copyRuntimeTree(resolveLanguageDataRoot(controllerRoot), candidate);
      await prepare(candidate);
      // Flush every candidate file before the pointer can name it. Old files
      // are cloned rather than linked, so migrations cannot mutate old readers.
      const flush = (directory: string): void => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const file = path.join(directory, entry.name);
          if (entry.isDirectory()) flush(file);
          else { const fd = fs.openSync(file, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
        }
        syncDirectory(directory);
      };
      flush(candidate); syncDirectory(path.dirname(candidate));
      const fd = fs.openSync(pointerTemp, 'wx');
      try { fs.writeFileSync(fd, JSON.stringify({ schemaVersion: 1, generation, revision: revision + 1 }) + '\n'); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      fs.renameSync(pointerTemp, path.join(controllerRoot, POINTER));
      published = true;
      try { syncDirectory(controllerRoot); }
      catch (error) {
        // A failed durability acknowledgement must not leave selected authority
        // looking successful. Retain the candidate for any reader that admitted
        // the short publication window, and restore the usable predecessor.
        if (previousBytes) {
          const restore = fs.openSync(pointerTemp, 'wx');
          try { fs.writeFileSync(restore, previousBytes); fs.fsyncSync(restore); }
          finally { fs.closeSync(restore); }
          fs.renameSync(pointerTemp, previousPointer);
        } else fs.rmSync(previousPointer, { force: true });
        syncDirectory(controllerRoot);
        throw error;
      }
      return candidate;
    } finally {
      fs.rmSync(pointerTemp, { force: true });
      // A crashed candidate has no authority. Existing generations are retained
      // because open Python/SQLite/graph/font readers may still hold them.
      if (!published) fs.rmSync(candidate, { recursive: true, force: true });
    }
  });
  queues.set(key, operation);
  void operation.finally(() => { if (queues.get(key) === operation) queues.delete(key); }).catch(() => {});
  return operation;
}
