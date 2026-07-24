import { toast } from 'sonner';
import { useLlmConfig, useSaveLlmConfig } from '@/hooks/useConfig';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useLanguage } from '@/i18n/LanguageProvider';

export function SemanticAnalysisSettingsStatus({
  configured,
  enabled,
  provider,
  model,
  locality,
  pending,
  onToggle,
}: {
  configured: boolean;
  enabled: boolean;
  provider?: string;
  model?: string;
  locality?: 'local' | 'remote';
  pending: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const { t } = useLanguage();
  const resolvedLocality = locality
    ?? (provider && ['ollama', 'llamacpp'].includes(provider) ? 'local' : 'remote');
  const unsupportedRemoteLocalProvider = resolvedLocality === 'remote'
    && (provider === 'ollama' || provider === 'llamacpp');
  return (
    <Card aria-label={t('semantic.settings', 'Semantic analysis settings')}>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">{t('semantic.title', 'Privacy-controlled semantic analysis')}</CardTitle>
          <Badge className="ml-auto" variant={enabled ? 'default' : 'secondary'}>
            {enabled ? t('runtime.enabled', 'Enabled') : t('semantic.disabledDefault', 'Disabled by default')}
          </Badge>
        </div>
        <CardDescription>
          {t('semantic.desc', 'Semantic claims are optional; deterministic facts, trends, and delivery evidence do not require an LLM.')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>{configured ? `${provider} · ${model} · ${resolvedLocality}` : t('semantic.configureFirst', 'Configure and test a provider first.')}</p>
        {unsupportedRemoteLocalProvider && (
          <p className="text-xs text-destructive">
            {t('semantic.remoteUnsupported', 'Remote Ollama and llama.cpp endpoints cannot be enabled for semantic analysis.')}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {t('semantic.privacy', 'A redacted, turn-safe evidence packet is shown before each run. Remote providers receive only that bounded packet.')}
        </p>
        <Button
          variant={enabled ? 'outline' : 'default'}
          disabled={!configured || pending || (!enabled && unsupportedRemoteLocalProvider)}
          onClick={() => onToggle(!enabled)}
        >
          {enabled ? t('semantic.disable', 'Disable semantic analysis') : t('semantic.enable', 'Enable semantic analysis')}
        </Button>
      </CardContent>
    </Card>
  );
}

export function SemanticAnalysisSettingsCard() {
  const { t } = useLanguage();
  const config = useLlmConfig();
  const save = useSaveLlmConfig();
  const configured = Boolean(config.data?.provider && config.data.model);
  const enabled = config.data?.semanticAnalysisEnabled === true;
  const toggle = async (next: boolean) => {
    try {
      await save.mutateAsync({ semanticAnalysisEnabled: next });
      toast.success(next ? t('semantic.enabledToast', 'Semantic analysis enabled') : t('semantic.disabledToast', 'Semantic analysis disabled'));
    } catch {
      toast.error(t('semantic.updateFailed', 'Could not update semantic analysis settings'));
    }
  };
  return (
    <SemanticAnalysisSettingsStatus
      configured={configured}
      enabled={enabled}
      provider={config.data?.provider}
      model={config.data?.model}
      locality={config.data?.semanticProviderLocality}
      pending={config.isLoading || save.isPending}
      onToggle={(next) => { void toggle(next); }}
    />
  );
}
