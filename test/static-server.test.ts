import { request } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaticServer } from '../src/obsidian/static-server';

function get(url: string, path: string, method = 'GET'): Promise<{ status: number; body: string; type?: string }> {
  return new Promise((resolve, reject) => {
    const req = request(new URL(url), { path, method }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString(), type: res.headers['content-type'] }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('draw.io static server', () => {
  let server: StaticServer | undefined;
  afterEach(() => server?.stop());

  it('serves only add-on files through the vault adapter', async () => {
    const adapter = {
      exists: vi.fn(async (path: string) => path === '.obsidian/plugins/flowmotion/drawio/index.html'),
      readBinary: vi.fn(async () => new TextEncoder().encode('editor').buffer),
    };
    server = new StaticServer(adapter, () => '.obsidian/plugins/flowmotion/drawio');
    const url = await server.url();
    expect(await get(url, '/')).toMatchObject({ status: 200, body: 'editor', type: 'text/html; charset=utf-8' });
    expect(await get(url, '/index.html', 'HEAD')).toMatchObject({ status: 200, body: '' });
    expect(await get(url, '/missing')).toMatchObject({ status: 404 });
    expect(await get(url, '/%2e%2e/secret')).toMatchObject({ status: 403 });
    expect(await get(url, '/%5csecret')).toMatchObject({ status: 403 });
    expect(await get(url, '/', 'POST')).toMatchObject({ status: 405 });
    expect(adapter.readBinary).toHaveBeenCalledWith('.obsidian/plugins/flowmotion/drawio/index.html');
    expect(adapter.readBinary).toHaveBeenCalledTimes(2);
  });

  it('reports adapter failures instead of treating them as missing files', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      server = new StaticServer({ exists: async () => true, readBinary: async () => { throw new Error('read failed'); } }, () => 'plugin/drawio');
      expect(await get(await server.url(), '/index.html')).toMatchObject({ status: 500 });
      expect(log).toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
});
