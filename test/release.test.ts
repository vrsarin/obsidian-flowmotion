import { describe, expect, it } from "vitest";
// eslint-disable-next-line no-restricted-imports -- Execute the workflow gate in tests, not in the plugin.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
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

  describe("release security gate", () => {
    const securityWorkflow = parse(
      readFileSync(".github/workflows/security-audit.yml", "utf8"),
    ) as {
      on: Record<string, unknown>;
      jobs: Record<string, {
        needs?: string[];
        steps?: { name?: string; run?: string }[];
      }>;
    };
    const releaseWorkflow = parse(
      readFileSync(".github/workflows/release.yml", "utf8"),
    ) as {
      jobs: Record<string, {
        uses?: string;
        needs?: string | string[];
        steps?: { name?: string }[];
      }>;
    };
    const gateScript = securityWorkflow.jobs["security-gate"]?.steps?.find(
      (step) => step.name === "Require blocking checks to pass",
    )?.run;

    function runGate(overrides: Record<string, string> = {}) {
      if (!gateScript) throw new Error("Security gate script is missing");
      return spawnSync("bash", ["-e", "-c", gateScript], {
        env: {
          ...process.env,
          LINT_RESULT: "success",
          SEMGREP_RESULT: "success",
          SNYK_RESULT: "success",
          SONAR_RESULT: "success",
          DEPENDENCY_REVIEW_RESULT: "skipped",
          DEPENDENCY_AUDIT_RESULT: "success",
          IS_PULL_REQUEST: "false",
          IS_FORK_PR: "false",
          ...overrides,
        },
      }).status;
    }

    it("requires the reusable security workflow before publishing", () => {
      expect(securityWorkflow.on).toHaveProperty("workflow_call");
      expect(releaseWorkflow.jobs.security?.uses).toBe(
        "./.github/workflows/security-audit.yml",
      );
      expect(releaseWorkflow.jobs.build?.needs).toEqual("security");
      expect(releaseWorkflow.jobs.build?.steps?.some(
        (step) => step.name === "Publish release",
      )).toBe(true);
      expect(securityWorkflow.jobs["security-gate"]?.needs).toEqual(
        expect.arrayContaining([
          "lint", "semgrep", "snyk", "sonarcloud", "dependency-audit",
        ]),
      );
    });

    it("blocks release when any required check fails, is cancelled, skipped, or missing", () => {
      expect(runGate()).toBe(0);
      for (const check of [
        "LINT_RESULT", "SEMGREP_RESULT", "SNYK_RESULT",
        "SONAR_RESULT", "DEPENDENCY_AUDIT_RESULT",
      ]) {
        for (const result of ["failure", "cancelled", "skipped", ""]) {
          expect(runGate({ [check]: result }), `${check}: ${result}`).not.toBe(0);
        }
      }
    });

    it("still requires dependency review for pull requests but not release tags", () => {
      expect(runGate({ IS_PULL_REQUEST: "true" })).not.toBe(0);
      expect(runGate({
        IS_PULL_REQUEST: "true",
        DEPENDENCY_REVIEW_RESULT: "success",
      })).toBe(0);
      expect(runGate({
        IS_PULL_REQUEST: "true",
        IS_FORK_PR: "true",
        SNYK_RESULT: "skipped",
        SONAR_RESULT: "skipped",
        DEPENDENCY_REVIEW_RESULT: "success",
      })).toBe(0);
    });
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
