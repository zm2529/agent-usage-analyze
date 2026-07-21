import { Badge } from '@/components/ui/badge';
import {
  CheckCircle2,
  AlertCircle,
  XCircle,
  Ban,
  HelpCircle,
  Lightbulb,
  CalendarClock,
  FileText,
  Scale,
  GitFork,
  ArrowRightLeft,
  Clock,
} from 'lucide-react';
import type { InsightType, InsightMetadata } from '@/lib/types';
import type { LucideIcon } from 'lucide-react';

// --- Outcome Badge ---

export const OUTCOME_CONFIG: Record<string, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  success: { label: 'Success', className: 'bg-green-500/10 text-green-600 border-green-500/20', icon: CheckCircle2 },
  partial: { label: 'Partial', className: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20', icon: AlertCircle },
  abandoned: { label: 'Abandoned', className: 'bg-gray-500/10 text-gray-500 border-gray-500/20', icon: XCircle },
  blocked: { label: 'Blocked', className: 'bg-red-500/10 text-red-600 border-red-500/20', icon: Ban },
};

export function OutcomeBadge({ outcome }: { outcome: string }) {
  const config = OUTCOME_CONFIG[outcome];
  if (!config) return null;
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={config.className}>
      <Icon className="h-3 w-3 mr-1" />
      {config.label}
    </Badge>
  );
}

// --- Field icon config ---

const FIELD_CONFIG: Record<string, { icon: LucideIcon; color: string }> = {
  'What Happened': { icon: AlertCircle, color: 'text-muted-foreground' },
  'Why': { icon: HelpCircle, color: 'text-muted-foreground' },
  'Takeaway': { icon: Lightbulb, color: 'text-yellow-500' },
  'Applies When': { icon: CalendarClock, color: 'text-muted-foreground' },
  'Situation': { icon: FileText, color: 'text-muted-foreground' },
  'Choice': { icon: CheckCircle2, color: 'text-blue-500' },
  'Reasoning': { icon: Scale, color: 'text-muted-foreground' },
  'Alternatives Considered': { icon: GitFork, color: 'text-muted-foreground' },
  'Trade-offs': { icon: ArrowRightLeft, color: 'text-muted-foreground' },
  'Revisit When': { icon: Clock, color: 'text-muted-foreground' },
};

// --- Shared metadata helpers ---

export function MetadataSection({ label, children, prominent }: { label: string; children: React.ReactNode; prominent?: boolean }) {
  const fieldConfig = FIELD_CONFIG[label];
  const FieldIcon = fieldConfig?.icon;

  return (
    <div className="space-y-0.5">
      <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {FieldIcon && <FieldIcon className={`h-3 w-3 ${fieldConfig.color}`} />}
        {label}
      </span>
      {prominent ? (
        <div className="rounded-md bg-muted/30 px-3 py-2">
          <p className="text-sm font-medium text-foreground">{children}</p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{children}</p>
      )}
    </div>
  );
}

export function formatAlternatives(alternatives: InsightMetadata['alternatives']): string {
  if (!alternatives || alternatives.length === 0) return '';
  return alternatives.map(a => {
    if (typeof a === 'string') return a;
    return a.rejected_because ? `${a.option} (rejected: ${a.rejected_because})` : a.option;
  }).join('; ');
}

// --- Type-specific content components ---

export function DecisionContent({ metadata }: { metadata: InsightMetadata }) {
  const hasStructured = metadata.situation || metadata.choice || metadata.reasoning;
  if (!hasStructured) return null;

  return (
    <div className="space-y-2.5">
      {metadata.situation && <MetadataSection label="Situation">{metadata.situation}</MetadataSection>}
      {metadata.choice && <MetadataSection label="Choice" prominent>{metadata.choice}</MetadataSection>}
      {metadata.reasoning && <MetadataSection label="Reasoning">{metadata.reasoning}</MetadataSection>}
      {metadata.alternatives && metadata.alternatives.length > 0 && (
        <div className="space-y-0.5">
          <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <GitFork className="h-3 w-3 text-muted-foreground" />
            Alternatives Considered
          </span>
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {metadata.alternatives.map((alt, i) => {
              const label = typeof alt === 'string' ? alt : alt.option;
              const reason = typeof alt === 'string' ? undefined : alt.rejected_because;
              return (
                <Badge key={i} variant="outline" className="text-xs font-normal" title={reason ? `Rejected: ${reason}` : undefined}>
                  {label}
                  {reason && <span className="ml-1 text-muted-foreground/60">- {reason}</span>}
                </Badge>
              );
            })}
          </div>
        </div>
      )}
      {metadata.trade_offs && <MetadataSection label="Trade-offs">{metadata.trade_offs}</MetadataSection>}
      {metadata.revisit_when && metadata.revisit_when !== 'N/A' && (
        <MetadataSection label="Revisit When">{metadata.revisit_when}</MetadataSection>
      )}
      {metadata.evidence && metadata.evidence.length > 0 && (
        <MetadataSection label="Evidence">{metadata.evidence.join(', ')}</MetadataSection>
      )}
    </div>
  );
}

export function LearningContent({ metadata }: { metadata: InsightMetadata }) {
  const hasStructured = metadata.symptom || metadata.root_cause || metadata.takeaway;
  if (!hasStructured) return null;

  return (
    <div className="space-y-2.5">
      {metadata.symptom && <MetadataSection label="What Happened">{metadata.symptom}</MetadataSection>}
      {metadata.root_cause && <MetadataSection label="Why">{metadata.root_cause}</MetadataSection>}
      {metadata.takeaway && <MetadataSection label="Takeaway" prominent>{metadata.takeaway}</MetadataSection>}
      {metadata.applies_when && <MetadataSection label="Applies When">{metadata.applies_when}</MetadataSection>}
    </div>
  );
}

export function SummaryContent({ metadata, bullets }: { metadata: InsightMetadata; bullets: string[] }) {
  return (
    <div className="space-y-2">
      {metadata.outcome && (
        <div>
          <OutcomeBadge outcome={metadata.outcome} />
        </div>
      )}
      {bullets.length > 0 && (
        <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
          {bullets.map((bullet, i) => (
            <li key={i} className="line-clamp-1">{bullet}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function renderTypeContent(type: InsightType, metadata: InsightMetadata, bullets: string[]) {
  switch (type) {
    case 'decision':
      return <DecisionContent metadata={metadata} />;
    case 'learning':
    case 'technique':
      return <LearningContent metadata={metadata} />;
    case 'summary':
      return <SummaryContent metadata={metadata} bullets={bullets} />;
    default:
      return null;
  }
}
