const OLLAMA_URL =
  (import.meta.env.VITE_OLLAMA_URL as string | undefined) ??
  'http://localhost:11434';

export interface OllamaModel {
  name: string;
  size?: number;
  modified_at?: string;
}

export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamChatOptions {
  model: string;
  messages: ChatTurn[];
  numCtx?: number;
  signal?: AbortSignal;
}

export async function listOllamaModels(): Promise<OllamaModel[]> {
  const res = await fetch(`${OLLAMA_URL}/api/tags`);
  if (!res.ok) throw new Error(`Ollama /api/tags returned ${res.status}`);
  const data = (await res.json()) as { models?: OllamaModel[] };
  return data.models ?? [];
}

/** Lists models currently loaded in memory by Ollama. */
export async function listLoadedOllamaModels(): Promise<OllamaModel[]> {
  const res = await fetch(`${OLLAMA_URL}/api/ps`);
  if (!res.ok) throw new Error(`Ollama /api/ps returned ${res.status}`);
  const data = (await res.json()) as { models?: OllamaModel[] };
  return data.models ?? [];
}

/**
 * Tells Ollama to evict the given model from memory immediately.
 * `keep_alive: 0` is Ollama's documented unload signal.
 */
export async function unloadOllamaModel(name: string): Promise<void> {
  await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: name, keep_alive: 0 }),
  });
}

/**
 * Preload a model into VRAM without generating any tokens.
 *
 * Sends an empty-prompt generate request with keep_alive set to 5 minutes.
 * Ollama loads the model weights into GPU memory and keeps them warm.
 * The next real inference request will skip the cold-start entirely.
 *
 * Fire-and-forget — callers should not block on this.
 */
export async function preloadModel(name: string): Promise<void> {
  await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: name,
      prompt: '',
      keep_alive: '5m',
    }),
  });
}

/**
 * Cold-start hygiene: ask Ollama to drop the given models from VRAM if they
 * happen to be loaded. Used on extension init so the user's GPU stays idle
 * until they actually send a message.
 *
 * Fire-and-forget. Safe to call on models that aren't loaded — Ollama just
 * returns immediately.
 */
export async function unloadAllModels(names: string[]): Promise<void> {
  await Promise.all(
    names.map((name) =>
      unloadOllamaModel(name).catch(() => {
        // ignore individual failures — best-effort cleanup
      })
    )
  );
}

export async function* streamChat(
  opts: StreamChatOptions
): AsyncGenerator<string, void, void> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: true,
      options: opts.numCtx ? { num_ctx: opts.numCtx } : undefined,
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`Ollama /api/chat returned ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const json = JSON.parse(line) as {
            message?: { content?: string };
            done?: boolean;
          };
          const chunk = json.message?.content;
          if (chunk) yield chunk;
          if (json.done) return;
        } catch {
          // ignore partial / malformed line
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
