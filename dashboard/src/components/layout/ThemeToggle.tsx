import { Sun, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTheme } from './ThemeProvider';
import { useLanguage } from '@/i18n/LanguageProvider';

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const { t } = useLanguage();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
        >
          {resolvedTheme === 'dark' ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
          <span className="sr-only">{t('theme.toggle', 'Toggle theme')}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {resolvedTheme === 'dark' ? t('theme.light', 'Switch to light mode') : t('theme.dark', 'Switch to dark mode')}
      </TooltipContent>
    </Tooltip>
  );
}
