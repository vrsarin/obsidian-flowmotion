// Checks that a release tag can be published to the Obsidian community catalog.
// Rules (from the Obsidian plugin docs): the tag is exactly the manifest version (no "v" prefix),
// versions.json maps that version to minAppVersion, and the required release files exist.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Files published with the release. Monaco is downloaded separately from npm when enabled. */
export const RELEASE_FILES = [
  "dist/plugin/main.js",
  "dist/plugin/manifest.json",
  "dist/plugin/styles.css",
];

/** Returns a list of problems; an empty list means the release can be published. */
export function checkRelease({ tag, manifest, versions, files }) {
  const problems = [];
  if (!/^\d+\.\d+\.\d+$/.test(tag ?? ""))
    problems.push(
      `tag "${tag}" must be plain semver like 0.1.0 (no "v" prefix)`,
    );
  if (manifest.version !== tag)
    problems.push(
      `tag "${tag}" does not match manifest.json version "${manifest.version}"`,
    );
  if (!/^[a-z0-9-]+$/.test(manifest.id ?? ""))
    problems.push(
      `manifest id "${manifest.id}" must use only lowercase letters, digits and hyphens`,
    );
  if (/obsidian/i.test(manifest.id ?? ""))
    problems.push('manifest id must not contain "obsidian"');
  if (!manifest.description?.trim().endsWith("."))
    problems.push("manifest description should end with a period");
  if (versions[tag] !== manifest.minAppVersion)
    problems.push(
      `versions.json["${tag}"] must be "${manifest.minAppVersion}"`,
    );
  for (const f of RELEASE_FILES) {
    if (!files.includes(f)) problems.push(`missing release file ${f}`);
  }
  return problems;
}

function main() {
  const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? "";
  const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
  const versions = JSON.parse(readFileSync("versions.json", "utf8"));
  const files = RELEASE_FILES.filter((f) => existsSync(f));
  const problems = checkRelease({ tag, manifest, versions, files });
  if (problems.length) {
    for (const p of problems) console.error(`release check: ${p}`);
    process.exit(1);
  }
  console.log(`release check: ${tag} is ready to publish`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main();
