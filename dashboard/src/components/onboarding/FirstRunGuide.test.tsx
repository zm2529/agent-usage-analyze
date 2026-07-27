import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FirstRunGuide } from './FirstRunGuide';
import { LanguageProvider } from '@/i18n/LanguageProvider';

function renderGuide(onClose = vi.fn()) {
  render(
    <LanguageProvider>
      <FirstRunGuide open onClose={onClose} />
    </LanguageProvider>,
  );
  return onClose;
}

describe('FirstRunGuide', () => {
  it('explains the automatic import-to-LLM pipeline and supports the full tour', () => {
    const onClose = renderGuide();

    expect(screen.getByText('Reading your session history')).toBeInTheDocument();
    expect(screen.getByText(/organize Agent sessions saved on this computer/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Check preparation progress')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('What each page shows')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start using' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('can be dismissed with Escape', () => {
    const onClose = renderGuide();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
