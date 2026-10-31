'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = __dirname;
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};

const server = http.createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method not allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    response.writeHead(400);
    response.end('Invalid URL');
    return;
  }

  if (pathname.includes('\0')) {
    response.writeHead(400);
    response.end('Invalid path');
    return;
  }

  const filePath = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  const relativePath = path.relative(root, filePath);
  if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError) {
      if (statError.code !== 'ENOENT' && statError.code !== 'ENOTDIR') {
        console.error('Could not inspect requested file:', statError);
        response.writeHead(500);
        response.end('Internal server error');
        return;
      }
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    if (!stats.isFile()) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'Cache-Control': 'no-cache',
      'Content-Length': stats.size,
      'Content-Type': contentTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff'
    });

    if (request.method === 'HEAD') {
      response.end();
      return;
    }

    const stream = fs.createReadStream(filePath);
    stream.on('error', (error) => {
      console.error('Could not read requested file:', error);
      if (!response.headersSent) response.writeHead(500);
      response.end('Internal server error');
    });
    stream.pipe(response);
  });
});

const port = Number(process.env.PORT) || 10000;
server.on('error', (error) => {
  console.error('The web server could not start:', error);
  process.exitCode = 1;
});
server.listen(port, '0.0.0.0', () => {
  console.log(`Emlékkönyv elérhető: http://localhost:${port}`);
});
