import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, DatabaseZap, Route, Sparkles, X } from 'lucide-react';
import { useLanguage } from '@/i18n/LanguageProvider';

type SpotlightRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

const copy = {
  'zh-CN': [
    {
      eyebrow: '首次使用',
      title: '正在读取你的历史会话',
      description: '首次打开后，我们会整理本机保存的 Agent 会话。准备完成后，你可以在这里查看使用情况和分析结果。',
      target: null,
      icon: Sparkles,
    },
    {
      eyebrow: '数据准备',
      title: '查看准备进度',
      description: '顶部会显示已经读取了多少会话。数据较多时可能需要几分钟，你可以继续浏览其他页面。',
      target: 'pipeline',
      icon: Route,
    },
    {
      eyebrow: '四个页面',
      title: '每个页面分别看什么',
      description: '总览了解使用量和变化，分析查看做得好的地方与可改进之处，建议查看下一步做法，记录查看每一次会话。',
      target: 'primary-navigation',
      icon: DatabaseZap,
    },
    {
      eyebrow: '开始使用',
      title: '先从总览开始',
      description: '先了解最近使用了多少次 Agent、常用哪些工具，以及使用情况有什么变化。',
      target: 'workspace',
      icon: Check,
    },
  ],
  en: [
    {
      eyebrow: 'FIRST RUN',
      title: 'Reading your session history',
      description: 'On first launch, we organize Agent sessions saved on this computer. When preparation finishes, you can review usage and analysis here.',
      target: null,
      icon: Sparkles,
    },
    {
      eyebrow: 'DATA PREPARATION',
      title: 'Check preparation progress',
      description: 'The top bar shows how many sessions have been read. A large history may take a few minutes while you continue browsing.',
      target: 'pipeline',
      icon: Route,
    },
    {
      eyebrow: 'FOUR PAGES',
      title: 'What each page shows',
      description: 'Overview shows usage and changes, Capability shows strengths and areas to improve, Actions lists suggestions, and Activity opens each session.',
      target: 'primary-navigation',
      icon: DatabaseZap,
    },
    {
      eyebrow: 'GET STARTED',
      title: 'Start with Overview',
      description: 'See how often you used Agents, which tools you used most, and what changed recently.',
      target: 'workspace',
      icon: Check,
    },
  ],
} as const;

export const FIRST_RUN_GUIDE_STORAGE_KEY = 'agent-usage-analyze:first-run-guide:v1';

function targetRect(target: string | null): SpotlightRect | null {
  if (!target) return null;
  const element = document.querySelector<HTMLElement>(`[data-onboarding="${target}"]`);
  if (!element || element.offsetParent === null) return null;
  const rect = element.getBoundingClientRect();
  const padding = 7;
  return {
    top: Math.max(8, rect.top - padding),
    left: Math.max(8, rect.left - padding),
    width: Math.min(window.innerWidth - 16, rect.width + padding * 2),
    height: Math.min(window.innerHeight - 16, rect.height + padding * 2),
  };
}

export function FirstRunGuide({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { language } = useLanguage();
  const steps = copy[language];
  const [stepIndex, setStepIndex] = useState(0);
  const [spotlight, setSpotlight] = useState<SpotlightRect | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const step = steps[stepIndex];
  const Icon = step.icon;
  const isLast = stepIndex === steps.length - 1;

  const labels = useMemo(() => language === 'zh-CN' ? {
    dialog: '首次使用指引',
    skip: '跳过指引',
    back: '上一步',
    next: '下一步',
    finish: '开始使用',
    close: '关闭指引',
  } : {
    dialog: 'First-run guide',
    skip: 'Skip guide',
    back: 'Back',
    next: 'Next',
    finish: 'Start using',
    close: 'Close guide',
  }, [language]);

  useEffect(() => {
    if (!open) return;
    const update = () => setSpotlight(targetRect(step.target));
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    const frame = window.requestAnimationFrame(() => panelRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, step.target]);

  useEffect(() => {
    if (!open) setStepIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight' && !isLast) setStepIndex((current) => current + 1);
      if (event.key === 'ArrowLeft' && stepIndex > 0) setStepIndex((current) => current - 1);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isLast, onClose, open, stepIndex]);

  if (!open) return null;

  return (
    <div className="vibe-onboarding" aria-live="polite">
      {spotlight ? (
        <div
          className="vibe-onboarding-spotlight"
          style={spotlight}
          aria-hidden
        />
      ) : (
        <div className="vibe-onboarding-scrim" aria-hidden />
      )}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={labels.dialog}
        tabIndex={-1}
        className="vibe-onboarding-panel"
      >
        <div className="flex items-start justify-between gap-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center border border-[#28666E]/30 bg-[#28666E]/10 text-[#28666E]">
            <Icon className="h-5 w-5" />
          </span>
          <button
            type="button"
            className="vibe-icon-button -mr-2 -mt-2"
            aria-label={labels.close}
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="vibe-mono mt-5 text-[10px] tracking-[.18em] text-[#28666E]">{step.eyebrow}</p>
        <h2 className="mt-2 text-xl font-semibold tracking-[-.025em]">{step.title}</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{step.description}</p>

        <div className="mt-6 flex items-center justify-between gap-4 border-t pt-4">
          <div className="flex items-center gap-1.5" aria-label={`${stepIndex + 1}/${steps.length}`}>
            {steps.map((item, index) => (
              <span
                key={item.title}
                className={`h-1.5 transition-[width,background-color] duration-200 ${
                  index === stepIndex ? 'w-6 bg-[#28666E]' : 'w-1.5 bg-border'
                }`}
                aria-hidden
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {stepIndex === 0 ? (
              <button type="button" className="px-2 py-2 text-xs text-muted-foreground hover:text-foreground" onClick={onClose}>
                {labels.skip}
              </button>
            ) : (
              <button
                type="button"
                className="inline-flex min-h-9 items-center gap-1 border border-border px-3 text-xs hover:bg-muted"
                onClick={() => setStepIndex((current) => current - 1)}
              >
                <ArrowLeft className="h-3.5 w-3.5" />{labels.back}
              </button>
            )}
            <button
              type="button"
              className="inline-flex min-h-9 items-center gap-1 bg-foreground px-3 text-xs font-semibold text-background hover:opacity-90"
              onClick={() => isLast ? onClose() : setStepIndex((current) => current + 1)}
            >
              {isLast ? labels.finish : labels.next}
              {!isLast && <ArrowRight className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
