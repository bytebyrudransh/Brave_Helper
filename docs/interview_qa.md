# Brave Helper (V4.0): Interview Q&A

This document contains 130+ potential technical interview questions and answers tailored to the architecture, design decisions, and technologies used in the **Brave Helper** extension (a local-first AI side-panel for Brave / Chromium).

The original 100 questions cover the V2.0 foundation (vault, autofill, content-script messaging). Parts 6 and 7 cover V3.0 (modes, vision, RAG, audit) and V4.0 (auto-router).

---

## Project Theory — what this project actually is

Before the questions, here's the big picture so the rest makes sense.

### The product
Brave Helper is a side-panel that sits next to a browser tab and helps the user **read, research, recall, and autofill** — entirely with models running on the user's own machine via Ollama. There is no cloud, no API key, no account, no telemetry.

### The four jobs
1. **Read the page the user is looking at** and answer questions about it.
2. **Search the web** when local context isn't enough.
3. **Recall** what the user has saved in the past via local RAG.
4. **Autofill forms** from an encrypted vault when the user opts in.

### The architectural commitment: one-way internet
The single most important property of the codebase: **the model READS, never WRITES.** All outbound public-internet HTTP goes through `lib/http.ts::safeFetch`, which is GET-only and refuses non-http(s) protocols. Localhost POSTs (Ollama on 11434) are exempt — those never leave the machine. The model has no `sendEmail()`, `uploadFile()`, or `postToAPI()` tool — those simply do not exist in the toolset.

This makes "privacy" a property of the architecture, not a marketing claim. Even if the model misbehaves, there's no outbound channel for user data.

### The two modes (V3.0)
The vault contains credentials. The web is a place data could leak to. So at any moment, exactly one of these is allowed:

- 🟢 **Research mode** (default) — page reading + web search + URL fetch + screenshots + memory recall, all on. **Vault locked.**
- 🔴 **Autofill mode** — vault unlocked. **Web access automatically cut.** Model can fill the form in front of the user, but can't reach the network.

Mutual exclusion is enforced in code via `lib/mode.ts::capabilitiesFor(mode)`. Mode is *derived* from vault state (not stored separately) so drift is impossible.

### The five tier system (V3.0)
Different models for different jobs, all sized for a 16 GB VRAM card with no spillover to system RAM:

- **Fast** — `qwen3.5:9b` (6.6 GB) — default chat, summaries, autofill
- **Balanced** — `qwen3:14b` (9.3 GB) — page Q&A, form analysis
- **Smart** — `gpt-oss:20b` (13 GB) — deep reasoning
- **Code** — `qwen2.5-coder:14b` (9 GB) — auto-engaged on dev pages
- **Vision** — `llava:7b` (4.7 GB) — `/ask` screenshot Q&A
- **Embeddings** — `nomic-embed-text` (274 MB) — RAG indexing for `/recall`

Each tier has a hand-tuned system prompt in `project-models/`. Default is concise; the user opts into long answers with `/describe`.

### The auto-router (V4.0)
Instead of making the user pick a tier, a **manager model** classifies every message and routes it to the right specialist. The router is the smallest model (`qwen3.5:9b`) running with `temperature=0.0`, `num_ctx=2048`, `num_predict=32`, and a JSON-only system prompt. It reads the user's message and returns `{"tier":"code"}` (or fast/balanced/smart/vision). The system then loads the chosen specialist and runs the real inference.

Cost: ~50–150 classification tokens per message (~0.3 s on the 9B). Benefit: the user doesn't think about which model to use.

### The privacy audit panel (V3.0)
Every privacy-relevant action — mode change, web request, page read, vault unlock, autofill execution, model swap, route decision — is logged locally in `chrome.storage.local`. The **AUDIT** tab shows the log with type filter, time-window filter, JSON export, and clear-all. This is the killer transparency feature: the user can see exactly what the helper has done.

### The stack
- React 18 + TypeScript on the frontend
- Vite + CRXJS for build / Manifest V3 packaging
- Tailwind CSS v4 for styling
- Zustand for state
- Web Crypto API (AES-GCM, PBKDF2) for the vault
- Ollama for all model inference (local-only)
- DuckDuckGo HTML endpoint as the default search provider

### Why this is a real differentiator
Most local AI extensions do one thing:
- ChatGPT-for-browser extensions: cloud-only, data leaves device
- Local-only Ollama wrappers: private but isolated, no internet, no memory
- Browser-native AI (Brave Leo, etc.): fixed model, no user control

Brave Helper combines: local-first by default, mode-isolated, vault-encrypted, multi-model (auto-routed), vision-capable, memory-augmented (RAG), and fully audited. Each capability is gated by an explicit user-visible state. The defaults are private. The user opts into power.

---

## Part 1: Architecture & System Design (Questions 1-20)

**1. What is the core problem this extension solves?**
It bridges the gap between large language models and real-time browser context without compromising user privacy, ensuring 100% of data processing occurs locally.

**2. Why use a Chrome Extension instead of a desktop app?**
Browser extensions have direct, native access to the DOM (via Content Scripts) and session state, allowing seamless extraction of forms, text, and active tab data without requiring users to copy-paste.

**3. Why Manifest V3 over V2?**
MV3 enforces better security by disallowing remotely hosted code, restricts background scripts to service workers (saving memory), and is the modern standard required by the Chrome Web Store.

**4. Why did you choose React for the Side Panel UI?**
React's component-based architecture is ideal for managing the complex, multi-tab state of the Side Panel (Chat, History, Vault, Forms) efficiently.

**5. How does the Side Panel communicate with the active webpage?**
Through Chrome's Message Passing API. The Side Panel (via `chrome.tabs.sendMessage`) sends a request to the Content Script injected into the active tab.

**6. Why use Zustand for state management instead of Redux or Context API?**
Zustand is boilerplate-free, extremely lightweight, and doesn't require wrapping the app in context providers, making it perfect for an extension environment where memory footprint matters.

**7. How do you handle asynchronous communication with the local LLM?**
Using the Fetch API to stream responses (`response.body.getReader()`) from the local Ollama server, allowing the UI to type out the response in real-time.

**8. Why use `@crxjs/vite-plugin`?**
It bridges Vite's hot-module replacement (HMR) with Chrome Extensions, automatically updating the manifest and reloading the extension during development.

**9. How does the system prevent the LLM from hallucinating regarding the page content?**
By injecting a structured markdown representation of the page (extracted by the content script) directly into the LLM's system prompt context.

**10. What happens if the local Ollama server is offline?**
The React UI catches the fetch failure, sets an `ollamaReachable` flag to false in Zustand, and displays a user-friendly error UI guiding them to start the daemon.

**11. Why separate `lib/page.ts` and `content/index.ts`?**
Separation of concerns. `lib/page.ts` acts as the strongly-typed client-side SDK for the Side Panel to request data, while `content/index.ts` is the actual DOM-manipulating executor.

**12. How does the system handle massive webpages that exceed context limits?**
The Content Script truncates `document.body.innerText` to `MAX_PAGE_TEXT` (e.g., 20,000 chars) and caps extracted links to `MAX_LINKS` (e.g., 200).

**13. What is the significance of the `OLLAMA_ORIGINS` environment variable?**
CORS protection. Ollama blocks cross-origin requests by default. `OLLAMA_ORIGINS="chrome-extension://*"` allows our extension to bypass CORS and communicate with `localhost:11434`.

**14. How do you ensure the extension doesn't slow down normal browsing?**
The Content Script is completely passive. It only executes DOM extraction logic when explicitly requested by a message from the Side Panel.

**15. Why use Tailwind CSS in this extension?**
Tailwind compiles down to a tiny CSS file containing only used classes, which is crucial for keeping the extension bundle size small while providing a highly customized, futuristic UI.

**16. Explain the "Zero-Knowledge" architecture of the Vault.**
The extension stores data encrypted. The decryption key is derived from a master password known only to the user. The password is never saved, so if lost, the data is mathematically unrecoverable.

**17. How do you handle routing in the Side Panel?**
Instead of a heavy library like `react-router`, routing is handled via a simple `activeTab` string state in Zustand ('chat', 'history', 'vault', 'form-fill').

**18. What is the purpose of `chrome.storage.local` vs `chrome.storage.sync`?**
`sync` has tight quota limits (100KB) and sends data to Google servers. `local` has much larger quotas (up to 5MB, or unlimited with `unlimitedStorage`) and keeps data strictly on-device.

**19. How do you manage the context window of large models (like Gemma 26B)?**
The `config/models.ts` file maps model names to safe `num_ctx` limits. This prevents Ollama from allocating too much VRAM and crashing on consumer hardware.

**20. How did you structure the project folders and why?**
`src/sidepanel` for UI, `src/content` for DOM manipulation, `src/lib` for pure functions and API wrappers. This modularity ensures UI components remain decoupled from extension-specific APIs.

---

## Part 2: Security & Web Crypto API (Questions 21-40)

**21. Why did you use Web Crypto API instead of a library like CryptoJS?**
Web Crypto API is natively built into the browser, executing at the C++ level. It's faster, doesn't add to the bundle size, and is generally more secure than third-party JS implementations.

**22. Explain how PBKDF2 works in your vault implementation.**
PBKDF2 (Password-Based Key Derivation Function 2) takes the user's password and a random salt, and hashes it iteratively (100,000 times) to generate a strong cryptographic key, defending against brute-force attacks.

**23. Why do you use a "salt" for key derivation?**
The salt prevents attackers from using precomputed hash tables (rainbow tables) to crack the master password.

**24. How is the salt stored?**
The salt is stored in plaintext via `chrome.storage.local`. It doesn't need to be secret; it just needs to be unique to the user's vault installation.

**25. What encryption algorithm did you choose and why?**
AES-GCM (Advanced Encryption Standard - Galois/Counter Mode). It provides both data confidentiality and authenticity (meaning tampering can be detected).

**26. What is an IV (Initialization Vector) and how is it used here?**
An IV introduces randomness to the encryption process so encrypting the same data twice yields different ciphertexts. We generate a random 12-byte IV for every save operation.

**27. How do you store the IV since it's needed for decryption?**
The IV is prepended to the encrypted ciphertext. When decrypting, we slice off the first 12 bytes to use as the IV and decrypt the remainder.

**28. What happens if the user enters the wrong master password?**
PBKDF2 derives an incorrect key. When `crypto.subtle.decrypt` attempts to decrypt the AES-GCM payload with the wrong key, it fails the authentication tag check and throws an error.

**29. Is the decrypted vault data ever written to disk?**
No. Once unlocked, the decrypted `VaultData` is held purely in the React memory space (via Zustand) and is garbage collected when the extension panel is closed.

**30. What prevents a malicious website from reading the extension's local storage?**
Chrome's extension architecture isolates `chrome.storage` to the extension's context. Webpages cannot access extension APIs or storage.

**31. How do you validate the strength of the master password?**
Currently, there is a simple length check (> 6 chars) before allowing setup, but the primary defense is the 100,000 iterations of PBKDF2.

**32. Can the vault data be synced across devices?**
No, by design. The data relies on `chrome.storage.local` to adhere to the strict local-first privacy requirements of the project.

**33. How does the app "lock" the vault?**
By setting `vaultData` and `vaultPassword` in the Zustand store to `null`, effectively purging the decrypted data and derived key from memory.

**34. Why do you encode the encrypted payload to Base64?**
`chrome.storage.local` stores JSON-serializable data. Web Crypto outputs `Uint8Array`s, which must be converted to Base64 strings for reliable storage and retrieval.

**35. What is the difference between `VaultProfile` and `VaultLogin`?**
`VaultProfile` stores identity data (Name, Email, Phone), whereas `VaultLogin` stores authentication credentials (URL, Username, Password).

**36. How do you handle UUIDs for Vault items?**
Using `crypto.randomUUID()`, which is a native, fast, and cryptographically secure way to generate unique IDs for CRUD operations.

**37. What happens if the storage data gets corrupted?**
The JSON parsing or the AES-GCM decryption will throw an error, which the UI catches to inform the user that the vault is corrupted or the password is wrong.

**38. Could a malicious extension read this extension's storage?**
No. Extension storage is sandboxed. Extensions cannot read each other's `chrome.storage.local` unless explicitly passed via messaging.

**39. Why not use `localStorage` instead of `chrome.storage.local`?**
`localStorage` is bound to the window's origin and is synchronous, which can block the main thread. `chrome.storage.local` is asynchronous and specific to the extension environment.

**40. Are the screenshots encrypted in the vault?**
No, currently screenshots and chat histories are saved separately in `chrome.storage.local` unencrypted, as they are considered ephemeral browsing data, not highly sensitive credentials.

---

## Part 3: Content Scripts & DOM Manipulation (Questions 41-60)

**41. What is the role of a Content Script?**
It is JavaScript that executes in the context of a webpage, allowing it to read details of the web pages the browser visits and make changes to them.

**42. How do you extract form data from a webpage?**
The script queries `document.querySelectorAll('form')` and iterates through them, finding all associated `input`, `select`, and `textarea` elements.

**43. Some modern React/SPA apps don't use `<form>` tags. How do you handle this?**
The extraction logic also queries for all inputs globally, tracks which ones were inside a `<form>`, and groups the remaining "orphan" inputs into a pseudo-form.

**44. How do you generate a unique CSS selector for an input?**
First, by checking for a unique `id`. Then, by `name` attribute. If neither exists, it traverses up the DOM tree building an `nth-of-type` path.

**45. How do you determine the "label" of an input field?**
The script checks `aria-label`, then looks for a wrapping `<label>` parent, then checks for a `<label for="id">`, and falls back to the `placeholder` or `name` attribute.

**46. How do you determine if a field is actually visible to the user?**
By checking if `input.offsetWidth`, `input.offsetHeight`, or `input.getClientRects().length` are greater than zero.

**47. How does the Side Panel trigger the form extraction?**
It sends a `PageMessage` with `{ type: 'extractForms' }` via `chrome.tabs.sendMessage` to the active tab.

**48. How do you handle filling React/Vue controlled inputs?**
Simply changing `input.value` isn't enough for SPAs. We must also dispatch an `input` and `change` event (`el.dispatchEvent(new Event('input', { bubbles: true }))`) so the framework's state updates.

**49. Why do you use `bubbles: true` when dispatching events?**
Framework event listeners are often attached at the document root (event delegation). If the event doesn't bubble up, the framework won't detect the change.

**50. What is `MAX_PAGE_TEXT` and why is it necessary?**
It truncates the `innerText` of a page to prevent passing a massive string to the LLM, which would exceed token limits and cause memory exhaustion on local hardware.

**51. How do you extract relevant links from a page?**
By querying `a[href]`, keeping track of seen URLs using a `Set` to remove duplicates, and limiting the result to the first 200 links.

**52. What is `CSS.escape()` and why use it in selector generation?**
If an element's ID or name contains special characters (like `:` or `.`), `CSS.escape` ensures it is safely formatted so `document.querySelector` doesn't throw a syntax error.

**53. How do you ensure the Content Script doesn't crash the host page?**
All message listeners are wrapped in `try/catch` blocks. Any errors are caught and returned as a `PageErrorResponse` (`{ ok: false, error: ... }`) back to the extension.

**54. Can the Content Script access the `chrome.storage` API directly?**
Yes, Content Scripts can access `chrome.storage`, but in this architecture, they act as pure DOM workers. Storage logic is centralized in the Side Panel to maintain a single source of truth.

**55. How do you debug Content Scripts?**
You must open the Chrome DevTools on the specific webpage where the script is injected, not the DevTools for the extension Side Panel.

**56. What happens if the user refreshes the page during an extraction?**
The message port disconnects, and `chrome.tabs.sendMessage` throws a "Receiving end does not exist" error, which the Side Panel catches and displays as a friendly prompt to refresh.

**57. How do you ensure you only get the active tab's context?**
By querying `chrome.tabs.query({ active: true, lastFocusedWindow: true })`.

**58. How do you handle password fields during extraction?**
The extraction reads `input.type` to identify password fields. In the UI, the values for these fields are obfuscated (e.g., '••••••••') to prevent shoulder surfing.

**59. Why is `document.body.innerText` used instead of `innerHTML`?**
`innerText` returns the visible text rendered on the screen, omitting hidden elements, scripts, and HTML tags, resulting in cleaner, token-efficient data for the LLM.

**60. Can the extension bypass Captchas?**
No. The extension interacts with standard DOM elements. It does not contain bypassing logic or visual AI reasoning for captchas.

---

## Part 4: React, Zustand & State Management (Questions 61-80)

**61. What is the advantage of the `useAppStore` hook over Context API?**
Zustand's `useAppStore` allows components to subscribe only to the specific slices of state they need, preventing unnecessary re-renders across the application.

**62. How does Zustand handle asynchronous actions?**
Zustand doesn't require middleware like Redux Thunk. You can write async functions directly in components that call Zustand's synchronous setter functions.

**63. How is the streaming chat state managed?**
We maintain a `messages` array. As chunks arrive, `appendToMessage(id, chunk)` locates the message by ID and concatenates the chunk, triggering a re-render to simulate typing.

**64. What is the purpose of the `abortRef` in `SidePanel.tsx`?**
It holds an `AbortController`. If the user hits "Stop Generating", `abortRef.current.abort()` cancels the fetch request to the Ollama server instantly.

**65. Why use a `useEffect` with an empty dependency array in `SidePanel.tsx`?**
To run initialization logic exactly once when the Side Panel mounts: verifying Ollama connectivity, loading models, and restoring the last chat session.

**66. How do you auto-scroll to the bottom of the chat?**
Using a `useEffect` that depends on `messages`. It accesses a `scrollRef` attached to the chat container and sets `scrollTop = scrollHeight`.

**67. What is a "slash command" in this context?**
It is a UI intercept. Before sending a message to the LLM, `runCommand` checks if the input starts with `/`. If so, it executes a local function (like clearing state) instead of querying the AI.

**68. How are components separated in the `src/sidepanel` directory?**
The main `SidePanel.tsx` manages routing and the chat interface. Heavy sub-views like `VaultView` and `HistoryView` are extracted into their own files to keep code readable.

**69. How do you handle conditional rendering of tabs?**
Using simple ternary operators or `if/else` logic based on the `activeTab` state: `{activeTab === 'vault' ? <VaultView /> : ... }`.

**70. What is `Lucide-React`?**
A popular, lightweight SVG icon library used for consistent, scalable, customizable iconography throughout the extension.

**71. How do you manage form state in the Vault UI?**
Using local `useState` hooks for temporary editing states (`editingProfile`, `editingLogin`), pushing to Zustand's global `vaultData` only when the user clicks "Save".

**72. Why use `useMemo` for the autofill matching logic?**
The matching algorithm loops through extracted forms and vault data. `useMemo` ensures this expensive calculation only re-runs when the active forms or selected profile changes, not on every render.

**73. How do you obfuscate the master password in the Vault setup?**
By using standard HTML `<input type="password" />` elements.

**74. What is the significance of the `streaming: boolean` flag in `ChatMessage`?**
It tells the UI to render a pulsing cursor/loader animation on that specific message while chunks are still arriving.

**75. How does the UI indicate that the vault is locked vs unlocked?**
When locked, `VaultView` renders an authentication form. When unlocked, it renders the CRUD lists for Profiles and Logins.

**76. How do you handle React component unmounting during a stream?**
The `useEffect` cleanup function or `try/finally` blocks ensure `isStreaming` is set to false and connections are cleanly terminated if the panel closes.

**77. Why use Tailwind's `opacity-0 group-hover:opacity-100`?**
To create clean, modern UIs where action buttons (like edit/delete) only appear when the user hovers over the specific list item, reducing visual clutter.

**78. How does `captureVisibleScreenshot` work in React?**
It calls `chrome.tabs.captureVisibleTab`, which returns a Base64 data URI, which is then opened in a new tab via `chrome.tabs.create`.

**79. Why filter hidden fields before passing them to the UI?**
Hidden fields (like CSRF tokens) cannot be autofilled by a user manually and clutter the UI. `filter(f => f.isVisible)` ensures the user only reviews actionable inputs.

**80. What is the role of `crypto.randomUUID()` in the Zustand store?**
It is used to generate guaranteed unique IDs for new chat messages, preventing key-collision errors in React's rendering loop.

---

## Part 5: Local LLMs & Chrome Extensions MV3 (Questions 81-100)

**81. What is Ollama?**
A lightweight, extensible framework for running, managing, and interacting with large language models locally on macOS, Linux, and Windows.

**82. Why use Gemma models?**
Google's Gemma models are highly capable open-weights models that fit well into consumer VRAM (especially 4B and quantized 26B versions), offering excellent reasoning.

**83. How do you format the prompt for the Ollama API?**
Using the `/api/chat` endpoint, passing an array of message objects (`{ role: 'user', content: '...' }`).

**84. Where does the page context go in the API request?**
It is formatted as a Markdown string and injected as a `system` message at the beginning of the chat array.

**85. What is the `num_ctx` parameter in Ollama?**
It defines the maximum context window (in tokens) the model is allowed to use. Higher values require more VRAM.

**86. Why cap `num_ctx` to 65,536 for Gemma 26B?**
Because a fully populated 26B model combined with an unlimited context window will easily exceed 16GB/24GB of VRAM, causing an Out-Of-Memory (OOM) crash on the server.

**87. What does `stream: true` do in the Ollama API?**
It keeps the HTTP connection open and sends the response back in chunks (JSON-lines) as the model generates them, rather than waiting for the entire generation to finish.

**88. How do you parse a streamed response in JavaScript?**
Using `TextDecoder` to convert the binary `Uint8Array` stream into a string, splitting by newlines, and parsing each line with `JSON.parse`.

**89. Why might Chrome reject an extension on the Web Store if it executes remote code?**
Executing remote code violates Manifest V3 policies designed to protect users from dynamic malware injection. Our extension only runs bundled code and local network requests.

**90. How does MV3 handle Service Workers compared to MV2 Background Pages?**
MV3 Service workers are ephemeral; they spin down when idle to save memory. They cannot use the DOM or `window` object.

**91. Why is there no background Service Worker in this project's current architecture?**
All active logic (LLM API calls, storage) is managed by the Side Panel React app, which acts as the persistent lifecycle owner while open.

**92. How do you configure Vite to output a Chrome Extension?**
By using `@crxjs/vite-plugin` and passing a `manifest.config.ts` file, Vite knows how to compile content scripts and HTML entry points separately.

**93. What permissions are requested in the Manifest?**
`sidePanel`, `activeTab`, `scripting`, and `storage`.

**94. What does the `activeTab` permission allow?**
It gives the extension temporary access to the currently focused tab when the user invokes the extension, without needing broad `*://*/*` host permissions.

**95. How does the Side Panel API differ from a Popup?**
Popups close immediately when the user clicks away. Side Panels persist across tab changes, making them ideal for continuous chat sessions.

**96. Can the local LLM access the internet?**
No. Ollama runs entirely offline. The model only knows what it was trained on and the context text our extension extracts and feeds to it.

**97. How do you handle JSON parsing errors during stream reception?**
By accumulating incomplete chunks in a buffer variable and attempting to parse only complete lines (`\n` separated).

**98. What is the "System Prompt" configured in `models.ts`?**
It dictates the persona and strict behavioral constraints of the AI (e.g., "You are a fast local research assistant in Brave's side panel... default to short, 1–3 sentences... never claim you can't see the page when context contains text").

**99. Why implement a "Clear" button instead of just restarting?**
Clearing purges the `messages` array in Zustand, stopping the context from growing indefinitely and saving processing time for the LLM on subsequent queries.

**100. How would you scale this to support cloud LLMs (like OpenAI)?**
By adding a configuration menu to swap the `baseUrl` from `localhost:11434` to `api.openai.com`, adding an API Key input field to the Vault, and mapping the payload to OpenAI's schema.

---

## Part 6: V3.0 — Modes, Vision, RAG, Audit (Questions 101-120)

**101. What's the architectural commitment summarized in one line?**
The model READS, never WRITES — all outbound public-internet HTTP is GET-only, enforced by a single chokepoint (`lib/http.ts::safeFetch`).

**102. Why is privacy "architectural" instead of "policy"?**
Because there's no `POST` code path in the extension that ships user data outbound. Even if the model misbehaved, no exfiltration tool exists in its toolset. Compare that to a policy claim ("we promise we don't…") — code-level guarantees survive bugs and intent changes.

**103. What are the two modes in V3.0 and why mutually exclusive?**
Research (vault locked, web on) and Autofill (vault unlocked, web off). The harm path is "credentials are reachable + network is reachable → exfiltration possible," so we enforce that those two states never overlap.

**104. Where is the mode actually stored?**
Nowhere directly. It's derived from `vaultData !== null` via `deriveMode()`. Keeping it derived (single source of truth) means accidental drift between vault state and "what the UI thinks the mode is" is impossible.

**105. What does `capabilitiesFor(mode)` return?**
A capability map: `{ pageReading, vaultAccess, webSearch, urlFetch, screenshots, memoryRecall }`. Consumers query the relevant flag at the call site (e.g. `/search` checks `caps.webSearch` and refuses if false).

**106. How is the vision model wired?**
`/ask <prompt>` captures the visible tab via `chrome.tabs.captureVisibleTab`, strips the `data:image/png;base64,` prefix, and POSTs to Ollama's `/api/generate` with `images: [base64]` against `llava:7b`. Streams response chunks the same way as `/api/chat`.

**107. Why use Ollama's `/api/generate` for vision instead of `/api/chat`?**
LLaVA is single-turn vision; `/api/generate` is the simpler endpoint for "image + prompt → text" without conversation memory. `/api/chat` would also work but adds turn-management overhead we don't need for screenshot Q&A.

**108. What's the embedding model and why that one?**
`nomic-embed-text` — 274 MB, runs via Ollama's `/api/embeddings` endpoint, produces 768-dim vectors, fast on CPU. Small enough to leave loaded without competing for VRAM with the chat tier.

**109. How is the vector store implemented?**
Simple linear cosine search over `chrome.storage.local`, capped at 500 records. That's fine for hundreds of saved pages — when the user has thousands, we'd switch to IndexedDB + an ANN index (HNSW). For now, simple wins.

**110. Why doesn't the vault get indexed into the embeddings?**
The vault contains credentials. Even though embeddings are local, generating an embedding turns a credential into a vector that lives forever in cosine-search-able form. Cleaner rule: vault data never leaves the encrypted store.

**111. What gets logged in the audit panel?**
Mode transitions, vault unlock/lock, outbound web requests (URL + query summary), page reads, screenshots, autofill executions, model switches, memory recalls, and auto-route decisions. Each entry has a timestamp, the mode at the time, a human-readable summary, and optional structured details.

**112. Why is the audit log append-only?**
Tamper resistance and trust. If the user could edit entries, the log would be useless as a privacy receipt. Entries are only purged en masse after the retention window (default 30 days) via `pruneAudit()` on init.

**113. What's the retention story for the audit log?**
2000-entry cap (FIFO when full) + 30-day default retention. Pruning runs on extension init. The user can also clear the entire log from the AUDIT tab — that action itself is logged so "who cleared the log when" is recoverable from the next entry's timestamp.

**114. How does `/search` defend against credential leak?**
Two layers: (a) at runtime, the slash command checks `capabilitiesFor(mode).webSearch` and refuses when the vault is unlocked; (b) at architecture, `safeFetch` is GET-only — the search query goes in the URL (same as the user typing it into ddg.com), the request body is empty.

**115. What's the response-size cap and why?**
200 KB default in `safeFetch`. Streams the body and stops reading once the cap is hit. Prevents a malicious search response from filling memory or eating the model's context budget.

**116. Why DuckDuckGo over Google or Bing?**
DDG's HTML endpoint requires no API key, has no tracking cookies, and is parseable with a small regex. Brave Search is a planned alternative (better quality, requires API key); DDG is the safe default.

**117. Why parse DDG with regex instead of `DOMParser`?**
We don't trust third-party HTML to not contain hostile script tags or unbounded structure. A regex extracts just the title/url/snippet fields and never instantiates DOM nodes from remote content.

**118. What are `MemoryFact`s and how do they differ from RAG?**
Memory facts are short, user-curated strings about the user (e.g., "name: Rudransh") injected into every system prompt. RAG (in `vectorstore.ts`) is large embedded text bodies retrieved on demand for `/recall`. Different scopes: facts are persistent identity, RAG is searchable content.

**119. Why default chat to concise and require `/describe` for long answers?**
Cognitive load + speed. A research assistant that drowns you in essays isn't helpful. Default to the answer the user asked for; promote depth to an explicit opt-in. Costs nothing if you don't use it.

**120. How does the cold-start unload work and why?**
On extension init, `unloadAllModels(PROJECT_MODELS.map(m => m.name))` fires `keep_alive: 0` to every configured tier model in parallel. Awaited (not fire-and-forget) so the eviction completes before any later step could re-warm Ollama. Result: opening the side panel doesn't load any model into VRAM until the user actually sends a message.

---

## Part 7: V4.0 — Auto-Router (Questions 121-130)

**121. What problem does the V4.0 auto-router solve?**
The user shouldn't have to think about which model tier to pick. A short greeting doesn't need the 20B Smart model; a code question shouldn't go to the general 9B. The router picks per-message.

**122. How does the router actually work?**
Before sending the real request, we POST the user's message to the Fast model (`qwen3.5:9b`) with a JSON-only classification system prompt. The model returns `{"tier":"code"}` (or fast/balanced/smart/vision). The system loads the chosen specialist and runs the actual inference.

**123. What configuration makes the router fast and deterministic?**
`temperature=0.0` (same input → same output), `num_ctx=2048` (tiny context, classification is short), `num_predict=32` (we only need ~10 tokens for the JSON), `stream=false` (atomic response). Total overhead ~50–150 tokens, ~0.3 s on a 16 GB card.

**124. What if the router fails (timeout, parse error, model not loaded)?**
Silent fallback to `'balanced'` — the safest middle ground. We never block the user on classification failure. A defensive 8-second `AbortController` timeout prevents indefinite hangs.

**125. How does the parser handle messy router output?**
`parseRouterResponse` tries four strategies in order: direct `JSON.parse`, markdown-code-fence extraction, inline `{"tier":"..."}` regex anywhere in the response, and last-resort bare tier-name match. Lenient by design — small models occasionally wrap their output in prose despite a strict prompt.

**126. Why are slash commands fast-pathed past the router?**
Slash commands have explicit semantics — `/code` already names the tier. Re-classifying would be wasted compute. Same for image attachments: those always go to vision, no classification needed.

**127. What's the cost-benefit of running a router on every message?**
Cost: ~0.3 s + 50 tokens. Benefit: never running a 13 GB model on a one-line greeting, never running a 6.6 GB model on a 5-step code refactor. Net win on both latency and quality once the user's message volume crosses ~10 messages.

**128. Why is the router model the *smallest* one, not a dedicated classifier?**
We didn't want to ship a separate 100 MB classifier. The Fast 9B is already pulled and loaded for chat. Reusing it for classification means one fewer artifact to maintain, one fewer download for the user, and the model's general intelligence handles edge cases (e.g., "fix this React bug") that a keyword classifier would miss.

**129. How does the router decide between Fast and Smart?**
The router prompt gives explicit decision rules: short conversational messages → fast, multi-step reasoning / writeups → smart. Code keywords (`function`, `error`, language names, framework names, file extensions) → code. Anything visual ("this image", "screenshot") → vision. Default is balanced when uncertain.

**130. Could you replace the auto-router with a real intent classifier model in the future?**
Yes — `lib/router.ts` is a single function (`classifyIntent`) that returns a `ModelTier`. Swap the implementation to call a fine-tuned BERT classifier or a small dedicated routing model. The rest of the codebase doesn't change. That's the upgrade path if classification accuracy ever becomes a bottleneck.

---

### End of Document
*Compiled for portfolio demonstration and technical review.*
