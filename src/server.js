import http from 'node:http';

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

if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, '0.0.0.0', () => console.log(`iGaming Radar listening on ${port}`));
}
