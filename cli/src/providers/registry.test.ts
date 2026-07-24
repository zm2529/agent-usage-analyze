import { describe, expect, it } from 'vitest';
import { getAllProviders } from './registry.js';

describe('provider registry', () => {
  it('keeps all supported coding-agent adapters enabled with Codex first', () => {
    expect(getAllProviders().map((provider) => provider.getProviderName())).toEqual([
      'codex-cli', 'claude-code', 'cursor', 'copilot-cli', 'copilot',
    ]);
  });
});
