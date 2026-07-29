import { useState } from 'react';
import { History, Loader2, PlayCircle, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useHistorySync } from '@/hooks/useHistorySync';
import { useLanguage } from '@/i18n/LanguageProvider';
import { toast } from 'sonner';

export function HistorySyncButton() {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const sync = useHistorySync();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2" disabled={sync.isPending} onClick={() => setOpen(true)}>
          {sync.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />}
          {sync.isPending ? t('sync.running', 'Syncing local history…') : t('sync.title', 'Sync history')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('sync.title', 'Sync history')}</DialogTitle>
          <DialogDescription>{t('sync.description', 'Re-read supported local Agent conversations and refresh tasks and linked delivery results. Required analysis starts automatically after import.')}</DialogDescription>
        </DialogHeader>
        {!sync.data && !sync.isError && <Button className="w-full gap-2" onClick={() => {
          setOpen(false);
          sync.mutate({ force: true }, {
            onSuccess: () => toast.success(t('sync.started', 'History sync started in the background')),
            onError: () => toast.error(t('sync.failed', 'History sync failed. Existing local data was preserved.')),
          });
        }}>
          <History className="h-4 w-4" />
          {t('sync.start', 'Start sync')}
        </Button>}
        {sync.data && <div className="space-y-3 text-sm">
          <p className="flex items-center gap-2 font-medium text-emerald-600"><PlayCircle className="h-4 w-4" />{t('sync.started', 'History sync started in the background')}</p>
          <p className="rounded-lg border p-3 text-muted-foreground">{t('sync.backgroundHint', 'You can keep using this page. Import and analysis progress will update automatically.')}</p>
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
