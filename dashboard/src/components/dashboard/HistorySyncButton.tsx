import { useState } from 'react';
import { CheckCircle2, History, Loader2, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useHistorySync } from '@/hooks/useHistorySync';
import { useLanguage } from '@/i18n/LanguageProvider';

export function HistorySyncButton() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const sync = useHistorySync();
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!sync.isPending) setOpen(next); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => setOpen(true)}>
          <History className="h-4 w-4" />{t('sync.title', 'Sync history')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('sync.title', 'Sync history')}</DialogTitle>
          <DialogDescription>{t('sync.description', 'Re-read supported local Agent conversations and refresh tasks and linked delivery results. Required analysis starts automatically after import.')}</DialogDescription>
        </DialogHeader>
        {!sync.data && !sync.isError && <Button className="w-full gap-2" disabled={sync.isPending} onClick={() => sync.mutate({ force: true })}>
          {sync.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
          {sync.isPending ? t('sync.running', 'Syncing local history…') : t('sync.start', 'Start sync')}
        </Button>}
        {sync.data && <div className="space-y-3 text-sm">
          <p className="flex items-center gap-2 font-medium text-emerald-600"><CheckCircle2 className="h-4 w-4" />{t('sync.completed', 'History sync completed')}</p>
          <div className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-xs sm:grid-cols-3">
            <p><strong>{sync.data.projection.usableSessions}</strong><br />{t('sync.usable', 'usable sessions')}</p>
            <p><strong>{sync.data.sessions.messageCount}</strong><br />{t('sync.messages', 'messages imported')}</p>
            <p><strong>{sync.data.projection.emptySessions}</strong><br />{t('sync.empty', 'empty sessions hidden')}</p>
            <p><strong>{sync.data.projection.invalidatedInsights}</strong><br />{t('sync.invalidated', 'invalid analyses hidden')}</p>
            <p><strong>{sync.data.deliveries.deliveries}</strong><br />{t('sync.deliveries', 'linked results indexed')}</p>
            <p><strong>{sync.data.sessions.errorCount + sync.data.deliveries.failed}</strong><br />{t('sync.errors', 'unavailable sources')}</p>
          </div>
          <Button className="w-full" onClick={() => { sync.reset(); setOpen(false); }}>{t('bulk.done', 'Done')}</Button>
        </div>}
        {sync.isError && <div className="space-y-3 text-sm">
          <p className="flex items-center gap-2 text-destructive"><TriangleAlert className="h-4 w-4" />{t('sync.failed', 'History sync failed. Existing local data was preserved.')}</p>
          <Button variant="outline" className="w-full" onClick={() => sync.reset()}>{t('sync.retry', 'Retry')}</Button>
        </div>}
      </DialogContent>
    </Dialog>
  );
}
