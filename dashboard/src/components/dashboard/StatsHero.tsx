import { Card, CardContent } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { formatDurationMinutes, formatModelName, formatTokenCount } from '@/lib/utils';
import {
  MessageSquare,
  Wrench,
  Clock,
  FolderOpen,
  Zap,
  Coins,
  Cpu,
} from 'lucide-react';
import { useLanguage } from '@/i18n/LanguageProvider';

interface StatsHeroProps {
  totalSessions: number;
  totalMessages: number;
  totalToolCalls: number;
  totalDurationMin: number;
  totalProjects: number;
  isExact: boolean;
  totalTokens?: number;
  topModel?: string | null;
  tokenBreakdown?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  };
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toString();
}

export function StatsHero({
  totalSessions,
  totalMessages,
  totalToolCalls,
  totalDurationMin,
  totalProjects,
  isExact,
  totalTokens,
  topModel,
  tokenBreakdown,
}: StatsHeroProps) {
  const { t } = useLanguage();
  const showUsage = (totalTokens ?? 0) > 0 || Boolean(topModel);

  const coreCell = (
    key: string,
    label: string,
    value: string,
    Icon: React.ElementType
  ) => (
    <div
      key={key}
      className="flex-1 min-w-[100px] px-3 py-2 border-r border-border last:border-r-0"
    >
      <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
        <Icon className="h-3 w-3" />
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-base font-bold text-primary">{value}</div>
    </div>
  );

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap">
          {coreCell('sessions', t('stats.sessions', 'Sessions'), formatCompact(totalSessions), Zap)}
          {coreCell('messages', t('stats.messages', 'Messages'), `${!isExact ? '~' : ''}${formatCompact(totalMessages)}`, MessageSquare)}
          {coreCell('toolCalls', t('stats.toolCalls', 'Tool Calls'), `${!isExact ? '~' : ''}${formatCompact(totalToolCalls)}`, Wrench)}
          {coreCell('duration', t('stats.codingTime', 'Coding Time'), `${!isExact ? '~' : ''}${formatDurationMinutes(totalDurationMin)}`, Clock)}
          <div
            className={`flex-1 min-w-[100px] px-3 py-2 ${showUsage ? 'border-r border-border' : ''}`}
          >
            <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
              <FolderOpen className="h-3 w-3" />
              <span className="text-[11px] font-medium uppercase tracking-wide">{t('stats.projects', 'Projects')}</span>
            </div>
            <div className="text-base font-bold text-primary">{totalProjects}</div>
          </div>

          {showUsage && (
            <>
              <div className="flex-1 min-w-[100px] px-3 py-2 border-r border-border last:border-r-0">
                <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
                  <Coins className="h-3 w-3" />
                  <span className="text-[11px] font-medium uppercase tracking-wide">{t('stats.tokens', 'Tokens')}</span>
                </div>
                {tokenBreakdown ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div
                        className="text-base font-bold text-primary cursor-default"
                        aria-label={t('stats.tokenBreakdown', 'Token breakdown')}
                      >
                        {formatTokenCount(totalTokens ?? 0)}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs space-y-0.5">
                      <p>{t('stats.input', 'Input')}: {formatTokenCount(tokenBreakdown.inputTokens)}</p>
                      <p>{t('stats.output', 'Output')}: {formatTokenCount(tokenBreakdown.outputTokens)}</p>
                      <p>{t('stats.cacheWrite', 'Cache Write')}: {formatTokenCount(tokenBreakdown.cacheCreationTokens)}</p>
                      <p>{t('stats.cacheRead', 'Cache Read')}: {formatTokenCount(tokenBreakdown.cacheReadTokens)}</p>
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <div className="text-base font-bold text-primary">
                    {formatTokenCount(totalTokens ?? 0)}
                  </div>
                )}
              </div>

              {topModel && (
                <div className="flex-1 min-w-[100px] px-3 py-2 last:border-r-0">
                  <div className="flex items-center gap-1.5 text-muted-foreground mb-0.5">
                    <Cpu className="h-3 w-3" />
                    <span className="text-[11px] font-medium uppercase tracking-wide">{t('stats.topModel', 'Top Model')}</span>
                  </div>
                  <div className="text-base font-bold text-primary">
                    {formatModelName(topModel)}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
