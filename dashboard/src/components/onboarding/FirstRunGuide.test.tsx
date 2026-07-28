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
  it('explains the product and asks for optional public research consent', () => {
    const onClose = renderGuide();

    expect(screen.getByText('Reading your session history')).toBeInTheDocument();
    expect(screen.getByText(/organize Agent sessions saved on this computer/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Confirm the hook once in Codex')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy /hooks' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Check preparation progress')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('What each page shows')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Allow public best-practice research')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Allow public practice research' })).not.toBeChecked();

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
