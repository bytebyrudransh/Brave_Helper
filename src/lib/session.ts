import type { PageSnapshot } from '../store';

const SAVED_PAGES_KEY = 'savedPages';
const MAX_SAVED_PAGES = 25;

export interface SavedPageRecord extends PageSnapshot {
  id: string;
  savedAt: number;
}

export async function saveCurrentPage(page: PageSnapshot): Promise<SavedPageRecord> {
  const existing = await chrome.storage.local.get(SAVED_PAGES_KEY);
  const savedPages = Array.isArray(existing[SAVED_PAGES_KEY])
    ? (existing[SAVED_PAGES_KEY] as SavedPageRecord[])
    : [];

  const record: SavedPageRecord = {
    ...page,
    id: crypto.randomUUID(),
    savedAt: Date.now(),
  };

  const next = [record, ...savedPages].slice(0, MAX_SAVED_PAGES);
  await chrome.storage.local.set({ [SAVED_PAGES_KEY]: next });
  return record;
}

export async function captureVisibleScreenshot(): Promise<string> {
  return chrome.tabs.captureVisibleTab({ format: 'png' });
}
