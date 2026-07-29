import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { HistorySyncButton } from './HistorySyncButton';

const mutate = vi.fn();
const reset = vi.fn();

vi.mock('@/hooks/useHistorySync', () => ({
  useHistorySync: () => ({
    data: null,
    isError: false,
    isPending: false,
    mutate,
    reset,
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe('HistorySyncButton', () => {
  beforeEach(() => {
    mutate.mockReset();
    reset.mockReset();
  });

  it('closes the modal as soon as background history sync starts', () => {
    render(
      <LanguageProvider>
        <HistorySyncButton />
      </LanguageProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sync history' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start sync' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mutate).toHaveBeenCalledWith(
      { force: true },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });
});
