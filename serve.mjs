// Minimal static file server for local QA.
// Usage: node serve.mjs           -> auto-picks the first free port from 3000 up
//        node serve.mjs 3010      -> use an explicit port (fails if taken)
// The chosen port is written to `.devport` in this folder; screenshot.mjs and
// qa.mjs read it automatically, so no project ever needs a port typed anywhere.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectName = path.basename(__dirname);
const explicitPort = process.argv[2] || process.env.PORT;
const startPort = Number(explicitPort || 3000);
const autoFind = !explicitPort;   // only hunt for a free port when none was given
const devportFile = path.join(__dirname, '.devport');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  try {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.join(__dirname, urlPath);
    // prevent path traversal
    if (!filePath.startsWith(__dirname)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found: ' + urlPath);
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) {
    res.writeHead(500); res.end('Server error');
  }
});

// Try to bind; on EADDRINUSE, hop to the next port (up to 50 tries) when auto-finding.
function attempt(port, triesLeft) {
  const onError = (e) => {
    server.removeListener('listening', onListening);
    if (e.code === 'EADDRINUSE' && autoFind && triesLeft > 0) {
      attempt(port + 1, triesLeft - 1);
    } else {
      console.error(`Could not start server on port ${port}: ${e.message}`);
      process.exit(1);
    }
  };
  const onListening = () => {
    server.removeListener('error', onError);
    const actual = server.address().port;
    try { fs.writeFileSync(devportFile, String(actual)); } catch {}
    console.log(`${projectName} dev server running at http://localhost:${actual}`);
    console.log(`(port ${actual} written to .devport — screenshot.mjs and qa.mjs read it automatically)`);
  };
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port);
}
// Clean up the .devport file on exit so a dead server doesn't leave a stale port.
for (const sig of ['SIGINT', 'SIGTERM', 'exit']) {
  process.once(sig, () => { try { fs.unlinkSync(devportFile); } catch {} });
}
attempt(startPort, autoFind ? 50 : 0);
