import { generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTempDir, type TempDir } from '../../../test/helpers/tempDir';
import { RuntimeClient } from './client';
import { canonicalJson, evaluateRuntime, PROTOCOL, validateRuntimeDocument, verifySignedDocument, type RuntimeDocument } from './protocol';

const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const now = Date.UTC(2026, 8, 23);
const document = (sequence = 1): RuntimeDocument => ({
  protocol: PROTOCOL, sequence, issuedAt: now - 1000, expiresAt: now + 86_400_000,
  switches: [{ id: 'cloud-llm', enabled: false, target: { platforms: ['darwin'], rolloutPercent: 100 } }],
  experiments: [{ id: 'update-download-policy', variants: [{ id: 'manual', weight: 50 }, { id: 'automatic', weight: 50 }] }],
  patches: [{ id: 'stop-plugin-installs', capability: 'plugin-install', operation: 'disable' }],
  update: { autoCheck: true, targetVersion: '2.8.0', allowReleaseRollback: true, maxDataSchema: 3 },
});
const envelope = (doc: RuntimeDocument) => ({ document: doc, signature: sign(null, Buffer.from(canonicalJson(doc)), keys.privateKey).toString('base64') });
const response = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
let temp: TempDir;

beforeEach(() => { temp = createTempDir('kikan-runtime-'); });
afterEach(() => temp.cleanup());

describe('KikanRuntime signed control plane', () => {
  it('authenticates directives and rejects malformed or expired content', () => {
    const signed = envelope(document());
    expect(verifySignedDocument(signed, publicKey, now).sequence).toBe(1);
    expect(() => verifySignedDocument({ ...signed, document: { ...signed.document, sequence: 2 } }, publicKey, now)).toThrow('signature');
    expect(() => validateRuntimeDocument({ ...document(), patches: [{ id: 'shell', command: 'rm -rf /' }] }, now)).toThrow();
    expect(() => verifySignedDocument(envelope({ ...document(), expiresAt: now - 1 }), publicKey, now)).toThrow('Expired');
    expect(() => validateRuntimeDocument({ ...document(), update: {
      autoCheck: true, targetVersion: '2.8.0', allowReleaseRollback: true, maxDataSchema: 3,
      feedUrl: 'http://runtime.example/rollbacks/2.8.0/',
    } }, now)).toThrow('HTTPS');
    expect(() => validateRuntimeDocument({ ...document(), update: {
      autoCheck: true, targetVersion: '2.8.0', allowReleaseRollback: true, maxDataSchema: 3,
      feedUrl: 'https://runtime.example/rollbacks/2.7.0/',
    } }, now)).toThrow('must match');
  });

  it('evaluates targeting and stable cohorts without exposing installation IDs', () => {
    const context = { installationId: 'local-only', platform: 'darwin', channel: 'stable', appVersion: '2.9.11', dataSchema: 3 };
    const first = evaluateRuntime(document(), context);
    expect(evaluateRuntime(document(), context)).toEqual(first);
    expect(first.switches['cloud-llm']).toBe(false);
    expect(['manual', 'automatic']).toContain(first.experiments['update-download-policy']);
    expect(first.patches[0].operation).toBe('disable');
    expect(first.update?.allowReleaseRollback).toBe(true);
    expect(evaluateRuntime(document(), { ...context, dataSchema: 4 }).update).toBeUndefined();
    expect(evaluateRuntime(document(), { ...context, platform: 'linux' }).switches['cloud-llm']).toBeUndefined();
  });

  it('discovers capabilities, preserves verified LKG offline, and rejects replay', async () => {
    let offered = envelope(document(2));
    const fetcher = vi.fn(async (input: string | URL | Request) => String(input).endsWith('discovery.json')
      ? response({ protocol: PROTOCOL, capabilities: [{ rel: 'urn:kikan:runtime:configuration', href: './configuration.json' }] })
      : response(offered));
    const context = { platform: 'darwin', channel: 'stable', appVersion: '2.9.11', dataSchema: 3 };
    const client = new RuntimeClient(temp.tmpDir, 'https://runtime.example/discovery.json', publicKey, context, fetcher as typeof fetch, () => now);
    expect(client.evaluation().sequence).toBe(0);
    await client.refresh();
    expect(client.evaluation().sequence).toBe(2);
    const offline = new RuntimeClient(temp.tmpDir, 'https://runtime.example/discovery.json', publicKey, context,
      vi.fn(async () => { throw new Error('offline'); }) as typeof fetch, () => now);
    expect(offline.evaluation().sequence).toBe(2);
    await expect(offline.refresh()).rejects.toThrow('offline');
    expect(offline.evaluation().sequence).toBe(2);
    offered = envelope(document(1));
    await expect(client.refresh()).rejects.toThrow('Stale');
    expect(client.evaluation().sequence).toBe(2);
    const expired = new RuntimeClient(temp.tmpDir, 'https://runtime.example/discovery.json', publicKey, context, fetcher as typeof fetch, () => now + 90_000_000);
    expect(expired.evaluation().sequence).toBe(0);
  });

  it('rejects cross-origin capability redirection', async () => {
    const fetcher = vi.fn(async () => response({ protocol: PROTOCOL,
      capabilities: [{ rel: 'urn:kikan:runtime:configuration', href: 'https://evil.example/configuration.json' }] }));
    const client = new RuntimeClient(temp.tmpDir, 'https://runtime.example/discovery.json', publicKey,
      { platform: 'darwin', channel: 'stable', appVersion: '2.9.11', dataSchema: 3 }, fetcher as typeof fetch, () => now);
    await expect(client.refresh()).rejects.toThrow('Cross-origin');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('ignores a forged local replay floor while retaining an expired signed floor', async () => {
    const statePath = path.join(temp.tmpDir, 'kikan-runtime', 'state.json');
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ highestSequence: 999, envelope: envelope(document(1)) }));
    const fetcher = vi.fn(async (input: string | URL | Request) => String(input).endsWith('discovery.json')
      ? response({ protocol: PROTOCOL, capabilities: [{ rel: 'urn:kikan:runtime:configuration', href: './configuration.json' }] })
      : response(envelope(document(2))));
    const context = { platform: 'darwin', channel: 'stable', appVersion: '2.9.11', dataSchema: 3 };
    const client = new RuntimeClient(temp.tmpDir, 'https://runtime.example/discovery.json', publicKey, context, fetcher as typeof fetch, () => now);
    await expect(client.refresh()).resolves.toBe(true);
    expect(client.verifiedSequence).toBe(2);

    const expired = new RuntimeClient(temp.tmpDir, 'https://runtime.example/discovery.json', publicKey, context,
      fetcher as typeof fetch, () => now + 90_000_000);
    expect(expired.evaluation().sequence).toBe(0);
    await expect(expired.refresh()).rejects.toThrow('Expired');
  });
});
