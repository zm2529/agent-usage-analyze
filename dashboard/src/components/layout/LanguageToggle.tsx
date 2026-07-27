import { Languages } from 'lucide-react';
import { useLanguage } from '@/i18n/LanguageProvider';

export function LanguageToggle() {
  const { language, setLanguage, t } = useLanguage();
  const next = language === 'zh-CN' ? 'en' : 'zh-CN';
  return (
    <button
      type="button"
      className="vibe-system-control"
      aria-label={t('language.switch', 'Switch language')}
      title={t('language.switch', 'Switch language')}
      onClick={() => setLanguage(next)}
    >
      <Languages className="h-4 w-4" />
      <span>{language === 'zh-CN' ? 'English' : '中文'}</span>
    </button>
  );
}
