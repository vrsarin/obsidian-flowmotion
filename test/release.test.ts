import { describe, expect, it } from "vitest";
// @ts-expect-error plain .mjs script without types
import { checkRelease } from "../scripts/check-release.mjs";
import {
  assertMainBundleSize,
  MAIN_JS_MAX_BYTES,
} from "../scripts/bundle-budget.mjs";

const manifest = {
  id: "flowmotion",
  version: "0.1.0",
  minAppVersion: "1.4.0",
  description: "Animated diagrams.",
};
const versions = { "0.1.0": "1.4.0" };
const files = [
  "dist/plugin/main.js",
  "dist/plugin/manifest.json",
  "dist/plugin/styles.css",
];

describe("release check", () => {
  it("accepts a matching plain-semver tag with all files", () => {
    expect(checkRelease({ tag: "0.1.0", manifest, versions, files })).toEqual(
      [],
    );
  });

  it('rejects a "v" prefix', () => {
    const p = checkRelease({ tag: "v0.1.0", manifest, versions, files });
    expect(p.some((x: string) => x.includes('no "v" prefix'))).toBe(true);
  });

  it("rejects a tag that differs from the manifest version", () => {
    const p = checkRelease({ tag: "0.2.0", manifest, versions, files });
    expect(
      p.some((x: string) => x.includes("does not match manifest.json")),
    ).toBe(true);
  });

  it("rejects a missing versions.json entry and missing files", () => {
    const p = checkRelease({
      tag: "0.1.0",
      manifest,
      versions: {},
      files: ["dist/plugin/main.js"],
    });
    expect(p.some((x: string) => x.includes("versions.json"))).toBe(true);
    expect(
      p.filter((x: string) => x.startsWith("missing release file")),
    ).toHaveLength(2);
  });

  it('rejects an id that contains "obsidian"', () => {
    const p = checkRelease({
      tag: "0.1.0",
      manifest: { ...manifest, id: "obsidian-flow" },
      versions,
      files,
    });
    expect(
      p.some((x: string) => x.includes('must not contain "obsidian"')),
    ).toBe(true);
  });

  it("enforces the main.js release budget at the exact limit", () => {
    expect(() => assertMainBundleSize(MAIN_JS_MAX_BYTES)).not.toThrow();
    expect(() => assertMainBundleSize(MAIN_JS_MAX_BYTES + 1)).toThrow(
      "release budget",
    );
  });
});
