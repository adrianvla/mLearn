/** Independent CPU guard. Never unloads/reconfigures the actor and never silently calls a hosted provider. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Llama, LlamaModel } from 'node-llama-cpp';
import { downloadFileWithProgress } from '../utils/downloadManager';
import { getUserDataPath } from '../utils/platform';
import { guardTemplateParts } from './guardTemplate';
import { runtimeTrace } from './runtimeTraceService';
import { guardTextWindows, parseGuardVerdict, REVIEW_LIMITS, type GuardVerdict, type LocalGuardStatus, type ReviewContextMessage } from '../../shared/conversationReview';
import type { RuntimeTraceContext } from '../../shared/runtimeInspection';

// Community quantization, not an official Qwen GGUF. The digest is the artifact's published SHA256.
// https://huggingface.co/QuantFactory/Qwen3Guard-Gen-0.6B-GGUF/blob/main/Qwen3Guard-Gen-0.6B.Q4_K_M.gguf
export const LOCAL_GUARD = {
  name: 'Qwen3Guard-Gen-0.6B · Q4_K_M (QuantFactory)',
  filename: 'Qwen3Guard-Gen-0.6B.Q4_K_M.gguf',
  url: 'https://huggingface.co/QuantFactory/Qwen3Guard-Gen-0.6B-GGUF/resolve/main/Qwen3Guard-Gen-0.6B.Q4_K_M.gguf',
  sha256: 'a0d3385101ba362822d914ba40d9767aff634811ac99a41e4509de2d7a453b3e',
} as const;
let native: Promise<typeof import('node-llama-cpp')> | undefined;
let llama: Promise<Llama> | undefined;
let model: LlamaModel | undefined;
let modelFile = '', verifiedFile = '', error: string | undefined;
let queue: Promise<unknown> = Promise.resolve();
const installations = new Map<string, { promise: Promise<void>; progress: number }>();
const listeners = new Set<() => void>();
function changed(): void { for (const listener of listeners) { try { listener(); } catch { /* status must not affect inference */ } } }
export function subscribeLocalGuard(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }
function filePath(): string { return path.join(getUserDataPath(), 'models', LOCAL_GUARD.filename); }
async function verify(file: string): Promise<void> {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== LOCAL_GUARD.sha256) throw new Error('Local guard integrity check failed. Reinstall the verified model.');
  verifiedFile = file;
}
export function localGuardStatus(): LocalGuardStatus {
  const file = filePath(), installation = installations.get(file); const installed = fs.existsSync(file);
  return { model: LOCAL_GUARD.name, installed, verified: installed && verifiedFile === file, loaded: modelFile === file && Boolean(model), downloading: Boolean(installation), progress: installation?.progress ?? 0, error };
}
/** Explicit one-click install; interrupted downloads resume through the shared downloader. */
export async function installLocalGuard(): Promise<void> {
  const file = filePath(); const existing = installations.get(file); if (existing) return existing.promise;
  const state = { promise: Promise.resolve(), progress: 0 };
  state.promise = (async () => {
    error = undefined; changed();
    try {
      if (fs.existsSync(file)) {
        try { await verify(file); return; } catch { await fs.promises.unlink(file); }
      }
      await downloadFileWithProgress(LOCAL_GUARD.url, file, progress => { const next = Math.floor(progress.progress); if (next !== state.progress) { state.progress = next; changed(); } });
      await verify(file);
    } catch (failure) { error = failure instanceof Error ? failure.message : String(failure); throw failure; }
    finally { installations.delete(file); changed(); }
  })();
  installations.set(file, state); return state.promise;
}
async function getModel(file: string): Promise<{ model: LlamaModel; library: typeof import('node-llama-cpp') }> {
  if (!fs.existsSync(file)) throw new Error('Install the local guard in AI settings before reviewing a conversation.');
  const library = await (native ??= new Function('return import("node-llama-cpp")')() as Promise<typeof import('node-llama-cpp')>);
  if (model && modelFile !== file) { await model.dispose(); model = undefined; modelFile = ''; }
  if (!model) {
    await verify(file); // check once per actual model load, not only when downloaded
    const runtime = await (llama ??= library.getLlama({ gpu: false, maxThreads: 2, build: 'never', skipDownload: true }));
    model = await runtime.loadModel({ modelPath: file, gpuLayers: 0, useMmap: true }); modelFile = file;
    changed();
  }
  return { model, library };
}
async function classify(messages: ReviewContextMessage[], signal: AbortSignal, context: RuntimeTraceContext): Promise<GuardVerdict> {
  const file = filePath(), profile = getUserDataPath();
  const work = queue.catch(() => undefined).then(async () => {
    signal.throwIfAborted(); if (profile !== getUserDataPath()) throw new Error('Guard review profile changed');
    const loaded = await getModel(file); signal.throwIfAborted();
    if (profile !== getUserDataPath()) throw new Error('Guard review profile changed');
    const template = loaded.model.fileInfo.metadata.tokenizer?.chat_template;
    if (typeof template !== 'string' || !template.includes('Safety:') || !template.includes('Categories:')) throw new Error('The guard checkpoint is missing its moderation template');
    const parts = guardTemplateParts(template, messages);
    const text = loaded.library.LlamaText(parts.map(part => part.special ? new loaded.library.SpecialTokensText(part.text) : part.text));
    const tokens = text.tokenize(loaded.model.tokenizer);
    // Never classify a truncated suffix/prefix as the complete message.
    if (tokens.length > 4096 - REVIEW_LIMITS.outputTokens) throw new Error('This review window exceeds the local guard context budget');
    const trace = runtimeTrace(); const traceId = trace.begin({ kind: 'model', context, input: { messages, prompt: text.toString(), checkpointSha256: LOCAL_GUARD.sha256, contextSize: 4096 } });
    trace.start(traceId, { provider: 'builtin-guard-cpu', model: LOCAL_GUARD.name });
    let modelContext: Awaited<ReturnType<LlamaModel['createContext']>> | undefined;
    try {
      modelContext = await loaded.model.createContext({ contextSize: 4096, sequences: 1, threads: 2, batchSize: 128 });
      signal.throwIfAborted();
      if (profile !== getUserDataPath()) throw new Error('Guard review profile changed');
      const completion = new loaded.library.LlamaCompletion({ contextSequence: modelContext.getSequence() });
      const output = await completion.generateCompletion(tokens, { signal, temperature: 0, maxTokens: REVIEW_LIMITS.outputTokens, disableContextShift: true,
        onTextChunk: content => trace.chunk(traceId, { content }) });
      const verdict = parseGuardVerdict(output);
      if (profile !== getUserDataPath()) throw new Error('Guard review profile changed');
      trace.finish(traceId, 'completed', { result: verdict }); error = undefined; return verdict;
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
      trace.finish(traceId, signal.aborted ? 'cancelled' : 'failed', { error }); changed(); throw failure;
    } finally { await modelContext?.dispose(); }
  });
  queue = work; return work;
}
export async function classifyLocalContent(text: string, role: 'user' | 'assistant', recent: ReviewContextMessage[], signal: AbortSignal, context: RuntimeTraceContext): Promise<GuardVerdict[]> {
  const windows = guardTextWindows(text), verdicts: GuardVerdict[] = [];
  // Context is bounded; every byte of the REVIEWED text is covered by overlapping windows.
  const prior = recent.slice(-2).map(message => ({ ...message, content: message.content.slice(-REVIEW_LIMITS.recentText) }));
  for (const window of windows) {
    signal.throwIfAborted();
    const messages: ReviewContextMessage[] = [...prior];
    if (role === 'assistant' && messages.at(-1)?.role !== 'user') messages.push({ role: 'user', content: 'Continue the conversation.' });
    messages.push({ role, content: window });
    verdicts.push(await classify(messages, signal, context));
  }
  return verdicts;
}
export async function unloadLocalGuard(): Promise<void> {
  await queue.catch(() => undefined); if (model) await model.dispose(); model = undefined; modelFile = ''; changed();
}
