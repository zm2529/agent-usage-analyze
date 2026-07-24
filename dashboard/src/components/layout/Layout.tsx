import { useEffect } from 'react';
import { Outlet } from 'react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { Header } from './Header';
import { CommandPalette } from '@/components/search/CommandPalette';
import { useCommandPalette } from '@/hooks/useCommandPalette';

export function Layout() {
  const { isOpen, setIsOpen, open, close } = useCommandPalette();

  // Global Cmd+K / Ctrl+K shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        open();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        <Header onOpenSearch={open} />
        <main className="pb-16 md:ml-[188px] md:pt-[61px] md:pb-0">
          <Outlet />
        </main>
        <Toaster />
        <CommandPalette isOpen={isOpen} onClose={close} />
      </div>
    </TooltipProvider>
  );
}
