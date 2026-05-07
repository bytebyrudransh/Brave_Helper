/**
 * Simple local vector store for memory recall.
 *
 * V1 implementation: chrome.storage.local with linear cosine search.
 * That's fine for hundreds of records — switch to IndexedDB + ANN
 * (e.g., HNSW) when the user has thousands of saved pages.
 *
 * Records can be saved pages, chat session summaries, or screenshot
 * captions. Each gets a `kind` tag so the recall UI can show the right
 * action when the user picks one.
 */

import { cosineSimilarity, embed } from './embeddings';

const VECTOR_STORE_KEY = 'memoryVectors';
const MAX_RECORDS = 500;

export type MemoryKind = 'page' | 'chat' | 'screenshot';

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  /** Short title shown in the recall UI. */
  title: string;
  /** Full text that produced the embedding. Kept for re-embedding later if model changes. */
  body: string;
  /** Optional URL associated with the record (page URL, chat session ID, etc.). */
  url?: string;
  embedding: number[];
  createdAt: number;
}

export interface RecallHit {
  record: MemoryRecord;
  score: number;
}

async function readAll(): Promise<MemoryRecord[]> {
  const raw = await chrome.storage.local.get(VECTOR_STORE_KEY);
  return Array.isArray(raw[VECTOR_STORE_KEY]) ? (raw[VECTOR_STORE_KEY] as MemoryRecord[]) : [];
}

async function writeAll(records: MemoryRecord[]): Promise<void> {
  await chrome.storage.local.set({ [VECTOR_STORE_KEY]: records });
}

/**
 * Embed and store a single record. If embedding fails (Ollama unreachable),
 * silently skips — recall just won't find this item later.
 */
export async function indexMemory(
  input: Omit<MemoryRecord, 'id' | 'embedding' | 'createdAt'>
): Promise<MemoryRecord | null> {
  const embedding = await embed(input.body);
  if (embedding.length === 0) return null;

  const record: MemoryRecord = {
    ...input,
    id: crypto.randomUUID(),
    embedding,
    createdAt: Date.now(),
  };

  const existing = await readAll();
  const next = [record, ...existing].slice(0, MAX_RECORDS);
  await writeAll(next);
  return record;
}

/** Top-K cosine search over the local store. */
export async function recallMemory(
  query: string,
  k: number = 5
): Promise<RecallHit[]> {
  const queryVec = await embed(query);
  if (queryVec.length === 0) return [];
  const records = await readAll();

  const hits = records
    .map((r) => ({ record: r, score: cosineSimilarity(queryVec, r.embedding) }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);

  return hits;
}

export async function getMemoryStats(): Promise<{ total: number; byKind: Record<MemoryKind, number> }> {
  const records = await readAll();
  const byKind: Record<MemoryKind, number> = { page: 0, chat: 0, screenshot: 0 };
  for (const r of records) byKind[r.kind]++;
  return { total: records.length, byKind };
}

export async function clearMemory(): Promise<void> {
  await writeAll([]);
}
