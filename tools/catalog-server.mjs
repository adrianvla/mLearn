// Development/test CDN fixture only. Production catalogs live on the publisher's CDN.
import { createServer } from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';

export async function startCatalog(directory, port = 7780) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
      const relative = pathname.replace(/^\/+/, '');
      if (relative.split('/').some((part) => !/^[a-zA-Z0-9._-]+$/.test(part) || part === '..' || part === '.')) throw new Error('Invalid path');
      const file = path.join(directory, relative);
      const info = await stat(file);
      if (!info.isFile()) throw new Error('Not a file');
      response.writeHead(200, { 'Content-Type': relative.endsWith('.json') ? 'application/json' : 'application/octet-stream', 'Content-Length': info.size });
      const input = createReadStream(file);
      input.on('error', () => response.destroy());
      response.on('close', () => input.destroy());
      input.pipe(response);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
