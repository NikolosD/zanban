# Zanban

AI meeting assistant — desktop overlay that listens to your meeting (mic + system audio), transcribes in real time via Deepgram, and answers questions via Vercel AI Gateway (DeepSeek + Mimo).

> Functional analogue of Cluely, built from scratch under your own brand.

## Stack

- **Electron** + **electron-vite** + **TypeScript**
- **React 19** + **TanStack Query/Router** + **Tailwind 4** + **Floating UI** + **Lucide**
- **Deepgram** Nova-3 (streaming, two channels: mic + system loopback)
- **Vercel AI Gateway** — DeepSeek v4 (answers) + Mimo v2.5 (titles)
- **electron-builder** + **electron-updater** + GitHub Releases

## Quickstart

```bash
pnpm install
cp .env.example .env   # fill DEEPGRAM_API_KEY, AI_GATEWAY_API_KEY
pnpm dev
```

For production keys you can use the in-app **Settings** panel — values are stored encrypted (DPAPI on Windows via `safeStorage`).

## Build & release

```bash
pnpm dist                 # local installer in release/
git tag v0.1.0
git push --tags           # triggers GitHub Actions, publishes installer + latest.yml
```

The `appId`, `protocol`, and `publish.owner` in `electron-builder.yml` need to be filled in before the first release.

## Hotkeys (default; rebindable in Settings)

- `Ctrl+\` — toggle overlay
- `Ctrl+Shift+Space` — focus AI input
- `Ctrl+Shift+Enter` — answer the last detected question
- `Ctrl+Shift+H` — hide/show

## Privacy

Recording meetings without all parties' consent is illegal in two-party-consent jurisdictions. The overlay shows a `REC` badge while capturing; cloud sync is opt-out in Settings.

The overlay window uses `setContentProtection(true)` — it is invisible in Zoom/Meet/Teams screen shares.
