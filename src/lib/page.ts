import type { PageSnapshot } from '../store';

export type PageMessage =
  | { type: 'getPageSnapshot' }
  | { type: 'extractForms' }
  | { type: 'fillForm'; values: Record<string, string> }
  | { type: 'highlight'; selector: string }
  | { type: 'clearHighlight' };

export interface ExtractedField {
  selector: string;
  type: string;
  name: string;
  label: string;
  isVisible: boolean;
}

export interface ExtractedForm {
  id: string; // generated ID or index
  action: string;
  fields: ExtractedField[];
}

export interface PageSnapshotResponse {
  ok: true;
  snapshot: PageSnapshot;
}

export interface PageFormResponse {
  ok: true;
  forms: ExtractedForm[];
}

export interface PageErrorResponse {
  ok: false;
  error: string;
}

export type PageResponse = PageSnapshotResponse | PageFormResponse | PageErrorResponse;


export async function requestActiveTabSnapshot(): Promise<PageSnapshot> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  const res = (await chrome.tabs.sendMessage(tab.id, {
    type: 'getPageSnapshot',
  } satisfies PageMessage)) as PageResponse | undefined;
  if (!res) throw new Error('Content script did not respond');
  if (!res.ok) throw new Error(res.error);
  if (!('snapshot' in res)) throw new Error('Unexpected response type');
  return res.snapshot;
}

export async function requestFormExtraction(): Promise<ExtractedForm[]> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  const res = (await chrome.tabs.sendMessage(tab.id, {
    type: 'extractForms',
  } satisfies PageMessage)) as PageResponse | undefined;
  if (!res) throw new Error('Content script did not respond');
  if (!res.ok) throw new Error(res.error);
  if (!('forms' in res)) throw new Error('Unexpected response type');
  return res.forms;
}

export async function requestFormFill(values: Record<string, string>): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) throw new Error('No active tab');
  const res = (await chrome.tabs.sendMessage(tab.id, {
    type: 'fillForm',
    values,
  } satisfies PageMessage)) as PageResponse | undefined;
  if (!res) throw new Error('Content script did not respond');
  if (!res.ok) throw new Error(res.error);
}
