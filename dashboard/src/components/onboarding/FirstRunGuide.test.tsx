import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  FIRST_RUN_GUIDE_OPEN_EVENT,
  FirstRunGuide,
  firstRunGuideStorageKey,
  requestFirstRunGuide,
} from './FirstRunGuide';
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
  it('scopes completion state to one local installation', () => {
    expect(firstRunGuideStorageKey('install-a')).not.toBe(firstRunGuideStorageKey('install-b'));
  });

  it('exposes a request event so Settings can reopen the guide', () => {
    const listener = vi.fn();
    window.addEventListener(FIRST_RUN_GUIDE_OPEN_EVENT, listener);

    requestFirstRunGuide();

    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(FIRST_RUN_GUIDE_OPEN_EVENT, listener);
  });

  it('explains the product and asks for optional public research consent', () => {
    const onClose = renderGuide();

    expect(screen.getByText('Reading your session history')).toBeInTheDocument();
    expect(screen.getByText(/organize Agent sessions saved on this computer/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Enable the Codex hook')).toBeInTheDocument();
    expect(screen.getByText('Codex App')).toBeInTheDocument();
    expect(screen.getByText('Codex CLI')).toBeInTheDocument();
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

  it('does not ask for another hook action after a real event was received', () => {
    render(
      <LanguageProvider>
        <FirstRunGuide open onClose={vi.fn()} hookState="healthy" />
      </LanguageProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByText(/hook is enabled and a real session event has been received/i))
      .toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy /hooks' })).not.toBeInTheDocument();
  });

  it('can be dismissed with Escape', () => {
    const onClose = renderGuide();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
