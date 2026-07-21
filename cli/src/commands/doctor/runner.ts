import chalk from 'chalk';
import type { CheckResult, CheckStatus, Section } from './types.js';

const GLYPHS: Record<CheckStatus, string> = {
  pass: chalk.green('[✓]'),
  warn: chalk.yellow('[!]'),
  fail: chalk.red('[✗]'),
  skip: chalk.dim('[-]'),
  optional: chalk.dim('[○]'),
};

interface RunOptions {
  verbose?: boolean;
  json?: boolean;
  fix?: boolean;
}

export interface DoctorResult {
  results: CheckResult[];
  hasFail: boolean;
}

/**
 * Run all sections sequentially. Within each section, checks run sequentially.
 * If a gated check fails, remaining checks in that section are auto-skipped.
 */
export async function runChecks(sections: Section[], opts: RunOptions): Promise<DoctorResult> {
  const allResults: CheckResult[] = [];

  for (const section of sections) {
    if (!opts.json) {
      console.log(chalk.white(`\n  ${section.label}`));
    }

    let gatedFailed = false;

    for (const check of section.checks) {
      let result: CheckResult;

      if (gatedFailed) {
        result = {
          id: check.id,
          label: check.label,
          status: 'skip',
          detail: 'Skipped (dependency failed)',
        };
      } else {
        result = await check.run();
      }

      if (check.gate && result.status === 'fail') {
        gatedFailed = true;
      }

      allResults.push(result);

      if (!opts.json) {
        renderCheck(result, opts);
      }
    }
  }

  // --fix pass
  if (opts.fix && !opts.json) {
    const fixable = allResults.filter((r) => r.fix && (r.status === 'fail' || r.status === 'warn'));
    if (fixable.length > 0) {
      console.log(chalk.cyan(`\n  Fixing ${fixable.length} issue(s)...`));
      for (const result of fixable) {
        try {
          await result.fix!();
          console.log(chalk.green(`  ✓  ${result.fixLabel ?? result.label}`));
        } catch (err) {
          console.log(chalk.red(`  ✗  ${result.fixLabel ?? result.label}: ${err instanceof Error ? err.message : String(err)}`));
        }
      }
    }
  }

  const hasFail = allResults.some((r) => r.status === 'fail');

  if (!opts.json) {
    renderSummary(allResults);
  }

  return { results: allResults, hasFail };
}

function renderCheck(result: CheckResult, opts: RunOptions): void {
  const glyph = GLYPHS[result.status];
  const detail = result.detail ? chalk.dim(`  ${result.detail}`) : '';
  console.log(`  ${glyph} ${result.label}${detail}`);

  // Show hint for fail/warn
  if (result.hint && (result.status === 'fail' || result.status === 'warn')) {
    for (const line of result.hint.split('\n')) {
      console.log(chalk.dim(`     ${line}`));
    }
  }

  // Show verbose lines for optional/skip items, or always if --verbose
  if (result.verboseLines && (opts.verbose || result.status === 'optional')) {
    for (const line of result.verboseLines) {
      console.log(chalk.dim(`     ${line}`));
    }
  }
}

function renderSummary(results: CheckResult[]): void {
  const counts: Record<CheckStatus, number> = { pass: 0, warn: 0, fail: 0, skip: 0, optional: 0 };
  for (const r of results) {
    counts[r.status]++;
  }

  console.log(chalk.dim('\n  ────────────────────────────────────────────────'));

  if (counts.fail === 0 && counts.warn === 0) {
    console.log(chalk.green('  All checks passed.'));
  } else if (counts.fail === 0) {
    console.log(chalk.yellow(`  ${counts.warn} warning(s). All critical checks passed.`));
  } else {
    const parts: string[] = [];
    if (counts.fail > 0) parts.push(`${counts.fail} error(s)`);
    if (counts.warn > 0) parts.push(`${counts.warn} warning(s)`);
    console.log(chalk.red(`  ${parts.join(', ')}. Run the commands above to fix.`));
  }

  console.log('');
}

/**
 * Render results as JSON for machine consumption / bug reports.
 */
export function renderJson(results: CheckResult[], version: string): string {
  const counts: Record<CheckStatus, number> = { pass: 0, warn: 0, fail: 0, skip: 0, optional: 0 };
  for (const r of results) {
    counts[r.status]++;
  }

  const output = {
    version,
    timestamp: new Date().toISOString(),
    checks: results.map((r) => ({
      id: r.id,
      label: r.label,
      status: r.status,
      detail: r.detail ? redactPaths(r.detail) : null,
      hint: r.hint ?? null,
    })),
    summary: { pass: counts.pass, warn: counts.warn, fail: counts.fail, skip: counts.skip, optional: counts.optional },
  };

  return JSON.stringify(output, null, 2);
}

/** Redact home directory paths for safe sharing in bug reports */
function redactPaths(text: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (!home) return text;
  return text.replaceAll(home, '~');
}
