import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Llama, LlamaModel } from 'node-llama-cpp';
import { parseGuardVerdict, type GuardVerdict, type LocalGuardStatus, type ReviewContextMessage } from '../../shared/conversationReview';
import type { RuntimeTraceContext } from '../../shared/runtimeInspection';
import { downloadFileWithProgress } from '../utils/downloadManager';
import { getUserDataPath } from '../utils/platform';
import { runtimeTrace } from './runtimeTraceService';

const GUARD = {
  name: 'Qwen3Guard-Gen-0.6B Q4_K_M',
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
const filePath = (): string => path.join(getUserDataPath(), 'models', GUARD.filename);

async function verify(file: string): Promise<void> {
  const hash = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  if (hash.digest('hex') !== GUARD.sha256) throw new Error('Local guard integrity check failed');
  verifiedFile = file;
}
export function localGuardStatus(): LocalGuardStatus {
  const file = filePath(), installation = installations.get(file);
  const installed = fs.existsSync(file);
  return { model: GUARD.name, installed, verified: installed && verifiedFile === file,
    loaded: modelFile === file && Boolean(model), downloading: Boolean(installation), progress: installation?.progress ?? 0, error };
}
export async function installLocalGuard(): Promise<void> {
  const file = filePath(), ongoing = installations.get(file);
  if (ongoing) return ongoing.promise;
  const state = { promise: Promise.resolve(), progress: 0 };
  state.promise = (async () => {
    error = undefined;
    try {
      if (fs.existsSync(file)) {
        try { await verify(file); return; }
        catch { await fs.promises.unlink(file); }
      }
      await downloadFileWithProgress(GUARD.url, file, progress => { state.progress = Math.floor(progress.progress); });
      await verify(file);
    } catch (failure) { error = failure instanceof Error ? failure.message : String(failure); throw failure; }
    finally { installations.delete(file); }
  })();
  installations.set(file, state);
  return state.promise;
}
async function loadedModel(file: string): Promise<{ model: LlamaModel; library: typeof import('node-llama-cpp') }> {
  if (!fs.existsSync(file)) throw new Error('Install the local conversation guard in AI settings');
  const library = await (native ??= new Function('return import("node-llama-cpp")')() as Promise<typeof import('node-llama-cpp')>);
  if (model && modelFile !== file) { await model.dispose(); model = undefined; modelFile = ''; }
  if (!model) {
    await verify(file);
    const runtime = await (llama ??= library.getLlama({ gpu: false, maxThreads: 2, build: 'never', skipDownload: true }));
    model = await runtime.loadModel({ modelPath: file, gpuLayers: 0, useMmap: true });
    modelFile = file;
  }
  return { model, library };
}

async function classify(messages: ReviewContextMessage[], signal: AbortSignal, context: RuntimeTraceContext): Promise<GuardVerdict> {
  const file = filePath(), profile = getUserDataPath();
  const work = queue.catch(() => undefined).then(async () => {
    signal.throwIfAborted(); if (profile !== getUserDataPath()) throw new Error('Guard profile changed');
    const { model: checkpoint, library } = await loadedModel(file);
    const template = checkpoint.fileInfo.metadata.tokenizer?.chat_template;
    if (typeof template !== 'string' || !template.includes('Safety:') || !template.includes('Categories:')) throw new Error('Guard checkpoint lacks its moderation template');
    const contextWindow = await checkpoint.createContext({ contextSize: 4096, sequences: 1, threads: 2, batchSize: 128 });
    const session = new library.LlamaChat({ contextSequence: contextWindow.getSequence(),
      chatWrapper: new library.JinjaTemplateChatWrapper({ template, tokenizer: checkpoint.tokenizer }) });
    const trace = runtimeTrace(), traceId = trace.begin({ kind: 'model', context, input: { messages, checkpointSha256: GUARD.sha256, template: 'verified GGUF metadata' } });
    trace.start(traceId, { provider: 'builtin-guard-cpu', model: GUARD.name });
    try {
      const history = messages.map(item => item.role === 'user'
        ? { type: 'user' as const, text: item.content }
        : { type: 'model' as const, response: [item.content] });
      const result = await session.generateResponse(history, { signal, temperature: 0, maxTokens: 128,
        onTextChunk: content => trace.chunk(traceId, { content }) });
      signal.throwIfAborted(); if (profile !== getUserDataPath()) throw new Error('Guard profile changed');
      if (result.metadata.stopReason === 'maxTokens') throw new Error('Guard response exceeded its output budget');
      const verdict = parseGuardVerdict(result.response);
      trace.finish(traceId, 'completed', { result: verdict }); error = undefined; return verdict;
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
      trace.finish(traceId, signal.aborted ? 'cancelled' : 'failed', { error }); throw failure;
    } finally { session.dispose(); await contextWindow.dispose(); }
  });
  queue = work;
  return work;
}

export async function classifyLocalContent(text: string, role: 'user' | 'assistant', recent: ReviewContextMessage[],
  signal: AbortSignal, context: RuntimeTraceContext): Promise<GuardVerdict[]> {
  const verdicts: GuardVerdict[] = [];
  for (let offset = 0; offset < text.length; offset += 3500) {
    signal.throwIfAborted();
    const window = text.slice(Math.max(0, offset - 120), offset + 3500);
    const previous = recent.slice(-2).map(item => ({ ...item, content: item.content.slice(-1000) }));
    verdicts.push(await classify([...previous, { role, content: window }], signal, context));
  }
  return verdicts;
}

export async function unloadLocalGuard(): Promise<void> {
  await queue.catch(() => undefined);
  if (model) await model.dispose();
  model = undefined; modelFile = '';
}
