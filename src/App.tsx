import { useEffect } from 'react';
import { Bot, AlertTriangle, MessageSquare, FileText } from 'lucide-react';
import { useAppStore } from './store';
import { listOllamaModels } from './ollamaService';
import ChatPanel from './ChatPanel';
import DocumentsPanel from './DocumentsPanel';

export default function App() {
  const {
    tab,
    models,
    selectedModel,
    ollamaReachable,
    documents,
    setTab,
    setModels,
    setSelectedModel,
    setOllamaReachable,
    hydrate,
  } = useAppStore();

  useEffect(() => {
    hydrate().catch((err) => console.error('Hydrate failed:', err));
  }, [hydrate]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listOllamaModels();
        if (cancelled) return;
        setModels(list);
        setOllamaReachable(true);
      } catch (err) {
        console.error('Ollama unreachable:', err);
        if (!cancelled) setOllamaReachable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setModels, setOllamaReachable]);

  return (
    <div className="flex h-full flex-col bg-[var(--color-bg)] text-white">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 font-semibold">
            <Bot size={20} className="text-[var(--color-accent)]" />
            Local AI Studio
          </div>

          <nav className="flex items-center gap-1 rounded-lg bg-[var(--color-elevated)] p-1 text-xs">
            <TabButton active={tab === 'chat'} onClick={() => setTab('chat')}>
              <MessageSquare size={12} /> Chat
            </TabButton>
            <TabButton active={tab === 'documents'} onClick={() => setTab('documents')}>
              <FileText size={12} /> Documents
              {documents.length > 0 && (
                <span className="ml-1 rounded-full bg-[var(--color-bg)] px-1.5 py-0.5 text-[10px] text-gray-400">
                  {documents.length}
                </span>
              )}
            </TabButton>
          </nav>
        </div>

        <div className="flex items-center gap-3 text-xs">
          {ollamaReachable && models.length > 0 ? (
            <select
              value={selectedModel ?? ''}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="rounded border border-[var(--color-border)] bg-[var(--color-elevated)] px-2 py-1 text-xs outline-none"
            >
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="flex items-center gap-1 text-[var(--color-danger)]">
              <AlertTriangle size={12} />
              Ollama offline
            </span>
          )}
        </div>
      </header>

      <main className="min-h-0 flex-1">{tab === 'chat' ? <ChatPanel /> : <DocumentsPanel />}</main>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 transition ${
        active ? 'bg-[var(--color-accent)] text-white' : 'text-gray-300 hover:bg-blue-500/10'
      }`}
    >
      {children}
    </button>
  );
}
