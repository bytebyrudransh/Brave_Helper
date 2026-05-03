import type { ChatMessage, PageSnapshot } from '../store';

// ── Storage Keys ──
const CHAT_SESSIONS_KEY = 'chatSessions';
const PAGE_SNAPSHOTS_KEY = 'pageSnapshots';
const LAST_SESSION_KEY = 'lastActiveSession';
const SELECTED_MODEL_KEY = 'selectedModel';

const MAX_CHAT_SESSIONS = 50;
const MAX_PAGE_SNAPSHOTS = 100;

// ── Types ──

export interface ChatSession {
  id: string;
  title: string;
  pageUrl: string | null;
  pageTitle: string | null;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface StoredPageSnapshot extends PageSnapshot {
  id: string;
  savedAt: number;
}

// ── Chat Sessions ──

export async function saveChatSession(
  messages: ChatMessage[],
  page: PageSnapshot | null,
  existingSessionId?: string
): Promise<ChatSession> {
  const existing = await chrome.storage.local.get(CHAT_SESSIONS_KEY);
  const sessions = Array.isArray(existing[CHAT_SESSIONS_KEY])
    ? (existing[CHAT_SESSIONS_KEY] as ChatSession[])
    : [];

  // Derive title from first user message or page title
  const firstUserMsg = messages.find((m) => m.role === 'user');
  const title = firstUserMsg
    ? firstUserMsg.content.slice(0, 80)
    : page?.title || 'Untitled Session';

  const now = Date.now();

  if (existingSessionId) {
    // Update existing session
    const idx = sessions.findIndex((s) => s.id === existingSessionId);
    if (idx !== -1) {
      sessions[idx] = {
        ...sessions[idx],
        messages: messages.filter((m) => !m.streaming),
        updatedAt: now,
        title,
      };
      await chrome.storage.local.set({ [CHAT_SESSIONS_KEY]: sessions });
      return sessions[idx];
    }
  }

  // Create new session
  const session: ChatSession = {
    id: crypto.randomUUID(),
    title,
    pageUrl: page?.url ?? null,
    pageTitle: page?.title ?? null,
    messages: messages.filter((m) => !m.streaming),
    createdAt: now,
    updatedAt: now,
  };

  const next = [session, ...sessions].slice(0, MAX_CHAT_SESSIONS);
  await chrome.storage.local.set({ [CHAT_SESSIONS_KEY]: next });
  return session;
}

export async function listChatSessions(): Promise<ChatSession[]> {
  const data = await chrome.storage.local.get(CHAT_SESSIONS_KEY);
  return Array.isArray(data[CHAT_SESSIONS_KEY])
    ? (data[CHAT_SESSIONS_KEY] as ChatSession[])
    : [];
}

export async function getChatSession(
  id: string
): Promise<ChatSession | null> {
  const sessions = await listChatSessions();
  return sessions.find((s) => s.id === id) ?? null;
}

export async function deleteChatSession(id: string): Promise<void> {
  const sessions = await listChatSessions();
  const filtered = sessions.filter((s) => s.id !== id);
  await chrome.storage.local.set({ [CHAT_SESSIONS_KEY]: filtered });
}

// ── Page Snapshots ──

export async function savePageSnapshot(
  page: PageSnapshot
): Promise<StoredPageSnapshot> {
  const existing = await chrome.storage.local.get(PAGE_SNAPSHOTS_KEY);
  const snapshots = Array.isArray(existing[PAGE_SNAPSHOTS_KEY])
    ? (existing[PAGE_SNAPSHOTS_KEY] as StoredPageSnapshot[])
    : [];

  const record: StoredPageSnapshot = {
    ...page,
    id: crypto.randomUUID(),
    savedAt: Date.now(),
  };

  const next = [record, ...snapshots].slice(0, MAX_PAGE_SNAPSHOTS);
  await chrome.storage.local.set({ [PAGE_SNAPSHOTS_KEY]: next });
  return record;
}

export async function listPageSnapshots(): Promise<StoredPageSnapshot[]> {
  const data = await chrome.storage.local.get(PAGE_SNAPSHOTS_KEY);
  return Array.isArray(data[PAGE_SNAPSHOTS_KEY])
    ? (data[PAGE_SNAPSHOTS_KEY] as StoredPageSnapshot[])
    : [];
}

export async function deletePageSnapshot(id: string): Promise<void> {
  const snapshots = await listPageSnapshots();
  const filtered = snapshots.filter((s) => s.id !== id);
  await chrome.storage.local.set({ [PAGE_SNAPSHOTS_KEY]: filtered });
}

// ── Last Active Session (auto-restore) ──

export async function saveLastSessionId(id: string): Promise<void> {
  await chrome.storage.local.set({ [LAST_SESSION_KEY]: id });
}

export async function getLastSessionId(): Promise<string | null> {
  const data = await chrome.storage.local.get(LAST_SESSION_KEY);
  return (data[LAST_SESSION_KEY] as string) ?? null;
}

// ── Model Preference Persistence ──

export async function saveSelectedModel(name: string): Promise<void> {
  await chrome.storage.local.set({ [SELECTED_MODEL_KEY]: name });
}

export async function getSelectedModel(): Promise<string | null> {
  const data = await chrome.storage.local.get(SELECTED_MODEL_KEY);
  return (data[SELECTED_MODEL_KEY] as string) ?? null;
}

// ── Search ──

export async function searchHistory(
  query: string
): Promise<{ sessions: ChatSession[]; snapshots: StoredPageSnapshot[] }> {
  const q = query.toLowerCase();
  const [sessions, snapshots] = await Promise.all([
    listChatSessions(),
    listPageSnapshots(),
  ]);

  return {
    sessions: sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.pageTitle?.toLowerCase().includes(q) ?? false) ||
        (s.pageUrl?.toLowerCase().includes(q) ?? false) ||
        s.messages.some((m) => m.content.toLowerCase().includes(q))
    ),
    snapshots: snapshots.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.url.toLowerCase().includes(q) ||
        s.text.toLowerCase().includes(q)
    ),
  };
}
