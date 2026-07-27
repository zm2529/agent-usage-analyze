import { ArrowRight, BriefcaseBusiness, PackageCheck, TrendingUp, Terminal } from 'lucide-react';
import { Link } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useLanguage } from '@/i18n/LanguageProvider';

const steps = [
  {
    titleKey: 'flow.work', title: 'Work',
    descriptionKey: 'flow.workDesc', description: 'See each coding-agent session as a unit of work.',
    href: '/tasks',
    actionKey: 'flow.workAction', action: 'Open work',
    icon: BriefcaseBusiness,
  },
  {
    titleKey: 'flow.evidence', title: 'Evidence',
    descriptionKey: 'flow.evidenceDesc', description: 'Check what changed and which result supports completion.',
    href: '/deliveries',
    actionKey: 'flow.evidenceAction', action: 'Review evidence',
    icon: PackageCheck,
  },
  {
    titleKey: 'flow.improve', title: 'Improve',
    descriptionKey: 'flow.improveDesc', description: 'Choose one evidence-backed suggestion for the next task.',
    href: '/analysis',
    actionKey: 'flow.improveAction', action: 'See analysis and advice',
    icon: TrendingUp,
  },
];

export function GettingStartedFlow({ hasData, isLoading = false }: { hasData: boolean; isLoading?: boolean }) {
  const { language, t } = useLanguage();
  return (
    <Card className="overflow-hidden border-primary/20 bg-primary/[0.035]">
      <CardHeader className="pb-3">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">{t('flow.start', 'Start here')}</p>
        <CardTitle className="text-xl">{t('flow.title', 'Understand your agent usage in three steps')}</CardTitle>
        <p className="max-w-2xl text-sm text-muted-foreground">
          {t('flow.subtitle', 'Start with the work item, verify its delivery evidence, then pick one improvement to try next.')}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isLoading && !hasData && (
          <div className="flex flex-col gap-2 rounded-lg border border-dashed bg-background/70 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2">
              <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-medium">{t('flow.noData', 'No agent history has been imported yet')}</p>
                <p className="text-xs text-muted-foreground">{t('flow.noDataHint', 'Run the command once; Codex is captured automatically and other agents sync on startup.')}</p>
              </div>
            </div>
            <code className="select-all rounded-md bg-muted px-3 py-1.5 text-xs">npx --yes agent-usage-analyze start</code>
          </div>
        )}

        <div className="grid gap-2 md:grid-cols-3">
          {steps.map(({ titleKey, title, descriptionKey, description, href, actionKey, action, icon: Icon }, index) => (
            <Link
              key={href}
              to={href}
              className="group rounded-lg border bg-background/80 p-3 transition-colors hover:border-primary/35 hover:bg-background"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-xs font-medium text-muted-foreground">{language === 'zh-CN' ? `${t('flow.step')} ${index + 1}` : `Step ${index + 1}`}</span>
              </div>
              <h2 className="mt-3 text-sm font-semibold">{t(titleKey, title)}</h2>
              <p className="mt-1 min-h-10 text-xs leading-5 text-muted-foreground">{t(descriptionKey, description)}</p>
              <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary">
                {t(actionKey, action)}<ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
