import gemma426bPrompt from '../../project-models/gemma4-26b.md?raw';
import gemma4e4bPrompt from '../../project-models/gemma4-e4b.md?raw';

export interface ProjectModelConfig {
  name: string;
  label: string;
  numCtx: number;
  maxNumCtx: number;
  systemPrompt: string;
}

export const PROJECT_MODELS: ProjectModelConfig[] = [
  {
    name: 'gemma4:26b',
    label: 'Gemma 4 26B',
    numCtx: 65536,
    maxNumCtx: 256000,
    systemPrompt: gemma426bPrompt.trim(),
  },
  {
    name: 'gemma4:e4b',
    label: 'Gemma 4 E4B',
    numCtx: 32768,
    maxNumCtx: 128000,
    systemPrompt: gemma4e4bPrompt.trim(),
  },
];

export const PROJECT_MODEL_MAP = new Map(
  PROJECT_MODELS.map((model) => [model.name, model])
);
