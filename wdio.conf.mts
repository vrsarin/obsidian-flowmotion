import * as path from 'node:path';

// Runs the built plugin (dist/plugin) inside real Obsidian desktop builds.
// Build first: `npm run build` (the `test:e2e` script does this).
const cacheDir = path.resolve('.obsidian-cache');

// [appVersion, installerVersion]. 1.4.5 is the oldest stable release at or above
// minAppVersion (1.4.0). "earliest" would pick 1.4.0, which is a beta build that
// needs Insiders credentials, so it cannot run in CI. The installer is "latest":
// the 1.1.9 installer does not start on macOS arm64.
const versions: [string, string][] = [
  ['1.4.5', 'latest'],
  ['1.15.1', 'latest'],
  ['latest', 'latest'],
];

export const config: WebdriverIO.Config = {
  runner: 'local',
  framework: 'mocha',
  specs: ['./e2e/specs/**/*.e2e.ts'],
  maxInstances: 2,

  capabilities: versions.map(([appVersion, installerVersion]) => ({
    browserName: 'obsidian',
    browserVersion: appVersion,
    'wdio:obsidianOptions': {
      installerVersion,
      plugins: ['dist/plugin'],
      vault: 'e2e/vaults/simple',
    },
  })),

  services: ['obsidian'],
  reporters: ['obsidian'],
  cacheDir,

  mochaOpts: {
    ui: 'bdd',
    timeout: 60000,
    retries: 1,
  },
  logLevel: 'warn',
};
