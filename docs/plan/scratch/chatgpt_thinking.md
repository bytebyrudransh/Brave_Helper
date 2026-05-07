# ChatGPT Thinking - Production Architecture

Date: 2026-04-26

## Short version

You are right: the current architecture is not production grade.

It is a prototype made from:

- React UI
- Express local backend
- Puppeteer controlling Brave
- direct browser fetches to Ollama
- fake action handling
- no real browser state model
- no durable app state
- no security boundary

That is okay for proving an idea, but it should not become the foundation of the product.

The biggest problem is not one bad file. The biggest problem is that the repo has not chosen what product it is:

1. An AI assistant inside the user's real browser.
2. A custom AI browser app.
3. A local AI studio with browser-related tools.

Those need different architectures. Mixing them creates the bad architecture we have now.

## My honest recommendation

Build this as a browser extension first.

If the core dream is "AI helps me understand and act on pages while I browse," then a Chrome/Brave extension is the clean production architecture.

Do not continue with Puppeteer controlling a separate Brave window.

## Why the current architecture is bad

### 1. Puppeteer is the wrong foundation

Puppeteer is useful for automation, testing, scraping, and controlled browser sessions. It is not a good foundation for a user-facing browser assistant.

Current issues:

- Brave path is hardcoded to `/snap/bin/brave`.
- One global browser instance is shared by the whole backend.
- No real tab model exists.
- No active-tab tracking exists.
- User navigation inside Brave does not automatically sync to the React app.
- The assistant UI and browser live in different windows.
- The user cannot see what the AI is about to click.
- Puppeteer can desync from the real browser state.

This will get worse as features grow.

### 2. The action system is fake

The UI says it can help with clicking, filling, and submitting, but the backend does not have the data required to do that safely.

Today the assistant gets mostly this:

- page URL
- `document.body.innerText`
- a 15k character text cap

That is not enough to perform real browser actions.

A real action system needs:

- visible element list
- text labels
- ARIA roles
- selectors
- bounding boxes
- form metadata
- enabled/disabled state
- iframe awareness
- confidence score
- visual highlight before execution
- user confirmation for risky steps
- audit log after execution

Without that, "click the login button" is guesswork.

### 3. The local backend is unsafe by design

The backend exposes browser control on `localhost:3002` with broad CORS.

That means the product shape is dangerous:

- other local pages may be able to call the backend
- there is no auth token
- there is no origin allowlist
- there is no permission model
- there is no per-action confirmation enforced on the server
- there is no separation between read actions and write actions

For production, browser control must be permissioned and scoped.

### 4. State is too loose

The app stores too much important state directly in `App.jsx` and passes it through props.

Current state includes:

- current URL
- browser history
- history index
- page content
- loading state
- model list
- Ollama status
- browser connection status

This works for a small demo. It does not survive:

- tabs
- sessions
- streaming chats
- pending actions
- action history
- model settings
- page snapshots
- persistent memory
- multi-step plans

We need a real state layer.

### 5. Page extraction is too weak

`document.body.innerText` is not a page understanding layer.

Production extraction should return structured page context:

- title
- URL
- headings
- paragraphs
- links
- buttons
- inputs
- forms
- tables
- selected text
- visible viewport text
- metadata
- simplified accessibility tree

The assistant should know what is visible and actionable, not just what text exists somewhere in the DOM.

### 6. The AI layer is not designed yet

The current Ollama integration is useful but basic.

Missing pieces:

- streaming responses
- cancellation
- structured tool calls
- model capability registry
- context budgeting
- prompt versioning
- response grounding
- retry handling
- error categories
- telemetry for latency and failures

For a production assistant, the LLM should not just receive a giant prompt. It should operate through a controlled tool/action protocol.

## The production-grade architecture I would choose

## Option A: Browser Extension Architecture

This is my recommended path.

Use:

- Manifest V3 extension
- React side panel UI
- content scripts for page extraction and highlighting
- service worker for orchestration
- `chrome.tabs` for tab state
- `chrome.scripting` for controlled injection
- direct local Ollama connection when allowed
- optional native helper later if needed

High-level shape:

```txt
Brave/Chrome
  |
  |-- Extension Side Panel UI
  |     - chat
  |     - model picker
  |     - page summary
  |     - pending action cards
  |
  |-- Service Worker
  |     - tab tracking
  |     - permission checks
  |     - action orchestration
  |     - message routing
  |
  |-- Content Script
  |     - reads page structure
  |     - highlights elements
  |     - executes approved clicks/fills
  |     - reports DOM changes
  |
  |-- Local AI Provider
        - Ollama at localhost
        - later: OpenAI, Anthropic, WebLLM, etc.
```

Why this is better:

- The assistant lives inside the browser.
- It can track the real active tab.
- It can read the live DOM without Puppeteer.
- It can highlight elements before acting.
- It uses Chromium's permission model.
- It is distributable.
- It removes the separate Express/Puppeteer backend.

This is the cleanest route for the product described in `docs plan /v1 plan.md`.

## Option B: Desktop Browser Architecture

If we truly want to build our own browser, use Electron or Tauri.

Use:

- Electron app shell
- Chromium WebContents / BrowserView
- React for browser chrome and assistant UI
- main process for permissions and native APIs
- preload bridge for safe page interaction
- local model providers behind a typed API

High-level shape:

```txt
Desktop App
  |
  |-- Main Process
  |     - window management
  |     - tabs
  |     - permissions
  |     - downloads
  |     - history
  |     - local AI connections
  |
  |-- Browser View
  |     - renders websites
  |
  |-- Assistant UI
  |     - chat
  |     - action confirmation
  |     - page memory
  |
  |-- Preload / Bridge
        - safe page extraction
        - approved actions
```

This is more powerful but much bigger. It means we are building a browser, not just an assistant.

I would only choose this if the long-term product is a real Arc/Cursor-style browser replacement.

## Option C: Local AI Studio

This matches `docs plan / plan_from_yt.md`.

Use:

- React + TypeScript
- Vite
- Zustand
- Tailwind or one chosen design system
- Web Workers
- Transformers.js
- WebLLM
- IndexedDB
- direct Ollama integration

This is a good product, but it is not the same as an AI browser assistant.

If we choose this path, delete the Puppeteer browser-control idea and build a local AI workspace instead.

## The architecture I would build now

I would build Option A: browser extension.

Reason:

The user's real pain seems to be browsing with AI help. The product should sit next to the page, understand the page, and act with permission. A browser extension gives us that shape directly.

## Proposed production modules

### 1. App shell

Responsible for UI only.

Owns:

- side panel layout
- chat thread
- page summary panel
- model selector
- pending action UI
- settings
- connection status

Should not own:

- DOM scraping logic
- browser automation logic
- model provider details

### 2. Browser context service

Responsible for knowing the active browser state.

Owns:

- active tab ID
- URL
- title
- loading status
- navigation events
- selected text
- page snapshot version

### 3. Page extraction service

Responsible for turning the current page into structured context.

Returns:

```ts
type PageSnapshot = {
  url: string;
  title: string;
  text: string;
  headings: PageHeading[];
  links: PageLink[];
  forms: PageForm[];
  actions: PageActionTarget[];
  viewport: ViewportSnapshot;
  capturedAt: string;
};
```

### 4. Action planner

Responsible for converting user intent into safe proposed actions.

Returns:

```ts
type ProposedAction = {
  id: string;
  kind: "click" | "fill" | "submit" | "navigate" | "extract";
  target?: PageActionTarget;
  value?: string;
  risk: "low" | "medium" | "high";
  confidence: number;
  explanation: string;
  requiresConfirmation: boolean;
};
```

### 5. Action executor

Responsible for running only approved actions.

Rules:

- never execute high-risk actions silently
- always highlight target before click/fill
- block payment, delete, submit, send, purchase unless confirmed
- return a result object
- record action history

### 6. AI provider layer

Responsible for model calls.

Providers:

- Ollama local
- WebLLM later
- hosted APIs later if desired

Must support:

- streaming
- abort/cancel
- structured JSON responses
- retries
- context budgets
- model capability metadata

### 7. Persistence layer

Responsible for durable local data.

Store:

- settings
- selected model
- chat sessions
- page snapshots
- action history
- permissions
- prompt versions

Use:

- IndexedDB for larger structured data
- extension storage for small settings

## What should change in this repo

### Stop investing in these

- `server.js` as a production backend
- Puppeteer as the main browser control layer
- fake action cards that do not execute real actions
- `document.body.innerText` as the only context format
- manual "sync current tab" as core UX
- hardcoded Brave executable paths
- broad CORS on localhost

### Keep or reuse these ideas

- split browser area and assistant area
- Ollama as a local model provider
- confirmation before actions
- simple V1 scope
- visible loading/error states
- quick actions like summarize/extract/explain

### Replace with these

- browser extension side panel instead of separate Vite browser shell
- content script extraction instead of Puppeteer extraction
- Chrome tab events instead of manual sync
- typed action protocol instead of keyword matching
- state store instead of prop drilling
- streaming chat instead of blocking responses
- IndexedDB/extension storage instead of memory-only state

## Migration plan

### Phase 1: Decide product shape

Decision:

Build a Brave/Chrome extension side panel.

Then mark docs as:

- `docs plan /v1 plan.md` = canonical product goal
- `gemini_thinking.md` = architecture warning
- `docs plan /claude_thinking.md` = architecture warning
- `chatgpt_thinking.md` = production architecture recommendation
- `docs plan / plan_from_yt.md` = archived reference for local AI studio ideas

### Phase 2: Create extension scaffold

Add:

- `manifest.json`
- `src/extension/serviceWorker.js`
- `src/extension/contentScript.js`
- `src/extension/messages.js`
- `src/services/browserContext.js`
- `src/services/pageExtraction.js`
- `src/services/actions.js`
- `src/services/aiProvider.js`
- `src/store/appStore.js`

Keep React, but target extension side panel instead of normal web app.

### Phase 3: Real page reading

Build a content script that returns:

- title
- URL
- visible text
- headings
- links
- buttons
- inputs
- forms
- element descriptors

Do not send raw full DOM to the model.

### Phase 4: Real assistant answers

Update AI flow:

- gather current `PageSnapshot`
- build a scoped prompt
- stream response from Ollama
- cite the current page context internally
- show stale-context warning if page changed mid-response

### Phase 5: Real guided actions

Build:

- proposed action JSON
- confirmation UI
- target highlight
- executor
- result log

Start with only:

- click visible button/link
- fill visible input

Do not support submit/payment/delete in V1 except with explicit confirmation and strong guardrails.

### Phase 6: Persistence

Add:

- settings
- selected model
- chat sessions per tab/session
- action history

## Minimum production rules

These rules should become non-negotiable:

1. No silent destructive actions.
2. No action without a visible target.
3. No action without an audit record.
4. No browser control endpoint exposed without auth.
5. No model output executed directly.
6. No unstructured DOM guessing for actions.
7. No hardcoded local executable paths.
8. No core UX that depends on a manual sync button.
9. No memory-only architecture for sessions.
10. No adding features until the product shape is chosen.

## The hard truth

The current app can become a useful demo, but it cannot become a production AI browser by polishing the UI.

The core architecture must change.

My vote:

Build the browser extension.

Use the existing app only as a visual and UX sketch. Keep the useful ideas, but do not keep the Puppeteer architecture.

