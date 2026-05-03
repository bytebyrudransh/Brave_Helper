import {
  MAX_LINKS,
  MAX_PAGE_TEXT,
  type PageMessage,
  type PageResponse,
  type ExtractedForm,
  type ExtractedField
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

function getUniqueSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;
  if (el.getAttribute('name')) return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.getAttribute('name')!)}"]`;
  let path = '';
  let current: Element | null = el;
  while (current && current.tagName !== 'HTML') {
    let nth = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === current.tagName) nth++;
      sibling = sibling.previousElementSibling;
    }
    path = `${current.tagName.toLowerCase()}:nth-of-type(${nth})` + (path ? ` > ${path}` : '');
    current = current.parentElement;
  }
  return path;
}

function extractFieldData(el: Element): ExtractedField {
  const input = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  let labelText = '';
  
  if (input.getAttribute('aria-label')) {
    labelText = input.getAttribute('aria-label')!;
  } else if (input.closest('label')) {
    labelText = (input.closest('label')!.textContent || '').trim();
  } else if (input.id) {
    const labelEl = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    if (labelEl) labelText = (labelEl.textContent || '').trim();
  }
  
  if (!labelText) {
    labelText = input.getAttribute('placeholder') || input.name || input.id || 'Unknown Field';
  }
  
  labelText = labelText.replace(/\s+/g, ' ').trim().slice(0, 100);
  
  const isVisible = !!(input.offsetWidth || input.offsetHeight || input.getClientRects().length);
  
  return {
    selector: getUniqueSelector(input),
    type: input.tagName.toLowerCase() === 'input' ? (input as HTMLInputElement).type : input.tagName.toLowerCase(),
    name: input.name || input.id || '',
    label: labelText,
    isVisible
  };
}

function extractForms(): ExtractedForm[] {
  const forms: ExtractedForm[] = [];
  const formElements = document.querySelectorAll('form');
  const processedInputs = new Set<Element>();
  
  formElements.forEach((formEl, idx) => {
    const fields: ExtractedField[] = [];
    const inputs = formEl.querySelectorAll('input:not([type="hidden"]), select, textarea');
    inputs.forEach(input => {
      processedInputs.add(input);
      fields.push(extractFieldData(input));
    });
    
    if (fields.length > 0) {
      forms.push({
        id: formEl.id || `form-${idx}`,
        action: formEl.getAttribute('action') || '',
        fields
      });
    }
  });
  
  const allInputs = document.querySelectorAll('input:not([type="hidden"]), select, textarea');
  const orphanFields: ExtractedField[] = [];
  allInputs.forEach(input => {
    if (!processedInputs.has(input)) {
      orphanFields.push(extractFieldData(input));
    }
  });
  
  if (orphanFields.length > 0) {
    forms.push({
      id: 'orphan-inputs',
      action: '',
      fields: orphanFields
    });
  }
  
  return forms;
}

chrome.runtime.onMessage.addListener(
  (msg: PageMessage, _sender, sendResponse: (res: PageResponse) => void) => {
    try {
      if (msg?.type === 'getPageSnapshot') {
        sendResponse({ ok: true, snapshot: captureSnapshot() });
        return false;
      }
      if (msg?.type === 'extractForms') {
        sendResponse({ ok: true, forms: extractForms() });
        return false;
      }
      if (msg?.type === 'fillForm') {
        const values = msg.values;
        for (const [selector, val] of Object.entries(values)) {
          const el = document.querySelector(selector) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
          if (el) {
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
        sendResponse({ ok: true, snapshot: captureSnapshot() }); // return a dummy snapshot/response to satisfy PageResponse
        return false;
      }
    } catch (err) {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      return false;
    }
    return false;
  }
);
