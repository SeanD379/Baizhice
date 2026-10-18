import http from 'node:http';
import { readFile } from 'node:fs/promises';

const page = new URL('./wireframe.html', import.meta.url);
const server = http.createServer(async (request, response) => {
  if (request.method !== 'GET' || !['/', '/wireframe.html'].includes(request.url)) {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const content = await readFile(page);
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(content);
  } catch {
    response.writeHead(500).end('Preview file unavailable');
  }
});
server.listen(0, '127.0.0.1', () => {
  console.log(`Workbench wireframe: http://127.0.0.1:${server.address().port}`);
});
