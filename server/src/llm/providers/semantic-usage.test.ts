import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLlamaCppClient } from './llamacpp.js';
import { createOllamaClient } from './ollama.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('local provider usage provenance', () => {
  it('does not invent zero token counts when Ollama omits usage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: { content: '{"status":"ok"}' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const response = await createOllamaClient('fixture').chat([
      { role: 'user', content: 'fixture' },
    ]);

    expect(response).toEqual({ content: '{"status":"ok"}' });
  });

  it('does not invent zero token counts when llama.cpp omits usage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"status":"ok"}' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const response = await createLlamaCppClient('fixture').chat([
      { role: 'user', content: 'fixture' },
    ]);

    expect(response).toEqual({ content: '{"status":"ok"}' });
  });
});
