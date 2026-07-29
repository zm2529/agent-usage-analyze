import { runHistorySync } from './routes/ingestion.js';

try {
  const result = await runHistorySync(process.argv.includes('--force'));
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}
