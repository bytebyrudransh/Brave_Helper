import { useEffect, useRef, useState } from 'react';
import { Send, FileText, X } from 'lucide-react';
import { useAppStore, type ChatMessage } from './store';
import { streamChat, toChatTurns, type ChatTurn } from './ollamaService';
import { retrieveTopK, type RetrievedChunk } from './lib/retrieval';
import { getChunksByIds, type ChunkRow } from './db';

const BASE_SYSTEM =
  "You are a helpful local AI assistant running on the user's machine. Answer concisely and directly.";

const RAG_SYSTEM_TEMPLATE = (context: string) =>
  `${BASE_SYSTEM}\n\nThe user has scoped this conversation to documents they uploaded. Use the following retrieved excerpts to ground your answer. If the answer is not in the excerpts, say so plainly.\n\nWhen you use information from an excerpt, cite it inline like [1], [2] using the numbers from the list below.\n\n--- RETRIEVED EXCERPTS ---\n${context}\n--- END EXCERPTS ---`;

function formatContext(chunks: RetrievedChunk[], docNameById: Map<string, string>): string {
  return chunks
    .map((rc, i) => {
      const docName = docNameById.get(rc.chunk.docId) ?? 'unknown';
      return `[${i + 1}] (${docName}, chunk ${rc.chunk.ordinal})\n${rc.chunk.text}`;
    })
    .join('\n\n');
}

function newId(): string {
  return crypto.randomUUID();
}

export default function ChatPanel() {
  const {
    messages,
    isStreaming,
    selectedModel,
    ollamaReachable,
    documents,
    scopeDocIds,
    toggleScopeDoc,
    appendMessage,
    appendToMessage,
    setMessageCitations,
    finishStreaming,
    setIsStreaming,
  } = useAppStore();
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  const canSend = !!input.trim() && !isStreaming && ollamaReachable && !!selectedModel;
  const scopedDocs = documents.filter((d) => scopeDocIds.includes(d.id));

  async function handleSend() {
    if (!canSend || !selectedModel) return;
    const text = input.trim();
    setInput('');

    const userMsg: ChatMessage = { id: newId(), role: 'user', content: text };
    const assistantId = newId();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      streaming: true,
    };
    await appendMessage(userMsg);
    await appendMessage(assistantMsg);
    setIsStreaming(true);

    try {
      let systemPrompt = BASE_SYSTEM;
      let citationChunkIds: string[] = [];

      if (scopeDocIds.length > 0) {
        const top = await retrieveTopK(text, scopeDocIds, 5);
        if (top.length > 0) {
          const docNameById = new Map(documents.map((d) => [d.id, d.name]));
          systemPrompt = RAG_SYSTEM_TEMPLATE(formatContext(top, docNameById));
          citationChunkIds = top.map((rc) => rc.chunk.id);
          await setMessageCitations(assistantId, citationChunkIds);
        }
      }

      const turns: ChatTurn[] = toChatTurns(
        [...useAppStore.getState().messages].filter((m) => m.id !== assistantId),
        systemPrompt
      );

      for await (const chunk of streamChat({ model: selectedModel, messages: turns })) {
        appendToMessage(assistantId, chunk);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      appendToMessage(assistantId, `\n\n[error: ${msg}]`);
    } finally {
      await finishStreaming(assistantId);
      setIsStreaming(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {scopedDocs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-xs">
          <span className="text-gray-400">Grounded in:</span>
          {scopedDocs.map((d) => (
            <button
              key={d.id}
              onClick={() => toggleScopeDoc(d.id)}
              className="flex items-center gap-1 rounded-full bg-[var(--color-elevated)] px-2 py-1 hover:bg-blue-500/20"
              title="Click to remove from scope"
            >
              <FileText size={11} />
              <span className="max-w-[180px] truncate">{d.name}</span>
              <X size={11} />
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.length === 0 && (
            <div className="mt-12 text-center text-sm text-gray-400">
              {ollamaReachable
                ? scopeDocIds.length > 0
                  ? 'Ask a question about the scoped documents.'
                  : 'Start a conversation. Add documents from the Documents tab to ground answers in your files.'
                : 'Ollama is not reachable at http://localhost:11434. Start it with `ollama serve`.'}
            </div>
          )}

          {messages.map((m) => (
            <Bubble key={m.id} message={m} />
          ))}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-elevated)] px-3 py-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={ollamaReachable ? 'Message your local model…' : 'Ollama is offline'}
            disabled={!ollamaReachable}
            rows={1}
            className="max-h-40 min-h-[24px] flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-gray-500 disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!canSend}
            className="rounded p-2 text-[var(--color-accent)] hover:bg-blue-500/10 disabled:cursor-not-allowed disabled:text-gray-500 disabled:hover:bg-transparent"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex flex-col gap-2 ${isUser ? 'items-end' : 'items-start'}`}>
      <div
        className={`max-w-[80%] whitespace-pre-wrap rounded-xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? 'rounded-br-sm bg-[var(--color-accent)] text-white'
            : 'rounded-bl-sm bg-[var(--color-elevated)] text-white'
        }`}
      >
        {message.content || (message.streaming ? '…' : '')}
      </div>
      {!isUser && message.citationChunkIds && message.citationChunkIds.length > 0 && (
        <Citations chunkIds={message.citationChunkIds} />
      )}
    </div>
  );
}

function Citations({ chunkIds }: { chunkIds: string[] }) {
  const documents = useAppStore((s) => s.documents);
  const [chunks, setChunks] = useState<ChunkRow[] | null>(null);
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getChunksByIds(chunkIds).then((rows) => {
      if (cancelled) return;
      const ordered = chunkIds
        .map((id) => rows.find((r) => r.id === id))
        .filter((r): r is ChunkRow => Boolean(r));
      setChunks(ordered);
    });
    return () => {
      cancelled = true;
    };
  }, [chunkIds]);

  if (!chunks || chunks.length === 0) return null;
  const docNameById = new Map(documents.map((d) => [d.id, d.name]));

  return (
    <div className="max-w-[80%] text-xs">
      <div className="flex flex-wrap gap-1">
        {chunks.map((c, i) => (
          <button
            key={c.id}
            onClick={() => setOpenIdx(openIdx === i ? null : i)}
            className={`rounded-full border px-2 py-0.5 ${
              openIdx === i
                ? 'border-[var(--color-accent)] bg-blue-500/20 text-white'
                : 'border-[var(--color-border)] bg-[var(--color-elevated)] text-gray-300 hover:bg-blue-500/10'
            }`}
          >
            [{i + 1}] {docNameById.get(c.docId) ?? 'unknown'}
          </button>
        ))}
      </div>
      {openIdx !== null && chunks[openIdx] && (
        <div className="mt-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-3 text-gray-300">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">
            {docNameById.get(chunks[openIdx].docId) ?? 'unknown'} · chunk {chunks[openIdx].ordinal}
          </div>
          <div className="whitespace-pre-wrap leading-relaxed">{chunks[openIdx].text}</div>
        </div>
      )}
    </div>
  );
}
