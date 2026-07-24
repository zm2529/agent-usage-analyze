import type { AdvisorySuggestion } from '@/lib/types';

type Translate = (key: string, fallback?: string) => string;

const KEYS: Record<string, { title: string; fact: string; benefit: string; verification: string }> = {
  'pattern:rework': {
    title: 'patterns.rework', fact: 'patterns.reworkFact', benefit: 'advice.reworkBenefit', verification: 'advice.reworkVerification',
  },
  'pattern:waiting': {
    title: 'patterns.waiting', fact: 'patterns.waitingFact', benefit: 'advice.waitingBenefit', verification: 'advice.waitingVerification',
  },
  'pattern:context-switching': {
    title: 'patterns.contextSwitching', fact: 'patterns.contextSwitchingFact', benefit: 'advice.contextBenefit', verification: 'advice.contextVerification',
  },
  'pattern:validation-missing': {
    title: 'patterns.validationMissing', fact: 'patterns.validationMissingFact', benefit: 'advice.validationBenefit', verification: 'advice.validationVerification',
  },
  'pattern:late-constraint': {
    title: 'patterns.lateConstraint', fact: 'patterns.lateConstraintFact', benefit: 'advice.constraintBenefit', verification: 'advice.constraintVerification',
  },
  'pattern:repeated-failure': {
    title: 'patterns.repeatedFailure', fact: 'patterns.repeatedFailureFact', benefit: 'advice.failureBenefit', verification: 'advice.failureVerification',
  },
};

export function localizedAdviceCopy(t: Translate, suggestion: AdvisorySuggestion) {
  const keys = KEYS[suggestion.issueKey];
  if (!keys) return {
    title: suggestion.issueKey,
    triggerFact: suggestion.triggerFact,
    expectedBenefit: suggestion.expectedBenefit,
    verification: suggestion.verification,
  };
  return {
    title: t(keys.title, suggestion.issueKey),
    triggerFact: t(keys.fact, suggestion.triggerFact),
    expectedBenefit: t(keys.benefit, suggestion.expectedBenefit),
    verification: t(keys.verification, suggestion.verification),
  };
}
