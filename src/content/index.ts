import {
  MAX_LINKS,
  MAX_PAGE_TEXT,
  type PageMessage,
  type PageResponse,
} from '../lib/page';
import type { PageSnapshot } from '../store';

function captureSnapshot(): PageSnapshot {
  const text = (document.body?.innerText ?? '').slice(0, MAX_PAGE_TEXT);
  const links: PageSnapshot['links'] = [];
  const seen = new Set<string>();
  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    const href = (a as HTMLAnchorElement).href;
    if (!href || seen.has(href)) continue;
    seen.add(href);
    const label = (a.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
    links.push({ href, text: label });
    if (links.length >= MAX_LINKS) break;
  }
  return {
    url: location.href,
    title: document.title,
    text,
    links,
    capturedAt: Date.now(),
  };
}

chrome.runtime.onMessage.addListener(
  (msg: PageMessage, _sender, sendResponse: (res: PageResponse) => void) => {
    try {
      if (msg?.type === 'getPageSnapshot') {
        sendResponse({ ok: true, snapshot: captureSnapshot() });
        return false;
      }
    } catch (err) {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      return false;
    }
    return false;
  }
);
