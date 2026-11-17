import { config as base } from './wdio.conf.mts';
export const config: WebdriverIO.Config = {
  ...base,
  maxInstances: 1,
  specs: ['./.cache/settings-probe.e2e.ts'],
  capabilities: [base.capabilities[1]!],
  mochaOpts: { ui: 'bdd', timeout: 300000 },
};
