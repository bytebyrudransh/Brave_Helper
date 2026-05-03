import { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import { 
  listChatSessions, 
  deleteChatSession, 
  type ChatSession, 
  saveLastSessionId 
} from '../lib/history';
import { Trash2, MessageSquare, Clock } from 'lucide-react';

export function HistoryView() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const { setActiveTab, setMessages, setCurrentSessionId } = useAppStore();

  useEffect(() => {
    void loadSessions();
  }, []);

  async function loadSessions() {
    const list = await listChatSessions();
    setSessions(list.sort((a, b) => b.updatedAt - a.updatedAt));
  }

  async function handleLoadSession(session: ChatSession) {
    setMessages(session.messages);
    setCurrentSessionId(session.id);
    await saveLastSessionId(session.id);
    setActiveTab('chat');
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await deleteChatSession(id);
    
    // If we're deleting the currently active session, clear the chat
    const { currentSessionId, clearMessages } = useAppStore.getState();
    if (currentSessionId === id) {
      clearMessages();
      await saveLastSessionId('');
    }
    
    await loadSessions();
  }

  if (sessions.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center space-y-4 opacity-60">
        <Clock className="h-10 w-10 text-text-muted" />
        <p className="text-xs font-bold text-text-muted">No history yet.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {sessions.map((s) => (
        <div
          key={s.id}
          onClick={() => void handleLoadSession(s)}
          className="group relative cursor-pointer rounded-xl border border-border bg-surface p-3 transition-all hover:border-accent/50 hover:bg-surface/80"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <h3 className="truncate text-[13px] font-semibold text-text-primary">
                {s.title}
              </h3>
              {s.pageTitle && (
                <p className="truncate text-[10px] text-text-muted mt-1">
                  Page: {s.pageTitle}
                </p>
              )}
            </div>
            <button
              onClick={(e) => void handleDelete(s.id, e)}
              className="text-text-muted hover:text-danger p-1 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          
          <div className="mt-3 flex items-center gap-4 text-[10px] text-text-muted">
            <div className="flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              <span>{s.messages.length} messages</span>
            </div>
            <span>
              {new Date(s.updatedAt).toLocaleDateString()} {new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
