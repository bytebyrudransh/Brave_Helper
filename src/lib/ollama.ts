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
