import { Sun, Moon } from 'lucide-react';
import { useTheme } from './ThemeProvider';
import { useLanguage } from '@/i18n/LanguageProvider';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const { t } = useLanguage();

  return (
    <button
      type="button"
      className="vibe-system-control"
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
      aria-label={t('theme.toggle', 'Toggle theme')}
    >
      {resolvedTheme === 'dark' ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
      <span>{resolvedTheme === 'dark'
        ? t('theme.light', 'Light mode')
        : t('theme.dark', 'Dark mode')}</span>
    </button>
  );
}
