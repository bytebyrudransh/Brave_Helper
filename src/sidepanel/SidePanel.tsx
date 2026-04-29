import { useEffect, useRef, useState } from 'react';
import { Send, RefreshCw, Globe, AlertCircle, Loader2 } from 'lucide-react';
import { useAppStore } from '../store';
import { listOllamaModels, streamChat, type ChatTurn } from '../lib/ollama';
import { requestActiveTabSnapshot } from '../lib/page';

const SYSTEM_PROMPT = `You are a local browser assistant running inside the user's Brave browser.
You can see a snapshot of the current page (title, URL, visible text, links) when provided.
Be concise. Ground answers in the page when it's available. If the page is not available,
say so plainly instead of guessing.`;

function buildPageContext(): string | null {
  const { page, pageScopeEnabled } = useAppStore.getState();
  if (!page || !pageScopeEnabled) return null;
  const linkList = page.links
    .slice(0, 50)
    .map((l) => `- ${l.text || '(no text)'} → ${l.href}`)
    .join('\n');
  return `# Current page
Title: ${page.title}
URL: ${page.url}

## Visible text (truncated)
${page.text}

## Links (truncated)
${linkList}`;
}

export default function SidePanel() {
  const {
    models,
    selectedModel,
    setModels,
    setSelectedModel,
    ollamaReachable,
    setOllamaReachable,
    page,
    pageScopeEnabled,
    setPage,
    setPageScopeEnabled,
    messages,
    appendMessage,
    appendToMessage,
    finishStreaming,
    isStreaming,
    setIsStreaming,
  } = useAppStore();

  const [input, setInput] = useState('');
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [activeTabUrl, setActiveTabUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const isStale =
    page !== null && activeTabUrl !== null && activeTabUrl !== page.url;

  useEffect(() => {
    void refreshModels();
    void capturePage();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function readActiveTab() {
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true,
        });
        if (!cancelled) setActiveTabUrl(tab?.url ?? null);
      } catch {
        if (!cancelled) setActiveTabUrl(null);
      }
    }
    void readActiveTab();

    const onActivated = () => void readActiveTab();
    const onUpdated = (
      _id: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab
    ) => {
      if (tab.active && (changeInfo.url || changeInfo.status === 'complete')) {
        void readActiveTab();
      }
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      cancelled = true;
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function refreshModels() {
    try {
      const list = await listOllamaModels();
      setModels(list);
      setOllamaReachable(true);
    } catch {
      setOllamaReachable(false);
    }
  }

  async function capturePage() {
    setPageLoading(true);
    setPageError(null);
    try {
      const snap = await requestActiveTabSnapshot();
      setPage(snap);
    } catch (err) {
      setPage(null);
      setPageError(err instanceof Error ? err.message : String(err));
    } finally {
      setPageLoading(false);
    }
  }

  async function send() {
    const content = input.trim();
    if (!content || isStreaming || !selectedModel) return;
    setInput('');

    const userMsg = { id: crypto.randomUUID(), role: 'user' as const, content };
    appendMessage(userMsg);

    const assistantId = crypto.randomUUID();
    appendMessage({ id: assistantId, role: 'assistant', content: '', streaming: true });

    const turns: ChatTurn[] = [{ role: 'system', content: SYSTEM_PROMPT }];
    const ctx = buildPageContext();
    if (ctx) turns.push({ role: 'system', content: ctx });
    for (const m of useAppStore.getState().messages) {
      if (m.id === assistantId) continue;
      turns.push({ role: m.role, content: m.content });
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsStreaming(true);
    try {
      for await (const chunk of streamChat({
        model: selectedModel,
        messages: turns,
        signal: ctrl.signal,
      })) {
        appendToMessage(assistantId, chunk);
      }
    } catch (err) {
      appendToMessage(
        assistantId,
        `\n\n[error: ${err instanceof Error ? err.message : String(err)}]`
      );
    } finally {
      finishStreaming(assistantId);
      setIsStreaming(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg)] text-sm">
      <header className="flex items-center gap-2 border-b border-[var(--color-border)] px-3 py-2">
        <Globe className="h-4 w-4 text-[var(--color-accent)]" />
        <span className="font-medium">Local Brave Helper</span>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={selectedModel ?? ''}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs"
          >
            {models.length === 0 && <option value="">no models</option>}
            {models.map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => void refreshModels()}
            className="rounded p-1 hover:bg-[var(--color-elevated)]"
            title="Refresh models"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs">
        {pageLoading ? (
          <div className="flex items-center gap-2 text-gray-400">
            <Loader2 className="h-3 w-3 animate-spin" /> reading page…
          </div>
        ) : page ? (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={pageScopeEnabled}
                onChange={(e) => setPageScopeEnabled(e.target.checked)}
              />
              <span>use page</span>
            </label>
            <span className="truncate text-gray-400">{page.title || page.url}</span>
            {isStale && (
              <span
                className="rounded bg-[var(--color-warning)]/20 px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-warning)]"
                title={`Captured: ${page.url}\nActive tab: ${activeTabUrl}`}
              >
                stale
              </span>
            )}
            <button
              onClick={() => void capturePage()}
              className={
                isStale
                  ? 'ml-auto font-medium text-[var(--color-warning)] hover:underline'
                  : 'ml-auto text-[var(--color-accent)] hover:underline'
              }
            >
              recapture
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[var(--color-warning)]">
            <AlertCircle className="h-3 w-3" />
            <span>{pageError ?? 'no page captured'}</span>
            <button
              onClick={() => void capturePage()}
              className="ml-auto text-[var(--color-accent)] hover:underline"
            >
              retry
            </button>
          </div>
        )}
      </div>

      {!ollamaReachable && (
        <div className="flex items-center gap-2 bg-[var(--color-danger)]/20 px-3 py-2 text-xs text-[var(--color-danger)]">
          <AlertCircle className="h-3 w-3" />
          Ollama unreachable at localhost:11434. Start it and set OLLAMA_ORIGINS.
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <div className="mx-auto mt-8 max-w-xs text-center text-gray-500">
            <p>Ask about the current page.</p>
            <p className="mt-2 text-xs">Try: summarize, list links, extract emails.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={
                  m.role === 'user'
                    ? 'ml-6 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-white'
                    : 'mr-6 whitespace-pre-wrap rounded-lg bg-[var(--color-elevated)] px-3 py-2'
                }
              >
                {m.content || (m.streaming ? '…' : '')}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-[var(--color-border)] p-2">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder={selectedModel ? 'Message…' : 'Pick a model first'}
            className="flex-1 resize-none rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-sm focus:border-[var(--color-accent)] focus:outline-none"
            disabled={!selectedModel}
          />
          {isStreaming ? (
            <button
              onClick={stop}
              className="rounded bg-[var(--color-danger)] px-3 py-2 text-white"
            >
              stop
            </button>
          ) : (
            <button
              onClick={() => void send()}
              disabled={!selectedModel || !input.trim()}
              className="rounded bg-[var(--color-accent)] px-3 py-2 text-white disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
