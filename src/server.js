import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function createServer() {
  return http.createServer((req, res) => {
    res.setHeader('content-type', 'application/json; charset=utf-8');
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200);
      return res.end(JSON.stringify({ status: 'ok', service: 'igaming-radar', version: '0.1.0' }));
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'not_found' }));
  });
}

export function startServer({ port = Number(process.env.PORT || 3000), host = '0.0.0.0' } = {}) {
  const server = createServer();
  server.listen(port, host, () => console.log(`iGaming Radar listening on ${port}`));
  return server;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectRun) startServer();
