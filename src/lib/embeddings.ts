/**
 * Local embeddings via Ollama's nomic-embed-text model.
 * Used by the vector store for memory recall (Phase 5 RAG).
 *
 * All calls hit localhost only — no embeddings ever leave the device.
 */

const OLLAMA_URL =
  (import.meta.env.VITE_OLLAMA_URL as string | undefined) ??
  'http://localhost:11434';

const EMBEDDING_MODEL = 'nomic-embed-text';

export interface EmbeddingResponse {
  embedding: number[];
}

/**
 * Generate a single embedding vector for the given text.
 * Returns an empty array if Ollama is unreachable or returns nothing useful;
 * callers should treat empty as "skip indexing this item."
 */
export async function embed(text: string): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  try {
    const res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        prompt: trimmed,
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as Partial<EmbeddingResponse>;
    return data.embedding ?? [];
  } catch {
    return [];
  }
}

/** Cosine similarity between two equal-length vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
