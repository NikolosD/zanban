# Zanban

Desktop AI meeting assistant — a stealth overlay that captures your mic and the system loopback (the other speaker), transcribes both in real time, and answers questions via your LLM of choice.

> Functional analogue of Cluely, built from scratch under your own brand.

## Stack

- **Electron 33** + **electron-vite** + **TypeScript**
- **React 19** + **TanStack Query** + **Tailwind 4** + **Zustand** + **Lucide**
- **STT providers** — Deepgram Nova-3 (default), Google Cloud Speech, OpenAI Whisper, ElevenLabs Scribe, local Whisper (`@xenova/transformers`)
- **LLM providers** — Vercel AI Gateway (default), Anthropic, OpenAI, Google Gemini, Groq, Ollama (local). Vision can ride a different provider than text.
- **Web search** — Tavily, optional, auto-injected on factual lookups
- **RAG** — `better-sqlite3` + `sqlite-vec` over the user's own past sessions
- **Document context** — PDF / DOCX / TXT / MD ingestion (`pdf-parse`, `mammoth`)
- **Screenshots** — full screen + drag-region cropper, OCR via Tesseract
- **electron-builder** + **electron-updater** + GitHub Releases

## Quickstart

```bash
pnpm install
cp .env.example .env   # fill at least one LLM key + one STT credential
pnpm dev
```

For production keys use the in-app **Settings → AI / Audio** panel — values are stored encrypted in the OS keychain (`safeStorage` → DPAPI on Windows, Keychain on macOS, libsecret on Linux).

`Privacy mode` (Settings → AI) flips both LLM and STT to local providers in one click — Ollama + local Whisper. Nothing leaves the machine.

## Scripts

```bash
pnpm dev          # electron-vite dev — main + preload + 4 renderer entries
pnpm build        # production build
pnpm typecheck    # tsc --noEmit on both web + node configs
pnpm test         # vitest run
pnpm lint         # eslint . (flat config + react-hooks + prettier)
pnpm format       # prettier --write .
pnpm analyze      # ANALYZE=1 build → out/bundle-stats.html
pnpm icons        # regenerate resources/icon.png variants from the SVG
pnpm dist         # local installer in release/
```

A pre-commit hook (`husky` + `lint-staged`) auto-formats staged files and runs ESLint on them. Pre-push runs `typecheck` + `test`.

## Build & release

```bash
git tag v0.1.0
git push --tags           # GitHub Actions builds + publishes installer + latest.yml
```

The release publish target is wired in `electron-builder.yml` (provider: github · owner: NikolosD · repo: zanban). Auto-update reads the same channel.

## Hotkeys (default; rebindable in Settings → Hotkeys)

- `Ctrl+\` — toggle overlay
- `Ctrl+Shift+Space` — focus AI input
- `Ctrl+Shift+Enter` — answer the last detected question
- `Ctrl+Shift+H` — toggle stealth (visible / invisible to screen-share)
- `Ctrl+Shift+S` — full-screen screenshot → Ask
- `Ctrl+Shift+Alt+S` — drag a region → OCR Ask
- `Ctrl+Shift+G` — open the standalone chat window
- `Ctrl+Shift+D` — force-show the dashboard (escape hatch from stealth + hide-widget)

## Privacy

Recording meetings without all parties' consent is illegal in two-party-consent jurisdictions. The overlay shows a recording pulse while capturing.

`setContentProtection(true)` keeps the overlay invisible to Zoom / Meet / Teams screen shares; the dashboard window uses the same posture. Audio + transcripts can be kept fully on-device via Privacy mode (Ollama + local Whisper).

## Project layout

See [AGENTS.md](./AGENTS.md) for the directory map, IPC pattern, and recipes for adding a provider / hotkey / prompt.
