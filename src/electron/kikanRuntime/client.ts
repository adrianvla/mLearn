import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  PROTOCOL, evaluateRuntime, verifySignedDocument,
  type RuntimeContext, type RuntimeDocument, type RuntimeEvaluation, type SignedRuntimeDocument,
} from './protocol';

interface StoredRuntime { highestSequence: number; envelope: SignedRuntimeDocument }
interface Discovery { protocol: typeof PROTOCOL; capabilities: Array<{ rel: string; href: string }> }

function writeAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

function readJson(file: string): unknown | undefined {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown; }
  catch { return undefined; }
}

export class RuntimeClient {
  private highestSequence = 0;
  private highestSignature: string | undefined;
  private active: RuntimeDocument | undefined;
  private readonly statePath: string;
  private readonly idPath: string;
  readonly context: RuntimeContext;

  constructor(
    root: string,
    private readonly discoveryUrl: string,
    private readonly publicKeyPem: string,
    context: Omit<RuntimeContext, 'installationId'>,
    private readonly fetcher: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.statePath = path.join(root, 'kikan-runtime', 'state.json');
    this.idPath = path.join(root, 'kikan-runtime', 'installation-id');
    let id: string;
    try { id = fs.readFileSync(this.idPath, 'utf8').trim(); }
    catch { id = randomUUID(); fs.mkdirSync(path.dirname(this.idPath), { recursive: true }); fs.writeFileSync(this.idPath, id, { mode: 0o600 }); }
    this.context = { ...context, installationId: id };
    const stored = readJson(this.statePath) as StoredRuntime | undefined;
    if (stored && Number.isSafeInteger(stored.highestSequence) && stored.highestSequence > 0) {
      try {
        const expiresAt = stored.envelope?.document?.expiresAt;
        const verificationTime = Number.isSafeInteger(expiresAt)
          ? Math.min(this.now(), expiresAt - 1) : this.now();
        const document = verifySignedDocument(stored.envelope, publicKeyPem, verificationTime);
        if (document.sequence === stored.highestSequence) {
          this.highestSequence = document.sequence;
          this.highestSignature = stored.envelope.signature;
          if (document.expiresAt > this.now()) this.active = document;
        }
      } catch { /* Invalid cache uses embedded defaults and cannot advance the replay floor. */ }
    }
  }

  /** Refresh is deliberately optional: callers never await it on startup. */
  async refresh(): Promise<boolean> {
    const origin = new URL(this.discoveryUrl);
    if (origin.protocol !== 'https:' && origin.hostname !== 'localhost' && origin.hostname !== '127.0.0.1') throw new Error('Runtime discovery requires HTTPS');
    const discoveryResponse = await this.fetcher(this.discoveryUrl, { signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } });
    if (!discoveryResponse.ok) throw new Error(`Runtime discovery HTTP ${discoveryResponse.status}`);
    const discovery = await discoveryResponse.json() as Discovery;
    if (discovery?.protocol !== PROTOCOL || !Array.isArray(discovery.capabilities)) throw new Error('Invalid runtime discovery');
    const config = discovery.capabilities.find((entry) => entry?.rel === 'urn:kikan:runtime:configuration');
    if (!config || typeof config.href !== 'string') throw new Error('Runtime configuration capability unavailable');
    const configUrl = new URL(config.href, this.discoveryUrl);
    if (configUrl.origin !== origin.origin) throw new Error('Cross-origin runtime configuration rejected');
    const response = await this.fetcher(configUrl, { signal: AbortSignal.timeout(5000), headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Runtime configuration HTTP ${response.status}`);
    const envelope = await response.json() as SignedRuntimeDocument;
    const document = verifySignedDocument(envelope, this.publicKeyPem, this.now());
    if (document.sequence < this.highestSequence) throw new Error('Stale runtime directive rejected');
    if (document.sequence === this.highestSequence && envelope.signature !== this.highestSignature) {
      throw new Error('Conflicting runtime directive sequence rejected');
    }
    const stored: StoredRuntime = { highestSequence: document.sequence, envelope };
    writeAtomic(this.statePath, stored);
    this.highestSequence = document.sequence;
    this.highestSignature = envelope.signature;
    this.active = document;
    return true;
  }

  evaluation(): RuntimeEvaluation {
    if (!this.active || this.active.expiresAt <= this.now()) {
      return { switches: {}, experiments: {}, patches: [], sequence: 0 };
    }
    return evaluateRuntime(this.active, this.context);
  }

  get verifiedSequence(): number { return this.active?.sequence ?? 0; }
}
