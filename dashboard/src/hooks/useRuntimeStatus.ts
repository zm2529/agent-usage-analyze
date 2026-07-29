import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchRuntimeStatus, retryPendingAnalysis } from '@/lib/api';
import { useLanguage } from '@/i18n/LanguageProvider';

export function useRuntimeStatus() {
  const { language } = useLanguage();
  return useQuery({
    queryKey: ['runtimeStatus', language],
    queryFn: fetchRuntimeStatus,
    refetchInterval: 10_000,
    select: (data) => {
      const cn = language === 'zh-CN';
      const stateLabels = cn
        ? { healthy: '正常', running: '处理中', waiting: '等待中', stale: '需要处理', failed: '失败', 'not-configured': '未配置' }
        : { healthy: 'Ready', running: 'In progress', waiting: 'Waiting', stale: 'Needs attention', failed: 'Failed', 'not-configured': 'Not configured' };
      const stages = Object.fromEntries(Object.entries(data.stages).map(([key, stage]) => {
        const ingestionProgress = key === 'ingestion'
          ? stage.detail.match(/(\d+)\/(\d+)/)
          : null;
        return [key, {
          ...stage,
          // The server owns the operational label and detail. Replacing them with
          // a generic state hid import counts and actionable failure diagnostics.
          label: cn ? stage.label : stateLabels[stage.state],
          detail: cn
            ? stage.detail
            : ingestionProgress
              ? `${ingestionProgress[1]}/${ingestionProgress[2]} sources processed`
              : stage.backlog > 0
                ? `${stage.backlog} pending`
                : stage.failures > 0
                  ? `${stage.failures} incomplete; open for details`
                  : 'No action needed',
        }];
      })) as typeof data.stages;
      return { ...data, stages };
    },
  });
}

export function useRetryPendingAnalysis() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: retryPendingAnalysis,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['runtimeStatus'] });
      void client.invalidateQueries({ queryKey: ['analysisQueue'] });
    },
  });
}
