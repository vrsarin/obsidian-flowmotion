import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { summarizeSecurityReports } from '../scripts/security-summary.mjs';

const directories: string[] = [];
const makeDir = () => {
  const directory = mkdtempSync(join(tmpdir(), 'flowmotion-security-'));
  directories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('security report summary', () => {
  it('reports when no report directory exists', () => {
    const output: string[] = [];
    expect(summarizeSecurityReports({ directory: join(tmpdir(), 'missing-security-dir'), log: (line) => output.push(line) })).toBe(0);
    expect(output[0]).toMatch(/No .security/);
  });

  it('summarizes skipped scans, SARIF, Sonar issues, and Aikido output', () => {
    const directory = makeDir();
    const output: string[] = [];
    writeFileSync(join(directory, 'snyk.skipped'), 'not configured\n');
    writeFileSync(join(directory, 'semgrep.sarif'), JSON.stringify({ runs: [{ results: [
      { ruleId: 'ERR', level: 'error', message: { text: 'error finding' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.ts' }, region: { startLine: 7 } } }] },
      { ruleId: 'WARN', level: 'warning', message: { text: 'warning finding\nextra detail' } },
      { ruleId: 'NOTE', level: 'note', message: { text: 'note finding' } },
    ] }] }));
    writeFileSync(join(directory, 'sonar-issues.json'), JSON.stringify({ total: 4, issues: [
      { severity: 'MAJOR', rule: 'rule-1', component: 'project:src/b.ts', line: 12, message: 'maintainability finding' },
    ] }));
    writeFileSync(join(directory, 'aikido.txt'), 'details');

    const count = summarizeSecurityReports({ directory, top: 1, log: (line) => output.push(line) });

    expect(count).toBe(3);
    expect(output.join('\n')).toContain('snyk');
    expect(output.join('\n')).toContain('[error] ERR src/a.ts:7');
    expect(output.join('\n')).toContain('3 finding(s) {"error":1,"warning":1,"note":1}');
    expect(output.join('\n')).toContain('== sonar == 4 open issue(s)');
    expect(output.join('\n')).toContain('aikido');
    expect(output.at(-1)).toContain('3 finding(s) at warning level or above');
  });
});
