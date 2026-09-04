// Static file server for the journey. No dependencies, no configuration.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// 0 means "any free port". A fixed port turns one crashed run into every
// later run failing with EADDRINUSE, which is a flake in CI and a puzzle
// locally; the caller reads the real port off the returned server.
const PORT = Number(process.argv[3] || 0);
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.wav': 'audio/wav', '.webmanifest': 'application/manifest+json',
  '.bin': 'application/octet-stream', '.txt': 'text/plain'
};

export function serve(root = ROOT, port = PORT) {
  const server = createServer(async (request, response) => {
    try {
      let path = decodeURIComponent(new URL(request.url, 'http://local').pathname);
      if (path.endsWith('/')) path += 'index.html';
      const full = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ''));
      const info = await stat(full);
      const body = await readFile(info.isDirectory() ? join(full, 'index.html') : full);
      response.writeHead(200, { 'content-type': TYPES[extname(full)] || 'application/octet-stream' });
      response.end(body);
    } catch {
      response.writeHead(404, { 'content-type': 'text/plain' });
      response.end('not found');
    }
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = await serve();
  console.log(`serving ${ROOT} on http://127.0.0.1:${server.address().port}`);
}
