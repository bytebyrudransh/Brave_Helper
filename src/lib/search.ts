/**
 * Web search provider for v3.0 Research mode.
 *
 * Architectural commitment: outbound HTTP from this module is GET-only.
 * No POST, no body payloads, no user data leaving the device beyond the
 * search query the user typed (which is already going to the search engine
 * by definition).
 *
 * Provider: DuckDuckGo HTML endpoint. No API key, no tracking cookies.
 * Response is parsed locally; no third-party JS runs.
 */

import { safeFetch } from './http';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const DDG_HTML_URL = 'https://html.duckduckgo.com/html/';
const MAX_RESULTS = 5;
const MAX_RESPONSE_BYTES = 200 * 1024; // 200KB cap per v3.0 plan

/**
 * Run a web search and return the top results.
 * Throws if the network is unreachable or the response exceeds size cap.
 */
export async function searchWeb(query: string): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const url = `${DDG_HTML_URL}?q=${encodeURIComponent(trimmed)}`;
  const html = await safeFetch(url, MAX_RESPONSE_BYTES);
  return parseDdgResults(html).slice(0, MAX_RESULTS);
}

/**
 * Parse DuckDuckGo HTML results page. We use a lightweight regex pass instead
 * of a full HTML parser — DDG's result markup is stable enough and we want
 * to avoid pulling jsdom or trusting page scripts.
 *
 * Each result block looks roughly like:
 *   <a class="result__a" href="..."> Title </a>
 *   <a class="result__snippet" ...> Snippet text </a>
 */
function parseDdgResults(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  const blockRegex =
    /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(html)) !== null) {
    const rawUrl = match[1];
    const title = stripTags(match[2]).trim();
    const snippet = stripTags(match[3]).trim();
    const url = unwrapDdgUrl(rawUrl);
    if (url && title) {
      results.push({ title, url, snippet });
    }
  }

  return results;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * DDG wraps result URLs in a redirect like /l/?uddg=<encoded-url>.
 * Unwrap it so we hand the model the real destination.
 */
function unwrapDdgUrl(raw: string): string {
  try {
    const u = raw.startsWith('//') ? `https:${raw}` : raw;
    const parsed = new URL(u, 'https://duckduckgo.com');
    const wrapped = parsed.searchParams.get('uddg');
    if (wrapped) return decodeURIComponent(wrapped);
    return parsed.toString();
  } catch {
    return raw;
  }
}

/** Format search results as a markdown context block to feed into the model. */
export function formatSearchContext(query: string, results: SearchResult[]): string {
  if (results.length === 0) {
    return `# Web search\nQuery: "${query}"\n\nNo results found.`;
  }
  const lines = results.map(
    (r, i) => `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.snippet}`
  );
  return `# Web search results\nQuery: "${query}"\n\n${lines.join('\n\n')}`;
}
