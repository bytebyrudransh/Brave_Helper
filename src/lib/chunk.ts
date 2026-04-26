// Char-based chunking. Roughly 4 chars per token, so ~500 tokens ≈ 2000 chars.
const DEFAULT_CHUNK_CHARS = 2000;
const DEFAULT_OVERLAP_CHARS = 200;

export interface ChunkOptions {
  chunkChars?: number;
  overlapChars?: number;
}

export function chunkText(text: string, opts: ChunkOptions = {}): string[] {
  const size = opts.chunkChars ?? DEFAULT_CHUNK_CHARS;
  const overlap = opts.overlapChars ?? DEFAULT_OVERLAP_CHARS;
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length === 0) return [];
  if (cleaned.length <= size) return [cleaned];

  const chunks: string[] = [];
  let start = 0;
  while (start < cleaned.length) {
    const end = Math.min(start + size, cleaned.length);
    let slice = cleaned.slice(start, end);

    // Try to end on a sentence boundary if not at end of doc.
    if (end < cleaned.length) {
      const lastBoundary = Math.max(
        slice.lastIndexOf('. '),
        slice.lastIndexOf('! '),
        slice.lastIndexOf('? '),
        slice.lastIndexOf('\n')
      );
      if (lastBoundary > size * 0.5) {
        slice = slice.slice(0, lastBoundary + 1);
      }
    }

    chunks.push(slice.trim());
    if (end >= cleaned.length) break;
    start += slice.length - overlap;
    if (start < 0) start = 0;
  }
  return chunks.filter((c) => c.length > 0);
}
