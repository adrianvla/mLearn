import type { Request, Response, Snapshot, ThemeDocument } from '@mlearn/contracts';

export interface Transport {
  execute(request: string): Promise<string>;
  commandId(): string;
}
export class RuntimeError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'RuntimeError'; }
}

export function createRuntimeClient(transport: Transport) {
  async function request(command: Request): Promise<Response> {
    const raw = await transport.execute(JSON.stringify(command));
    if (raw.length > 524_288) throw new RuntimeError('protocol', 'Native response exceeds the message limit.');
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('type' in value) || typeof value.type !== 'string') throw new RuntimeError('protocol', 'Malformed native response.');
    const response = value as Response;
    if (response.type === 'error') throw new RuntimeError(response.code, response.message);
    return response;
  }
  return {
    async snapshot(): Promise<Snapshot> {
      const response = await request({ type: 'snapshot' });
      if (response.type !== 'snapshot' || response.snapshot.protocolVersion !== 1) throw new RuntimeError('protocol', 'Unsupported native protocol.');
      return response.snapshot;
    },
    async saveTheme(document: ThemeDocument, expectedRevision: number): Promise<number> {
      const response = await request({ type: 'save_theme', document, expectedRevision, commandId: transport.commandId() });
      if (response.type !== 'saved') throw new RuntimeError('protocol', 'Missing settings commit receipt.');
      return response.revision;
    },
    async installPlugin(pluginId: string) {
      const response = await request({ type: 'install_plugin', pluginId });
      if (response.type !== 'installed') throw new RuntimeError('protocol', 'Missing plugin installation receipt.');
      return response.plugin;
    },
    async invokePlugin(pluginId: string, capability: string, input: unknown): Promise<unknown> {
      const response = await request({ type: 'invoke_plugin', pluginId, capability, input });
      if (response.type !== 'plugin_result') throw new RuntimeError('protocol', 'Missing plugin result.');
      return response.output;
    },
  };
}
export type RuntimeClient = ReturnType<typeof createRuntimeClient>;
