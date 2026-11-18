// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { mount, purge } from "../src/monaco/entry";
import { MonacoLoader } from "../src/obsidian/monaco-loader";

vi.mock("../src/monaco/entry", () => ({
  init: vi.fn(),
  mount: vi.fn(),
  purge: vi.fn(),
}));

afterEach(() => vi.restoreAllMocks());

it("uses the bundled Monaco API without creating or appending script elements", async () => {
  const append = vi.spyOn(document.head, "appendChild");
  const create = vi.spyOn(document, "createElement");
  const loader = new MonacoLoader();

  expect(await loader.installed()).toBe(true);
  const api = await loader.acquire();

  expect(api.mount).toBe(mount);
  expect(api.purge).toBe(purge);
  expect(create).not.toHaveBeenCalledWith("script");
  expect(append).not.toHaveBeenCalled();
  loader.release();
  expect(purge).toHaveBeenCalledOnce();
});
