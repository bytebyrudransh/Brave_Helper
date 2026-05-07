/**
 * Outbound HTTP wrapper. The architectural commitment for v3.0 is:
 *
 *   The extension performs GET requests only. No POST, no PUT, no DELETE,
 *   no body payloads carrying user data. The model has no tool to send,
 *   submit, or upload anything outbound.
 *
 * This module is the single chokepoint for outbound web requests. Anything
 * that fetches from the public internet must go through `safeFetch`.
 *
 * Exemption: requests to `localhost` (Ollama on 11434) are POSTs by design
 * — those are local-only, never leave the machine, and don't count as
 * outbound in the privacy sense. They use the regular `fetch` directly in
 * `lib/ollama.ts` and `lib/vision.ts`.
 */

/**
 * GET a remote URL and return the response body as text, capped at `maxBytes`.
 * Streams the body so we can stop reading once we hit the cap, instead of
 * materializing a multi-MB response in memory.
 */
export async function safeFetch(
  url: string,
  maxBytes: number = 200 * 1024,
  signal?: AbortSignal
): Promise<string> {
  // Defensive: refuse anything that isn't an https/http URL on a remote host.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`safeFetch: invalid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`safeFetch: refused non-http(s) protocol ${parsed.protocol}`);
  }

  const res = await fetch(url, {
    method: 'GET',
    redirect: 'follow',
    signal,
  });

  if (!res.ok) {
    throw new Error(`safeFetch: ${url} returned ${res.status}`);
  }

  if (!res.body) {
    return await res.text();
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let out = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        out += decoder.decode(value.slice(0, Math.max(0, maxBytes - (received - value.byteLength))), { stream: false });
        break;
      }
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }

  return out;
}
