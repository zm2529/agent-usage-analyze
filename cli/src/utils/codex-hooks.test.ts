import { afterEach, describe, expect, it } from 'vitest';
import { codexConfigRoot, codexHooksFeatureEnabled } from './codex-hooks.js';

describe('Codex hook configuration contract', () => {
  afterEach(() => {
    delete process.env.AGENT_ANALYTICS_CODEX_HOME;
    delete process.env.CODEX_HOME;
  });

  it('uses the explicit product override before CODEX_HOME', () => {
    process.env.CODEX_HOME = '/codex-home';
    process.env.AGENT_ANALYTICS_CODEX_HOME = '/test-codex-home';
    expect(codexConfigRoot()).toBe('/test-codex-home');
  });

  it('only treats hooks=false inside the features section as disabling hooks', () => {
    expect(codexHooksFeatureEnabled('[other]\nhooks = false\n[features]\nplugin_hooks = true')).toBe(true);
    expect(codexHooksFeatureEnabled('[other]\nhooks = true\n[features]\nhooks = false # intentional')).toBe(false);
  });
});
