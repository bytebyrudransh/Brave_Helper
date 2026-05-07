import { create } from 'zustand';
import type { OllamaModel } from '../lib/ollama';
import { PROJECT_MODELS } from '../config/models';
import type { VaultData } from '../lib/vault';
import type { ExtractedForm } from '../lib/page';

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

export type ViewTab = 'chat' | 'history' | 'form-fill' | 'vault' | 'audit' | 'settings';

interface AppState {
  models: OllamaModel[];
  selectedModel: string | null;
  ollamaReachable: boolean;

  page: PageSnapshot | null;
  pageScopeEnabled: boolean;

  messages: ChatMessage[];
  isStreaming: boolean;
  currentSessionId: string | null;
  activeTab: ViewTab;
  
  vaultData: VaultData | null;
  vaultPassword: string | null;

  extractedForms: ExtractedForm[];
  setExtractedForms: (forms: ExtractedForm[]) => void;

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
  setMessages: (messages: ChatMessage[]) => void;
  setCurrentSessionId: (id: string | null) => void;
  setActiveTab: (tab: ViewTab) => void;
  setVaultData: (data: VaultData | null, password: string | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  models: [],
  selectedModel: null,
  ollamaReachable: false,

  page: null,
  pageScopeEnabled: true,

  messages: [],
  isStreaming: false,
  currentSessionId: null,
  activeTab: 'chat',
  
  vaultData: null,
  vaultPassword: null,

  extractedForms: [],
  setExtractedForms: (forms) => set({ extractedForms: forms }),

  setModels: (models) =>
    set((state) => {
      const allowedNames = new Set(PROJECT_MODELS.map((model) => model.name));
      const filtered = models.filter((model) => allowedNames.has(model.name));
      const preferred =
        (state.selectedModel && filtered.some((m) => m.name === state.selectedModel)
          ? state.selectedModel
          : null) ??
        PROJECT_MODELS.find((model) =>
          filtered.some((installed) => installed.name === model.name)
        )?.name ??
        filtered[0]?.name ??
        null;
      return { models: filtered, selectedModel: preferred };
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
  clearMessages: () => set({ messages: [], currentSessionId: null }),
  setMessages: (messages) => set({ messages }),
  setCurrentSessionId: (id) => set({ currentSessionId: id }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setVaultData: (data, password) => set({ vaultData: data, vaultPassword: password }),
}));
