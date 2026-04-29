# Local Brave Helper

A local-only Brave (Chromium) **side-panel assistant** that reads the current tab and chats via your local [Ollama](https://ollama.com/). Loaded as an unpacked extension on your own machine. Not published.

See [`docs plan /v1.6 brave-extension plan.md`](./docs%20plan%20/v1.6%20brave-extension%20plan.md) for scope and rationale.

Stack: Manifest V3 + React 18 + TypeScript + Vite + Tailwind v4 + Zustand, built with [`@crxjs/vite-plugin`](https://crxjs.dev/vite-plugin).

## What it does (V1)

- Side panel UI in Brave / Chromium.
- Reads the active tab: title, URL, visible text, flat list of links.
- Streams responses from a local Ollama model.
- Summarize, Q&A, extract links / prices / dates / emails grounded in the page.

Action features (`fillField`, `click`) are deliberately **not** in V1 — they will require explicit confirmation when added.

## Prerequisites

1. **Node.js** 18+ and npm.
2. **Ollama** installed and running locally.

   ```sh
   curl -fsSL https://ollama.com/install.sh | sh
   ollama pull llama3.1:8b
   ```

3. **Let the extension call Ollama.** Ollama refuses cross-origin requests by default. Start it with extension origins allowed:

   ```sh
   OLLAMA_ORIGINS="chrome-extension://*" ollama serve
   ```

   Or, to also keep dev-server access during build work:

   ```sh
   OLLAMA_ORIGINS="chrome-extension://*,http://localhost:5173" ollama serve
   ```

## Build and load

```sh
npm install
npm run build
```

In Brave:

1. Open `brave://extensions`.
2. Enable **Developer mode** (top-right).
3. Click **Load unpacked** and select the `dist/` folder produced by the build.
4. Pin the extension. Click its icon — the side panel opens beside the active tab.

To reload after changes, run `npm run build` again and click the reload icon on the extension card.

## Scripts

- `npm run build` — type-check + production build into `dist/`.
- `npm run dev` — Vite dev server with HMR for the side panel (the extension itself still needs `npm run build` to refresh once installed).
- `npm run typecheck` — type-check only.

## Configuration

`.env.local` at the repo root:

- `VITE_OLLAMA_URL` — override the Ollama base URL. Default `http://localhost:11434`.

## Layout

```
manifest.json                MV3 manifest
src/
  background/index.ts        service worker — opens side panel on action click
  content/index.ts           DOM reader (title, URL, innerText, links)
  sidepanel/                 side panel React app
  lib/
    ollama.ts                streaming /api/chat client
    page.ts                  side panel ↔ content script messaging
  store/index.ts             Zustand store (messages, model, page snapshot)
```

## Status

V1 scope per [`docs plan /v1.6 brave-extension plan.md`](./docs%20plan%20/v1.6%20brave-extension%20plan.md). Earlier "Local AI Studio" (RAG over local docs, in-browser embeddings) work lives in git history at commit `4064471`.
