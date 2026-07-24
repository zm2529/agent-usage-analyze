import { Languages } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/LanguageProvider';

export function LanguageToggle() {
  const { language, setLanguage, t } = useLanguage();
  const next = language === 'zh-CN' ? 'en' : 'zh-CN';
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-9 gap-1 px-2"
      aria-label={t('language.switch', 'Switch language')}
      title={t('language.switch', 'Switch language')}
      onClick={() => setLanguage(next)}
    >
      <Languages className="h-4 w-4" />
      <span className="text-xs">{language === 'zh-CN' ? 'EN' : '中文'}</span>
    </Button>
  );
}
