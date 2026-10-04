import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { LearningEvidenceSnapshot } from '../../shared/learningEvidence';

/** One read-only worker; full journal scans and fitting never occupy Electron's main loop. */
export class LearningEvidenceReader {
  private worker: Worker | undefined;
  private nextId = 0;
  private pending = new Map<number, { resolve: (snapshot: LearningEvidenceSnapshot) => void; reject: (error: Error) => void }>();
  private requests = new Map<string, Promise<LearningEvidenceSnapshot>>();

  constructor(private dbPath: string, private workerPath = path.join(__dirname, 'learningEvidenceWorker.js')) {}

  query(language: string, sequence: number): Promise<LearningEvidenceSnapshot> {
    if (typeof language !== 'string' || !language || language.length > 128) return Promise.reject(new Error('Invalid learning language'));
    const key = JSON.stringify([language, sequence]);
    const existing = this.requests.get(key);
    if (existing) return existing;
    if (!this.worker) {
      const worker = new Worker(this.workerPath, { workerData: { dbPath: this.dbPath }, execArgv: [] });
      this.worker = worker;
      const fail = (error: Error) => {
        if (this.worker !== worker) return;
        this.worker = undefined;
        for (const request of this.pending.values()) request.reject(error);
        this.pending.clear();
        void worker.terminate();
      };
      worker.on('error', fail);
      worker.on('exit', code => fail(new Error(`Learning evidence worker exited (${code})`)));
      worker.on('message', (reply: { id: number; snapshot: LearningEvidenceSnapshot; error?: string }) => {
        const request = this.pending.get(reply.id);
        if (!request) return;
        this.pending.delete(reply.id);
        if (reply.error !== undefined) request.reject(new Error(reply.error));
        else request.resolve(reply.snapshot);
        if (this.pending.size === 0) worker.unref();
      });
      worker.unref();
    }
    const id = ++this.nextId;
    const promise = new Promise<LearningEvidenceSnapshot>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.ref();
      try { this.worker!.postMessage({ id, language }); }
      catch (error) { this.pending.delete(id); reject(error instanceof Error ? error : new Error(String(error))); }
    });
    this.requests.set(key, promise);
    const clear = () => { if (this.requests.get(key) === promise) this.requests.delete(key); };
    void promise.then(clear, clear);
    return promise;
  }

  async close(): Promise<void> {
    const worker = this.worker;
    this.worker = undefined;
    for (const request of this.pending.values()) request.reject(new Error('Learning evidence reader closed'));
    this.pending.clear();
    this.requests.clear();
    if (worker) await worker.terminate();
  }
}
