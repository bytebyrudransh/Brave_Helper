import { useEffect, useRef, useState } from 'react';
import { 
  Send, 
  RefreshCw, 
  Globe, 
  AlertCircle, 
  Loader2, 
  Cpu,
  ChevronDown,
  Sparkles,
  Command,
  ShieldCheck,
  StopCircle,
  History,
  MessageSquare,
  FileText,
  Activity,
  Paperclip,
  Power,
} from 'lucide-react';
import { useAppStore } from '../store';
import { deriveMode, MODE_DESCRIPTIONS, MODE_LABELS } from '../lib/mode';
import { listOllamaModels, streamChat, unloadOllamaModel, type ChatTurn } from '../lib/ollama';
import { streamVision } from '../lib/vision';
import { searchWeb, formatSearchContext } from '../lib/search';
import { capabilitiesFor } from '../lib/mode';
import { indexMemory, recallMemory } from '../lib/vectorstore';
import { logAudit, pruneAudit } from '../lib/audit';
import { requestActiveTabSnapshot, requestFormExtraction, requestFormFill } from '../lib/page';
import { PROJECT_MODEL_MAP, PROJECT_MODELS } from '../config/models';
import { captureVisibleScreenshot, saveCurrentPage } from '../lib/session';
import { 
  saveChatSession, 
  saveLastSessionId,
  saveSelectedModel,
  getSelectedModel
} from '../lib/history';
import { HistoryView } from './HistoryView';
import { FormFillView } from './FormFillView';
import { VaultView } from './VaultView';
import { AuditView } from './AuditView';
import { loadMemoryFacts, formatMemoryPrompt, type MemoryFact } from '../lib/memory';

/**
 * Approx token budget for page text we ship to the model.
 * 4 chars/token is the rough English heuristic. 6k tokens → 24k chars.
 * Anything past this is truncated with a "[truncated]" marker so the model
 * knows it didn't see the whole page.
 */
const PAGE_TEXT_CHAR_CAP = 24_000;
const PAGE_LINKS_CAP = 50;

function truncatePageText(text: string): { text: string; truncated: boolean } {
  if (text.length <= PAGE_TEXT_CHAR_CAP) return { text, truncated: false };
  return { text: text.slice(0, PAGE_TEXT_CHAR_CAP), truncated: true };
}

function buildPageContext(): string | null {
  const { page, pageScopeEnabled, extractedForms, vaultData } = useAppStore.getState();
  if (!page || !pageScopeEnabled) return null;

  const { text: pageText, truncated } = truncatePageText(page.text);
  const links = page.links.slice(0, PAGE_LINKS_CAP);
  const linkList = links
    .map((l) => `- ${l.text || '(no text)'} → ${l.href}`)
    .join('\n');
  const linksTruncated = page.links.length > PAGE_LINKS_CAP;

  let ctx = `# Current page
Title: ${page.title}
URL: ${page.url}

## Visible text${truncated ? ' (truncated)' : ''}
${pageText}${truncated ? '\n\n[truncated — page was longer than the chat context budget]' : ''}

## Links${linksTruncated ? ` (top ${PAGE_LINKS_CAP} of ${page.links.length})` : ''}
${linkList}`;

  // Inject form fields so AI can see what's on the page (visible AND hidden)
  if (extractedForms.length > 0) {
    ctx += '\n\n## Form Fields on This Page\n';
    ctx += 'Below are ALL form fields detected on this page (including hidden). Use their EXACT selectors when autofilling.\n\n';
    for (const form of extractedForms) {
      ctx += `### ${form.id === 'orphan-inputs' ? 'Standalone Inputs' : `Form: ${form.id}`}\n`;
      for (const field of form.fields) {
        ctx += `- Selector: \`${field.selector}\` | Type: ${field.type} | Label: "${field.label}" | Name: "${field.name}" | Visible: ${field.isVisible}\n`;
      }
    }
  }

  // Inject vault data so AI can match credentials to fields
  if (vaultData) {
    ctx += '\n\n## User Vault Data (UNLOCKED — Full Access Granted)\n';
    ctx += 'The user has unlocked their vault. You have FULL permission to use this data. No confirmation needed.\n\n';
    
    if (vaultData.logins.length > 0) {
      ctx += '### Saved Logins\n';
      for (const login of vaultData.logins) {
        ctx += `- URL: ${login.url} | Username: ${login.username} | Password: ${login.password || '(none)'}${login.notes ? ` | Notes: ${login.notes}` : ''}\n`;
      }
    }
    
    if (vaultData.profiles.length > 0) {
      ctx += '\n### Saved Profiles\n';
      for (const profile of vaultData.profiles) {
        ctx += `- ${profile.title}: Name="${profile.fullName}" Email="${profile.email}"${profile.phone ? ` Phone="${profile.phone}"` : ''}${profile.address ? ` Address="${profile.address}"` : ''}\n`;
      }
    }
  }

  return ctx;
}

export default function SidePanel() {
  const {
    models,
    selectedModel,
    setModels,
    setSelectedModel,
    ollamaReachable,
    setOllamaReachable,
    page,
    pageScopeEnabled,
    setPage,
    setPageScopeEnabled,
    messages,
    appendMessage,
    appendToMessage,
    finishStreaming,
    isStreaming,
    setIsStreaming,
    clearMessages,
    activeTab,
    setActiveTab,
    setCurrentSessionId,
    vaultData,
    setVaultData,
  } = useAppStore();

  const appMode = deriveMode(vaultData !== null);

  const [input, setInput] = useState('');
  const [pageError, setPageError] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [activeTabUrl, setActiveTabUrl] = useState<string | null>(null);
  const [ollamaError, setOllamaError] = useState<string | null>(null);
  const [memoryFacts, setMemoryFacts] = useState<MemoryFact[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const isStale =
    page !== null && activeTabUrl !== null && activeTabUrl !== page.url;
  const selectedModelConfig = selectedModel
    ? PROJECT_MODEL_MAP.get(selectedModel) ?? null
    : null;

  useEffect(() => {
    async function init() {
      void pruneAudit();
      const savedModel = await getSelectedModel();
      await refreshModels(savedModel);
      await capturePage();
      // Load memory facts for system prompt injection
      const facts = await loadMemoryFacts();
      setMemoryFacts(facts);
      // Always start fresh — previous sessions are accessible from the History tab
    }
    void init();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function readActiveTab() {
      try {
        const [tab] = await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true,
        });
        if (!cancelled) setActiveTabUrl(tab?.url ?? null);
      } catch {
        if (!cancelled) setActiveTabUrl(null);
      }
    }
    void readActiveTab();

    const onActivated = () => void readActiveTab();
    const onUpdated = (
      _id: number,
      changeInfo: chrome.tabs.TabChangeInfo,
      tab: chrome.tabs.Tab
    ) => {
      if (tab.active && (changeInfo.url || changeInfo.status === 'complete')) {
        void readActiveTab();
      }
    };
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      cancelled = true;
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [messages]);

  // Audit vault unlock/lock and the implicit mode transition that comes with it.
  // This runs whenever vaultData flips between null and non-null.
  const prevVaultRef = useRef<boolean>(vaultData !== null);
  useEffect(() => {
    const isUnlocked = vaultData !== null;
    if (isUnlocked === prevVaultRef.current) return;
    prevVaultRef.current = isUnlocked;
    const newMode = isUnlocked ? 'autofill' : 'research';
    void logAudit({
      type: isUnlocked ? 'vault_unlock' : 'vault_lock',
      mode: newMode,
      summary: isUnlocked ? 'Vault unlocked — entered Autofill mode' : 'Vault locked — back to Research mode',
    });
    void logAudit({
      type: 'mode_transition',
      mode: newMode,
      summary: `Mode → ${newMode}`,
      details: { from: isUnlocked ? 'research' : 'autofill', to: newMode },
    });
  }, [vaultData]);

  async function refreshModels(preferredModelName?: string | null) {
    try {
      setOllamaError(null);
      const list = await listOllamaModels();
      setModels(list);
      setOllamaReachable(true);
      const availableConfiguredModels = list.filter((model) =>
        PROJECT_MODEL_MAP.has(model.name)
      );
      
      const { selectedModel: currentSelected } = useAppStore.getState();
      const targetModel = preferredModelName || currentSelected;
      
      if (availableConfiguredModels.length > 0) {
        if (!targetModel || !availableConfiguredModels.some(m => m.name === targetModel)) {
          setSelectedModel(availableConfiguredModels[0].name);
        } else if (preferredModelName) {
           setSelectedModel(preferredModelName);
        }
      }
    } catch (err) {
      setOllamaReachable(false);
      let errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('Failed to fetch')) {
        errMsg = "Ollama isn't reachable at localhost:11434.";
      } else if (errMsg.includes('403')) {
        errMsg = "Ollama rejected extension origin. Set OLLAMA_ORIGINS=chrome-extension://<id> and restart ollama.";
      }
      setOllamaError(errMsg);
    }
  }

  async function capturePage() {
    setPageLoading(true);
    setPageError(null);
    try {
      const snap = await requestActiveTabSnapshot();
      setPage(snap);
      // Auto-extract ALL forms (visible AND hidden) — gives AI full awareness
      try {
        const forms = await requestFormExtraction();
        useAppStore.getState().setExtractedForms(forms.filter(f => f.fields.length > 0));
      } catch {
        // Forms extraction is best-effort; don't block page capture
        useAppStore.getState().setExtractedForms([]);
      }
    } catch (err) {
      setPage(null);
      let errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('Receiving end does not exist')) {
        errMsg = "Page hasn't loaded helper yet (refresh, or it's a restricted browser page).";
      }
      setPageError(errMsg);
    } finally {
      setPageLoading(false);
    }
  }

  /**
   * Build the turn list sent to the model.
   *
   * Order matters for small models: they pay most attention to the very start
   * and the very end of the prompt ("lost in the middle"). So we put the page
   * context RIGHT BEFORE the user's most recent message instead of burying it
   * after the system prompt — this keeps the page fresh next to the question.
   */
  function buildTurnsForRequest(assistantId: string): ChatTurn[] {
    const basePrompt = selectedModelConfig?.systemPrompt ?? PROJECT_MODELS[0].systemPrompt;
    const memoryBlock = formatMemoryPrompt(memoryFacts);
    const systemContent = memoryBlock ? `${basePrompt}\n\n${memoryBlock}` : basePrompt;

    const turns: ChatTurn[] = [
      {
        role: 'system',
        content: systemContent,
      },
    ];

    const allMessages = useAppStore.getState().messages.filter(
      (m) => m.id !== assistantId
    );
    const lastIdx = allMessages.length - 1;
    const last = lastIdx >= 0 ? allMessages[lastIdx] : null;
    const earlier = lastIdx >= 0 ? allMessages.slice(0, lastIdx) : allMessages;

    for (const m of earlier) {
      turns.push({ role: m.role, content: m.content });
    }

    const ctx = buildPageContext();
    if (ctx) turns.push({ role: 'system', content: ctx });

    if (last) turns.push({ role: last.role, content: last.content });

    return turns;
  }

  async function send() {
    const content = input.trim();
    if (!content || isStreaming || !selectedModel) return;
    setInput('');

    if (content.startsWith('/')) {
      await runCommand(content);
      return;
    }

    const userMsg = { id: crypto.randomUUID(), role: 'user' as const, content };
    appendMessage(userMsg);

    const assistantId = crypto.randomUUID();
    appendMessage({ id: assistantId, role: 'assistant', content: '', streaming: true });

    const turns = buildTurnsForRequest(assistantId);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsStreaming(true);
    try {
      for await (const chunk of streamChat({
        model: selectedModel,
        messages: turns,
        numCtx: selectedModelConfig?.numCtx,
        signal: ctrl.signal,
      })) {
        appendToMessage(assistantId, chunk);
      }
    } catch (err) {
      appendToMessage(
        assistantId,
        `\n\n[error: ${err instanceof Error ? err.message : String(err)}]`
      );
    } finally {
      finishStreaming(assistantId);
      setIsStreaming(false);
      abortRef.current = null;
      
      // Auto-execute any autofill commands in the AI response
      const finalMessages = useAppStore.getState().messages;
      const lastMsg = finalMessages.find(m => m.id === assistantId);
      if (lastMsg?.content) {
        await executeAutofillCommands(lastMsg.content);
      }
      
      // Save session
      const { messages, page, currentSessionId: sid } = useAppStore.getState();
      const session = await saveChatSession(messages, page, sid ?? undefined);
      if (session.id !== sid) {
        setCurrentSessionId(session.id);
        await saveLastSessionId(session.id);
      }
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  /** Emergency kill — abort everything, lock vault, clear chat, return to safe state. */
  function killAll() {
    // 1. Abort any running inference
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    // 2. Lock vault immediately
    setVaultData(null, null);
    // 3. Clear chat
    clearMessages();
    // 4. Reset to chat tab
    setActiveTab('chat');
    // 5. Clear input
    setInput('');
  }

  /** Handle image file upload for vision */
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleImageUpload(file: File) {
    if (!selectedModel || !ollamaReachable) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result as string;

      // Show user message with filename
      const userMsg = {
        id: crypto.randomUUID(),
        role: 'user' as const,
        content: `[Uploaded: ${file.name}] Describe this image.`,
      };
      appendMessage(userMsg);

      const assistantId = crypto.randomUUID();
      appendMessage({ id: assistantId, role: 'assistant', content: '', streaming: true });

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setIsStreaming(true);

      try {
        for await (const chunk of streamVision({
          prompt: 'Describe this image in detail. What do you see?',
          image: base64,
          signal: ctrl.signal,
        })) {
          appendToMessage(assistantId, chunk);
        }
      } catch (err) {
        appendToMessage(
          assistantId,
          `\n\n[error: ${err instanceof Error ? err.message : String(err)}]`
        );
      } finally {
        finishStreaming(assistantId);
        setIsStreaming(false);
        abortRef.current = null;
      }
    };
    reader.readAsDataURL(file);
  }

  function appendAssistantNote(content: string) {
    appendMessage({
      id: crypto.randomUUID(),
      role: 'assistant',
      content,
    });
  }

  async function askWithPreset(content: string) {
    setInput(content);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const userMsg = { id: crypto.randomUUID(), role: 'user' as const, content };
    appendMessage(userMsg);

    const assistantId = crypto.randomUUID();
    appendMessage({ id: assistantId, role: 'assistant', content: '', streaming: true });

    const turns = buildTurnsForRequest(assistantId);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsStreaming(true);
    setInput('');
    try {
      for await (const chunk of streamChat({
        model: selectedModel!,
        messages: turns,
        numCtx: selectedModelConfig?.numCtx,
        signal: ctrl.signal,
      })) {
        appendToMessage(assistantId, chunk);
      }
    } catch (err) {
      appendToMessage(
        assistantId,
        `\n\n[error: ${err instanceof Error ? err.message : String(err)}]`
      );
    } finally {
      finishStreaming(assistantId);
      setIsStreaming(false);
      abortRef.current = null;
      
      // Auto-execute any autofill commands in the AI response
      const finalMessages = useAppStore.getState().messages;
      const lastMsg = finalMessages.find(m => m.id === assistantId);
      if (lastMsg?.content) {
        await executeAutofillCommands(lastMsg.content);
      }
      
      // Save session
      const { messages, page, currentSessionId: sid } = useAppStore.getState();
      const session = await saveChatSession(messages, page, sid ?? undefined);
      if (session.id !== sid) {
        setCurrentSessionId(session.id);
        await saveLastSessionId(session.id);
      }
    }
  }

  async function runCommand(raw: string) {
    const trimmed = raw.trim();
    const spaceIdx = trimmed.indexOf(' ');
    const head = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
    const arg = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();

    if (head === '/clear') {
      clearMessages();
      return;
    }

    if (head === '/start') {
      clearMessages();
      await capturePage();
      appendAssistantNote(
        'Fresh session started. Page snapshot synced and ready.'
      );
      return;
    }

    if (head === '/summary' || head === '/summery') {
      await askWithPreset(
        'Summarize this page in concise bullets. Include the main topic, key points, and anything actionable.'
      );
      return;
    }

    if (head === '/save') {
      const currentPage = useAppStore.getState().page;
      if (!currentPage) {
        appendAssistantNote('No page snapshot is loaded yet. Press Sync first.');
        return;
      }
      const saved = await saveCurrentPage(currentPage);
      appendAssistantNote(`Saved current page locally: ${saved.title || saved.url}`);
      // Index this page into the memory store so `/recall` can find it later.
      // Fire-and-forget — embedding failures (e.g. Ollama unreachable) are silent.
      void indexMemory({
        kind: 'page',
        title: currentPage.title || currentPage.url,
        body: `${currentPage.title}\n\n${currentPage.text}`,
        url: currentPage.url,
      });
      void logAudit({
        type: 'page_read',
        mode: vaultData ? 'autofill' : 'research',
        summary: `Saved page: ${currentPage.title || currentPage.url}`,
        details: { url: currentPage.url, chars: currentPage.text.length },
      });
      return;
    }

    if (head === '/takess') {
      try {
        const dataUrl = await captureVisibleScreenshot();
        // Download to user's filesystem
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `screenshot_${timestamp}.png`;
        await chrome.downloads.download({
          url: dataUrl,
          filename,
          saveAs: false,
        });
        appendAssistantNote(`Screenshot saved to Downloads as \`${filename}\``);
        void logAudit({
          type: 'screenshot_captured',
          mode: vaultData ? 'autofill' : 'research',
          summary: `Screenshot saved: ${filename}`,
        });
      } catch (err) {
        appendAssistantNote(
          `Screenshot failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      return;
    }

    if (head === '/ask') {
      await runVisionAsk(arg);
      return;
    }

    if (head === '/search') {
      await runWebSearch(arg);
      return;
    }

    if (head === '/recall') {
      await runMemoryRecall(arg);
      return;
    }

    if (head === '/fast' || head === '/balanced' || head === '/smart' || head === '/code') {
      const tier = head.slice(1) as 'fast' | 'balanced' | 'smart' | 'code';
      const target = PROJECT_MODELS.find((m) => m.tier === tier);
      if (!target) {
        appendAssistantNote(`No model configured for tier "${tier}".`);
        return;
      }
      const installed = useAppStore.getState().models;
      if (!installed.some((m) => m.name === target.name)) {
        appendAssistantNote(`Model ${target.name} is not installed in Ollama.`);
        return;
      }
      const prev = selectedModel;
      setSelectedModel(target.name);
      void saveSelectedModel(target.name);
      if (prev && prev !== target.name) {
        void unloadOllamaModel(prev).catch(() => {});
      }
      void logAudit({
        type: 'model_switched',
        mode: vaultData ? 'autofill' : 'research',
        summary: `Switched to ${target.label}`,
        details: { from: prev ?? 'none', to: target.name, tier },
      });
      appendAssistantNote(`Switched to ${target.label}.`);
      return;
    }

    appendAssistantNote(
      'Unknown command. Try /start, /clear, /summary, /save, /takeSS, /ask <prompt>, /search <query>, /recall <query>, or /fast | /balanced | /smart | /code.'
    );
  }

  /**
   * Memory recall — embed the query, find the top-K most similar saved pages
   * or chat summaries, and ask the chat model to synthesize an answer using
   * those snippets as context.
   */
  async function runMemoryRecall(query: string) {
    if (!query) {
      appendAssistantNote('Usage: /recall <query>');
      return;
    }
    if (!selectedModel) {
      appendAssistantNote('No model selected.');
      return;
    }

    const mode = vaultData ? 'autofill' : 'research';
    void logAudit({
      type: 'memory_recall',
      mode,
      summary: `Memory recall: "${query.slice(0, 80)}"`,
      details: { query: query.slice(0, 200) },
    });

    appendMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: `/recall ${query}`,
    });

    const assistantId = crypto.randomUUID();
    appendMessage({ id: assistantId, role: 'assistant', content: '', streaming: true });

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsStreaming(true);

    try {
      const hits = await recallMemory(query, 5);
      if (hits.length === 0) {
        appendToMessage(
          assistantId,
          'No relevant memories found. Save pages with `/save` to build up the index.'
        );
        return;
      }

      const memoryContext =
        '# Local memory recall\n' +
        `Query: "${query}"\n\n` +
        hits
          .map((h, i) => {
            const head = `${i + 1}. **${h.record.title}** (${h.record.kind}, score ${h.score.toFixed(2)})`;
            const url = h.record.url ? `\n   ${h.record.url}` : '';
            const body = `\n   ${h.record.body.slice(0, 600).replace(/\s+/g, ' ')}`;
            return head + url + body;
          })
          .join('\n\n');

      const turns: ChatTurn[] = [
        {
          role: 'system',
          content: selectedModelConfig?.systemPrompt ?? PROJECT_MODELS[0].systemPrompt,
        },
        { role: 'system', content: memoryContext },
        {
          role: 'user',
          content: `Using the recalled memories above, answer: ${query}. Reference items by title.`,
        },
      ];

      for await (const chunk of streamChat({
        model: selectedModel,
        messages: turns,
        numCtx: selectedModelConfig?.numCtx,
        signal: ctrl.signal,
      })) {
        appendToMessage(assistantId, chunk);
      }
    } catch (err) {
      appendToMessage(
        assistantId,
        `\n\n[recall error: ${err instanceof Error ? err.message : String(err)}]`
      );
    } finally {
      finishStreaming(assistantId);
      setIsStreaming(false);
      abortRef.current = null;
    }
  }

  /**
   * Capture the visible tab and ask the local vision model about it.
   * If no prompt is given, defaults to a generic "describe what you see."
   */
  async function runVisionAsk(prompt: string) {
    const userPrompt = prompt || 'Describe what you see in this screenshot. Be specific.';

    appendMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: `[Screenshot] ${userPrompt}`,
    });

    const assistantId = crypto.randomUUID();
    appendMessage({ id: assistantId, role: 'assistant', content: '', streaming: true });

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsStreaming(true);

    try {
      const dataUrl = await captureVisibleScreenshot();
      for await (const chunk of streamVision({
        prompt: userPrompt,
        image: dataUrl,
        signal: ctrl.signal,
      })) {
        appendToMessage(assistantId, chunk);
      }
    } catch (err) {
      appendToMessage(
        assistantId,
        `\n\n[vision error: ${err instanceof Error ? err.message : String(err)}]`
      );
    } finally {
      finishStreaming(assistantId);
      setIsStreaming(false);
      abortRef.current = null;
    }
  }

  /**
   * Run a DuckDuckGo web search and feed the results to the chat model
   * for synthesis. Refuses if the user is in Autofill mode (vault unlocked)
   * — web access is cut while credentials are reachable.
   */
  async function runWebSearch(query: string) {
    if (!query) {
      appendAssistantNote('Usage: /search <query>');
      return;
    }

    const { vaultData } = useAppStore.getState();
    const caps = capabilitiesFor(vaultData ? 'autofill' : 'research');
    if (!caps.webSearch) {
      appendAssistantNote(
        'Web search is disabled while the vault is unlocked. Lock the vault to use /search.'
      );
      return;
    }

    if (!selectedModel) {
      appendAssistantNote('No model selected.');
      return;
    }

    appendMessage({
      id: crypto.randomUUID(),
      role: 'user',
      content: `/search ${query}`,
    });

    const assistantId = crypto.randomUUID();
    appendMessage({ id: assistantId, role: 'assistant', content: '', streaming: true });

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setIsStreaming(true);

    try {
      const results = await searchWeb(query);
      void logAudit({
        type: 'outbound_request',
        mode: 'research',
        summary: `Web search: "${query.slice(0, 80)}"`,
        details: {
          provider: 'duckduckgo',
          query: query.slice(0, 200),
          results: results.length,
        },
      });
      const searchContext = formatSearchContext(query, results);

      const turns: ChatTurn[] = [
        {
          role: 'system',
          content:
            selectedModelConfig?.systemPrompt ?? PROJECT_MODELS[0].systemPrompt,
        },
        { role: 'system', content: searchContext },
        {
          role: 'user',
          content: `Summarize the search results for: ${query}. Cite the source URLs you use.`,
        },
      ];

      for await (const chunk of streamChat({
        model: selectedModel,
        messages: turns,
        numCtx: selectedModelConfig?.numCtx,
        signal: ctrl.signal,
      })) {
        appendToMessage(assistantId, chunk);
      }
    } catch (err) {
      appendToMessage(
        assistantId,
        `\n\n[search error: ${err instanceof Error ? err.message : String(err)}]`
      );
    } finally {
      finishStreaming(assistantId);
      setIsStreaming(false);
      abortRef.current = null;
    }
  }

  /** Parse AI response for ```autofill blocks and execute them immediately */
  async function executeAutofillCommands(content: string) {
    const autofillRegex = /```autofill\s*\n([\s\S]*?)\n```/g;
    let match: RegExpExecArray | null;
    
    while ((match = autofillRegex.exec(content)) !== null) {
      try {
        const payload = JSON.parse(match[1].trim()) as Record<string, string>;
        const fieldCount = Object.keys(payload).length;
        if (fieldCount > 0) {
          await requestFormFill(payload);
          appendAssistantNote(`✅ Autofilled ${fieldCount} field${fieldCount > 1 ? 's' : ''} on the page.`);
          void logAudit({
            type: 'autofill_executed',
            mode: vaultData ? 'autofill' : 'research',
            summary: `Filled ${fieldCount} field${fieldCount > 1 ? 's' : ''}`,
            details: { fieldCount, vaultUnlocked: vaultData !== null },
          });
        }
      } catch (err) {
        appendAssistantNote(
          `⚠️ Autofill execution failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  return (
    <div className="flex h-full flex-col bg-bg text-sm selection:bg-accent/30">
      {/* Premium Header */}
      <header className="relative z-10 flex flex-col gap-2 border-b border-border/50 bg-bg/80 p-4 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg bg-surface shadow-lg shadow-accent/20 ring-1 ring-accent/30">
              <img
                src={chrome.runtime.getURL('assets/icons/icon-128.png')}
                alt="Brave Helper"
                className="h-full w-full object-cover"
              />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-white">BRAVE HELPER</h1>
              <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-text-muted">
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${ollamaReachable ? 'bg-success animate-pulse' : 'bg-danger'}`} />
                  {ollamaReachable ? 'Local AI Active' : 'AI Offline'}
                </div>
                <span
                  title={MODE_DESCRIPTIONS[appMode]}
                  className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold tracking-tight ${
                    appMode === 'research'
                      ? 'bg-success/15 text-success ring-1 ring-success/30'
                      : 'bg-danger/15 text-danger ring-1 ring-danger/30'
                  }`}
                >
                  {MODE_LABELS[appMode]}
                </span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-1">
            <div className="relative group">
              <select
                value={selectedModel ?? ''}
                onChange={(e) => {
                  const next = e.target.value;
                  const prev = selectedModel;
                  setSelectedModel(next);
                  void saveSelectedModel(next);
                  // Free VRAM/RAM held by the previously selected model.
                  // Fire-and-forget; failures are non-fatal.
                  if (prev && prev !== next) {
                    void unloadOllamaModel(prev).catch(() => {});
                  }
                }}
                className="h-8 appearance-none rounded-lg border border-border bg-surface pl-8 pr-8 text-[11px] font-semibold text-text-secondary outline-none transition-all hover:border-accent hover:text-white"
              >
                {models.length === 0 && <option value="">No Models</option>}
                {models.map((m) => (
                  <option key={m.name} value={m.name}>
                    {(PROJECT_MODEL_MAP.get(m.name)?.label ?? m.name).toUpperCase()}
                  </option>
                ))}
              </select>
              <Cpu className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted group-hover:text-accent transition-colors" />
              <ChevronDown className="absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted pointer-events-none" />
            </div>
            
            <button
              onClick={() => void refreshModels()}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface text-text-secondary transition-all hover:border-accent hover:text-white"
              title="Refresh Models"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isStreaming ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={killAll}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-danger/20 text-danger transition-all hover:bg-danger/40 hover:scale-110 active:scale-95 ring-1 ring-danger/30"
              title="Kill All — Stop inference, lock vault, clear chat"
            >
              <Power className="h-3 w-3" />
            </button>
          </div>
        </div>

        {/* Page Scope Control */}
        <div className={`flex items-center gap-3 rounded-xl border border-white/5 p-2 transition-all ${page ? 'bg-surface/50' : 'bg-danger/10 border-danger/20'}`}>
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-white/5">
            {pageLoading ? <Loader2 className="h-3 w-3 animate-spin text-accent" /> : <Globe className={`h-3 w-3 ${page ? 'text-accent' : 'text-danger'}`} />}
          </div>
          
          <div className="flex min-w-0 flex-1 flex-col">
            {page ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] font-medium text-text-secondary">
                    {page.title || 'Untitled Page'}
                  </span>
                  <div className="flex items-center gap-2">
                    {isStale && <span className="rounded-full bg-warning/20 px-1.5 py-0.5 text-[9px] font-bold text-warning uppercase">Stale</span>}
                    <button onClick={() => void capturePage()} className="text-[10px] font-bold text-accent hover:text-accent-hover uppercase">Sync</button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-1.5 group">
                    <input
                      type="checkbox"
                      checked={pageScopeEnabled}
                      onChange={(e) => setPageScopeEnabled(e.target.checked)}
                      className="h-3 w-3 rounded border-border bg-transparent text-accent focus:ring-0 focus:ring-offset-0 transition-all cursor-pointer"
                    />
                    <span className="text-[10px] font-semibold text-text-muted group-hover:text-text-secondary transition-colors uppercase tracking-tight">Scope Active</span>
                  </label>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-danger">{pageError || 'No connection to page'}</span>
                <button onClick={() => void capturePage()} className="text-[10px] font-bold text-accent uppercase hover:underline">Retry</button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Connection Warning */}
      {!ollamaReachable && (
        <div className="mx-4 mt-4 flex items-start gap-3 rounded-xl border border-danger/20 bg-danger/5 p-3 text-xs text-danger shadow-lg shadow-danger/5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <p className="font-bold uppercase tracking-tight">Ollama Unreachable</p>
            <p className="text-text-secondary leading-relaxed">
              {ollamaError || (
                <>Ensure Ollama is running and <code className="rounded bg-danger/10 px-1 font-mono text-[10px]">OLLAMA_ORIGINS</code> is configured.</>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border/50 px-4 pt-2">
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-bold transition-all ${
            activeTab === 'chat'
              ? 'border-accent text-white'
              : 'border-transparent text-text-muted hover:text-text-secondary'
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          CHAT
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-bold transition-all ${
            activeTab === 'history'
              ? 'border-accent text-white'
              : 'border-transparent text-text-muted hover:text-text-secondary'
          }`}
        >
          <History className="h-3.5 w-3.5" />
          HISTORY
        </button>
        <button
          onClick={() => setActiveTab('vault')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-bold transition-all ${
            activeTab === 'vault'
              ? 'border-accent text-white'
              : 'border-transparent text-text-muted hover:text-text-secondary'
          }`}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          VAULT
        </button>
        <button
          onClick={() => setActiveTab('form-fill')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-bold transition-all ${
            activeTab === 'form-fill'
              ? 'border-accent text-white'
              : 'border-transparent text-text-muted hover:text-text-secondary'
          }`}
        >
          <FileText className="h-3.5 w-3.5" />
          FORMS
        </button>
        <button
          onClick={() => setActiveTab('audit')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-bold transition-all ${
            activeTab === 'audit'
              ? 'border-accent text-white'
              : 'border-transparent text-text-muted hover:text-text-secondary'
          }`}
        >
          <Activity className="h-3.5 w-3.5" />
          AUDIT
        </button>
      </div>

      {/* Main Content Area */}
      {activeTab === 'history' ? (
        <HistoryView />
      ) : activeTab === 'vault' ? (
        <VaultView />
      ) : activeTab === 'form-fill' ? (
        <FormFillView />
      ) : activeTab === 'audit' ? (
        <AuditView />
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 space-y-6 overflow-y-auto p-4 py-8">
            {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center space-y-6 opacity-60">
            <div className="relative">
              <div className="absolute -inset-4 rounded-full bg-accent/20 blur-2xl" />
              <Command className="relative h-12 w-12 text-accent/50" />
            </div>
            <div className="space-y-2 text-center">
              <p className="text-lg font-bold tracking-tight text-white">How can I help?</p>
              <p className="text-xs text-text-muted">Analyzing your current session in real-time.</p>
            </div>
          <div className="grid grid-cols-2 gap-2 max-w-xs">
              {['Summarize Page', 'Extract Links', 'Find Emails', 'Explain Content'].map(item => (
                <button 
                  key={item}
                  onClick={() => setInput(item)}
                  className="rounded-xl border border-border bg-surface/50 p-2.5 text-center text-[10px] font-bold text-text-secondary hover:border-accent hover:text-white transition-all"
                >
                  {item}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap justify-center gap-2 max-w-xs">
              {['/start', '/clear', '/summary', '/takeSS', '/save', '/ask', '/search '].map((item) => (
                <button
                  key={item}
                  onClick={() => setInput(item)}
                  className="rounded-full border border-border bg-surface/40 px-3 py-1.5 text-[10px] font-bold text-text-muted transition-all hover:border-accent hover:text-white"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div className={`flex items-center gap-2 mb-1.5 px-1 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                   {m.role === 'user' ? <Command className="h-3 w-3 text-text-muted" /> : <Sparkles className="h-3 w-3 text-accent" />}
                   <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted">
                     {m.role === 'user'
                       ? 'System User'
                       : (selectedModelConfig?.label.toUpperCase() ?? selectedModel?.toUpperCase() ?? 'Assistant')}
                   </span>
                </div>
                <div
                  className={`relative max-w-[90%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-[13px] leading-relaxed shadow-sm transition-all ${
                    m.role === 'user'
                      ? 'accent-gradient text-white shadow-accent/10 rounded-tr-none'
                      : 'bg-elevated border border-border text-text-primary shadow-black/20 rounded-tl-none'
                  }`}
                >
                  {m.content}
                  {m.streaming && !m.content && (
                    <div className="flex gap-1 py-1">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:0.2s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent [animation-delay:0.4s]" />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="relative p-4 pt-0">
        <div className="absolute -top-12 left-0 right-0 h-12 bg-gradient-to-t from-bg to-transparent pointer-events-none" />
        
        <div className="group relative rounded-2xl border border-border bg-surface/80 p-2 shadow-2xl transition-all hover:border-accent/50 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/20 backdrop-blur-md">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            placeholder={selectedModel ? 'Command local intelligence...' : 'Select a neural engine...'}
            className="w-full resize-none bg-transparent px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none disabled:cursor-not-allowed"
            disabled={!selectedModel || !ollamaReachable}
          />
          
          <div className="flex items-center justify-between border-t border-border/50 px-2 py-1.5 mt-1">
            <div className="flex items-center gap-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleImageUpload(file);
                  e.target.value = '';
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={!ollamaReachable}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted transition-all hover:bg-surface hover:text-accent disabled:opacity-30"
                title="Upload image for vision analysis"
              >
                <Paperclip className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  clearMessages();
                }}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-text-secondary transition-all hover:border-accent hover:text-white"
                title="Clear Chat"
              >
                Clear
              </button>
              {isStreaming ? (
                <button
                  onClick={stop}
                  className="flex h-8 items-center gap-2 rounded-lg bg-danger/10 px-3 text-[10px] font-bold uppercase tracking-wider text-danger transition-all hover:bg-danger/20"
                >
                  <StopCircle className="h-3.5 w-3.5" />
                  Stop
                </button>
              ) : (
                <button
                  onClick={() => void send()}
                  disabled={!selectedModel || !input.trim() || !ollamaReachable}
                  className="flex h-8 w-8 items-center justify-center rounded-lg accent-gradient text-white shadow-lg shadow-accent/20 transition-all hover:scale-105 active:scale-95 disabled:grayscale disabled:opacity-20 disabled:hover:scale-100"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
}
