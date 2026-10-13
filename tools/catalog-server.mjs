// Development/test CDN fixture only. Production catalogs live on the publisher's CDN.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export async function startCatalog(directory, port = 7780) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
      const relative = pathname.replace(/^\/+/, '');
      if (relative.split('/').some((part) => !/^[a-zA-Z0-9._-]+$/.test(part) || part === '..' || part === '.')) throw new Error('Invalid path');
      const data = await readFile(path.join(directory, relative));
      response.writeHead(200, { 'Content-Type': relative.endsWith('.json') ? 'application/json' : 'application/wasm', 'Content-Length': data.length });
      response.end(data);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
