import { useEffect, useState } from 'react';
import { useAppStore } from '../store';
import { 
  isVaultSetup, 
  unlockVault, 
  saveVault, 
  type VaultData, 
  type VaultProfile, 
  type VaultLogin 
} from '../lib/vault';
import { Lock, Unlock, Plus, KeyRound, User, Trash2, Edit2, ShieldAlert } from 'lucide-react';

export function VaultView() {
  const { vaultData, vaultPassword, setVaultData } = useAppStore();
  
  const [setupMode, setSetupMode] = useState(false);
  const [loading, setLoading] = useState(true);
  
  const [pwdInput, setPwdInput] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [error, setError] = useState<string | null>(null);
  
  const [viewMode, setViewMode] = useState<'list' | 'editProfile' | 'editLogin'>('list');
  const [editingProfile, setEditingProfile] = useState<Partial<VaultProfile>>({});
  const [editingLogin, setEditingLogin] = useState<Partial<VaultLogin>>({});

  useEffect(() => {
    void checkSetup();
  }, []);

  async function checkSetup() {
    try {
      const setup = await isVaultSetup();
      setSetupMode(!setup);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const data = await unlockVault(pwdInput);
      setVaultData(data, pwdInput);
      setPwdInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unlock failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault();
    if (pwdInput.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (pwdInput !== confirmPwd) {
      setError('Passwords do not match');
      return;
    }
    
    setError(null);
    setLoading(true);
    try {
      const initialData: VaultData = { logins: [], profiles: [] };
      await saveVault(pwdInput, initialData);
      setVaultData(initialData, pwdInput);
      setSetupMode(false);
      setPwdInput('');
      setConfirmPwd('');
    } catch (err) {
      setError('Failed to setup vault');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveProfile() {
    if (!vaultData || !vaultPassword || !editingProfile.title) return;
    
    const isNew = !editingProfile.id;
    const profile: VaultProfile = {
      id: editingProfile.id || crypto.randomUUID(),
      title: editingProfile.title,
      fullName: editingProfile.fullName || '',
      email: editingProfile.email || '',
      phone: editingProfile.phone || '',
      address: editingProfile.address || ''
    };
    
    const updatedProfiles = isNew 
      ? [...vaultData.profiles, profile]
      : vaultData.profiles.map(p => p.id === profile.id ? profile : p);
      
    const newData = { ...vaultData, profiles: updatedProfiles };
    await saveVault(vaultPassword, newData);
    setVaultData(newData, vaultPassword);
    setViewMode('list');
  }

  async function handleSaveLogin() {
    if (!vaultData || !vaultPassword || !editingLogin.url) return;
    
    const isNew = !editingLogin.id;
    const login: VaultLogin = {
      id: editingLogin.id || crypto.randomUUID(),
      url: editingLogin.url,
      username: editingLogin.username || '',
      password: editingLogin.password || '',
      notes: editingLogin.notes || ''
    };
    
    const updatedLogins = isNew 
      ? [...vaultData.logins, login]
      : vaultData.logins.map(l => l.id === login.id ? login : l);
      
    const newData = { ...vaultData, logins: updatedLogins };
    await saveVault(vaultPassword, newData);
    setVaultData(newData, vaultPassword);
    setViewMode('list');
  }
  
  async function handleDeleteProfile(id: string) {
    if (!vaultData || !vaultPassword) return;
    const newData = { 
      ...vaultData, 
      profiles: vaultData.profiles.filter(p => p.id !== id) 
    };
    await saveVault(vaultPassword, newData);
    setVaultData(newData, vaultPassword);
  }
  
  async function handleDeleteLogin(id: string) {
    if (!vaultData || !vaultPassword) return;
    const newData = { 
      ...vaultData, 
      logins: vaultData.logins.filter(l => l.id !== id) 
    };
    await saveVault(vaultPassword, newData);
    setVaultData(newData, vaultPassword);
  }

  if (loading && !vaultData) {
    return <div className="p-4 text-xs text-text-muted">Loading vault...</div>;
  }

  // ── Authentication View ──
  if (!vaultData) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 space-y-6">
        <div className="flex flex-col items-center space-y-2">
          <div className="rounded-full bg-surface p-4 border border-border">
            <Lock className="h-8 w-8 text-accent" />
          </div>
          <h2 className="text-sm font-bold text-white tracking-wide">
            {setupMode ? 'Initialize Local Vault' : 'Unlock Vault'}
          </h2>
          <p className="text-xs text-text-muted text-center max-w-[200px]">
            {setupMode 
              ? 'Create a master password to encrypt your local data.' 
              : 'Enter master password to access profiles and logins.'}
          </p>
        </div>

        <form onSubmit={setupMode ? handleSetup : handleUnlock} className="w-full space-y-3">
          <input
            type="password"
            placeholder="Master Password"
            value={pwdInput}
            onChange={(e) => setPwdInput(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-white outline-none focus:border-accent"
            autoFocus
          />
          {setupMode && (
            <input
              type="password"
              placeholder="Confirm Password"
              value={confirmPwd}
              onChange={(e) => setConfirmPwd(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-white outline-none focus:border-accent"
            />
          )}
          {error && <p className="text-[10px] text-danger text-center">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-accent px-4 py-2 text-xs font-bold text-white hover:bg-accent/90 disabled:opacity-50"
          >
            {setupMode ? 'Encrypt & Save' : 'Unlock'}
          </button>
        </form>
        
        <div className="flex items-center gap-2 text-[9px] text-warning max-w-[200px] text-center">
           <ShieldAlert className="h-4 w-4 shrink-0" />
           <span>Your data never leaves this device. If you forget this password, the data cannot be recovered.</span>
        </div>
      </div>
    );
  }

  // ── Edit Profile View ──
  if (viewMode === 'editProfile') {
    return (
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <h3 className="text-xs font-bold uppercase text-text-muted">
          {editingProfile.id ? 'Edit Profile' : 'New Profile'}
        </h3>
        <div className="space-y-3">
          <input placeholder="Profile Name (e.g. Personal)" value={editingProfile.title || ''} onChange={e => setEditingProfile({...editingProfile, title: e.target.value})} className="w-full rounded bg-surface p-2 text-xs text-white border border-border" />
          <input placeholder="Full Name" value={editingProfile.fullName || ''} onChange={e => setEditingProfile({...editingProfile, fullName: e.target.value})} className="w-full rounded bg-surface p-2 text-xs text-white border border-border" />
          <input placeholder="Email" type="email" value={editingProfile.email || ''} onChange={e => setEditingProfile({...editingProfile, email: e.target.value})} className="w-full rounded bg-surface p-2 text-xs text-white border border-border" />
          <input placeholder="Phone" value={editingProfile.phone || ''} onChange={e => setEditingProfile({...editingProfile, phone: e.target.value})} className="w-full rounded bg-surface p-2 text-xs text-white border border-border" />
          <textarea placeholder="Address" value={editingProfile.address || ''} onChange={e => setEditingProfile({...editingProfile, address: e.target.value})} className="w-full rounded bg-surface p-2 text-xs text-white border border-border h-20" />
        </div>
        <div className="flex gap-2 pt-2">
          <button onClick={() => setViewMode('list')} className="flex-1 rounded border border-border py-1.5 text-xs text-text-muted hover:text-white">Cancel</button>
          <button onClick={() => void handleSaveProfile()} className="flex-1 rounded bg-accent py-1.5 text-xs font-bold text-white hover:bg-accent/90">Save</button>
        </div>
      </div>
    );
  }

  // ── Edit Login View ──
  if (viewMode === 'editLogin') {
    return (
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <h3 className="text-xs font-bold uppercase text-text-muted">
          {editingLogin.id ? 'Edit Login' : 'New Login'}
        </h3>
        <div className="space-y-3">
          <input placeholder="Website URL (e.g. github.com)" value={editingLogin.url || ''} onChange={e => setEditingLogin({...editingLogin, url: e.target.value})} className="w-full rounded bg-surface p-2 text-xs text-white border border-border" />
          <input placeholder="Username / Email" value={editingLogin.username || ''} onChange={e => setEditingLogin({...editingLogin, username: e.target.value})} className="w-full rounded bg-surface p-2 text-xs text-white border border-border" />
          <input placeholder="Password" type="password" value={editingLogin.password || ''} onChange={e => setEditingLogin({...editingLogin, password: e.target.value})} className="w-full rounded bg-surface p-2 text-xs text-white border border-border" />
          <textarea placeholder="Notes (Optional)" value={editingLogin.notes || ''} onChange={e => setEditingLogin({...editingLogin, notes: e.target.value})} className="w-full rounded bg-surface p-2 text-xs text-white border border-border h-20" />
        </div>
        <div className="flex gap-2 pt-2">
          <button onClick={() => setViewMode('list')} className="flex-1 rounded border border-border py-1.5 text-xs text-text-muted hover:text-white">Cancel</button>
          <button onClick={() => void handleSaveLogin()} className="flex-1 rounded bg-accent py-1.5 text-xs font-bold text-white hover:bg-accent/90">Save</button>
        </div>
      </div>
    );
  }

  // ── Main Unlocked View ──
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6">
      <div className="flex items-center justify-between border-b border-border/50 pb-2">
        <div className="flex items-center gap-2 text-success">
          <Unlock className="h-4 w-4" />
          <span className="text-xs font-bold">Vault Unlocked</span>
        </div>
        <button 
          onClick={() => setVaultData(null, null)}
          className="text-[10px] uppercase font-bold text-text-muted hover:text-white px-2 py-1 rounded bg-surface border border-border"
        >
          Lock
        </button>
      </div>

      {/* Profiles */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase text-text-muted flex items-center gap-1.5">
            <User className="h-3.5 w-3.5" /> Profiles
          </h3>
          <button 
            onClick={() => { setEditingProfile({}); setViewMode('editProfile'); }}
            className="text-accent hover:text-white p-1"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        
        {vaultData.profiles.length === 0 ? (
          <p className="text-[11px] text-text-muted italic px-2">No profiles saved.</p>
        ) : (
          <div className="grid gap-2">
            {vaultData.profiles.map(p => (
              <div key={p.id} className="group relative flex items-center justify-between rounded-lg border border-border bg-surface p-3">
                <div className="min-w-0">
                  <p className="text-[12px] font-bold text-white truncate">{p.title}</p>
                  <p className="text-[10px] text-text-muted truncate">{p.email || p.fullName}</p>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => { setEditingProfile(p); setViewMode('editProfile'); }} className="p-1.5 text-text-muted hover:text-white"><Edit2 className="h-3 w-3" /></button>
                  <button onClick={() => void handleDeleteProfile(p.id)} className="p-1.5 text-text-muted hover:text-danger"><Trash2 className="h-3 w-3" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Logins */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase text-text-muted flex items-center gap-1.5">
            <KeyRound className="h-3.5 w-3.5" /> Logins
          </h3>
          <button 
            onClick={() => { setEditingLogin({}); setViewMode('editLogin'); }}
            className="text-accent hover:text-white p-1"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
        
        {vaultData.logins.length === 0 ? (
          <p className="text-[11px] text-text-muted italic px-2">No logins saved.</p>
        ) : (
          <div className="grid gap-2">
            {vaultData.logins.map(l => (
              <div key={l.id} className="group relative flex items-center justify-between rounded-lg border border-border bg-surface p-3">
                <div className="min-w-0">
                  <p className="text-[12px] font-bold text-white truncate">{l.url}</p>
                  <p className="text-[10px] text-text-muted truncate">{l.username}</p>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => { setEditingLogin(l); setViewMode('editLogin'); }} className="p-1.5 text-text-muted hover:text-white"><Edit2 className="h-3 w-3" /></button>
                  <button onClick={() => void handleDeleteLogin(l.id)} className="p-1.5 text-text-muted hover:text-danger"><Trash2 className="h-3 w-3" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
