import type { RuntimeClient } from '@mlearn/runtime-client';
export type Host = { available: true; client: RuntimeClient; label: string } | { available: false; label: string; reason: string };
