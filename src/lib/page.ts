import type { PageSnapshot } from '../store';

export type PageMessage =
  | { type: 'getPageSnapshot' }
  | { type: 'highlight'; selector: string }
  | { type: 'clearHighlight' };

export interface PageSnapshotResponse {
  ok: true;
  snapshot: PageSnapshot;
}

export interface PageErrorResponse {
  ok: false;
  error: string;
}

export type PageResponse = PageSnapshotResponse | PageErrorResponse;

export const MAX_PAGE_TEXT = 20_000;
export const MAX_LINKS = 200;

export async function requestActiveTabSnapshot(): Promise<PageSnapshot> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  const res = (await chrome.tabs.sendMessage(tab.id, {
    type: 'getPageSnapshot',
  } satisfies PageMessage)) as PageResponse | undefined;
  if (!res) throw new Error('Content script did not respond');
  if (!res.ok) throw new Error(res.error);
  return res.snapshot;
}
