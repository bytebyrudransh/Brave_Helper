import qwen35_9bPrompt from '../../project-models/qwen3.5-9b.md?raw';
import qwen3_14bPrompt from '../../project-models/qwen3-14b.md?raw';
import gptOss_20bPrompt from '../../project-models/gpt-oss-20b.md?raw';
import qwenCoder_14bPrompt from '../../project-models/qwen2.5-coder-14b.md?raw';
import llava_7bPrompt from '../../project-models/llava-7b.md?raw';

/**
 * ModelTier — the specialist tiers.
 * 'auto' is the V4.0 manager mode: the router classifies intent and picks
 * the right specialist per-message. It is NOT a real model — it's a meta-tier.
 */
export type ModelTier = 'fast' | 'balanced' | 'smart' | 'code' | 'vision';
export type SelectableTier = ModelTier | 'auto';

export interface ProjectModelConfig {
  name: string;
  label: string;
  tier: ModelTier;
  numCtx: number;
  maxNumCtx: number;
  systemPrompt: string;
}

/**
 * V4.0 model tiers. Defaults are tuned for a 16GB VRAM card — every entry
 * fits fully in VRAM with headroom for KV cache, no spillover to system RAM.
 *
 * Order matters: first installed match in this list becomes the default.
 */
export const PROJECT_MODELS: ProjectModelConfig[] = [
  {
    name: 'qwen3.5:9b',
    label: 'Fast — Qwen 3.5 9B',
    tier: 'fast',
    numCtx: 8192,
    maxNumCtx: 32768,
    systemPrompt: qwen35_9bPrompt.trim(),
  },
  {
    name: 'qwen3:14b',
    label: 'Balanced — Qwen 3 14B',
    tier: 'balanced',
    numCtx: 16384,
    maxNumCtx: 65536,
    systemPrompt: qwen3_14bPrompt.trim(),
  },
  {
    name: 'gpt-oss:20b',
    label: 'Smart — GPT-OSS 20B',
    tier: 'smart',
    numCtx: 16384,
    maxNumCtx: 32768,
    systemPrompt: gptOss_20bPrompt.trim(),
  },
  {
    name: 'qwen2.5-coder:14b',
    label: 'Code — Qwen Coder 14B',
    tier: 'code',
    numCtx: 16384,
    maxNumCtx: 65536,
    systemPrompt: qwenCoder_14bPrompt.trim(),
  },
  {
    name: 'llava:7b',
    label: 'Vision — LLaVA 7B',
    tier: 'vision',
    numCtx: 4096,
    maxNumCtx: 8192,
    systemPrompt: llava_7bPrompt.trim(),
  },
];

export const PROJECT_MODEL_MAP = new Map(
  PROJECT_MODELS.map((model) => [model.name, model])
);

/** V4.0 default: auto mode — the router picks the right model per-message. */
export const DEFAULT_TIER: SelectableTier = 'auto';

/** Label shown in the UI when auto mode is active. */
export const AUTO_MODE_LABEL = '⚡ AUTO — AI Router';

export function getModelByTier(tier: ModelTier): ProjectModelConfig | undefined {
  return PROJECT_MODELS.find((m) => m.tier === tier);
}
