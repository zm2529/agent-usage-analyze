import { Link } from 'react-router';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { MessageSquare, FileText, GitCommit, BookOpen, Target, Activity } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { getSessionTitle } from '@/lib/utils';
import { INSIGHT_TYPE_COLORS, SOURCE_TOOL_COLORS } from '@/lib/constants/colors';
import type { Session, Insight, InsightType } from '@/lib/types';
import { SOURCE_TOOL_DISPLAY_NAMES } from '@/lib/share-card-icons';
import { useLanguage } from '@/i18n/LanguageProvider';

interface ActivityFeedProps {
  sessions: Session[];
  insights: Insight[];
  limit?: number;
}

const insightTypeIcons: Record<InsightType, typeof FileText> = {
  summary: FileText,
  decision: GitCommit,
  learning: BookOpen,
  technique: BookOpen,
  prompt_quality: Target,
};

const insightTypeLabels: Record<InsightType, string> = {
  summary: 'Summary',
  decision: 'Decision',
  learning: 'Learning',
  technique: 'Learning',
  prompt_quality: 'Prompt Quality',
};

export function ActivityFeed({ sessions, insights, limit = 7 }: ActivityFeedProps) {
  const { language, t } = useLanguage();
  const sessionLimit = Math.ceil(limit / 2);
  const insightLimit = Math.floor(limit / 2);
  const recentSessions = [...sessions]
    .sort((a, b) => new Date(b.ended_at).getTime() - new Date(a.ended_at).getTime())
    .slice(0, sessionLimit);
  const recentInsights = [...insights]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, insightLimit);

  if (recentSessions.length === 0 && recentInsights.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-4 gap-1.5 text-center">
        <Activity className="h-8 w-8 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">{t('activity.empty', 'No recent activity')}</p>
        <p className="text-xs text-muted-foreground">{t('activity.emptyHint', 'Start an agent coding session to see it here.')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {recentSessions.length > 0 && (
        <section>
          <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t('activity.recentSessions', 'Recent conversations')}
          </p>
          <div className="divide-y divide-border">
            {recentSessions.map((session) => (
              <SessionFeedItem key={`s-${session.id}`} session={session} language={language} t={t} />
            ))}
          </div>
        </section>
      )}
      {recentInsights.length > 0 && (
        <section>
          <div className="flex items-center justify-between px-1 pb-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('activity.latestInsights', 'Latest LLM insights')}
            </p>
            <span className="text-[10px] text-muted-foreground">{t('activity.insightHint', 'Summary, decision, and learning are insight types')}</span>
          </div>
          <div className="divide-y divide-border">
            {recentInsights.map((insight) => (
              <InsightFeedItem key={`i-${insight.id}`} insight={insight} language={language} t={t} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SessionFeedItem({ session, language, t }: { session: Session; language: 'en' | 'zh-CN'; t: (key: string, fallback?: string) => string }) {
  const startedAt = new Date(session.started_at);
  const lastActivityAt = new Date(session.ended_at);
  const endedAt = new Date(session.ended_at);
  const durationMin = Math.round((endedAt.getTime() - startedAt.getTime()) / 60000);
  const displayTitle = getSessionTitle(session);

  return (
    <Link to={`/sessions?session=${session.id}`} className="block group">
      <div className="rounded-sm px-1 py-1.5 transition-[background-color] duration-200 hover:bg-accent">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="shrink-0 h-5 w-5 rounded bg-primary/10 group-hover:bg-primary/15 flex items-center justify-center transition-colors">
              <MessageSquare className="h-3 w-3 text-primary/70" />
            </div>
            <p className="text-sm font-medium line-clamp-1 group-hover:text-primary transition-colors min-w-0">
              {displayTitle}
            </p>
            <Badge variant="secondary" className="text-[10px] shrink-0">
              {t('activity.conversationType', 'Conversation')}
            </Badge>
            {session.source_tool && (
              <Badge
                variant="outline"
                className={`text-xs capitalize shrink-0 ${SOURCE_TOOL_COLORS[session.source_tool] ?? 'bg-muted text-muted-foreground'}`}
              >
                {SOURCE_TOOL_DISPLAY_NAMES[session.source_tool] ?? session.source_tool}
              </Badge>
            )}
            <span className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">
              &middot; {session.message_count} {t('activity.messages', 'msgs')} &middot; {durationMin}{t('activity.minutes', 'm')}
            </span>
          </div>
          <span className="text-xs text-muted-foreground shrink-0">
            {formatDistanceToNow(lastActivityAt, { addSuffix: true, locale: language === 'zh-CN' ? zhCN : undefined })}
          </span>
        </div>
      </div>
    </Link>
  );
}

function InsightFeedItem({ insight, language, t }: { insight: Insight; language: 'en' | 'zh-CN'; t: (key: string, fallback?: string) => string }) {
  const Icon = insightTypeIcons[insight.type];
  const colorClass = INSIGHT_TYPE_COLORS[insight.type];
  const label = t(`activity.insight.${insight.type}`, insightTypeLabels[insight.type]);

  return (
    <Link to={`/sessions?session=${insight.session_id}`} className="block group">
      <div className="rounded-sm px-1 py-1.5 transition-[background-color] duration-200 hover:bg-accent">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className={`shrink-0 h-5 w-5 rounded flex items-center justify-center transition-colors ${colorClass}`}>
              <Icon className="h-3 w-3" />
            </div>
            <p className="text-sm font-medium line-clamp-1 group-hover:text-primary transition-colors min-w-0">
              {insight.title}
            </p>
            <Badge variant="outline" className={`text-xs shrink-0 ${colorClass}`}>
              {t('activity.llmInsightType', 'LLM insight')} · {label}
            </Badge>
          </div>
          <span className="text-xs text-muted-foreground shrink-0">
            {formatDistanceToNow(new Date(insight.timestamp), { addSuffix: true, locale: language === 'zh-CN' ? zhCN : undefined })}
          </span>
        </div>
      </div>
    </Link>
  );
}
