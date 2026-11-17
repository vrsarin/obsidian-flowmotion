import { config as base } from './wdio.conf.mts';
export const config: WebdriverIO.Config = {
  ...base,
  maxInstances: 1,
  specs: ['./e2e/specs/settings.e2e.ts'],
  capabilities: [base.capabilities.at(-1)!],
  mochaOpts: { ui: 'bdd', timeout: 300000 },
};
