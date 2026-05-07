# How to start — Brave Helper (V4.0)

A local-first AI side-panel extension for Brave / Chromium. All inference runs on your machine via Ollama. Nothing about your browsing leaves your device.

This guide gets you from a fresh checkout to a working extension. ~15 minutes if Ollama is already installed.

---

## 1. Prerequisites

### Hardware
- **GPU recommended** — 16 GB VRAM is the sweet spot. The default tier set fits comfortably with headroom for context.
- **Minimum** — 8 GB VRAM if you only use Fast (`qwen3.5:9b`) and Vision (`llava:7b`). Drop the Smart and Code tiers from your install list.
- **CPU-only also works** but inference will be slow (10–30× slower than GPU).
- **Disk** — ~50 GB free for the full model set, or ~12 GB for Fast + Vision + Embeddings only.

### OS
- **Linux** — tested on Ubuntu 22.04+, Fedora 39+, Arch.
- **Windows** — Windows 10 / 11 with WSL2 OR native Windows. Ollama supports both.
- **macOS** — works (Apple Silicon recommended).

### Software
| Tool | Version | Why |
|------|---------|-----|
| Node.js | 18 LTS or newer | Build the extension |
| npm | 9+ | Comes with Node |
| Brave | latest stable | Or any Chromium 114+ (Chrome, Edge, Arc) |
| Ollama | 0.1.30+ | Local LLM runtime |
| ImageMagick | optional | Only if you want to regenerate icons from a new logo |

---

## 2. Install Ollama

### Linux
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

Verify it's running:
```bash
ollama --version
systemctl status ollama
```

If `systemctl` doesn't show it, start manually:
```bash
ollama serve
```

### Windows
1. Download the installer from <https://ollama.com/download/windows>
2. Run `OllamaSetup.exe` — it installs as a background service.
3. Open PowerShell and verify:
   ```powershell
   ollama --version
   ```

### macOS
```bash
brew install ollama
brew services start ollama
```

Or download the `.dmg` from <https://ollama.com/download/mac>.

---

## 3. Configure Ollama for the extension

Browser extensions live on a `chrome-extension://...` origin. By default Ollama rejects requests from that origin for safety. You need to allow it.

### Linux (systemd)
```bash
sudo systemctl edit ollama.service
```

Add this block in the editor that opens:
```ini
[Service]
Environment="OLLAMA_ORIGINS=*"
```

Save, then:
```bash
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

(Use `OLLAMA_ORIGINS=chrome-extension://*` if you want to be stricter and only allow extension requests.)

### Linux (manual `ollama serve`)
```bash
OLLAMA_ORIGINS=* ollama serve
```

Add it to your `~/.bashrc` or `~/.zshrc` so it persists:
```bash
export OLLAMA_ORIGINS=*
```

### Windows
1. Open **System → About → Advanced system settings → Environment Variables**
2. Under **User variables** click **New…**
3. Name: `OLLAMA_ORIGINS` — Value: `*`
4. Click OK, then quit and restart Ollama from the system tray.

(Or run `setx OLLAMA_ORIGINS "*"` in PowerShell, then restart Ollama.)

### macOS
```bash
launchctl setenv OLLAMA_ORIGINS "*"
brew services restart ollama
```

### Verify the origin fix
```bash
curl http://localhost:11434/api/tags
```
If you get JSON back without errors, Ollama is up and reachable.

---

## 4. Pull the models

The extension uses six models. Pull what you want — missing ones just won't appear in the model selector.

| Tier | Model | Size | Required? | Used for |
|------|-------|------|-----------|----------|
| Fast | `qwen3.5:9b` | 6.6 GB | **Yes** (the auto-router classifies with this) | Default chat, summaries, autofill |
| Balanced | `qwen3:14b` | 9.3 GB | recommended | Page Q&A, form analysis |
| Smart | `gpt-oss:20b` | 13 GB | optional | Deep reasoning, long writeups |
| Code | `qwen2.5-coder:14b` | 9 GB | optional | Auto-engaged on dev pages |
| Vision | `llava:7b` | 4.7 GB | recommended | `/ask` screenshot Q&A |
| Embeddings | `nomic-embed-text` | 274 MB | recommended | RAG (`/recall`) and `/save` indexing |

Pull them all (~50 GB total):
```bash
ollama pull qwen3.5:9b
ollama pull qwen3:14b
ollama pull gpt-oss:20b
ollama pull qwen2.5-coder:14b
ollama pull llava:7b
ollama pull nomic-embed-text
```

Or pull just the minimum (~12 GB):
```bash
ollama pull qwen3.5:9b
ollama pull llava:7b
ollama pull nomic-embed-text
```

Verify:
```bash
ollama list
```

---

## 5. Build the extension

### Get the code
```bash
git clone <repo-url> brave-helper
cd brave-helper
```

### Install dependencies
```bash
npm install
```

### Build
```bash
npm run build
```

This produces `dist/` — that's the unpacked extension folder.

For active development, use `npm run dev` instead — Vite watches files and rebuilds on save. You still need to reload the extension in Brave to pick up changes.

---

## 6. Load the extension in Brave

1. Open Brave and go to `brave://extensions`
2. Toggle **Developer mode** on (top-right)
3. Click **Load unpacked**
4. Select the `dist/` folder from the project
5. Pin the extension icon to the toolbar — click the puzzle-piece icon → pin

Click the cyber-lion icon to open the side panel. The header should show **🟢 LOCAL AI ACTIVE**. If it shows red / "AI Offline," see Troubleshooting below.

---

## 7. First-time setup inside the extension

1. **Pick a model** — the dropdown in the header defaults to `⚡ AUTO`. Auto routes every message to the right specialist (Fast for greetings, Code for programming, etc.). You can also pin a specific tier.
2. **Hard-refresh the page you want to talk about** — `Ctrl+Shift+R` (Linux/Win) or `Cmd+Shift+R` (mac). The content script needs to inject on a fresh load.
3. **Click "Sync"** in the side panel header to capture the page.
4. **Try it** — type *"summarize this page"* or *"what's on screen"*.

### Slash commands
| Command | Effect |
|---------|--------|
| `/start` | Clear chat + re-sync the current page |
| `/clear` | Clear chat |
| `/summary` | Concise summary of the current page |
| `/describe <q>` | Long, structured answer for one turn (default chat is concise) |
| `/save` | Save page snapshot + auto-index for `/recall` |
| `/takeSS` | Screenshot the visible tab |
| `/ask <prompt>` | Vision Q&A on the visible tab (uses `llava:7b`) |
| `/search <query>` | Web search via DuckDuckGo (Research mode only) |
| `/recall <query>` | RAG over your saved pages |
| `/fast` `/balanced` `/smart` `/code` | Pin a model tier |
| `/auto` | Re-enable the auto-router |

### Vault setup (optional)
1. Click the **VAULT** tab
2. Set a master password — this encrypts everything you store
3. Add logins / profiles
4. Unlocking the vault auto-switches the helper to **Autofill mode** (web access cuts; vault data becomes accessible to the model). Locking returns to **Research mode**.

---

## 8. Updating an existing install

```bash
git pull
npm install        # in case dependencies changed
npm run build
```

Then in `brave://extensions`, click the refresh icon on the extension card. New build picks up automatically.

---

## 9. Troubleshooting

### "AI Offline" or "Ollama unreachable"
- Is `ollama serve` running? (`systemctl status ollama` on Linux)
- Did you set `OLLAMA_ORIGINS`? Test: `curl -H "Origin: chrome-extension://test" http://localhost:11434/api/tags` — should return JSON, not 403.
- Restart Ollama after setting the env var.

### Extension won't load — manifest errors
- Run `npm run build` again. Make sure you're loading `dist/`, not the project root.
- Check that `dist/manifest.json` exists.

### Side panel opens but model dropdown is empty
- Pull at least one tier model: `ollama pull qwen3.5:9b`
- Click the refresh icon next to the model selector.

### Page sync says "page hasn't loaded helper yet"
- Hard-refresh the page (`Ctrl+Shift+R`).
- Some pages can't be inspected — `chrome://`, `brave://`, the Web Store. The content script can't run there.

### Model is slow / GPU not used
- Check `nvidia-smi` (Linux/Win) — is the model loaded into VRAM?
- If it's spilling to system RAM, the model is too big for your card. Use a smaller tier (`/fast`).
- Make sure the model fits: 16 GB VRAM card → stick to ≤13 GB models. The default Smart tier (`gpt-oss:20b`, 13 GB) is the largest that fits cleanly.

### Auto-router picked the wrong tier
- Override for one message with a slash command (`/code`, `/smart`, etc.)
- The router uses Fast (`qwen3.5:9b`) for classification — it's fast but not infallible. Manual pin is always available.

### `/search` says "web search disabled"
- You're in Autofill mode (vault unlocked). Lock the vault (vault tab → lock) and try again. This is the deliberate isolation: web access is cut whenever credentials are reachable.

### Build fails with Node version error
- Need Node 18+. Check with `node --version`. Upgrade via [nvm](https://github.com/nvm-sh/nvm) on Linux/mac, or [fnm](https://github.com/Schniz/fnm) on Windows.

---

## 10. Daily start-up checklist

Once everything is set up, the daily flow is:
1. Ensure Ollama is running (it usually starts automatically as a service).
2. Open Brave → click the cyber-lion → side panel opens.
3. Hard-refresh the page you want to chat about → click Sync.
4. Type your question. Auto-router picks the right model.

That's it.

---

## 11. Where everything lives

```
brave-helper/
├── manifest.json          ← extension manifest, points at dist/ outputs after build
├── howtostart.md          ← this file
├── README.md              ← project overview
├── assets/
│   ├── icons/             ← toolbar + extension-list icons
│   ├── logo-square.png    ← master logo (regen icons from this)
│   └── favicon.png        ← favicon for the side-panel HTML
├── docs/
│   ├── interview_qa.md
│   └── plan/              ← v1 → v4 architecture history
├── project-models/        ← system prompts, one per tier + router
├── src/
│   ├── background/        ← service worker (panel open)
│   ├── content/           ← page snapshot + form extraction
│   ├── sidepanel/         ← React UI
│   ├── lib/               ← Ollama, vision, search, vault, audit, RAG, router, mode
│   ├── store/             ← Zustand store
│   └── config/models.ts   ← tier definitions + system prompt imports
└── dist/                  ← build output (loaded as unpacked extension)
```

---

## 12. Privacy / network behavior

- All inference: `localhost:11434` (Ollama).
- Web search: only when Research mode is active (vault locked). Goes to `https://html.duckduckgo.com/` via the GET-only `safeFetch` wrapper. No POSTs, no body uploads.
- No telemetry, no analytics, no remote endpoints. Confirm by inspecting `host_permissions` in `manifest.json`.
- Vault: AES-GCM encrypted, key derived from your master password via PBKDF2. Stored in `chrome.storage.local`. Never transmitted.
- Audit log: every privacy-relevant action (mode switch, web fetch, page read, vault unlock) is logged locally. Open the **AUDIT** tab to inspect.

---

## 13. Asking for help

If something breaks:
1. Open the AUDIT tab — recent events often explain what happened
2. Open Brave's DevTools on the side panel (right-click the panel → Inspect) — check the Console
3. Check `ollama logs` on Linux: `journalctl -u ollama -f`

Good luck. Have fun.
