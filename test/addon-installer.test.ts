import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installAddon, removeAddon } from '../src/obsidian/addon-installer';
import type { AddonSpec } from '../src/obsidian/addons';
import { unzip } from '../src/obsidian/zip';

vi.mock('https', () => ({
  get: (_url: string, _options: object, callback: (response: Readable & { statusCode: number; headers: object }) => void) => {
    queueMicrotask(() => callback(Object.assign(Readable.from([Buffer.from('archive')]), { statusCode: 200, headers: {} })));
    return new EventEmitter();
  },
}));
vi.mock('../src/obsidian/zip', () => ({ unzip: vi.fn() }));

const spec: AddonSpec = {
  dir: 'drawio', marker: 'index.html',
  resolve: async () => ({ url: 'https://example.com/archive', label: 'draw.io test' }),
  target: (path) => path,
};

function storage() {
  const dirs = new Set(['.obsidian', '.obsidian/plugins', '.obsidian/plugins/flowmotion']);
  const files = new Map<string, Uint8Array>();
  const adapter = {
    exists: async (path: string) => dirs.has(path) || files.has(path),
    mkdir: async (path: string) => { dirs.add(path); },
    rmdir: async (path: string, _recursive: boolean) => {
      for (const dir of dirs) if (dir === path || dir.startsWith(`${path}/`)) dirs.delete(dir);
      for (const file of files.keys()) if (file.startsWith(`${path}/`)) files.delete(file);
    },
    rename: async (from: string, to: string) => {
      for (const dir of [...dirs]) if (dir === from || dir.startsWith(`${from}/`)) { dirs.delete(dir); dirs.add(to + dir.slice(from.length)); }
      for (const [file, data] of [...files]) if (file.startsWith(`${from}/`)) { files.delete(file); files.set(to + file.slice(from.length), data); }
    },
    write: async (path: string, data: string) => { files.set(path, new TextEncoder().encode(data)); },
    writeBinary: async (path: string, data: ArrayBuffer) => { files.set(path, new Uint8Array(data)); },
  };
  return { adapter, files, dirs };
}

describe('add-on installation through the vault adapter', () => {
  beforeEach(() => vi.resetAllMocks());

  it('installs and removes the add-on within the plugin directory', async () => {
    const { adapter, files } = storage();
    vi.mocked(unzip).mockImplementation(async (_zip, select, onFile) => {
      if (select('index.html')) await onFile('index.html', new TextEncoder().encode('editor'));
      if (select('js/app.js')) await onFile('js/app.js', new TextEncoder().encode('script'));
    });
    const root = '.obsidian/plugins/flowmotion';
    await installAddon(spec, adapter, root);
    expect(new TextDecoder().decode(files.get(`${root}/drawio/index.html`))).toBe('editor');
    expect(files.has(`${root}/drawio/js/app.js`)).toBe(true);
    expect(new TextDecoder().decode(files.get(`${root}/drawio/VERSION`))).toBe('draw.io test\n');
    await removeAddon(spec, adapter, root);
    expect(files.size).toBe(0);
  });

  it('rejects unsafe archive targets and retains the installed add-on', async () => {
    const { adapter, files, dirs } = storage();
    const root = '.obsidian/plugins/flowmotion';
    dirs.add(`${root}/drawio`);
    files.set(`${root}/drawio/index.html`, new TextEncoder().encode('old'));
    vi.mocked(unzip).mockImplementation(async (_zip, select, onFile) => {
      if (select('../outside')) await onFile('../outside', new Uint8Array([1]));
    });
    await expect(installAddon(spec, adapter, root)).rejects.toThrow('unsafe path');
    expect(new TextDecoder().decode(files.get(`${root}/drawio/index.html`))).toBe('old');
    expect(dirs.has(`${root}/drawio.installing`)).toBe(false);
  });
});
