import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as tar from "tar-stream";
import * as zlib from "node:zlib";
import { installAddon, removeAddon } from "../src/obsidian/addon-installer";
import { MONACO, type AddonSpec } from "../src/obsidian/addons";
import { unzip } from "../src/obsidian/zip";

const downloaded = vi.hoisted(() => ({
  body: new Uint8Array(Buffer.from("archive")),
}));

vi.mock("https", () => ({
  get: (
    _url: string,
    _options: object,
    callback: (
      response: Readable & { statusCode: number; headers: object },
    ) => void,
  ) => {
    queueMicrotask(() =>
      callback(
        Object.assign(Readable.from([downloaded.body]), {
          statusCode: 200,
          headers: {},
        }),
      ),
    );
    return new EventEmitter();
  },
}));
vi.mock("../src/obsidian/zip", () => ({ unzip: vi.fn() }));

const spec: AddonSpec = {
  dir: "drawio",
  marker: "index.html",
  resolve: async () => ({
    url: "https://example.com/archive",
    label: "draw.io test",
  }),
  target: (path) => path,
};

async function npmArchive(files: Record<string, string>): Promise<Buffer> {
  const pack = tar.pack();
  const chunks: Buffer[] = [];
  const done = new Promise<void>((resolve, reject) => {
    pack.on("data", (value: unknown) => {
      if (!(value instanceof Uint8Array)) {
        reject(new Error("tar archive generated invalid data"));
        return;
      }
      chunks.push(Buffer.from(value));
    });
    pack.once("end", resolve);
    pack.once("error", reject);
  });
  for (const [name, content] of Object.entries(files))
    await new Promise<void>((resolve, reject) => {
      pack.entry({ name }, content, (error) =>
        error ? reject(error) : resolve(),
      );
    });
  pack.finalize();
  await done;
  return zlib.gzipSync(Buffer.concat(chunks));
}

function storage() {
  const dirs = new Set([
    ".obsidian",
    ".obsidian/plugins",
    ".obsidian/plugins/flowmotion",
  ]);
  const files = new Map<string, Uint8Array>();
  const adapter = {
    exists: async (path: string) => dirs.has(path) || files.has(path),
    mkdir: async (path: string) => {
      dirs.add(path);
    },
    rmdir: async (path: string, _recursive: boolean) => {
      for (const dir of dirs)
        if (dir === path || dir.startsWith(`${path}/`)) dirs.delete(dir);
      for (const file of files.keys())
        if (file.startsWith(`${path}/`)) files.delete(file);
    },
    rename: async (from: string, to: string) => {
      for (const dir of [...dirs])
        if (dir === from || dir.startsWith(`${from}/`)) {
          dirs.delete(dir);
          dirs.add(to + dir.slice(from.length));
        }
      for (const [file, data] of [...files])
        if (file.startsWith(`${from}/`)) {
          files.delete(file);
          files.set(to + file.slice(from.length), data);
        }
    },
    write: async (path: string, data: string) => {
      files.set(path, new TextEncoder().encode(data));
    },
    writeBinary: async (path: string, data: ArrayBuffer) => {
      files.set(path, new Uint8Array(data));
    },
  };
  return { adapter, files, dirs };
}

describe("add-on installation through the vault adapter", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    downloaded.body = Buffer.from("archive");
  });

  it("installs and removes the add-on within the plugin directory", async () => {
    const { adapter, files } = storage();
    vi.mocked(unzip).mockImplementation(async (_zip, select, onFile) => {
      if (select("index.html"))
        await onFile("index.html", new TextEncoder().encode("editor"));
      if (select("js/app.js"))
        await onFile("js/app.js", new TextEncoder().encode("script"));
    });
    const root = ".obsidian/plugins/flowmotion";
    await installAddon(spec, adapter, root);
    expect(
      new TextDecoder().decode(files.get(`${root}/drawio/index.html`)),
    ).toBe("editor");
    expect(files.has(`${root}/drawio/js/app.js`)).toBe(true);
    expect(new TextDecoder().decode(files.get(`${root}/drawio/VERSION`))).toBe(
      "draw.io test\n",
    );
    await removeAddon(spec, adapter, root);
    expect(files.size).toBe(0);
  });

  it("installs a single-file add-on from the matching versioned release", async () => {
    const { adapter, files } = storage();
    const monaco: AddonSpec = {
      dir: "monaco",
      marker: "main.js",
      file: "main.js",
      resolve: async (_text, version) => ({
        url: `https://example.com/${version}/monaco.js`,
        label: `Monaco ${version}`,
      }),
      target: () => null,
    };
    const root = ".obsidian/plugins/flowmotion";
    await installAddon(monaco, adapter, root, "1.2.3");
    expect(new TextDecoder().decode(files.get(`${root}/monaco/main.js`))).toBe(
      "archive",
    );
    expect(new TextDecoder().decode(files.get(`${root}/monaco/VERSION`))).toBe(
      "Monaco 1.2.3\n",
    );
    expect(unzip).not.toHaveBeenCalled();
  });

  it("installs only Monaco's browser files from the npm package archive", async () => {
    downloaded.body = Uint8Array.from(
      await npmArchive({
        "package/LICENSE": "MIT",
        "package/min/vs/loader.js": "loader",
        "package/min/vs/yaml-C-RIivnc.js": "yaml",
        "package/min/vs/editor/editor.main.js.map": "source map",
        "package/package.json": "{}",
      }),
    );
    const { adapter, files } = storage();
    const root = ".obsidian/plugins/flowmotion";
    await installAddon(MONACO, adapter, root);

    expect(new TextDecoder().decode(files.get(`${root}/monaco/min/vs/loader.js`))).toBe(
      "loader",
    );
    expect(new TextDecoder().decode(files.get(`${root}/monaco/min/vs/yaml-C-RIivnc.js`))).toBe(
      "yaml",
    );
    expect(new TextDecoder().decode(files.get(`${root}/monaco/LICENSE`))).toBe(
      "MIT",
    );
    expect(files.has(`${root}/monaco/package.json`)).toBe(false);
    expect(files.has(`${root}/monaco/min/vs/editor/editor.main.js.map`)).toBe(
      false,
    );
    expect(unzip).not.toHaveBeenCalled();
  });

  it("rejects a truncated skipped tar entry and removes the partial install", async () => {
    const archive = zlib.gunzipSync(await npmArchive({
      "package/min/vs/loader.js": "loader",
      "package/package.json": "{}",
    }));
    // Keep the first entry and the second entry's header, but not its data.
    downloaded.body = Uint8Array.from(zlib.gzipSync(archive.subarray(0, 3 * 512)));
    const { adapter, files, dirs } = storage();
    const root = ".obsidian/plugins/flowmotion";

    await expect(installAddon(MONACO, adapter, root)).rejects.toThrow(
      /truncated add-on archive entry/,
    );
    expect(dirs.has(`${root}/monaco.installing`)).toBe(false);
    expect(files.size).toBe(0);
  });

  it("rejects unsafe archive targets and retains the installed add-on", async () => {
    const { adapter, files, dirs } = storage();
    const root = ".obsidian/plugins/flowmotion";
    dirs.add(`${root}/drawio`);
    files.set(`${root}/drawio/index.html`, new TextEncoder().encode("old"));
    vi.mocked(unzip).mockImplementation(async (_zip, select, onFile) => {
      if (select("../outside")) await onFile("../outside", new Uint8Array([1]));
    });
    await expect(installAddon(spec, adapter, root)).rejects.toThrow(
      "unsafe path",
    );
    expect(
      new TextDecoder().decode(files.get(`${root}/drawio/index.html`)),
    ).toBe("old");
    expect(dirs.has(`${root}/drawio.installing`)).toBe(false);
  });
});
