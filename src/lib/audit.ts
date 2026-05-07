/**
 * Append-only local audit log for v3.0.
 *
 * Every privacy-relevant action writes here:
 *   - mode transitions
 *   - vault unlock / lock
 *   - outbound web requests (search)
 *   - page reads
 *   - screenshots
 *   - vault-backed autofills
 *
 * The user can review this in the Audit tab. Entries are never edited,
 * only purged after a retention window (default 30 days).
 *
 * Storage: chrome.storage.local under a single key. Bounded at MAX_ENTRIES
 * to prevent unbounded growth — oldest entries roll off first.
 */

const AUDIT_KEY = 'auditEvents';
const MAX_ENTRIES = 2000;
const DEFAULT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export type AuditEventType =
  | 'mode_transition'
  | 'mode_switched'
  | 'vault_unlock'
  | 'vault_lock'
  | 'outbound_request'
  | 'page_read'
  | 'screenshot_captured'
  | 'autofill_executed'
  | 'memory_recall'
  | 'model_switched'
  | 'auto_routed';

export interface AuditEvent {
  id: string;
  timestamp: number;
  type: AuditEventType;
  mode: 'research' | 'autofill';
  /** Short human-readable summary. Shown in the audit UI. */
  summary: string;
  /** Optional structured payload (URL, query, model name, etc.). Kept JSON-safe. */
  details?: Record<string, string | number | boolean>;
}

async function readAll(): Promise<AuditEvent[]> {
  const raw = await chrome.storage.local.get(AUDIT_KEY);
  return Array.isArray(raw[AUDIT_KEY]) ? (raw[AUDIT_KEY] as AuditEvent[]) : [];
}

async function writeAll(events: AuditEvent[]): Promise<void> {
  await chrome.storage.local.set({ [AUDIT_KEY]: events });
}

/**
 * Append a new audit event. Cheap, fire-and-forget — callers should not
 * await this in hot paths. If chrome.storage is unavailable (during tests),
 * silently drops.
 */
export async function logAudit(input: Omit<AuditEvent, 'id' | 'timestamp'>): Promise<void> {
  try {
    const event: AuditEvent = {
      ...input,
      id: crypto.randomUUID(),
      timestamp: Date.now(),
    };
    const existing = await readAll();
    const next = [event, ...existing].slice(0, MAX_ENTRIES);
    await writeAll(next);
  } catch {
    // never let audit logging break a real action
  }
}

export async function listAudit(filter?: {
  type?: AuditEventType;
  sinceMs?: number;
}): Promise<AuditEvent[]> {
  const all = await readAll();
  return all.filter((e) => {
    if (filter?.type && e.type !== filter.type) return false;
    if (filter?.sinceMs && Date.now() - e.timestamp > filter.sinceMs) return false;
    return true;
  });
}

/** Drop entries older than the retention window. Call on startup. */
export async function pruneAudit(retentionMs: number = DEFAULT_RETENTION_MS): Promise<void> {
  const all = await readAll();
  const cutoff = Date.now() - retentionMs;
  const kept = all.filter((e) => e.timestamp >= cutoff);
  if (kept.length !== all.length) await writeAll(kept);
}

export async function clearAudit(): Promise<void> {
  await writeAll([]);
}
