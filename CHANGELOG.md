# Changelog

All notable changes to Zanban are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- App icon (SVG source + generated PNGs) wired into every BrowserWindow and
  the macOS dock.
- Native macOS app menu (App / Edit / Window with role-driven items); no
  menu bar at all on Windows / Linux.
- Cross-platform "Hide from app switcher" setting — replaces the previous
  macOS-only `hideDockMacOS` toggle. Drops Zanban from the dock + Cmd+Tab on
  macOS and from the taskbar + Alt+Tab on Windows / Linux.
- Vitest with 47 tests across pure functions (prompts, dateFormat, hotkeys,
  KeyRecorder.prettyAccelerator, modelFor, system + vision + user prompt
  builders).
- ESLint flat config + Prettier; husky pre-commit (lint-staged) and
  pre-push (typecheck + test) hooks.
- GitHub Actions CI workflow (lint + typecheck + test + build) on push to
  main / `claude/*` branches and on every PR.
- Bundle visualizer behind `ANALYZE=1` (drops `out/bundle-stats.html`).
- AGENTS.md as orientation guide for future contributors / AI agents.
- README.md refreshed for the actual provider matrix.

### Changed
- Markdown rendering now lazy-loaded — the previously fat 932 kB sonner
  chunk dropped to 212 kB; markdown libs land in their own chunk only
  after the first answer renders.
- LLM provider type is a single `LlmProvider` union shared by main and
  renderer (replaces inline literal repeats and indexed-access references).
- Main process IPC handlers grouped by domain into `src/main/ipc/*.ts`;
  index.ts shrinks to overlay/dashboard window-stateful handlers only.
- Dead code removed: `cancel()` IPC channel + plumbing, duplicate prompt
  constants, unused provider id types, internal `inflight` map.

### Fixed
- `electron-builder.yml` `publish.owner` — `REPLACE_WITH_GH_OWNER` →
  `NikolosD`. Auto-update can now reach the release feed.
- Hotkey label fallback for `showDashboard` — previously rendered the raw
  key name because the switch-statement was missing a case.
