import { useEffect, useState } from 'react';
import {
  Activity,
  Trash2,
  Download,
  RefreshCw,
  Globe,
  ShieldCheck,
  Camera,
  FileText,
  Cpu,
  Search,
  Lock,
  Unlock,
  Filter,
  Zap,
  ToggleRight,
} from 'lucide-react';
import {
  listAudit,
  clearAudit,
  type AuditEvent,
  type AuditEventType,
} from '../lib/audit';

const TYPE_META: Record<
  AuditEventType,
  { label: string; tone: 'green' | 'red' | 'amber' | 'blue' | 'gray'; Icon: typeof Activity }
> = {
  mode_transition: { label: 'Mode', tone: 'blue', Icon: Activity },
  vault_unlock: { label: 'Vault unlocked', tone: 'red', Icon: Unlock },
  vault_lock: { label: 'Vault locked', tone: 'green', Icon: Lock },
  outbound_request: { label: 'Web request', tone: 'amber', Icon: Globe },
  page_read: { label: 'Page read', tone: 'gray', Icon: FileText },
  screenshot_captured: { label: 'Screenshot', tone: 'gray', Icon: Camera },
  autofill_executed: { label: 'Autofill', tone: 'red', Icon: ShieldCheck },
  memory_recall: { label: 'Recall', tone: 'blue', Icon: Search },
  model_switched: { label: 'Model swap', tone: 'gray', Icon: Cpu },
  auto_routed: { label: 'Auto routed', tone: 'blue', Icon: Zap },
  mode_switched: { label: 'Mode switch', tone: 'amber', Icon: ToggleRight },
};

const TONE_CLASS: Record<string, string> = {
  green: 'bg-success/15 text-success ring-success/30',
  red: 'bg-danger/15 text-danger ring-danger/30',
  amber: 'bg-warning/15 text-warning ring-warning/30',
  blue: 'bg-accent/15 text-accent ring-accent/30',
  gray: 'bg-white/5 text-text-muted ring-white/10',
};

const SINCE_OPTIONS: { label: string; ms: number | undefined }[] = [
  { label: 'All', ms: undefined },
  { label: '1 h', ms: 60 * 60 * 1000 },
  { label: '24 h', ms: 24 * 60 * 60 * 1000 },
  { label: '7 d', ms: 7 * 24 * 60 * 60 * 1000 },
];

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString();
}

export function AuditView() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [typeFilter, setTypeFilter] = useState<AuditEventType | 'all'>('all');
  const [sinceMs, setSinceMs] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const list = await listAudit({
        type: typeFilter === 'all' ? undefined : typeFilter,
        sinceMs,
      });
      setEvents(list);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [typeFilter, sinceMs]);

  async function handleExport() {
    const blob = new Blob([JSON.stringify(events, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brave-helper-audit-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleClear() {
    if (!confirm('Clear the entire audit log? This cannot be undone.')) return;
    await clearAudit();
    await load();
  }

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-accent" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-white">
            Privacy Audit
          </h2>
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-bold text-text-muted">
            {events.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => void load()}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-surface text-text-secondary transition-all hover:border-accent hover:text-white"
            title="Refresh"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => void handleExport()}
            disabled={events.length === 0}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-surface text-text-secondary transition-all hover:border-accent hover:text-white disabled:opacity-30"
            title="Export JSON"
          >
            <Download className="h-3 w-3" />
          </button>
          <button
            onClick={() => void handleClear()}
            disabled={events.length === 0}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-surface text-danger transition-all hover:border-danger disabled:opacity-30"
            title="Clear log"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Filter className="h-3 w-3 text-text-muted" />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as AuditEventType | 'all')}
          className="h-6 rounded-md border border-border bg-surface px-2 text-[10px] font-bold uppercase text-text-secondary outline-none"
        >
          <option value="all">All types</option>
          {Object.entries(TYPE_META).map(([key, meta]) => (
            <option key={key} value={key}>
              {meta.label}
            </option>
          ))}
        </select>
        {SINCE_OPTIONS.map((opt) => (
          <button
            key={opt.label}
            onClick={() => setSinceMs(opt.ms)}
            className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider transition-all ${
              sinceMs === opt.ms
                ? 'border-accent bg-accent/10 text-white'
                : 'border-border bg-surface text-text-muted hover:text-text-secondary'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto rounded-xl border border-border/50">
        {events.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <Activity className="mb-3 h-8 w-8 text-text-muted/30" />
            <p className="text-xs font-bold text-text-secondary">
              No events match the current filter
            </p>
            <p className="mt-1 text-[10px] text-text-muted">
              Use the helper — events appear here as they happen.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/50">
            {events.map((e) => {
              const meta = TYPE_META[e.type];
              const Icon = meta.Icon;
              return (
                <li key={e.id} className="flex items-start gap-3 p-2.5">
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ring-1 ${TONE_CLASS[meta.tone]}`}
                  >
                    <Icon className="h-3 w-3" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
                        {meta.label}
                      </span>
                      <span className="shrink-0 text-[10px] font-mono text-text-muted/70">
                        {formatTime(e.timestamp)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-text-primary">
                      {e.summary}
                    </p>
                    {e.details && (
                      <pre className="mt-1 overflow-x-auto rounded bg-black/40 px-2 py-1 text-[9px] font-mono text-text-muted">
                        {JSON.stringify(e.details, null, 0)}
                      </pre>
                    )}
                    <span
                      className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-tight ${
                        e.mode === 'research'
                          ? 'bg-success/10 text-success'
                          : 'bg-danger/10 text-danger'
                      }`}
                    >
                      {e.mode}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
