<div align="center">
  <img src="assets/logo-square.png" alt="Brave Helper logo" width="180" />

  # Brave Helper

  **A local-first AI side-panel extension for Brave / Chromium.**
  No cloud, no API keys, no data leaving your device — every model runs on your own machine via [Ollama](https://ollama.com/).

  [![Version](https://img.shields.io/badge/version-4.0-success.svg)]()
  [![Manifest](https://img.shields.io/badge/Manifest-V3-orange.svg)]()
  [![Stack](https://img.shields.io/badge/Stack-React_+_TS_+_Vite_+_Zustand-blueviolet.svg)]()
  [![License](https://img.shields.io/badge/license-local--use-lightgrey.svg)]()
</div>

---

## What it does

A side panel that sits next to your browser tab and helps you read, research, recall, and autofill — all running on local models.

- **Read the page** you're looking at and answer questions about it
- **Search the web** when local context isn't enough (DuckDuckGo, GET-only)
- **See your screen** via a local vision model (`/ask`)
- **Remember what you saved** with local RAG (`/recall`)
- **Autofill forms** from an AES-encrypted vault when you choose to unlock it
- **Pick the right model automatically** — the V4.0 auto-router classifies every message and routes it to the right specialist

The architecture is read-only outbound: the model can pull search results and fetch URLs, but the extension has no `POST` code path that sends user data anywhere. Privacy is a property of the codebase, not a marketing line.

---

## Features (V4.0)

### V4.0 — Intelligent auto-router
A small "manager" model classifies each message and picks the best specialist for the task. No more guessing whether to use Fast or Smart — the router decides per-message and swaps models on the fly. Manual override is always one slash command away (`/fast`, `/smart`, `/code`).

### V3.0 — Modes, vision, memory, audit
- **Two modes, mutually exclusive on the harm path**
  - 🟢 **Research** (default) — page reading + web search + URL fetch + screenshots + memory recall, all on. Vault locked.
  - 🔴 **Autofill** — vault unlocked. Web access automatically cut. Model can fill the form in front of you, but can't reach the network.
- **Five tier system prompts** tuned for the model size and use case (Fast / Balanced / Smart / Code / Vision)
- **Vision Q&A** — `/ask` captures the visible tab and sends it to `llava:7b` running locally
- **Local RAG** — `/save` indexes a page snapshot via `nomic-embed-text`; `/recall` does cosine search over your saved pages
- **Privacy audit panel** — every mode change, web request, page read, vault unlock, autofill, model swap, and route decision is logged locally with filters and JSON export
- **Personal memory facts** — short user-curated facts injected into every system prompt (the "ChatGPT memory" pattern, but local)

### V2.0 — Vault & autofill (still here)
- AES-GCM encrypted vault, master password via PBKDF2
- Form extraction (visible + hidden fields with stable selectors)
- Source-traced autofill — every value shows where it came from before being filled

### Slash commands
| Command | Effect |
|---------|--------|
| `/start` | Clear chat + re-sync the current page |
| `/clear` | Clear chat |
| `/summary` | Concise bullet summary of the current page |
| `/describe <q>` | Long, structured answer for one turn (default chat is concise) |
| `/save` | Save page snapshot + auto-index it for `/recall` |
| `/takeSS` | Screenshot the visible tab |
| `/ask <prompt>` | Vision Q&A on the visible tab (uses `llava:7b`) |
| `/search <query>` | Web search via DuckDuckGo (Research mode only) |
| `/recall <query>` | RAG over your saved pages |
| `/fast` `/balanced` `/smart` `/code` | Pin a model tier manually |
| `/auto` | Re-enable the auto-router |

---

## The architectural commitment: one-way internet

> The model READS, never WRITES.

| Direction | Allowed | Not allowed |
|-----------|---------|-------------|
| Outbound HTTP | `GET` only — search queries, URL fetches | `POST`, `PUT`, `DELETE`, form submits, file uploads, API calls with user-data payloads |
| Tools | Read page, web search, URL fetch, screenshot, recall history | Send email, post to social, submit form to remote, upload file |
| Inputs to model | Page text, search results, fetched URLs, screenshots, chat history | (the model only sees what the user is already looking at) |
| Outputs from model | Text in the side panel | (no outbound transmission of user data) |

`src/lib/http.ts::safeFetch` is the single chokepoint for outbound public-internet HTTP. It is GET-only and refuses non-http(s) protocols. Localhost POSTs to Ollama (port 11434) are exempt — those never leave the device.

---

## Quick start

Full setup guide in **[howtostart.md](howtostart.md)** — hardware/OS prereqs, Ollama install for Linux/Windows/macOS, the `OLLAMA_ORIGINS` step, model pulls, troubleshooting.

TL;DR for someone who already has Ollama running:

```bash
# 1. allow extension origin
export OLLAMA_ORIGINS="*"
# (restart Ollama so it picks this up — see howtostart.md for systemd / Windows / macOS)

# 2. pull at least the minimum models
ollama pull qwen3.5:9b           # Fast — also used by the auto-router
ollama pull llava:7b             # Vision (/ask)
ollama pull nomic-embed-text     # Embeddings (/recall)

# 3. build
npm install
npm run build

# 4. load `dist/` as an unpacked extension at brave://extensions
```

Open the side panel → hard-refresh the page you want to chat about → click Sync → ask anything.

---

## Models

The five chat tiers are sized for a **16 GB VRAM card** with headroom for context. Drop tiers you don't need — only Fast is required for the auto-router to function.

| Tier | Model | Size | Required? | Used for |
|------|-------|------|-----------|----------|
| Fast | `qwen3.5:9b` | 6.6 GB | **Yes** (router uses this for classification) | Default chat, quick summaries, autofill |
| Balanced | `qwen3:14b` | 9.3 GB | recommended | Page Q&A, form analysis |
| Smart | `gpt-oss:20b` | 13 GB | optional | Deep reasoning, long writeups |
| Code | `qwen2.5-coder:14b` | 9 GB | optional | Auto-engaged for dev/code pages |
| Vision | `llava:7b` | 4.7 GB | recommended | `/ask` screenshot Q&A |
| Embeddings | `nomic-embed-text` | 274 MB | recommended | `/recall` and `/save` indexing |

Each tier has a hand-tuned system prompt in `project-models/`. The Fast prompt is short and concise-by-default; Smart is allowed to run long when warranted; Code is biased toward terse code answers.

---

## Project structure

```
brave-helper/
├── manifest.json              ← Manifest V3, points at dist/ outputs after build
├── howtostart.md              ← Full install guide (Linux/Win/macOS, troubleshooting)
├── README.md                  ← This file
├── assets/
│   ├── icons/                 ← Generated 16/32/48/128px from logo-square.png
│   ├── logo-square.png        ← Master logo (cyber-lion)
│   └── favicon.png            ← Favicon (32×32)
├── docs/
│   ├── interview_qa.md
│   └── plan/                  ← v1 → v4 architecture history (kept for context)
├── project-models/            ← One system prompt per tier + the router prompt
├── src/
│   ├── background/index.ts    ← Service worker (panel open behavior)
│   ├── content/index.ts       ← Page snapshot + form extraction + form fill
│   ├── sidepanel/             ← React UI
│   │   ├── SidePanel.tsx      ← Main chat + slash commands + tab routing
│   │   ├── HistoryView.tsx
│   │   ├── VaultView.tsx
│   │   ├── FormFillView.tsx
│   │   └── AuditView.tsx
│   ├── lib/                   ← Core services
│   │   ├── ollama.ts          ← Streaming chat + model unload helpers
│   │   ├── vision.ts          ← Multimodal inference for /ask
│   │   ├── search.ts          ← DuckDuckGo provider (GET-only)
│   │   ├── http.ts            ← safeFetch GET-only chokepoint
│   │   ├── router.ts          ← V4.0 manager / classifier
│   │   ├── mode.ts            ← Research / Autofill state machine
│   │   ├── audit.ts           ← Append-only privacy audit log
│   │   ├── embeddings.ts      ← nomic-embed-text wrapper
│   │   ├── vectorstore.ts     ← Local cosine search over chrome.storage
│   │   ├── memory.ts          ← User-curated personal facts
│   │   ├── vault.ts           ← AES-GCM + PBKDF2 encrypted vault
│   │   ├── history.ts         ← Chat session persistence
│   │   ├── session.ts         ← Page-save + screenshot helpers
│   │   └── page.ts            ← Side-panel ↔ content-script messaging
│   ├── store/index.ts         ← Zustand store
│   └── config/models.ts       ← Tier definitions + system-prompt imports
└── dist/                      ← Build output (load this as unpacked extension)
```

---

## Stack

- **React 18 + TypeScript** for the side panel UI
- **Vite + CRXJS** for build / Manifest V3 packaging
- **Tailwind CSS v4** for styling
- **Zustand** for state
- **Web Crypto API** (AES-GCM, PBKDF2) for the vault
- **Ollama** for all model inference (local-only)
- **DuckDuckGo HTML endpoint** as the default search provider

---

## Privacy summary

- All inference runs on `localhost:11434`
- All public-internet HTTP goes through `safeFetch` (GET-only)
- The extension has no telemetry, no analytics, no remote endpoints
- Vault data stored encrypted in `chrome.storage.local`, never transmitted
- `host_permissions` in `manifest.json` lists every external host the extension can reach — audit it yourself
- Every privacy-relevant action is logged to the local audit panel

---

## Version history

- **V4.0** — Auto-router (manager-classifies-intent, per-message specialist swap)
- **V3.0** — Modes, vision (`llava:7b`), web search, RAG (`nomic-embed-text`), audit panel, personal memory facts
- **V2.0** — Vault, structured autofill, encrypted local storage
- **V1.6** — Pivot to a Brave side-panel extension
- **V1.5 / V1** — Earlier "Local AI Studio" web-app shape (superseded)

Plan documents for every version live in [`docs/plan/`](docs/plan/).

---

<div align="center">
  <i>Built by <b>Rudransh</b> — local-first, privacy-by-architecture.</i>
</div>
