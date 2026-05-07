/**
 * V4.0 Intelligent Router — "Manager Model"
 *
 * Instead of making the user manually pick Fast / Balanced / Smart / Code / Vision,
 * the router sends a tiny classification request to the fastest available model.
 * That model reads the user's prompt and returns a single JSON `{"tier":"..."}`.
 * The router then switches to the correct specialist before the real inference starts.
 *
 * Cost: ~50–150 tokens of classification overhead per message (~0.3s on the 9B).
 * Benefit: The user never has to think about which model to use.
 *
 * Fallback: If classification fails (timeout, parse error, model not loaded),
 * the router returns 'balanced' — the safest middle ground.
 */

import type { ModelTier } from '../config/models';
import { PROJECT_MODELS, getModelByTier } from '../config/models';
import routerPrompt from '../../project-models/router.md?raw';

const OLLAMA_URL =
  (import.meta.env.VITE_OLLAMA_URL as string | undefined) ??
  'http://localhost:11434';

/** The tier used for routing classification itself — always the smallest/fastest. */
const ROUTER_MODEL_TIER: ModelTier = 'fast';

/** Max time we wait for the classification response before falling back. */
const ROUTER_TIMEOUT_MS = 8_000;

const VALID_TIERS = new Set<ModelTier>(['fast', 'balanced', 'smart', 'code', 'vision']);

/**
 * Classify a user message and return the best tier to handle it.
 *
 * @param userMessage  The raw user input (or the last user turn).
 * @param hasImage     Whether an image is attached to this request.
 * @param installedModels  Names of models currently available in Ollama.
 * @returns The recommended ModelTier.
 */
export async function classifyIntent(
  userMessage: string,
  hasImage: boolean,
  installedModels: string[]
): Promise<ModelTier> {
  // Fast path: image attached → always vision, no classification needed.
  if (hasImage) return 'vision';

  // Fast path: slash commands don't need classification.
  if (userMessage.startsWith('/')) return 'fast';

  // Find the router model (the smallest one).
  const routerConfig = getModelByTier(ROUTER_MODEL_TIER);
  if (!routerConfig || !installedModels.includes(routerConfig.name)) {
    // Router model isn't installed — fall back to balanced.
    return 'balanced';
  }

  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), ROUTER_TIMEOUT_MS);

    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: routerConfig.name,
        messages: [
          { role: 'system', content: routerPrompt.trim() },
          { role: 'user', content: userMessage },
        ],
        stream: false,
        options: {
          num_ctx: 2048,      // Tiny context — classification is short.
          temperature: 0.0,   // Deterministic — same input → same routing.
          num_predict: 32,    // We only need ~10 tokens for the JSON response.
        },
      }),
      signal: ctrl.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) return 'balanced';

    const data = (await res.json()) as {
      message?: { content?: string };
    };

    const raw = data.message?.content?.trim() ?? '';
    const tier = parseRouterResponse(raw);

    // Validate that the classified tier actually has an installed model.
    if (tier && VALID_TIERS.has(tier)) {
      const targetModel = getModelByTier(tier);
      if (targetModel && installedModels.includes(targetModel.name)) {
        return tier;
      }
      // Tier valid but model not installed — downgrade gracefully.
      return findBestAvailableFallback(tier, installedModels);
    }

    return 'balanced';
  } catch {
    // Timeout, network error, abort — silent fallback.
    return 'balanced';
  }
}

/**
 * Parse the router model's response. It should be a JSON object like:
 * {"tier": "code"}
 *
 * We're lenient: we also handle markdown-wrapped JSON, bare tier strings, etc.
 */
function parseRouterResponse(raw: string): ModelTier | null {
  // Try direct JSON parse first.
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj.tier === 'string') {
      return obj.tier as ModelTier;
    }
  } catch {
    // Not valid JSON — try extracting from markdown code fence.
  }

  // Try extracting JSON from a markdown code fence.
  const jsonMatch = raw.match(/```(?:json)?\s*\n?\{([^}]+)\}\s*\n?```/);
  if (jsonMatch) {
    try {
      const obj = JSON.parse(`{${jsonMatch[1]}}`);
      if (obj && typeof obj.tier === 'string') {
        return obj.tier as ModelTier;
      }
    } catch {
      // ignore
    }
  }

  // Try extracting a bare {"tier":"..."} anywhere in the response.
  const inlineMatch = raw.match(/\{\s*"tier"\s*:\s*"(\w+)"\s*\}/);
  if (inlineMatch) {
    return inlineMatch[1] as ModelTier;
  }

  // Last resort: check if the entire response is just a tier name.
  const trimmed = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (VALID_TIERS.has(trimmed as ModelTier)) {
    return trimmed as ModelTier;
  }

  return null;
}

/**
 * When the classified tier's model isn't installed, find the closest alternative.
 * Priority order: balanced → fast → smart → whatever is available.
 */
function findBestAvailableFallback(
  _preferredTier: ModelTier,
  installedModels: string[]
): ModelTier {
  const fallbackOrder: ModelTier[] = ['balanced', 'fast', 'smart', 'code'];
  for (const tier of fallbackOrder) {
    const config = getModelByTier(tier);
    if (config && installedModels.includes(config.name)) {
      return tier;
    }
  }
  // Absolute last resort — return whatever PROJECT_MODELS[0] is.
  return PROJECT_MODELS[0]?.tier ?? 'fast';
}
