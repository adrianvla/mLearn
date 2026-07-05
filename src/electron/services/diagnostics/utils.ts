/**
 * Diagnostics utilities
 */

import http from 'http';
import https from 'https';

export function skipTest(reason: string): never {
  const err = new Error(`SKIP: ${reason}`);
  throw err;
}

export function httpGet(url: string, timeoutMs = 10_000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request to ${url} timed out after ${timeoutMs}ms`));
    });
  });
}

export function httpPost(
  url: string,
  body: object,
  timeoutMs = 10_000,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const postData = JSON.stringify(body);
    const req = client.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: responseBody });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`POST to ${url} timed out after ${timeoutMs}ms`));
    });
    req.write(postData);
    req.end();
  });
}

export function httpPostMultipart(
  url: string,
  body: Buffer,
  boundary: string,
  timeoutMs = 10_000,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': body.length,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => {
          resolve({ status: res.statusCode ?? 0, body: responseBody });
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Multipart POST to ${url} timed out after ${timeoutMs}ms`));
    });
    req.write(body);
    req.end();
  });
}

export function isConnectionRefused(err: unknown): boolean {
  if (err instanceof Error) {
    // Node 20+ throws AggregateError when both IPv4 and IPv6 fail
    if (err.name === 'AggregateError') {
      const agg = err as unknown as { errors: Array<{ code?: string }> };
      if (agg.errors?.some((e) => e.code === 'ECONNREFUSED')) return true;
    }
    if ((err as { code?: string }).code === 'ECONNREFUSED') return true;
    if (err.message.includes('ECONNREFUSED')) return true;
    if (err.message.includes('ECONNRESET')) return true;
    if (err.message.includes('socket hang up')) return true;
  }
  return false;
}

export function wsConnect(url: string, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const WebSocket = require('ws');
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`WebSocket connection to ${url} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.on('open', () => {
      clearTimeout(timer);
      ws.close();
      resolve();
    });
    ws.on('error', (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}
