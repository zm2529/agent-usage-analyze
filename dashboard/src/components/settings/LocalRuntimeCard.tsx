import { useQuery } from '@tanstack/react-query';
import { Database, Download, HardDrive, Server } from 'lucide-react';
import { fetchRuntimeConfig } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export function LocalRuntimeCard() {
  const runtime = useQuery({ queryKey: ['config', 'runtime'], queryFn: fetchRuntimeConfig });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><HardDrive className="h-5 w-5" />Local runtime and data</CardTitle>
        <CardDescription>Where analysis runs, what it observes, and how to export, archive, recover, or rebuild it.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {runtime.isLoading && <p className="text-muted-foreground">Loading local runtime…</p>}
        {runtime.isError && <p className="text-destructive">Local runtime status is unavailable.</p>}
        {runtime.data && <>
          <div className="grid gap-2 sm:grid-cols-2">
            <p className="flex gap-2"><Database className="h-4 w-4 shrink-0" /><span><strong>Data directory</strong><br /><code className="break-all text-xs">{runtime.data.dataDirectory}</code></span></p>
            <p className="flex gap-2"><Server className="h-4 w-4 shrink-0" /><span><strong>Loopback server</strong><br />{runtime.data.listenAddress}</span></p>
          </div>
          <p><strong>Sources:</strong> {runtime.data.sources.length === 0 ? 'none' : runtime.data.sources.map((source) => `${source.kind} (${source.count})`).join(', ')}</p>
          <p><strong>Observation eras:</strong> {runtime.data.eras.length === 0 ? 'none' : runtime.data.eras.map((era) => `${era.mode} · ${era.parserVersion} (${era.count})`).join(', ')}</p>
          <p><strong>Semantic analysis:</strong> {runtime.data.llm.configured
            ? `${runtime.data.llm.provider} · ${runtime.data.llm.model} · ${runtime.data.llm.locality ?? 'unknown locality'} · ${runtime.data.llm.enabled ? 'enabled' : 'disabled'}`
            : 'not configured · disabled'}</p>
          <p><strong>Migration:</strong> schema V{runtime.data.migration.databaseSchema} · {runtime.data.migration.status}</p>
          <div className="rounded-md border p-3 space-y-2">
            <Button asChild size="sm"><a href={runtime.data.dataActions.exportPath} download><Download className="mr-2 h-4 w-4" />Download sanitized export</a></Button>
            <p>{runtime.data.dataActions.scope}</p>
            <p>{runtime.data.dataActions.recovery}</p>
            <p>Archive: <code>{runtime.data.dataActions.archiveCommand}</code></p>
            <p>Rebuild: <code>{runtime.data.dataActions.rebuildCommand}</code></p>
          </div>
        </>}
      </CardContent>
    </Card>
  );
}
