# Local AI Studio

A local-first AI Studio that runs against [Ollama](https://ollama.com/) on your own machine. No backend, no API keys, no cloud calls.

**Phase 2** of the [V1.5-lean plan](./docs%20plan%20/v1.5-lean%20plan.md) is in: RAG over local documents (PDF / TXT / MD), client-side embeddings via Transformers.js (BGE-small) running in a Web Worker, IndexedDB persistence, and grounded chat with clickable citations.

Stack: React 18 + TypeScript + Vite + Tailwind v4 + Zustand. Streaming chat against Ollama. Embeddings via `@huggingface/transformers`. PDF parsing via `pdfjs-dist`. Storage via `idb`.

## Prerequisites

1. **Node.js** 18+ and npm.
2. **Ollama** installed and running locally.

   ```sh
   # macOS / Linux
   curl -fsSL https://ollama.com/install.sh | sh

   # Pull a model (default expected: llama3.1)
   ollama pull llama3.1:8b
   ```

3. **Allow the browser to call Ollama.** By default the Ollama daemon refuses cross-origin requests from a browser. Restart it with the dev origin allowed:

   ```sh
   OLLAMA_ORIGINS="http://localhost:5173" ollama serve
   ```

   Or allow all origins for local development:

   ```sh
   OLLAMA_ORIGINS="*" ollama serve
   ```

## Run

```sh
npm install
npm run dev
```

Open the URL printed by Vite (usually `http://localhost:5173`).

## Scripts

- `npm run dev` — start the Vite dev server.
- `npm run build` — type-check (`tsc -b`) and build for production.
- `npm run typecheck` — type-check only, no emit.
- `npm run preview` — serve the production build locally.

## Configuration

Environment variables (set in a `.env.local` file at the repo root):

- `VITE_OLLAMA_URL` — override the Ollama base URL. Defaults to `http://localhost:11434`.

## Using RAG (Phase 2)

1. Open the **Documents** tab.
2. Upload a PDF, TXT, or MD file. The first upload triggers a one-time download of the BGE-small embeddings model (~100 MB, cached in your browser afterward).
3. Click **Add to scope** on one or more documents.
4. Switch to **Chat** and ask a question. Answers are grounded in retrieved chunks and show clickable citation pills you can expand to see the source text.

Documents, embeddings, conversations, and messages are all persisted in IndexedDB. Closing and reopening the app preserves everything.

## What's Next

See [`docs plan/v1.5-lean plan.md`](./docs%20plan%20/v1.5-lean%20plan.md). Phase 3 = Studio polish (model manager, conversation list, command palette). Phase 4 = WebLLM as a no-Ollama fallback. Phase 5 (V2) = Manifest V3 browser extension.
