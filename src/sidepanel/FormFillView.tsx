import { useEffect, useState, useMemo } from 'react';
import { requestFormExtraction, requestFormFill, type ExtractedForm } from '../lib/page';
import { useAppStore } from '../store';
import { FileText, Loader2, RefreshCw, AlertCircle, Search, CheckCircle2, User, KeyRound } from 'lucide-react';


export function FormFillView() {
  const { vaultData } = useAppStore();
  const [forms, setForms] = useState<ExtractedForm[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [selectedLoginId, setSelectedLoginId] = useState<string>('');

  const [fillState, setFillState] = useState<'idle' | 'filling' | 'done'>('idle');

  useEffect(() => {
    void analyzeForms();
  }, []);

  async function analyzeForms() {
    setLoading(true);
    setError(null);
    setFillState('idle');
    try {
      const extracted = await requestFormExtraction();
      setForms(extracted.filter(f => f.fields.length > 0));
    } catch (err) {
      let errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('Receiving end does not exist')) {
        errMsg = "Page hasn't loaded helper yet. Refresh the active tab.";
      }
      setError(errMsg);
    } finally {
      setLoading(false);
    }
  }

  // Auto-matching logic
  const proposedValues = useMemo(() => {
    const values: Record<string, { value: string; source: string }> = {};
    if (!vaultData) return values;

    const profile = vaultData.profiles.find(p => p.id === selectedProfileId);
    const login = vaultData.logins.find(l => l.id === selectedLoginId);

    forms.forEach(form => {
      form.fields.forEach(f => {
        const lbl = f.label.toLowerCase();
        const nm = f.name.toLowerCase();
        const type = f.type.toLowerCase();

        // Match Login
        if (login) {
          if ((lbl.includes('password') || type === 'password' || nm.includes('pass')) && login.password) {
            values[f.selector] = { value: login.password, source: 'Login Password' };
            return;
          }
          if ((lbl.includes('user') || lbl.includes('email') || nm.includes('user') || nm.includes('email')) && login.username) {
            values[f.selector] = { value: login.username, source: 'Login Username' };
            return;
          }
        }

        // Match Profile
        if (profile) {
          if (lbl.includes('name') || nm.includes('name')) {
            values[f.selector] = { value: profile.fullName, source: 'Profile Name' };
            return;
          }
          if (lbl.includes('email') || nm.includes('email') || type === 'email') {
            values[f.selector] = { value: profile.email, source: 'Profile Email' };
            return;
          }
          if (lbl.includes('phone') || nm.includes('phone') || type === 'tel') {
            if (profile.phone) {
              values[f.selector] = { value: profile.phone, source: 'Profile Phone' };
              return;
            }
          }
          if (lbl.includes('address') || nm.includes('address')) {
            if (profile.address) {
              values[f.selector] = { value: profile.address, source: 'Profile Address' };
              return;
            }
          }
        }
      });
    });

    return values;
  }, [forms, selectedProfileId, selectedLoginId, vaultData]);

  async function handleFill() {
    setFillState('filling');
    try {
      const fillData: Record<string, string> = {};
      for (const [selector, match] of Object.entries(proposedValues)) {
        fillData[selector] = match.value;
      }
      await requestFormFill(fillData);
      setFillState('done');
      setTimeout(() => setFillState('idle'), 2000);
    } catch (err) {
      setError('Failed to fill form');
      setFillState('idle');
    }
  }

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center space-y-4 opacity-60">
        <Loader2 className="h-10 w-10 animate-spin text-accent" />
        <p className="text-xs font-bold text-text-muted">Analyzing forms...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col p-4 space-y-4">
        <div className="flex items-start gap-3 rounded-xl border border-danger/20 bg-danger/5 p-3 text-xs text-danger shadow-lg shadow-danger/5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <p className="font-bold uppercase tracking-tight">Extraction Failed</p>
            <p className="text-text-secondary leading-relaxed">{error}</p>
          </div>
        </div>
        <button
          onClick={() => void analyzeForms()}
          className="rounded-lg border border-border bg-surface px-4 py-2 text-xs font-bold text-text-primary hover:border-accent hover:text-white"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (forms.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center space-y-4 opacity-60">
        <Search className="h-10 w-10 text-text-muted" />
        <p className="text-xs font-bold text-text-muted">No visible forms found on this page.</p>
        <button
          onClick={() => void analyzeForms()}
          className="rounded-lg border border-border bg-surface px-4 py-2 text-xs font-bold text-text-primary hover:border-accent hover:text-white mt-4"
        >
          Re-Analyze
        </button>
      </div>
    );
  }

  const matchCount = Object.keys(proposedValues).length;

  return (
    <div className="flex-1 flex flex-col h-full relative">
      <div className="flex-1 overflow-y-auto p-4 space-y-6 pb-24">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase tracking-wider text-text-muted">
            Extracted Forms ({forms.length})
          </h2>
          <button
            onClick={() => void analyzeForms()}
            className="text-text-muted hover:text-accent p-1 transition-colors"
            title="Re-analyze Page"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Vault Selectors */}
        {!vaultData ? (
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Unlock vault to enable autofill
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-text-muted uppercase flex items-center gap-1">
                <User className="h-3 w-3" /> Profile
              </label>
              <select
                value={selectedProfileId}
                onChange={e => setSelectedProfileId(e.target.value)}
                className="w-full rounded bg-surface border border-border p-1.5 text-xs text-white"
              >
                <option value="">None</option>
                {vaultData.profiles.map(p => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-text-muted uppercase flex items-center gap-1">
                <KeyRound className="h-3 w-3" /> Login
              </label>
              <select
                value={selectedLoginId}
                onChange={e => setSelectedLoginId(e.target.value)}
                className="w-full rounded bg-surface border border-border p-1.5 text-xs text-white"
              >
                <option value="">None</option>
                {vaultData.logins.map(l => (
                  <option key={l.id} value={l.id}>{l.url}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {forms.map((form) => (
          <div key={form.id} className="rounded-xl border border-border bg-surface p-4 space-y-4">
            <div className="flex items-center gap-2 border-b border-border/50 pb-2">
              <FileText className="h-4 w-4 text-accent" />
              <h3 className="text-[13px] font-bold text-text-primary">
                {form.id === 'orphan-inputs' ? 'Unbound Inputs' : `Form: ${form.id}`}
              </h3>
            </div>

            <div className="space-y-3">
              {form.fields.map((field, i) => {
                const match = proposedValues[field.selector];
                
                return (
                  <div key={i} className={`rounded-lg bg-bg/50 p-3 border transition-colors ${match ? 'border-accent/50' : 'border-border/50'}`}>
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-[11px] font-bold text-white">
                        {field.label}
                      </span>
                      <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[9px] font-mono text-accent uppercase">
                        {field.type}
                      </span>
                    </div>
                    <div className="text-[10px] text-text-muted font-mono truncate" title={field.selector}>
                      {field.name || field.selector}
                    </div>
                    
                    <div className="mt-2 border-t border-border/30 pt-2 flex items-center justify-between">
                      {match ? (
                        <div className="flex flex-col">
                           <span className="text-[10px] text-accent font-bold">Matches: {match.source}</span>
                           <span className="text-[11px] text-white font-mono truncate max-w-[150px] opacity-80">
                             {field.type === 'password' ? '••••••••' : match.value}
                           </span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-text-muted italic">No matching vault data</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Floating Action Bar */}
      {matchCount > 0 && (
        <div className="absolute bottom-4 left-4 right-4 p-4 rounded-xl border border-accent/30 bg-surface/95 backdrop-blur-md shadow-lg shadow-black/50 flex items-center justify-between">
          <div className="flex flex-col">
             <span className="text-xs font-bold text-white">{matchCount} fields ready</span>
             <span className="text-[10px] text-text-muted">Review above, then fill</span>
          </div>
          <button
            onClick={() => void handleFill()}
            disabled={fillState !== 'idle'}
            className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {fillState === 'filling' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : fillState === 'done' ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              'Autofill'
            )}
          </button>
        </div>
      )}
    </div>
  );
}
