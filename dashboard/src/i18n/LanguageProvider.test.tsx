import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialLanguage } from './LanguageProvider';

describe('initialLanguage', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
  });

  it('uses the browser language when no preference was saved', () => {
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'zh-CN' });
    expect(initialLanguage()).toBe('zh-CN');
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'en-US' });
    expect(initialLanguage()).toBe('en');
  });

  it('keeps an explicit user preference', () => {
    localStorage.setItem('agent-usage-analyze:language', 'en');
    Object.defineProperty(navigator, 'language', { configurable: true, value: 'zh-CN' });
    expect(initialLanguage()).toBe('en');
  });
});
