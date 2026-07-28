import { useQuery } from '@tanstack/react-query';
import { translateContent } from '@/lib/api';
import { useLanguage } from '@/i18n/LanguageProvider';

function needsTranslation(value: unknown, target: 'en' | 'zh-CN'): boolean {
  const text = JSON.stringify(value);
  const chinese = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  return target === 'en' ? chinese > 8 : latin > Math.max(30, chinese * 3);
}

export function useLocalizedGeneratedContent<T>(content: T | null | undefined) {
  const { language } = useLanguage();
  const translate = content != null && needsTranslation(content, language);
  return useQuery({
    queryKey: ['localized-generated-content', language, content],
    queryFn: () => translateContent(language, content as T).then((result) => result.content),
    enabled: translate,
    retry: false,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60_000,
  });
}
