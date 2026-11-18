// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { init } from "../src/monaco/entry";
import { MonacoLoader } from "../src/obsidian/monaco-loader";

vi.mock("../src/monaco/entry", () => ({
  init: vi.fn(),
  mount: vi.fn(),
  purge: vi.fn(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("uses the original window and document when focus changes while the AMD script loads", async () => {
  const api = {};
  const yaml = {};
  const amdRequire = Object.assign(
    vi.fn((_modules: string[], ready: (api: object, yaml: object) => void) => ready(api, yaml)),
    { config: vi.fn() },
  );
  const hostRequire = vi.fn();
  const original = { document, require: hostRequire };
  const other = { document: document.implementation.createHTMLDocument(), require: vi.fn() };
  let first = true;
  vi.stubGlobal("activeWindow", original);
  vi.stubGlobal("activeDocument", document);
  const loadScript = vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
    original.require = amdRequire;
    node.dispatchEvent(new Event("load"));
    return node;
  });
  const loader = new MonacoLoader({
    url: async () => {
      if (first) {
        first = false;
        vi.stubGlobal("activeWindow", other);
        vi.stubGlobal("activeDocument", other.document);
      }
      return "http://127.0.0.1:1234";
    },
  }, { exists: async () => true }, "flowmotion");

  await loader.acquire();
  expect(original.require).toBe(hostRequire);
  loader.release();
  vi.stubGlobal("activeWindow", original);
  vi.stubGlobal("activeDocument", document);
  await loader.acquire();
  expect(original.require).toBe(hostRequire);
  loader.release();

  expect(loadScript).toHaveBeenCalledOnce();
  expect(amdRequire).toHaveBeenCalledTimes(2);
  expect(amdRequire.config).toHaveBeenCalledWith({
    paths: { vs: "http://127.0.0.1:1234/min/vs" },
    preferScriptTags: true,
  });
  expect(init).toHaveBeenCalledWith(api, yaml);
  expect(other.require).not.toHaveBeenCalled();
});

it("restores the original require when Monaco module loading fails", async () => {
  const hostRequire = vi.fn();
  const original = { document, require: hostRequire };
  const failure = new Error("module load failed");
  const amdRequire = Object.assign(
    vi.fn((_modules: string[], _ready: () => void, fail: (error: Error) => void) => fail(failure)),
    { config: vi.fn() },
  );
  vi.stubGlobal("activeWindow", original);
  vi.spyOn(document.head, "appendChild").mockImplementation((node) => {
    original.require = amdRequire;
    node.dispatchEvent(new Event("load"));
    return node;
  });
  const loader = new MonacoLoader({ url: async () => "http://127.0.0.1:1234" }, {
    exists: async () => true,
  }, "flowmotion");

  await expect(loader.acquire()).rejects.toThrow(failure);
  expect(original.require).toBe(hostRequire);
});
