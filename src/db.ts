import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface DocumentRow {
  id: string;
  name: string;
  mimeType: string;
  byteSize: number;
  chunkCount: number;
  addedAt: number;
}

export interface ChunkRow {
  id: string;
  docId: string;
  ordinal: number;
  text: string;
  embedding: Float32Array;
}

export interface ConversationRow {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  scopeDocIds: string[];
}

export interface MessageRow {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  citationChunkIds?: string[];
  createdAt: number;
}

interface StudioDB extends DBSchema {
  documents: {
    key: string;
    value: DocumentRow;
    indexes: { 'by-addedAt': number };
  };
  chunks: {
    key: string;
    value: ChunkRow;
    indexes: { 'by-doc': string };
  };
  conversations: {
    key: string;
    value: ConversationRow;
    indexes: { 'by-updatedAt': number };
  };
  messages: {
    key: string;
    value: MessageRow;
    indexes: { 'by-conversation': string };
  };
}

const DB_NAME = 'local-ai-studio';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<StudioDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<StudioDB>> {
  if (!dbPromise) {
    dbPromise = openDB<StudioDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const docs = db.createObjectStore('documents', { keyPath: 'id' });
        docs.createIndex('by-addedAt', 'addedAt');

        const chunks = db.createObjectStore('chunks', { keyPath: 'id' });
        chunks.createIndex('by-doc', 'docId');

        const convos = db.createObjectStore('conversations', { keyPath: 'id' });
        convos.createIndex('by-updatedAt', 'updatedAt');

        const messages = db.createObjectStore('messages', { keyPath: 'id' });
        messages.createIndex('by-conversation', 'conversationId');
      },
    });
  }
  return dbPromise;
}

export async function listDocuments(): Promise<DocumentRow[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('documents', 'by-addedAt');
  return all.reverse();
}

export async function addDocumentWithChunks(
  doc: Omit<DocumentRow, 'chunkCount' | 'addedAt'>,
  chunks: { text: string; embedding: Float32Array }[]
): Promise<DocumentRow> {
  const db = await getDB();
  const tx = db.transaction(['documents', 'chunks'], 'readwrite');

  const row: DocumentRow = {
    ...doc,
    chunkCount: chunks.length,
    addedAt: Date.now(),
  };
  await tx.objectStore('documents').put(row);

  const chunkStore = tx.objectStore('chunks');
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    await chunkStore.put({
      id: `${doc.id}:${i}`,
      docId: doc.id,
      ordinal: i,
      text: c.text,
      embedding: c.embedding,
    });
  }
  await tx.done;
  return row;
}

export async function deleteDocument(docId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['documents', 'chunks'], 'readwrite');
  await tx.objectStore('documents').delete(docId);
  const idx = tx.objectStore('chunks').index('by-doc');
  let cursor = await idx.openCursor(IDBKeyRange.only(docId));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function getChunksForDocs(docIds: string[]): Promise<ChunkRow[]> {
  if (docIds.length === 0) return [];
  const db = await getDB();
  const tx = db.transaction('chunks', 'readonly');
  const idx = tx.objectStore('chunks').index('by-doc');
  const out: ChunkRow[] = [];
  for (const docId of docIds) {
    const rows = await idx.getAll(IDBKeyRange.only(docId));
    out.push(...rows);
  }
  await tx.done;
  return out;
}

export async function getChunksByIds(ids: string[]): Promise<ChunkRow[]> {
  if (ids.length === 0) return [];
  const db = await getDB();
  const tx = db.transaction('chunks', 'readonly');
  const store = tx.objectStore('chunks');
  const out: ChunkRow[] = [];
  for (const id of ids) {
    const row = await store.get(id);
    if (row) out.push(row);
  }
  await tx.done;
  return out;
}

export async function listConversations(): Promise<ConversationRow[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('conversations', 'by-updatedAt');
  return all.reverse();
}

export async function upsertConversation(c: ConversationRow): Promise<void> {
  const db = await getDB();
  await db.put('conversations', c);
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['conversations', 'messages'], 'readwrite');
  await tx.objectStore('conversations').delete(id);
  const idx = tx.objectStore('messages').index('by-conversation');
  let cursor = await idx.openCursor(IDBKeyRange.only(id));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

export async function getMessages(conversationId: string): Promise<MessageRow[]> {
  const db = await getDB();
  const rows = await db.getAllFromIndex('messages', 'by-conversation', IDBKeyRange.only(conversationId));
  return rows.sort((a, b) => a.createdAt - b.createdAt);
}

export async function putMessage(m: MessageRow): Promise<void> {
  const db = await getDB();
  await db.put('messages', m);
}
