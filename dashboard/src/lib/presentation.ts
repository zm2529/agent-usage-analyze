import type { Delivery } from '@/lib/types';

type Translate = (key: string, fallback?: string) => string;

export function readableSessionTitle(
  storedTitle: string | null | undefined,
  fallback: string,
  t: Translate,
): string {
  const title = storedTitle?.trim() ?? '';
  if (!title
    || /^<recommended_?plugins?>/i.test(title)
    || /^<codex_?(?:internal_?context|delegation)>/i.test(title)
    || /^<skill>/i.test(title)
    || /^files mentioned by the user:/i.test(title)
    || /^no coding(?:-session)? activity captured$/i.test(title)) {
    return fallback || t('work.unnamedTask', 'Unnamed task');
  }
  return title;
}

export function repositoryDisplayName(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\\/g, '/').replace(/\/$/, '');
  return normalized.split('/').at(-1) || null;
}

export function deliveryKindLabel(delivery: Delivery, t: Translate): string {
  if (delivery.kind === 'git-commit') return t('delivery.commitResult', 'Code commit');
  if (delivery.kind === 'local-artifact') return t('delivery.artifactResult', 'Local artifact');
  const validationKind = String(delivery.metadata.validationKind ?? '').toLowerCase();
  if (validationKind === 'build') return t('delivery.buildResult', 'Build verification');
  if (validationKind === 'test') return t('delivery.testResult', 'Test run');
  return t('delivery.validationResult', 'Validation run');
}

export function deliveryDisplayTitle(delivery: Delivery, t: Translate): string {
  const label = deliveryKindLabel(delivery, t);
  if (delivery.kind === 'git-commit') return `${label} · ${delivery.resultIdentity.slice(0, 12)}`;
  if (delivery.kind === 'local-artifact') {
    const name = repositoryDisplayName(delivery.resultIdentity);
    return name ? `${label} · ${name}` : label;
  }
  return label;
}

export function deliveryExplanation(delivery: Delivery, t: Translate): string {
  if (delivery.kind === 'test-run') {
    const status = String(delivery.metadata.status ?? 'unknown').toLowerCase();
    if (status === 'passed' || status === 'success') {
      return t('delivery.testPassedDesc', 'The task history records this verification as passed.');
    }
    if (status === 'failed' || status === 'failure') {
      return t('delivery.testFailedDesc', 'The task history records this verification as failed.');
    }
    return t('delivery.testUnknownDesc', 'A build or test command was observed in this task, but the historical event did not preserve a clear pass or fail result.');
  }
  if (delivery.kind === 'git-commit') {
    return t('delivery.commitDesc', 'This commit is associated with the task by repository, branch, time, or an explicit task reference. Review the relationship before treating it as confirmed output.');
  }
  return t('delivery.artifactDesc', 'This local file was explicitly registered as an output of the task.');
}
