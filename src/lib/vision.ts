/**
 * Vision integration. Sends images + a prompt to a local multimodal model
 * (llava:7b) running in Ollama, streams the response back.
 *
 * Read-only outbound: this is a POST to localhost only — never to a remote
 * service. The image bytes never leave the user's machine.
 */

import { getModelByTier } from '../config/models';

const OLLAMA_URL =
  (import.meta.env.VITE_OLLAMA_URL as string | undefined) ??
  'http://localhost:11434';

export interface VisionRequest {
  prompt: string;
  /** Either a full data URL ("data:image/png;base64,...") or raw base64. */
  image: string;
  signal?: AbortSignal;
}

/** Strip the `data:...;base64,` prefix if the caller passed a full data URL. */
function normalizeBase64(input: string): string {
  const idx = input.indexOf('base64,');
  return idx === -1 ? input : input.slice(idx + 'base64,'.length);
}

export async function* streamVision(
  req: VisionRequest
): AsyncGenerator<string, void, void> {
  const visionModel = getModelByTier('vision');
  if (!visionModel) {
    throw new Error('No vision model is configured (expected tier: vision).');
  }

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: visionModel.name,
      prompt: req.prompt,
      images: [normalizeBase64(req.image)],
      stream: true,
      options: { num_ctx: visionModel.numCtx },
    }),
    signal: req.signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`Ollama /api/generate returned ${res.status}`);
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
            response?: string;
            done?: boolean;
          };
          if (json.response) yield json.response;
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
