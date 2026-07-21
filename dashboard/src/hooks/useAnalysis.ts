import { useMutation, useQueryClient } from '@tanstack/react-query';
import { analyzeSession } from '@/lib/api';

export function useAnalyzeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => analyzeSession(sessionId),
    onSuccess: (_data, sessionId) => {
      // Invalidate insights and the session itself — analysis may produce new insights
      // and update session summary/title.
      queryClient.invalidateQueries({ queryKey: ['insights'] });
      queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
    },
  });
}
