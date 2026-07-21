/**
 * Shared SSE parsing utility for fetch()-based streaming.
 * Uses fetch() + ReadableStream (not EventSource) to support AbortController.
 * Extracted from AnalysisContext.tsx for reuse across streaming consumers.
 */

/**
 * Parse SSE events from a ReadableStream response body.
 * Handles partial chunks by buffering lines until a complete event is received.
 */
export async function* parseSSEStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';
  let currentData = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep the last potentially incomplete line in the buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          currentData = line.slice(6);
        } else if (line === '' && currentEvent && currentData) {
          yield { event: currentEvent, data: currentData };
          currentEvent = '';
          currentData = '';
        }
      }
    }
    buffer += decoder.decode();
    // Flush any remaining buffered event
    if (currentEvent && currentData) {
      yield { event: currentEvent, data: currentData };
    }
  } finally {
    reader.releaseLock();
  }
}
