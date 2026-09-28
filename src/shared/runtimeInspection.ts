/** Developer-only observations. These are captured requests, never reconstructed prompts. */
export interface RuntimeTraceContext {
  source: string;
  requestId?: string;
  sourceEventId?: string;
  roomId?: string;
  threadId?: string;
  participantId?: string;
  operationId?: string;
}
export type RuntimeTraceStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface RuntimeTraceSummary {
  id: string;
  kind: 'model' | 'tool';
  context: RuntimeTraceContext;
  status: RuntimeTraceStatus;
  startedAt: number;
  updatedAt: number;
  finishedAt?: number;
  truncated: boolean;
  provider?: string;
  model?: string;
  tier?: string;
}
export interface RuntimeTraceEntry extends RuntimeTraceSummary {
  input: unknown;
  output: { content?: string; result?: unknown; error?: string; [key: string]: unknown };
}
export interface RuntimeTraceList {
  available: boolean;
  enabled: boolean;
  revision: number;
  entries: RuntimeTraceSummary[];
}
export interface RuntimeToolObservation {
  id: string;
  context: RuntimeTraceContext;
  name: string;
  arguments: unknown;
  status: 'running' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
}
export interface WorldChangeNotice {
  kind: 'world' | 'journal';
  roomId?: string;
  threadId?: string;
}
