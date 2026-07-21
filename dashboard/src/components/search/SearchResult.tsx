import { MessageSquare, Lightbulb, GitCommit, BookOpen, FileText, Target, ChevronRight } from 'lucide-react';
import { SearchHighlight } from './SearchHighlight';
import { formatDistanceToNow, parseISO } from 'date-fns';
import type { SearchSessionResult, SearchInsightResult } from '@/lib/api';

function formatRelativeDate(isoDate: string): string {
  try {
    return formatDistanceToNow(parseISO(isoDate), { addSuffix: true });
  } catch {
    return isoDate;
  }
}

const INSIGHT_ICONS: Record<string, typeof FileText> = {
  summary: FileText,
  decision: GitCommit,
  learning: BookOpen,
  technique: BookOpen,
  prompt_quality: Target,
};

interface SessionResultProps {
  result: SearchSessionResult;
  query: string;
  isActive: boolean;
  onClick: () => void;
}

export function SessionSearchResult({ result, query, isActive, onClick }: SessionResultProps) {
  const characterLabel = result.session_character
    ? result.session_character.replace(/_/g, ' ')
    : null;

  return (
    <div
      role="option"
      aria-selected={isActive}
      onClick={onClick}
      className={`flex items-start gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
        isActive ? 'bg-accent' : 'hover:bg-accent/50'
      }`}
    >
      <MessageSquare className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-muted-foreground truncate">
          <SearchHighlight text={result.title} query={query} />
        </div>
        <div className="text-xs text-muted-foreground/60 mt-0.5 flex items-center gap-1.5">
          <span className="truncate">{result.project_name}</span>
          {characterLabel && (
            <>
              <span>·</span>
              <span>{characterLabel}</span>
            </>
          )}
          <span>·</span>
          <span>{formatRelativeDate(result.started_at)}</span>
        </div>
        {result.match_field === 'summary' && result.snippet && (
          <div className="text-xs text-muted-foreground/50 mt-0.5 truncate">
            <SearchHighlight text={result.snippet} query={query} />
          </div>
        )}
      </div>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 mt-1" />
    </div>
  );
}

interface InsightResultProps {
  result: SearchInsightResult;
  query: string;
  isActive: boolean;
  onClick: () => void;
}

export function InsightSearchResult({ result, query, isActive, onClick }: InsightResultProps) {
  const Icon = INSIGHT_ICONS[result.type] ?? Lightbulb;

  return (
    <div
      role="option"
      aria-selected={isActive}
      onClick={onClick}
      className={`flex items-start gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
        isActive ? 'bg-accent' : 'hover:bg-accent/50'
      }`}
    >
      <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-muted-foreground truncate">
          <SearchHighlight text={result.title} query={query} />
        </div>
        <div className="text-xs text-muted-foreground/60 mt-0.5 flex items-center gap-1.5">
          <span className="capitalize">{result.type.replace(/_/g, ' ')}</span>
          <span>·</span>
          <span className="truncate">{result.project_name}</span>
          <span>·</span>
          <span>{formatRelativeDate(result.created_at)}</span>
        </div>
        {result.snippet && (
          <div className="text-xs text-muted-foreground/50 mt-0.5 truncate">
            <SearchHighlight text={result.snippet} query={query} />
          </div>
        )}
      </div>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 mt-1" />
    </div>
  );
}
