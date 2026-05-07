# Local Brave Helper — Feature Overview

## The Elevator Pitch

Local Brave Helper is a fully local AI-powered research assistant that lives inside the Brave browser's side panel — it runs entirely on-device using Ollama for inference, meaning there are no API keys, no cloud dependencies, no quotas, and no user data ever leaving the machine. The extension captures and understands the page you're currently viewing (title, headings, text, links, and all form fields including hidden ones), lets you chat with a local LLM about that content, and supports three speed tiers — Fast (Qwen 3.5 9B), Balanced (Qwen 3 14B), and Smart (GPT-OSS 20B) — that dynamically swap the underlying model based on whether you need a quick summary or deep reasoning, all fitting within 16GB of VRAM with no CPU spillover. It has built-in vision capabilities through a local multimodal model (LLaVA 7B) that can capture a screenshot of the active tab and reason over it entirely on-device, so you can ask "what's on my screen?" and get an accurate local response without the image ever touching a remote server. For web research, the extension can query DuckDuckGo through a strict GET-only HTTP wrapper (the `safeFetch` chokepoint) that architecturally prevents any POST, PUT, or DELETE request from ever being sent — making privacy not a marketing claim but a property of the codebase — and then feeds those search results into the model's context so it can synthesize answers with cited sources. On the security side, it includes an AES-encrypted local vault protected by a master password where users can store login credentials and personal profiles, and when the vault is unlocked the AI autonomously detects form fields on the page and generates autofill commands that inject values directly into the DOM; critically, web search and all external URL fetching are hard-disabled at the code level whenever the vault is open, enforcing mutual exclusion between "credentials are visible to the model" and "the model can reach the internet" — two states clearly indicated in the UI as Research Mode (green pill, web on, vault locked) and Autofill Mode (red pill, web off, vault unlocked). The entire extension is built as a Manifest V3 Chrome extension using React, TypeScript, Vite, and Zustand for state management, with a clean module architecture: `lib/ollama.ts` for streaming chat, `lib/vision.ts` for multimodal inference, `lib/search.ts` for web search, `lib/http.ts` for the GET-only fetch wrapper, `lib/vault.ts` for encryption, `lib/mode.ts` for the mode state machine, `lib/page.ts` for content-script messaging, and `lib/history.ts` for session persistence via IndexedDB — and it compiles cleanly with zero TypeScript errors across all modules.

## Detailed Feature Breakdown

### 1. Local-First AI Assistant
- **Offline Inference**: Powered entirely by local models via Ollama. No cloud dependencies for core chat and summarization.
- **Speed Modes**: Dynamic model switching based on the task:
  - `Fast`: `qwen3.5:9b` for quick chat and summarization.
  - `Balanced`: `qwen3:14b` for page Q&A and form analysis.
  - `Smart`: `gpt-oss:20b` for complex reasoning and deep extraction.
- **Smart Context Scoping**: Truncates and extracts relevant page content (headings, paragraphs, visible forms) to fit optimal token limits (8k default).

### 2. Vision Integration ✅
- **Local Multimodal Capabilities**: Uses `llava:7b` to reason over images.
- **`/ask` Command**: Captures a screenshot of the visible tab and sends it to the vision model alongside a user prompt.
- **Privacy-First**: The image is sent to `localhost` only and never leaves the user's machine.

### 3. Web Search & Online Mode ✅
- **Whitelisted Providers**: Uses DuckDuckGo HTML endpoint for tracking-free search.
- **`/search` Command**: Allows the AI to query the web to augment its knowledge base. Search results are parsed locally (without running third-party JS) and fed into the AI's context.
- **Architectural Guarantee**: All outbound search requests are strictly `GET`-only via a `safeFetch` wrapper, ensuring no user data can be exfiltrated via `POST` payloads.

### 4. Encrypted Vault & Autonomous Autofill ✅
- **Local Encrypted Storage**: Secure vault for user credentials and profiles.
- **Mode-Gated Security**: Vault is locked by default.
- **Autofill Capabilities**: When the vault is unlocked (Autofill Mode), the AI can analyze page forms and automatically generate `autofill` blocks to inject credentials directly into the DOM.
- **Mutual Exclusion**: Web search and external URL fetching are hard-disabled when the vault is unlocked to prevent any credential exfiltration.

### 5. Architectural Privacy Guarantees
- **One-Way Internet**: The model can READ from the internet (fetch search results) but cannot WRITE to the internet.
- **No Remote POSTs**: The only `POST` requests allowed are to `localhost` (the local Ollama instance).
- **Explicit Transitions**: Switching between Research Mode (Web ON, Vault LOCKED) and Autofill Mode (Web OFF, Vault UNLOCKED) is explicit and clearly indicated in the UI.

### 6. Tech Stack
- **Frontend**: React 18 + TypeScript + Vite
- **State**: Zustand
- **Styling**: Tailwind CSS with custom dark theme
- **Extension**: Manifest V3 (Chrome/Brave)
- **AI Runtime**: Ollama (local)
- **Storage**: IndexedDB + chrome.storage
- **Encryption**: Web Crypto API (AES-GCM)

## Upcoming Features (Phases 5 & 6)
- Local RAG over browsing history (Memory) using `nomic-embed-text` embeddings.
- Privacy Audit Panel — a transparency dashboard logging every mode transition, outbound request, page read, and vault access event.
