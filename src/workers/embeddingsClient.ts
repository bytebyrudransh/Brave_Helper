import EmbeddingsWorker from './embeddings.worker?worker';
import type { WorkerRequest, WorkerResponse } from './embeddings.worker';

export interface ProgressEvent {
  status: string;
  progress?: number;
  file?: string;
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  onProgress?: (p: ProgressEvent) => void;
};

class EmbeddingsClient {
  private worker: Worker | null = null;
  private pending = new Map<string, Pending>();
  private nextId = 0;
  private ready = false;
  private initPromise: Promise<void> | null = null;

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new EmbeddingsWorker();
      this.worker.addEventListener('message', (ev: MessageEvent<WorkerResponse>) => {
        this.handle(ev.data);
      });
      this.worker.addEventListener('error', (ev) => {
        console.error('Embeddings worker error:', ev);
      });
    }
    return this.worker;
  }

  private handle(msg: WorkerResponse) {
    const p = this.pending.get(msg.id);
    if (!p) return;

    if (msg.type === 'progress') {
      p.onProgress?.({ status: msg.status, progress: msg.progress, file: msg.file });
      return;
    }
    if (msg.type === 'ready') {
      this.pending.delete(msg.id);
      p.resolve(undefined);
      return;
    }
    if (msg.type === 'embedded') {
      this.pending.delete(msg.id);
      p.resolve(msg.embeddings);
      return;
    }
    if (msg.type === 'error') {
      this.pending.delete(msg.id);
      p.reject(new Error(msg.message));
      return;
    }
  }

  private send<T>(req: WorkerRequest, onProgress?: (p: ProgressEvent) => void): Promise<T> {
    const w = this.ensureWorker();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(req.id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        onProgress,
      });
      w.postMessage(req);
    });
  }

  init(onProgress?: (p: ProgressEvent) => void): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.initPromise) return this.initPromise;

    const id = `init-${this.nextId++}`;
    this.initPromise = this.send<void>({ id, type: 'init' }, onProgress).then(() => {
      this.ready = true;
    });
    return this.initPromise;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    await this.init();
    const id = `embed-${this.nextId++}`;
    return this.send<Float32Array[]>({ id, type: 'embed', texts });
  }

  isReady(): boolean {
    return this.ready;
  }
}

export const embeddingsClient = new EmbeddingsClient();
