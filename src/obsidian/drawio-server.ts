import type { Server } from 'node:http';

const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', json: 'application/json', txt: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml', png: 'image/png', gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg', ico: 'image/x-icon', xml: 'application/xml', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf',
};

/** Serves the bundled draw.io folder on 127.0.0.1 (random port, GET only, never outside that folder).
 *  draw.io needs a normal http origin: it does not finish loading from Obsidian's app:// resources. Desktop only. */
export class DrawioServer {
  private server?: Server;
  private starting?: Promise<string>;
  constructor(private root: () => string) {}

  url(): Promise<string> { return (this.starting ??= this.start().catch((e) => { this.starting = undefined; throw e; })); }

  private start(): Promise<string> {
     
    const http = require('http') as typeof import('http'), fs = require('fs') as typeof import('fs'), path = require('path') as typeof import('path');
    const base = path.resolve(this.root());
    return new Promise((resolve, reject) => {
      const srv = http.createServer((req, res) => {
        const fail = (code: number) => { res.writeHead(code, { 'content-type': 'text/plain' }); res.end(); };
        if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405);
        let rel: string;
        try { rel = decodeURIComponent((req.url ?? '/').split('?')[0]!.split('#')[0]!); } catch { return fail(400); }
        if (rel.includes('\0')) return fail(400);
        const file = path.resolve(base, '.' + (rel.endsWith('/') ? `${rel}index.html` : rel));
        if (file !== base && !file.startsWith(base + path.sep)) return fail(403);
        fs.readFile(file, (err, data) => {
          if (err) return fail(404);
          res.writeHead(200, { 'content-type': TYPES[path.extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
          res.end(req.method === 'HEAD' ? undefined : data);
        });
      });
      srv.on('error', reject);
      srv.listen(0, '127.0.0.1', () => {
        this.server = srv;
        const a = srv.address();
        resolve(`http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`);
      });
    });
  }

  stop() { this.server?.close(); this.server = undefined; this.starting = undefined; }
}
