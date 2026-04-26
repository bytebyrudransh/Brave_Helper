import type { ChunkRow } from '../db';
import { getChunksForDocs } from '../db';
import { embeddingsClient } from '../workers/embeddingsClient';

export interface RetrievedChunk {
  chunk: ChunkRow;
  score: number;
}

// Embeddings are L2-normalized at write time, so cosine = dot product.
function dot(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export async function retrieveTopK(
  query: string,
  docIds: string[],
  k = 5
): Promise<RetrievedChunk[]> {
  if (docIds.length === 0 || !query.trim()) return [];

  const [[queryEmbedding], chunks] = await Promise.all([
    embeddingsClient.embed([query]),
    getChunksForDocs(docIds),
  ]);

  if (!queryEmbedding || chunks.length === 0) return [];

  const scored: RetrievedChunk[] = chunks.map((chunk) => ({
    chunk,
    score: dot(queryEmbedding, chunk.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
