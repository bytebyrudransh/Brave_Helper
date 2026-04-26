import { create } from 'zustand';
import type { DocumentRow } from '../db';
import {
  deleteConversation as dbDeleteConversation,
  getMessages,
  listConversations,
  listDocuments,
  putMessage,
  upsertConversation,
} from '../db';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  streaming?: boolean;
  citationChunkIds?: string[];
}

export interface OllamaModel {
  name: string;
  size?: number;
  modified_at?: string;
}

export interface Conversation {
  id: string;
  title: string;
  scopeDocIds: string[];
  createdAt: number;
  updatedAt: number;
}

export type Tab = 'chat' | 'documents';

interface AppState {
  tab: Tab;

  models: OllamaModel[];
  selectedModel: string | null;
  ollamaReachable: boolean;

  documents: DocumentRow[];

  conversations: Conversation[];
  activeConversationId: string | null;
  messages: ChatMessage[];
  scopeDocIds: string[];
  isStreaming: boolean;

  embeddingsStatus: { status: 'idle' | 'loading' | 'ready' | 'error'; progress?: number; file?: string; message?: string };

  setTab: (tab: Tab) => void;
  setModels: (models: OllamaModel[]) => void;
  setSelectedModel: (name: string) => void;
  setOllamaReachable: (ok: boolean) => void;
  setEmbeddingsStatus: (s: AppState['embeddingsStatus']) => void;

  refreshDocuments: () => Promise<void>;

  hydrate: () => Promise<void>;
  newConversation: () => Promise<string>;
  selectConversation: (id: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  setScope: (docIds: string[]) => Promise<void>;
  toggleScopeDoc: (docId: string) => Promise<void>;

  appendMessage: (msg: ChatMessage) => Promise<void>;
  appendToMessage: (id: string, chunk: string) => void;
  setMessageCitations: (id: string, chunkIds: string[]) => Promise<void>;
  finishStreaming: (id: string) => Promise<void>;
  setIsStreaming: (v: boolean) => void;
  clearMessages: () => void;
}

function deriveTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser) return 'New conversation';
  const t = firstUser.content.trim().slice(0, 60);
  return t.length > 0 ? t : 'New conversation';
}

export const useAppStore = create<AppState>((set, get) => ({
  tab: 'chat',
  models: [],
  selectedModel: null,
  ollamaReachable: false,
  documents: [],
  conversations: [],
  activeConversationId: null,
  messages: [],
  scopeDocIds: [],
  isStreaming: false,
  embeddingsStatus: { status: 'idle' },

  setTab: (tab) => set({ tab }),

  setModels: (models) =>
    set((state) => {
      const preferred =
        state.selectedModel ??
        models.find((m) => /llama3|qwen2\.5/.test(m.name))?.name ??
        models[0]?.name ??
        null;
      return { models, selectedModel: preferred };
    }),
  setSelectedModel: (name) => set({ selectedModel: name }),
  setOllamaReachable: (ok) => set({ ollamaReachable: ok }),
  setEmbeddingsStatus: (s) => set({ embeddingsStatus: s }),

  refreshDocuments: async () => {
    const docs = await listDocuments();
    set({ documents: docs });
  },

  hydrate: async () => {
    const [docs, convos] = await Promise.all([listDocuments(), listConversations()]);
    set({ documents: docs, conversations: convos });

    if (convos.length > 0) {
      const c = convos[0];
      const msgs = await getMessages(c.id);
      set({
        activeConversationId: c.id,
        scopeDocIds: c.scopeDocIds,
        messages: msgs.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          citationChunkIds: m.citationChunkIds,
        })),
      });
    } else {
      const id = crypto.randomUUID();
      const now = Date.now();
      const c: Conversation = {
        id,
        title: 'New conversation',
        scopeDocIds: [],
        createdAt: now,
        updatedAt: now,
      };
      await upsertConversation(c);
      set({ conversations: [c], activeConversationId: id, messages: [], scopeDocIds: [] });
    }
  },

  newConversation: async () => {
    const id = crypto.randomUUID();
    const now = Date.now();
    const c: Conversation = {
      id,
      title: 'New conversation',
      scopeDocIds: [],
      createdAt: now,
      updatedAt: now,
    };
    await upsertConversation(c);
    set((s) => ({
      conversations: [c, ...s.conversations],
      activeConversationId: id,
      messages: [],
      scopeDocIds: [],
    }));
    return id;
  },

  selectConversation: async (id) => {
    const c = get().conversations.find((x) => x.id === id);
    if (!c) return;
    const msgs = await getMessages(id);
    set({
      activeConversationId: id,
      scopeDocIds: c.scopeDocIds,
      messages: msgs.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        citationChunkIds: m.citationChunkIds,
      })),
    });
  },

  deleteConversation: async (id) => {
    await dbDeleteConversation(id);
    set((s) => {
      const remaining = s.conversations.filter((c) => c.id !== id);
      const stillActive = s.activeConversationId === id ? null : s.activeConversationId;
      return {
        conversations: remaining,
        activeConversationId: stillActive,
        messages: stillActive ? s.messages : [],
        scopeDocIds: stillActive ? s.scopeDocIds : [],
      };
    });
    if (get().activeConversationId === null) {
      await get().hydrate();
    }
  },

  setScope: async (docIds) => {
    const cid = get().activeConversationId;
    set({ scopeDocIds: docIds });
    if (!cid) return;
    const c = get().conversations.find((x) => x.id === cid);
    if (!c) return;
    const updated: Conversation = { ...c, scopeDocIds: docIds, updatedAt: Date.now() };
    await upsertConversation(updated);
    set((s) => ({ conversations: s.conversations.map((x) => (x.id === cid ? updated : x)) }));
  },

  toggleScopeDoc: async (docId) => {
    const cur = get().scopeDocIds;
    const next = cur.includes(docId) ? cur.filter((d) => d !== docId) : [...cur, docId];
    await get().setScope(next);
  },

  appendMessage: async (msg) => {
    const cid = get().activeConversationId;
    set((s) => ({ messages: [...s.messages, msg] }));
    if (!cid) return;
    if (!msg.streaming) {
      await putMessage({
        id: msg.id,
        conversationId: cid,
        role: msg.role,
        content: msg.content,
        citationChunkIds: msg.citationChunkIds,
        createdAt: Date.now(),
      });
    }
    const c = get().conversations.find((x) => x.id === cid);
    if (c) {
      const newTitle = c.title === 'New conversation' ? deriveTitle(get().messages) : c.title;
      const updated: Conversation = { ...c, title: newTitle, updatedAt: Date.now() };
      await upsertConversation(updated);
      set((s) => ({ conversations: s.conversations.map((x) => (x.id === cid ? updated : x)) }));
    }
  },

  appendToMessage: (id, chunk) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + chunk } : m
      ),
    })),

  setMessageCitations: async (id, chunkIds) => {
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, citationChunkIds: chunkIds } : m
      ),
    }));
  },

  finishStreaming: async (id) => {
    const cid = get().activeConversationId;
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, streaming: false } : m
      ),
    }));
    const m = get().messages.find((x) => x.id === id);
    if (cid && m) {
      await putMessage({
        id: m.id,
        conversationId: cid,
        role: m.role,
        content: m.content,
        citationChunkIds: m.citationChunkIds,
        createdAt: Date.now(),
      });
    }
  },

  setIsStreaming: (v) => set({ isStreaming: v }),
  clearMessages: () => set({ messages: [] }),
}));
