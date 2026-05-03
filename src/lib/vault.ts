const VAULT_STORAGE_KEY = 'encryptedVault';
const VAULT_SALT_KEY = 'vaultSalt';

export interface VaultLogin {
  id: string;
  url: string;
  username: string;
  password?: string;
  notes?: string;
}

export interface VaultProfile {
  id: string;
  title: string;
  fullName: string;
  email: string;
  phone?: string;
  address?: string;
}

export interface VaultData {
  logins: VaultLogin[];
  profiles: VaultProfile[];
}

// ── Encryption Core ──

async function getSalt(): Promise<Uint8Array> {
  const existing = await chrome.storage.local.get(VAULT_SALT_KEY);
  if (existing[VAULT_SALT_KEY]) {
    // Convert base64 back to Uint8Array
    const binaryString = atob(existing[VAULT_SALT_KEY]);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
  
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const base64 = btoa(String.fromCharCode(...salt));
  await chrome.storage.local.set({ [VAULT_SALT_KEY]: base64 });
  return salt;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );
  
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as any,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ── Operations ──

export async function isVaultSetup(): Promise<boolean> {
  const existing = await chrome.storage.local.get(VAULT_STORAGE_KEY);
  return !!existing[VAULT_STORAGE_KEY];
}

export async function unlockVault(password: string): Promise<VaultData> {
  const existing = await chrome.storage.local.get(VAULT_STORAGE_KEY);
  if (!existing[VAULT_STORAGE_KEY]) {
    // Return empty if not setup yet
    return { logins: [], profiles: [] };
  }

  const encryptedDataRaw = existing[VAULT_STORAGE_KEY] as string;
  const rawBytes = Uint8Array.from(atob(encryptedDataRaw), c => c.charCodeAt(0));
  
  const iv = rawBytes.slice(0, 12);
  const data = rawBytes.slice(12);
  
  const salt = await getSalt();
  const key = await deriveKey(password, salt);
  
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      data
    );
    const text = new TextDecoder().decode(decrypted);
    return JSON.parse(text) as VaultData;
  } catch (e) {
    throw new Error('Invalid master password or corrupted vault.');
  }
}

export async function saveVault(password: string, data: VaultData): Promise<void> {
  const salt = await getSalt();
  const key = await deriveKey(password, salt);
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  
  // Combine IV + Data
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);
  
  const base64 = btoa(String.fromCharCode(...combined));
  await chrome.storage.local.set({ [VAULT_STORAGE_KEY]: base64 });
}

export async function destroyVault(): Promise<void> {
  await chrome.storage.local.remove([VAULT_STORAGE_KEY, VAULT_SALT_KEY]);
}
