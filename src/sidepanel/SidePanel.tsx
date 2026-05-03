import { useEffect, useRef, useState } from 'react';
import { 
  Send, 
  RefreshCw, 
  Globe, 
  AlertCircle, 
  Loader2, 
  Cpu, 
  ChevronDown,
  Sparkles,
  Command,
  Zap,
  ShieldCheck,
  StopCircle,
  History,
  MessageSquare,
  FileText
} from 'lucide-react';
import { useAppStore } from '../store';
import { listOllamaModels, streamChat, type ChatTurn } from '../lib/ollama';
import { requestActiveTabSnapshot } from '../lib/page';
import { PROJECT_MODEL_MAP, PROJECT_MODELS } from '../config/models';
import { captureVisibleScreenshot, saveCurrentPage } from '../lib/session';
import { 
  saveChatSession, 
  getLastSessionId, 
  getChatSession, 
  saveLastSessionId,
  saveSelectedModel,
  getSelectedModel
} from '../lib/history';
import { HistoryView } from './HistoryView';
import { FormFillView } from './FormFillView';
import { VaultView } from './VaultView';

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
    clearMessages,
    activeTab,
    setActiveTab,
    setCurrentSessionId,
    setMessages,
  } = useAppStore();

  const [input, setInput] = useState('');
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [activeTabUrl, setActiveTabUrl] = useState<string | null>(null);
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const isStale =
    page !== null && activeTabUrl !== null && activeTabUrl !== page.url;
  const selectedModelConfig = selectedModel
    ? PROJECT_MODEL_MAP.get(selectedModel) ?? null
    : null;

  useEffect(() => {
    async function init() {
      const savedModel = await getSelectedModel();
      await refreshModels(savedModel);
      await capturePage();

      const lastSessionId = await getLastSessionId();
      if (lastSessionId) {
        const session = await getChatSession(lastSessionId);
        if (session) {
          setMessages(session.messages);
          setCurrentSessionId(session.id);
        }
      }
    }
    void init();
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
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages]);

  async function refreshModels(preferredModelName?: string | null) {
    try {
      setOllamaError(null);
      const list = await listOllamaModels();
      setModels(list);
      setOllamaReachable(true);
      const availableConfiguredModels = list.filter((model) =>
        PROJECT_MODEL_MAP.has(model.name)
      );
      
      const { selectedModel: currentSelected } = useAppStore.getState();
      const targetModel = preferredModelName || currentSelected;
      
      if (availableConfiguredModels.length > 0) {
        if (!targetModel || !availableConfiguredModels.some(m => m.name === targetModel)) {
          setSelectedModel(availableConfiguredModels[0].name);
        } else if (preferredModelName) {
           setSelectedModel(preferredModelName);
        }
      }
    } catch (err) {
      setOllamaReachable(false);
      let errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('Failed to fetch')) {
        errMsg = "Ollama isn't reachable at localhost:11434.";
      } else if (errMsg.includes('403')) {
        errMsg = "Ollama rejected extension origin. Set OLLAMA_ORIGINS=chrome-extension://<id> and restart ollama.";
      }
      setOllamaError(errMsg);
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
      let errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('Receiving end does not exist')) {
        errMsg = "Page hasn't loaded helper yet (refresh, or it's a restricted browser page).";
      }
      setPageError(errMsg);
    } finally {
      setPageLoading(false);
    }
  }

  async function send() {
    const content = input.trim();
    if (!content || isStreaming || !selectedModel) return;
    setInput('');

    if (content.startsWith('/')) {
      await runCommand(content);
      return;
    }

    const userMsg = { id: crypto.randomUUID(), role: 'user' as const, content };
    appendMessage(userMsg);

    const assistantId = crypto.randomUUID();
    appendMessage({ id: assistantId, role: 'assistant', content: '', streaming: true });

    const turns: ChatTurn[] = [
      {
        role: 'system',
        content:
          selectedModelConfig?.systemPrompt ??
          PROJECT_MODELS[0].systemPrompt,
      },
    ];
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
        numCtx: selectedModelConfig?.numCtx,
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
      
      // Save session
      const { messages, page, currentSessionId: sid } = useAppStore.getState();
      const session = await saveChatSession(messages, page, sid ?? undefined);
      if (session.id !== sid) {
        setCurrentSessionId(session.id);
        await saveLastSessionId(session.id);
      }
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function appendAssistantNote(content: string) {
    appendMessage({
      id: crypto.randomUUID(),
      role: 'assistant',
      content,
    });
  }

  async function askWithPreset(content: string) {
    setInput(content);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const userMsg = { id: crypto.randomUUID(), role: 'user' as const, content };
    appendMessage(userMsg);

    const assistantId = crypto.randomUUID();
    appendMessage({ id: assistantId, role: 'assistant', content: '', streaming: true });

    const turns: ChatTurn[] = [
      {
        role: 'system',
        content:
          selectedModelConfig?.systemPrompt ??
          PROJECT_MODELS[0].systemPrompt,
      },
    ];
    const ctx = buildPageContext();
    if (ctx) turns.push({ role: 'system', content: ctx });
    for (const m of useAppStore.getState().messages) {
      if (m.id === assistantId) continue;
      turns.push({ role: m.role, content: m.content });
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsStreaming(true);
    setInput('');
    try {
      for await (const chunk of streamChat({
        model: selectedModel!,
        messages: turns,
        numCtx: selectedModelConfig?.numCtx,
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
      
      // Save session
      const { messages, page, currentSessionId: sid } = useAppStore.getState();
      const session = await saveChatSession(messages, page, sid ?? undefined);
      if (session.id !== sid) {
        setCurrentSessionId(session.id);
        await saveLastSessionId(session.id);
      }
    }
  }

  async function runCommand(raw: string) {
    const command = raw.trim().toLowerCase();

    if (command === '/clear') {
      clearMessages();
      appendAssistantNote('Chat cleared.');
      return;
    }

    if (command === '/start') {
      clearMessages();
      await capturePage();
      appendAssistantNote(
        'Fresh session started. Page snapshot synced and ready.'
      );
      return;
    }

    if (command === '/summary' || command === '/summery') {
      await askWithPreset(
        'Summarize this page in concise bullets. Include the main topic, key points, and anything actionable.'
      );
      return;
    }

    if (command === '/save') {
      const currentPage = useAppStore.getState().page;
      if (!currentPage) {
        appendAssistantNote('No page snapshot is loaded yet. Press Sync first.');
        return;
      }
      const saved = await saveCurrentPage(currentPage);
      appendAssistantNote(`Saved current page locally: ${saved.title || saved.url}`);
      return;
    }

    if (command === '/takess') {
      try {
        const dataUrl = await captureVisibleScreenshot();
        await chrome.tabs.create({ url: dataUrl });
        appendAssistantNote('Screenshot captured and opened in a new tab.');
      } catch (err) {
        appendAssistantNote(
          `Screenshot failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      return;
    }

    appendAssistantNote(
      'Unknown command. Try /start, /clear, /summary, /takeSS, or /save.'
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg text-sm selection:bg-accent/30">
      {/* Premium Header */}
      <header className="relative z-10 flex flex-col gap-2 border-b border-border/50 bg-bg/80 p-4 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg accent-gradient text-white shadow-lg shadow-accent/20">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-white">BRAVE HELPER</h1>
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-text-muted">
                <span className={`h-1.5 w-1.5 rounded-full ${ollamaReachable ? 'bg-success animate-pulse' : 'bg-danger'}`} />
                {ollamaReachable ? 'Local AI Active' : 'AI Offline'}
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-1">
            <div className="relative group">
              <select
                value={selectedModel ?? ''}
                onChange={(e) => {
                  setSelectedModel(e.target.value);
                  void saveSelectedModel(e.target.value);
                }}
                className="h-8 appearance-none rounded-lg border border-border bg-surface pl-8 pr-8 text-[11px] font-semibold text-text-secondary outline-none transition-all hover:border-accent hover:text-white"
              >
                {models.length === 0 && <option value="">No Models</option>}
                {models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {(PROJECT_MODEL_MAP.get(m.name)?.label ?? m.name).toUpperCase()}
                  </option>
                ))}
              </select>
              <Cpu className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted group-hover:text-accent transition-colors" />
              <ChevronDown className="absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted pointer-events-none" />
            </div>
            
            <button
              onClick={() => void refreshModels()}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-text-secondary transition-all hover:border-accent hover:text-white"
              title="Refresh Models"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isStreaming ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Page Scope Control */}
        <div className={`flex items-center gap-3 rounded-xl border border-white/5 p-2 transition-all ${page ? 'bg-surface/50' : 'bg-danger/10 border-danger/20'}`}>
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/5">
            {pageLoading ? <Loader2 className="h-3 w-3 animate-spin text-accent" /> : <Globe className={`h-3 w-3 ${page ? 'text-accent' : 'text-danger'}`} />}
          </div>
          
          <div className="flex min-w-0 flex-1 flex-col">
            {page ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] font-medium text-text-secondary">
                    {page.title || 'Untitled Page'}
                  </span>
                  <div className="flex items-center gap-2">
                    {isStale && <span className="rounded-full bg-warning/20 px-1.5 py-0.5 text-[9px] font-bold text-warning uppercase">Stale</span>}
                    <button onClick={() => void capturePage()} className="text-[10px] font-bold text-accent hover:text-accent-hover uppercase">Sync</button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-1.5 group">
                    <input
                      type="checkbox"
                      checked={pageScopeEnabled}
                      onChange={(e) => setPageScopeEnabled(e.target.checked)}
                      className="h-3 w-3 rounded border-border bg-transparent text-accent focus:ring-0 focus:ring-offset-0 transition-all cursor-pointer"
                    />
                    <span className="text-[10px] font-semibold text-text-muted group-hover:text-text-secondary transition-colors uppercase tracking-tight">Scope Active</span>
                  </label>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-danger">{pageError || 'No connection to page'}</span>
                <button onClick={() => void capturePage()} className="text-[10px] font-bold text-accent uppercase hover:underline">Retry</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Connection Warning */}
      {!ollamaReachable && (
        <div className="mx-4 mt-4 flex items-start gap-3 rounded-xl border border-danger/20 bg-danger/5 p-3 text-xs text-danger shadow-lg shadow-danger/5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <p className="font-bold uppercase tracking-tight">Ollama Unreachable</p>
            <p className="text-text-secondary leading-relaxed">
              {ollamaError || (
                <>Ensure Ollama is running and <code className="rounded bg-danger/10 px-1 font-mono text-[10px]">OLLAMA_ORIGINS</code> is configured.</>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border/50 px-4 pt-2">
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-bold transition-all ${
            activeTab === 'chat'
              ? 'border-accent text-white'
              : 'border-transparent text-text-muted hover:text-text-secondary'
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          CHAT
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-bold transition-all ${
            activeTab === 'history'
              ? 'border-accent text-white'
              : 'border-transparent text-text-muted hover:text-text-secondary'
          }`}
        >
          <History className="h-3.5 w-3.5" />
          HISTORY
        </button>
        <button
          onClick={() => setActiveTab('vault')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-bold transition-all ${
            activeTab === 'vault'
              ? 'border-accent text-white'
              : 'border-transparent text-text-muted hover:text-text-secondary'
          }`}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          VAULT
        </button>
        <button
          onClick={() => setActiveTab('form-fill')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-bold transition-all ${
            activeTab === 'form-fill'
              ? 'border-accent text-white'
              : 'border-transparent text-text-muted hover:text-text-secondary'
          }`}
        >
          <FileText className="h-3.5 w-3.5" />
          FORMS
        </button>
      </div>

      {/* Main Content Area */}
      {activeTab === 'history' ? (
        <HistoryView />
      ) : activeTab === 'vault' ? (
        <VaultView />
      ) : activeTab === 'form-fill' ? (
        <FormFillView />
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 space-y-6 overflow-y-auto p-4 py-8">
            {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center space-y-6 opacity-60">
            <div className="relative">
              <div className="absolute -inset-4 rounded-full bg-accent/20 blur-2xl" />
              <Command className="relative h-12 w-12 text-accent/50" />
            </div>
            <div className="space-y-2 text-center">
              <p className="text-lg font-bold tracking-tight text-white">How can I help?</p>
              <p className="text-xs text-text-muted">Analyzing your current session in real-time.</p>
            </div>
          <div className="grid grid-cols-2 gap-2 max-w-xs">
              {['Summarize Page', 'Extract Links', 'Find Emails', 'Explain Content'].map(item => (
                <button 
                  key={item}
                  onClick={() => setInput(item)}
                  className="rounded-xl border border-border bg-surface/50 p-2.5 text-center text-[10px] font-bold text-text-secondary hover:border-accent hover:text-white transition-all"
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-xs">
              {['/start', '/clear', '/summary', '/takeSS', '/save'].map((item) => (
                <button
                  key={item}
                  onClick={() => setInput(item)}
                  className="rounded-full border border-border bg-surface/40 px-3 py-1.5 text-[10px] font-bold text-text-muted transition-all hover:border-accent hover:text-white"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div className={`flex items-center gap-2 mb-1.5 px-1 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                   {m.role === 'user' ? <Command className="h-3 w-3 text-text-muted" /> : <Sparkles className="h-3 w-3 text-accent" />}
                   <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                     {m.role === 'user' ? 'System User' : selectedModel?.toUpperCase() || 'Assistant'}
                   </span>
                </div>
                <div
                  className={`relative max-w-[90%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-[13px] leading-relaxed shadow-sm transition-all ${
                    m.role === 'user'
                      ? 'accent-gradient text-white shadow-accent/10 rounded-tr-none'
                      : 'bg-elevated border border-border text-text-primary shadow-black/20 rounded-tl-none'
                  }`}
                >
                  {m.content}
                  {m.streaming && !m.content && (
                    <div className="flex gap-1 py-1">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:0.2s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:0.4s]" />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="relative p-4 pt-0">
        <div className="absolute -top-12 left-0 right-0 h-12 bg-gradient-to-t from-bg to-transparent pointer-events-none" />
        
        <div className="group relative rounded-2xl border border-border bg-surface/80 p-2 shadow-2xl transition-all hover:border-accent/50 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/20 backdrop-blur-md">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder={selectedModel ? 'Command local intelligence...' : 'Select a neural engine...'}
            className="w-full resize-none bg-transparent px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none disabled:cursor-not-allowed"
            disabled={!selectedModel || !ollamaReachable}
          />
          
          <div className="flex items-center justify-between border-t border-border/50 px-2 py-1.5 mt-1">
            <div className="flex items-center gap-3 px-1">
              <div className="flex items-center gap-1 text-[10px] font-bold text-text-muted">
                <ShieldCheck className="h-3 w-3 text-success" />
                <span className="uppercase tracking-tight">Secure</span>
              </div>
              <div className="flex items-center gap-1 text-[10px] font-bold text-text-muted">
                <Zap className="h-3 w-3 text-warning" />
                <span className="uppercase tracking-tight">Offline</span>
              </div>
              {selectedModelConfig && (
                <div className="flex items-center gap-1 text-[10px] font-bold text-text-muted">
                  <Cpu className="h-3 w-3 text-accent" />
                  <span className="uppercase tracking-tight">
                    {Math.round(selectedModelConfig.numCtx / 1000)}K Active
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  clearMessages();
                  appendAssistantNote('Chat cleared.');
                }}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-text-secondary transition-all hover:border-accent hover:text-white"
                title="Clear Chat"
              >
                Clear
              </button>
              {isStreaming ? (
                <button
                  onClick={stop}
                  className="flex h-8 items-center gap-2 rounded-lg bg-danger/10 px-3 text-[10px] font-bold uppercase tracking-wider text-danger transition-all hover:bg-danger/20"
                >
                  <StopCircle className="h-3.5 w-3.5" />
                  Stop
                </button>
              ) : (
                <button
                  onClick={() => void send()}
                  disabled={!selectedModel || !input.trim() || !ollamaReachable}
                  className="flex h-8 w-8 items-center justify-center rounded-lg accent-gradient text-white shadow-lg shadow-accent/20 transition-all hover:scale-105 active:scale-95 disabled:grayscale disabled:opacity-20 disabled:hover:scale-100"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
        
        <p className="mt-2 text-center text-[9px] font-bold uppercase tracking-[0.2em] text-text-muted/50">
          Neural Architecture V2.0 — Local Environment
        </p>
      </div>
        </>
      )}
    </div>
  );
}
