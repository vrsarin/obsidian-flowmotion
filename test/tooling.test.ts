// eslint-disable-next-line no-restricted-imports -- Exercise Node and shell tools outside the plugin runtime.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const directories: string[] = [];

function makeDir() {
  const directory = mkdtempSync(join(tmpdir(), 'flowmotion-tooling-'));
  directories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('install-plugin', () => {
  it('installs to a valid vault outside the home directory and rejects non-vaults', () => {
    const workspace = makeDir();
    const vault = join(workspace, 'vault');
    const dist = join(workspace, 'dist', 'plugin');
    mkdirSync(join(vault, '.obsidian'), { recursive: true });
    mkdirSync(dist, { recursive: true });
    for (const file of ['main.js', 'manifest.json', 'styles.css']) writeFileSync(join(dist, file), file);

    const script = resolve('scripts/install-plugin.mjs');
    const install = spawnSync(process.execPath, [script, vault], { cwd: workspace, encoding: 'utf8' });
    expect(install.status).toBe(0);
    expect(readFileSync(join(vault, '.obsidian', 'plugins', 'flowmotion', 'main.js'), 'utf8')).toBe('main.js');
    const invalid = spawnSync(process.execPath, [script, workspace], { cwd: workspace, encoding: 'utf8' });
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain('Not an Obsidian vault');
  });
});

describe('local Sonar scan', () => {
  it('fails and removes an incomplete report if fetching issues fails', () => {
    const workspace = makeDir();
    const scripts = join(workspace, 'scripts');
    const bin = join(workspace, 'bin');
    const reports = join(workspace, '.security');
    mkdirSync(scripts);
    mkdirSync(bin);
    mkdirSync(reports);
    copyFileSync('scripts/security-scan.sh', join(scripts, 'security-scan.sh'));
    writeFileSync(join(reports, 'sonar-issues.json'), '{"total":0}');
    writeFileSync(join(bin, 'sonar-scanner'), '#!/bin/sh\necho "scan successful"\n');
    writeFileSync(join(bin, 'curl'), '#!/bin/sh\necho "partial" > .security/sonar-issues.json\nexit 22\n');
    chmodSync(join(bin, 'sonar-scanner'), 0o755);
    chmodSync(join(bin, 'curl'), 0o755);

    const result = spawnSync('bash', [join(scripts, 'security-scan.sh'), 'sonar'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SONAR_TOKEN: 'test-token' },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('could not fetch Sonar issues');
    expect(() => readFileSync(join(reports, 'sonar-issues.json'))).toThrow();
  });
});

describe('desktop workflow', () => {
  it('includes pull requests targeting main', () => {
    const workflow = parse(readFileSync('.github/workflows/e2e.yml', 'utf8')) as {
      on: { push: { 'branches-ignore': string[] }; pull_request: unknown };
    };
    expect(workflow.on.push['branches-ignore']).toContain('main');
    expect(workflow.on).toHaveProperty('pull_request', null);
  });
});
