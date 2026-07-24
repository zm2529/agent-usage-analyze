import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider, useLanguage } from './LanguageProvider';
import { LanguageToggle } from '@/components/layout/LanguageToggle';

function Probe() {
  const { t } = useLanguage();
  return <span>{t('analysis.title', 'Behavior analysis and improvement advice')}</span>;
}

describe('LanguageProvider', () => {
  const values = new Map<string, string>();
  beforeEach(() => {
    values.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    });
  });

  it('switches the WebUI to Simplified Chinese and persists the choice', async () => {
    render(<LanguageProvider><Probe /><LanguageToggle /></LanguageProvider>);
    expect(screen.getByText('Behavior analysis and improvement advice')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Switch language' }));
    expect(screen.getByText('行为分析与改进建议')).toBeInTheDocument();
    expect(localStorage.getItem('agent-usage-analyze:language')).toBe('zh-CN');
    expect(document.documentElement.lang).toBe('zh-CN');
  });
});
