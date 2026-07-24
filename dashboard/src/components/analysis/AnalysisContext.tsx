/**
 * Analysis context for the embedded dashboard.
 * Uses the same automatic runner policy exposed by Settings. This lets a
 * signed-in Codex account analyze sessions without a separately configured
 * API provider while retaining AbortController cancellation.
 *
 * State model: Map<analysisKey, AnalysisState> where analysisKey = `${sessionId}:${type}`.
 * Each analysis entry owns its own AbortController — multiple analyses can run concurrently.
 */
import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSessionTitle } from '@/lib/utils';
import type { Session } from '@/lib/types';
import { toast } from 'sonner';

export interface AnalysisState {
  status: 'idle' | 'analyzing' | 'complete' | 'error';
  sessionId: string | null;
  sessionTitle: string | null;
  type: 'session' | 'prompt_quality';
  progress: {
    phase: 'loading_messages' | 'analyzing' | 'saving';
    currentChunk?: number;
    totalChunks?: number;
    message: string;
  } | null;
  result: {
    success: boolean;
    insightCount?: number;
    tokenUsage?: { inputTokens: number; outputTokens: number };
    costUsd?: number;
    provider?: string;
    model?: string;
    error?: string;
  } | null;
}

type AnalysisType = 'session' | 'prompt_quality';

function makeKey(sessionId: string, type: AnalysisType): string {
  return `${sessionId}:${type}`;
}

function makeToastId(sessionId: string, type: AnalysisType): string {
  return `analysis-${sessionId}-${type}`;
}

interface AnalysisContextValue {
  analyses: Map<string, AnalysisState>;
  getAnalysisState: (sessionId: string, type: AnalysisType) => AnalysisState | undefined;
  startAnalysis: (session: Session, type: AnalysisType) => Promise<void>;
  cancelAnalysis: (sessionId: string, type: AnalysisType) => void;
  clearResult: (sessionId: string, type: AnalysisType) => void;
}

const AnalysisContext = createContext<AnalysisContextValue>({
  analyses: new Map(),
  getAnalysisState: () => undefined,
  startAnalysis: async () => {},
  cancelAnalysis: () => {},
  clearResult: () => {},
});

export function useAnalysis() {
  return useContext(AnalysisContext);
}

export function AnalysisProvider({ children }: { children: ReactNode }) {
  const [analyses, setAnalyses] = useState<Map<string, AnalysisState>>(new Map());
  const queryClient = useQueryClient();
  // Map of analysisKey → AbortController for concurrent cancellation
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());

  const getAnalysisState = useCallback(
    (sessionId: string, type: AnalysisType): AnalysisState | undefined => {
      return analyses.get(makeKey(sessionId, type));
    },
    [analyses]
  );

  const cancelAnalysis = useCallback((sessionId: string, type: AnalysisType) => {
    const key = makeKey(sessionId, type);
    abortControllersRef.current.get(key)?.abort();
    abortControllersRef.current.delete(key);
    setAnalyses((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    toast.info('Analysis cancelled', { id: makeToastId(sessionId, type), duration: 2000 });
  }, []);

  const clearResult = useCallback((sessionId: string, type: AnalysisType) => {
    const key = makeKey(sessionId, type);
    setAnalyses((prev) => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const startAnalysis = useCallback(
    async (session: Session, type: AnalysisType) => {
      const key = makeKey(session.id, type);
      const toastId = makeToastId(session.id, type);
      const sessionTitle = getSessionTitle(session);
      const controller = new AbortController();

      abortControllersRef.current.set(key, controller);

      setAnalyses((prev) => {
        const next = new Map(prev);
        next.set(key, {
          status: 'analyzing',
          sessionId: session.id,
          sessionTitle,
          type,
          progress: {
            phase: 'loading_messages',
            message: 'Loading messages...',
          },
          result: null,
        });
        return next;
      });

      toast.loading(`Loading messages for "${sessionTitle}"...`, { id: toastId });

      try {
        setAnalyses((prev) => {
          const next = new Map(prev);
          const entry = next.get(key);
          if (entry) next.set(key, {
            ...entry,
            progress: { phase: 'analyzing', message: 'Analyzing with the automatic runner…' },
          });
          return next;
        });
        toast.loading(`Analyzing "${sessionTitle}" with the automatic runner...`, { id: toastId });

        const response = await fetch('/api/analysis/automatic-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.id, force: true }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => response.statusText);
          throw new Error(`API ${response.status}: ${text}`);
        }
        const result = await response.json() as { success: boolean; runner?: string };
        if (!result.success) throw new Error('Automatic analysis failed');

        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['insights'] }),
          queryClient.invalidateQueries({ queryKey: ['session', session.id] }),
          queryClient.invalidateQueries({ queryKey: ['sessions'] }),
          queryClient.invalidateQueries({ queryKey: ['analysis-cost', session.id] }),
        ]);
        setAnalyses((prev) => {
          const next = new Map(prev);
          next.set(key, {
            status: 'complete', sessionId: session.id, sessionTitle, type,
            progress: null, result: { success: true, provider: result.runner },
          });
          return next;
        });
        toast.success(`Analysis completed for "${sessionTitle}"`, { id: toastId });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        const errorMsg = error instanceof Error ? error.message : 'Analysis failed';
        setAnalyses((prev) => {
          const next = new Map(prev);
          next.set(key, {
            status: 'error',
            sessionId: session.id,
            sessionTitle,
            type,
            progress: null,
            result: { success: false, error: errorMsg },
          });
          return next;
        });
        toast.error(`Analysis failed: ${errorMsg}`, { id: toastId });
      } finally {
        abortControllersRef.current.delete(key);
      }
    },
    [queryClient]
  );

  return (
    <AnalysisContext.Provider value={{ analyses, getAnalysisState, startAnalysis, cancelAnalysis, clearResult }}>
      {children}
    </AnalysisContext.Provider>
  );
}
