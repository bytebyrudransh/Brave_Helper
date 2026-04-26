import { useRef, useState } from 'react';
import { FileText, Trash2, Upload, Loader2, Check } from 'lucide-react';
import { useAppStore } from './store';
import { ingestFile } from './lib/ingest';
import { deleteDocument } from './db';
import { embeddingsClient } from './workers/embeddingsClient';

interface IngestState {
  fileName: string;
  stage: 'reading' | 'chunking' | 'embedding' | 'storing';
}

export default function DocumentsPanel() {
  const { documents, scopeDocIds, refreshDocuments, toggleScopeDoc, setEmbeddingsStatus } =
    useAppStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [ingesting, setIngesting] = useState<IngestState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(false);

  async function ensureEmbeddingsReady(): Promise<void> {
    if (embeddingsClient.isReady()) return;
    setModelLoading(true);
    setEmbeddingsStatus({ status: 'loading' });
    try {
      await embeddingsClient.init((p) => {
        setEmbeddingsStatus({
          status: 'loading',
          progress: p.progress,
          file: p.file,
          message: p.status,
        });
      });
      setEmbeddingsStatus({ status: 'ready' });
    } finally {
      setModelLoading(false);
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    try {
      await ensureEmbeddingsReady();
      for (const file of Array.from(files)) {
        setIngesting({ fileName: file.name, stage: 'reading' });
        await ingestFile(file, { onStage: (stage) => setIngesting({ fileName: file.name, stage }) });
        await refreshDocuments();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to ingest file.');
    } finally {
      setIngesting(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleDelete(id: string) {
    await deleteDocument(id);
    await refreshDocuments();
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 p-6">
      <div>
        <h2 className="text-lg font-semibold">Documents</h2>
        <p className="mt-1 text-sm text-gray-400">
          Upload PDFs or text files. Toggle them to scope your chat — answers will be grounded in their content with citations.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={ingesting !== null || modelLoading}
          className="flex items-center gap-2 rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Upload size={14} /> Upload
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        {modelLoading && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Loader2 size={14} className="animate-spin" />
            Loading embeddings model (first time only)…
          </div>
        )}
        {ingesting && (
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <Loader2 size={14} className="animate-spin" />
            <span>
              {stageLabel(ingesting.stage)} — {ingesting.fileName}
            </span>
          </div>
        )}
      </div>

      {error && <div className="rounded-lg border border-red-700 bg-red-950/40 p-3 text-sm text-red-300">{error}</div>}

      <div className="flex flex-col gap-2 overflow-y-auto">
        {documents.length === 0 && (
          <div className="rounded-lg border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-gray-500">
            No documents yet. Upload one to get started.
          </div>
        )}
        {documents.map((d) => {
          const inScope = scopeDocIds.includes(d.id);
          return (
            <div
              key={d.id}
              className={`flex items-center gap-3 rounded-lg border p-3 ${
                inScope ? 'border-[var(--color-accent)] bg-blue-500/5' : 'border-[var(--color-border)] bg-[var(--color-surface)]'
              }`}
            >
              <FileText size={16} className="text-gray-400" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{d.name}</div>
                <div className="text-xs text-gray-500">
                  {d.chunkCount} chunks · {formatBytes(d.byteSize)} · {new Date(d.addedAt).toLocaleDateString()}
                </div>
              </div>
              <button
                onClick={() => toggleScopeDoc(d.id)}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
                  inScope
                    ? 'bg-[var(--color-accent)] text-white'
                    : 'bg-[var(--color-elevated)] text-gray-300 hover:bg-blue-500/10'
                }`}
              >
                {inScope ? (
                  <>
                    <Check size={12} /> In scope
                  </>
                ) : (
                  'Add to scope'
                )}
              </button>
              <button
                onClick={() => handleDelete(d.id)}
                className="rounded-md p-1.5 text-gray-400 hover:bg-red-500/10 hover:text-red-400"
                title="Delete document"
              >
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function stageLabel(stage: IngestState['stage']): string {
  switch (stage) {
    case 'reading':
      return 'Reading';
    case 'chunking':
      return 'Chunking';
    case 'embedding':
      return 'Embedding';
    case 'storing':
      return 'Storing';
  }
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
