/**
 * Smart Memory — stores LLM-extracted facts about the user.
 * 
 * Instead of feeding entire chat history as context, the LLM extracts
 * key facts after each conversation (name, preferences, etc.) and they
 * get injected into every new chat's system prompt.
 * 
 * Storage: chrome.storage.local (unencrypted — these are preferences, not secrets).
 */

const MEMORY_KEY = 'memoryFacts';

export interface MemoryFact {
  id: string;
  key: string;    // e.g. "name", "preferred_language", "profession"
  value: string;  // e.g. "Rudransh", "English", "Developer"
  source: string; // which conversation/context it was extracted from
  createdAt: number;
}

/** Load all memory facts from storage */
export async function loadMemoryFacts(): Promise<MemoryFact[]> {
  try {
    const result = await chrome.storage.local.get(MEMORY_KEY);
    return (result[MEMORY_KEY] as MemoryFact[]) ?? [];
  } catch {
    return [];
  }
}

/** Save all memory facts to storage */
export async function saveMemoryFacts(facts: MemoryFact[]): Promise<void> {
  await chrome.storage.local.set({ [MEMORY_KEY]: facts });
}

/** Add a new fact (or update if key already exists) */
export async function upsertFact(key: string, value: string, source: string): Promise<void> {
  const facts = await loadMemoryFacts();
  const existing = facts.findIndex(f => f.key.toLowerCase() === key.toLowerCase());
  
  if (existing >= 0) {
    facts[existing] = { ...facts[existing], value, source, createdAt: Date.now() };
  } else {
    facts.push({
      id: crypto.randomUUID(),
      key,
      value,
      source,
      createdAt: Date.now(),
    });
  }
  
  await saveMemoryFacts(facts);
}

/** Delete a fact by ID */
export async function deleteFact(id: string): Promise<void> {
  const facts = await loadMemoryFacts();
  await saveMemoryFacts(facts.filter(f => f.id !== id));
}

/** 
 * Format memory facts as a system prompt block.
 * This gets injected into the model's context on every new conversation.
 */
export function formatMemoryPrompt(facts: MemoryFact[]): string {
  if (facts.length === 0) return '';
  
  const lines = facts.map(f => `- ${f.key}: ${f.value}`);
  return [
    '## What I know about you (from previous conversations)',
    'Use this information to personalize your responses when relevant:',
    ...lines,
    '',
    'If the user corrects any of these facts, note the correction in your response.',
  ].join('\n');
}

/**
 * Extract facts from a conversation.
 * Returns a prompt that asks the LLM to extract key-value facts.
 */
export function buildExtractionPrompt(chatSummary: string): string {
  return [
    'Extract key personal facts about the user from this conversation. Return ONLY a JSON array of objects with "key" and "value" fields.',
    'Examples of useful facts: name, nickname, profession, preferred language, interests, location, commonly used tools.',
    'If no new facts can be extracted, return an empty array [].',
    'IMPORTANT: Return ONLY the JSON array, no other text.',
    '',
    'Conversation:',
    chatSummary,
  ].join('\n');
}
