/// <reference lib="webworker" />
import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers';

env.allowLocalModels = false;

const MODEL_ID = 'Xenova/bge-small-en-v1.5';

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

export type WorkerRequest =
  | { id: string; type: 'init' }
  | { id: string; type: 'embed'; texts: string[] };

export type WorkerResponse =
  | { id: string; type: 'progress'; status: string; progress?: number; file?: string }
  | { id: string; type: 'ready' }
  | { id: string; type: 'embedded'; embeddings: Float32Array[] }
  | { id: string; type: 'error'; message: string };

function post(msg: WorkerResponse, transfer?: Transferable[]) {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pipelineAny = pipeline as any;

function loadModel(reqId: string): Promise<FeatureExtractionPipeline> {
  if (extractorPromise) return extractorPromise;

  extractorPromise = pipelineAny('feature-extraction', MODEL_ID, {
    dtype: 'fp32',
    progress_callback: (data: Record<string, unknown>) => {
      const status = String(data.status ?? '');
      const progress = typeof data.progress === 'number' ? data.progress : undefined;
      const file = typeof data.file === 'string' ? data.file : undefined;
      post({ id: reqId, type: 'progress', status, progress, file });
    },
  }) as Promise<FeatureExtractionPipeline>;

  return extractorPromise;
}

self.addEventListener('message', async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.type === 'init') {
      await loadModel(req.id);
      post({ id: req.id, type: 'ready' });
      return;
    }

    if (req.type === 'embed') {
      const extractor = await loadModel(req.id);
      const output = await extractor(req.texts, { pooling: 'mean', normalize: true });
      const list = output.tolist() as number[][];
      const embeddings = list.map((row) => Float32Array.from(row));
      post(
        { id: req.id, type: 'embedded', embeddings },
        embeddings.map((e) => e.buffer)
      );
      return;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ id: req.id, type: 'error', message });
  }
});
