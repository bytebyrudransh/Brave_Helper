import { create } from 'zustand';
import type { OllamaModel } from '../lib/ollama';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  streaming?: boolean;
}

export interface PageSnapshot {
  url: string;
  title: string;
  text: string;
  links: { href: string; text: string }[];
  capturedAt: number;
}

interface AppState {
  models: OllamaModel[];
  selectedModel: string | null;
  ollamaReachable: boolean;

  page: PageSnapshot | null;
  pageScopeEnabled: boolean;

  messages: ChatMessage[];
  isStreaming: boolean;

  setModels: (models: OllamaModel[]) => void;
  setSelectedModel: (name: string) => void;
  setOllamaReachable: (ok: boolean) => void;

  setPage: (page: PageSnapshot | null) => void;
  setPageScopeEnabled: (v: boolean) => void;

  appendMessage: (msg: ChatMessage) => void;
  appendToMessage: (id: string, chunk: string) => void;
  finishStreaming: (id: string) => void;
  setIsStreaming: (v: boolean) => void;
  clearMessages: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  models: [],
  selectedModel: null,
  ollamaReachable: false,

  page: null,
  pageScopeEnabled: true,

  messages: [],
  isStreaming: false,

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

  setPage: (page) => set({ page }),
  setPageScopeEnabled: (v) => set({ pageScopeEnabled: v }),

  appendMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  appendToMessage: (id, chunk) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, content: m.content + chunk } : m
      ),
    })),
  finishStreaming: (id) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === id ? { ...m, streaming: false } : m
      ),
    })),
  setIsStreaming: (v) => set({ isStreaming: v }),
  clearMessages: () => set({ messages: [] }),
}));
