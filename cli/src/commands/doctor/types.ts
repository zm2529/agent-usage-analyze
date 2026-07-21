export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip' | 'optional';

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
  hint?: string;
  hintUrl?: string;
  verboseLines?: string[];
  fix?: () => Promise<void>;
  fixLabel?: string;
}

export interface Check {
  id: string;
  label: string;
  gate?: boolean;
  run: () => Promise<CheckResult>;
}

export interface Section {
  label: string;
  checks: Check[];
}
