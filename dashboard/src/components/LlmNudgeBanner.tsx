import { useState } from 'react';
import { Link } from 'react-router';
import { X, Sparkles, Terminal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLlmConfig } from '@/hooks/useConfig';

interface LlmNudgeBannerProps {
  context: 'insights' | 'patterns';
}

const TITLES: Record<LlmNudgeBannerProps['context'], string> = {
  insights: 'Get AI-powered insights',
  patterns: 'Enable cross-session pattern detection',
};

function localStorageKey(context: LlmNudgeBannerProps['context']): string {
  return `agent-analytics:llm-nudge-dismissed-${context}`;
}

export function LlmNudgeBanner({ context }: LlmNudgeBannerProps) {
  const { data: llmConfig, isLoading: configLoading } = useLlmConfig();
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(localStorageKey(context)) === 'true';
    } catch {
      return false;
    }
  });

  // Don't render until config has resolved (prevents flash)
  if (configLoading) return null;

  // Don't show if LLM is already configured
  if (llmConfig?.provider) return null;

  // Don't show if user dismissed
  if (dismissed) return null;

  function handleDismiss() {
    try {
      localStorage.setItem(localStorageKey(context), 'true');
    } catch { /* ignore storage errors */ }
    setDismissed(true);
  }

  const title = TITLES[context];

  return (
    <div role="status" className="rounded-lg border bg-muted/40 px-4 py-3 text-sm">
      <div className="flex items-start gap-3">
        <Sparkles className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <p className="font-medium">{title}</p>

          {/* Primary path: Claude Code hook */}
          <div className="mt-2.5 rounded-md border border-dashed px-3 py-2.5 bg-background/60">
            <div className="flex items-start gap-2">
              <Terminal className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="font-medium text-foreground text-xs">Using Claude Code?</p>
                <p className="text-muted-foreground text-xs mt-0.5">
                  Analyze sessions automatically with your Claude subscription — no API key needed.
                </p>
                <code className="inline-block mt-1.5 rounded bg-muted px-2 py-0.5 text-[11px] font-mono text-foreground">
                  agent-analytics install-hook
                </code>
              </div>
            </div>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-2 my-2.5">
            <div className="flex-1 border-t" />
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">or</span>
            <div className="flex-1 border-t" />
          </div>

          {/* Secondary path: configure a provider */}
          <p className="text-muted-foreground text-xs">
            Configure a provider for manual analysis. Install{' '}
            <a
              href="https://ollama.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-foreground transition-colors"
            >
              Ollama
            </a>{' '}
            for free local analysis, or set up any provider in Settings.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-2">
          <Button variant="outline" size="sm" className="h-7 text-xs" asChild>
            <Link to="/settings">Configure AI Provider</Link>
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleDismiss}
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
