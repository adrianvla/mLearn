import { randomUUID } from 'crypto';
import type { LLMStreamChunk } from '../../shared/types';
import type { RuntimeTraceContext, RuntimeTraceEntry, RuntimeTraceList, RuntimeTraceStatus } from '../../shared/runtimeInspection';

/** In-memory only; bounded independently of provider output and chat history. */
export function createRuntimeTraceStore(limits: { maxEntries?: number; maxFieldCharacters?: number; maxCharacters?: number } = {}) {
  const maxEntries = limits.maxEntries ?? 128;
  const maxField = limits.maxFieldCharacters ?? 262144;
  const maxCharacters = limits.maxCharacters ?? 8 * 1024 * 1024;
  const entries = new Map<string, RuntimeTraceEntry>();
  const sizes = new Map<string, number>();
  const listeners = new Set<() => void>();
  let retainedCharacters = 0, enabled = false, profile = '', revision = 0;
  let secrets: readonly string[] = [];
  const changed = (): void => { revision++; for (const listener of listeners) { try { listener(); } catch { /* Inspection cannot break inference. */ } } };
  const clear = (): void => { entries.clear(); sizes.clear(); retainedCharacters = 0; changed(); };
  const redact = (text: string): string => {
    let result = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
      .replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}/g, '[redacted]')
      .replace(/([?&](?:api[-_]?key|access[-_]?token|refresh[-_]?token|session[-_]?token|id[-_]?token|auth(?:orization)?|password|client[-_]?secret)=)[^&#\s]+/gi, '$1[redacted]');
    for (const secret of secrets) if (secret.length >= 4) result = result.split(secret).join('[redacted]');
    return result;
  };
  const sanitize = (value: unknown): { value: unknown; truncated: boolean } => {
    try {
      const json = JSON.stringify(value, (key, item: unknown) => {
        if (/^(authorization|password|api[-_]?key|access[-_]?token|refresh[-_]?token|session[-_]?token|id[-_]?token|client[-_]?secret|private[-_]?key|credential|secret|cloudAuthAccessToken|cloudAuthToken|compatibleApiKey|cookie)$/i.test(key)) return '[redacted]';
        return typeof item === 'string' ? redact(item) : item;
      });
      if (json === undefined) return { value: null, truncated: false };
      if (json.length > maxField) return { value: { truncated: true, jsonPrefix: json.slice(0, maxField) }, truncated: true };
      return { value: JSON.parse(json), truncated: false };
    } catch { return { value: '[unserializable capture]', truncated: true }; }
  };
  const account = (entry: RuntimeTraceEntry): void => {
    const size = JSON.stringify(entry).length;
    retainedCharacters += size - (sizes.get(entry.id) ?? 0); sizes.set(entry.id, size);
    while (entries.size > maxEntries || retainedCharacters > maxCharacters) {
      const oldest = entries.keys().next().value as string | undefined;
      if (!oldest) break;
      retainedCharacters -= sizes.get(oldest) ?? 0; sizes.delete(oldest); entries.delete(oldest);
    }
    changed();
  };
  const get = (id: string): RuntimeTraceEntry | null => {
    const entry = entries.get(id); return enabled && entry ? structuredClone(entry) : null;
  };
  return {
    configure(nextEnabled: boolean, nextProfile: string, credentials: readonly string[] = []): void {
      const reset = enabled !== nextEnabled || profile !== nextProfile;
      enabled = nextEnabled; profile = nextProfile; secrets = credentials;
      if (reset) clear();
    },
    clear,
    subscribe(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); },
    begin(input: { id?: string; kind: 'model' | 'tool'; context: RuntimeTraceContext; input: unknown }): string | undefined {
      if (!enabled) return undefined;
      const id = input.id ?? randomUUID(); if (entries.has(id)) return id;
      const captured = sanitize(input.input);
      const context = sanitize(input.context);
      const now = Date.now();
      const entry: RuntimeTraceEntry = { id, kind: input.kind,
        context: context.truncated ? { source: 'invalid-context' } : context.value as RuntimeTraceContext,
        status: 'queued', startedAt: now, updatedAt: now, truncated: captured.truncated,
        input: captured.value, output: {} };
      entries.set(id, entry); account(entry); return id;
    },
    start(id: string | undefined, execution?: { provider: string; model?: string; tier?: string }): void {
      const entry = id ? entries.get(id) : undefined;
      if (!enabled || !entry || entry.finishedAt !== undefined) return;
      if (execution) Object.assign(entry, sanitize(execution).value);
      const now = Date.now();
      if (entry.kind === 'model') entry.providerStartedAt ??= now;
      entry.status = 'running'; entry.updatedAt = now; account(entry);
    },
    chunk(id: string | undefined, chunk: LLMStreamChunk): void {
      const entry = id ? entries.get(id) : undefined;
      if (!enabled || !entry || entry.finishedAt !== undefined) return;
      const { content, ...rest } = chunk;
      const metadata = sanitize(rest);
      if (!metadata.truncated && metadata.value && typeof metadata.value === 'object') Object.assign(entry.output, metadata.value);
      if (metadata.truncated) entry.truncated = true;
      const now = Date.now();
      if (content) {
        if (entry.kind === 'model' && entry.providerStartedAt !== undefined && entry.firstTokenAt === undefined) {
          entry.firstTokenAt = now;
          entry.timeToFirstTokenMs = now - entry.providerStartedAt;
        }
        const text = redact((entry.output.content ?? '') + content);
        if (text.length > maxField) entry.truncated = true;
        entry.output.content = text.slice(0, maxField);
      }
      entry.updatedAt = now;
      if (chunk.done || chunk.error) {
        entry.status = chunk.error ? 'failed' : 'completed'; entry.finishedAt = entry.updatedAt;
      }
      account(entry);
    },
    finish(id: string | undefined, status: Extract<RuntimeTraceStatus, 'completed' | 'failed' | 'cancelled'>, output?: RuntimeTraceEntry['output']): void {
      const entry = id ? entries.get(id) : undefined;
      if (!enabled || !entry || entry.finishedAt !== undefined) return;
      if (output) {
        const captured = sanitize(output);
        if (captured.truncated) { entry.output.result = captured.value; entry.truncated = true; }
        else Object.assign(entry.output, captured.value);
      }
      entry.status = status; entry.updatedAt = Date.now(); entry.finishedAt = entry.updatedAt; account(entry);
    },
    get,
    list(): RuntimeTraceList {
      return { available: true, enabled, revision, entries: enabled ? [...entries.values()].reverse().map(({ input: _input, output: _output, ...summary }) => structuredClone(summary)) : [] };
    },
  };
}
