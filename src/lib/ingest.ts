import { addDocumentWithChunks } from '../db';
import { embeddingsClient } from '../workers/embeddingsClient';
import { chunkText } from './chunk';
import { extractPdfText } from './pdf';

export interface IngestOptions {
  onStage?: (stage: 'reading' | 'chunking' | 'embedding' | 'storing') => void;
}

async function readText(file: File): Promise<string> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.pdf') || file.type === 'application/pdf') {
    return extractPdfText(file);
  }
  return file.text();
}

const EMBED_BATCH = 16;

export async function ingestFile(file: File, opts: IngestOptions = {}): Promise<void> {
  opts.onStage?.('reading');
  const raw = await readText(file);

  opts.onStage?.('chunking');
  const chunks = chunkText(raw);
  if (chunks.length === 0) throw new Error('No text could be extracted from this file.');

  opts.onStage?.('embedding');
  const embeddings: Float32Array[] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const out = await embeddingsClient.embed(batch);
    embeddings.push(...out);
  }

  opts.onStage?.('storing');
  await addDocumentWithChunks(
    {
      id: crypto.randomUUID(),
      name: file.name,
      mimeType: file.type || 'text/plain',
      byteSize: file.size,
    },
    chunks.map((text, i) => ({ text, embedding: embeddings[i] }))
  );
}
