import { Hono } from 'hono';
import { getProductUpdateService } from 'agent-usage-analyze/utils/update-service';

const app = new Hono();

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function startProductUpdateScheduler(): { close: () => void } {
  return getProductUpdateService().startScheduler();
}

app.get('/status', async (c) => {
  return c.json(await getProductUpdateService().getStatus());
});

app.post('/check', async (c) => {
  try {
    const status = await getProductUpdateService().checkForUpdates();
    return c.json(status);
  } catch (error) {
    return c.json({
      error: message(error),
      status: await getProductUpdateService().getStatus(),
    }, 502);
  }
});

app.patch('/settings', async (c) => {
  const body = await c.req.json<unknown>();
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'Invalid update settings body' }, 400);
  }
  const value = body as Record<string, unknown>;
  if (typeof value.autoUpdate !== 'boolean' || Object.keys(value).length !== 1) {
    return c.json({ error: 'autoUpdate must be a boolean' }, 400);
  }
  try {
    return c.json(await getProductUpdateService().setAutoUpdate(value.autoUpdate));
  } catch (error) {
    return c.json({ error: message(error) }, 409);
  }
});

app.post('/apply', async (c) => {
  try {
    const result = await getProductUpdateService().requestUpdate();
    return c.json(result, result.accepted ? 202 : 200);
  } catch (error) {
    return c.json({ error: message(error) }, 409);
  }
});

export default app;
