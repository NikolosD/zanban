# Zanban — Design

## Theme

Dark. Always. Scene sentence: *"a sales rep on a 14-inch laptop in a dim hotel room at 9pm, the overlay floating above a Zoom window — anything brighter than the meeting tile pulls focus and gets noticed."*

The overlay is **darker than the OS chrome behind it** so it visually recedes when not being read.

## Color strategy

**Restrained.** Tinted neutrals + one accent ≤10%. Stealth is the brand.

### Palette

```
--bg-overlay         oklch(0.16 0.01 260)   /* near-black, faint cool tint */
--bg-overlay-deep    oklch(0.13 0.012 260)
--bg-surface         oklch(0.20 0.008 260)  /* dashboard panels */
--bg-elev            oklch(0.24 0.006 260)  /* hover, dropdowns */

--fg                 oklch(0.96 0.005 260)  /* not #fff */
--fg-muted           oklch(0.66 0.01 260)
--fg-faint           oklch(0.48 0.01 260)

--border             oklch(1 0 0 / 0.07)
--border-strong      oklch(1 0 0 / 0.14)

--signal             oklch(0.72 0.18 25)    /* coral-red — REC + new question */
--signal-soft        oklch(0.72 0.18 25 / 0.12)

--accent             oklch(0.78 0.13 145)   /* sage-green — confirmed / done */
--warn               oklch(0.82 0.13 75)    /* amber — visible-mode warning */
```

The signal color is **coral, not pure red.** Pure red reads as "error." Coral reads as "live, attention here, not broken."

The accent (sage-green) is used only on success / confirmed states (stealth is on, message recorded). Never decorative.

## Typography

**Sans:** Inter Variable. Weights used: 400, 500, 600. No 700 except for hero numbers in sessions.
**Mono:** JetBrains Mono Variable. Used for: timestamps, durations, model IDs, hotkey hints, version numbers.

### Scale

| Role | Size | Weight | Line-height | Use |
|---|---|---|---|---|
| `meta` | 10px mono | 500 | 1.2 | timestamps, model IDs, hotkey badges |
| `body-s` | 11px sans | 400 | 1.4 | chip labels, secondary copy |
| `body` | 13px sans | 400 | 1.5 | answer text, list items |
| `lead` | 15px sans | 500 | 1.4 | section headings |
| `display` | 20px sans | 600 | 1.2 | dashboard "Zanban" wordmark |
| `numeric` | 28px mono | 500 | 1.0 | hero counts (sessions total) — sparingly |

Body line length capped at 65ch in the answer pane.

## Spacing

Rhythm matters more than uniform padding. Three rhythm groups:

- **tight** — 4 / 6 / 8 px : inside chips, between icon and label
- **default** — 12 / 16 / 20 px : panel padding, between rows
- **wide** — 28 / 40 / 56 px : page-level vertical rhythm in dashboard

Never apply a single `gap` to a vertical stack of mixed-importance children. Use larger gap above section starts, tight gaps inside groups.

## Surfaces

**Overlay** uses heavy backdrop-blur over a dense dark glass: `--bg-overlay-deep` at alpha `--overlay-glass`. The Interface Opacity setting (40–100%) maps linearly to that alpha (0.60–0.95; default 100% → 0.95) and changes **only the glass** — text and controls stay fully opaque. Never fade the window (`BrowserWindow.setOpacity`) or a wrapper: that fades the text with the glass, and muted text over a white document drops to ~1.5:1. At the default, muted text holds ~6:1 even over a white page; the blur still lets the OS show through as shape and colour, which keeps the floating-not-attached feeling. The status pill uses the same glass at 0.85× alpha — a touch lighter, it carries no reading text.

**Dashboard** uses opaque surfaces. No blur on the desktop home; blur is reserved for the overlay so it remains the "lighter" object visually.

## Borders & elevation

- 1px borders only. No 2px. Never side-stripe accents.
- No shadows on the dashboard. The overlay uses one soft shadow (`0 16px 48px -12px rgba(0,0,0,0.6)`) for separation from the desktop.
- Hover = +0.04 lightness, not a shadow.

## Motion

- All transitions: 180ms ease-out-quart for color/opacity, 220ms for transforms.
- No layout-property animations.
- The recording dot pulses at 1.6s cycle. Slower than the standard 1s — calmer.
- Streaming text fades in per chunk (60ms opacity 0→1). No typewriter cursor.

## Components

### Overlay status pill

Single pill, not three stacked. Three slots, separated by 1px dividers, never wrapping:

```
┌──────────────────────────────────────────┐
│ ● 02:31  •  hide  •  ⌨ ⌃⇧H  •  ✕         │
└──────────────────────────────────────────┘
```

State word lowercase + monospace. The signal dot is always position 1. ✕ collapses, never closes.

Idle, slot 1 is a neutral `start` button carrying the start/stop-session chord. It starts through the dashboard capture path (same as the hotkey). While idle the action-chip row is hidden — only the ask input stays.

### Action chips

Pill row, no nested borders inside chips. The "Answer" chip is the only emphasis-styled chip — solid foreground, no icon padding inflation. Other chips read as lighter siblings. Visible: "Catch up" (last ~90s — not "Recap", which is the post-meeting summary) and `more` ("Which question?", shorten, follow-up, model override).

### Ask row

Input (placeholder carries the focus-ask chord), camera icon button (chord in its tooltip), send. The per-request model picker appears here only while an override is active, so it can be seen and reset; otherwise it lives in `more`.

### Question pill

When a detected question fires, it is the **only** signal-coloured element on screen. One row, max two pills. Pressing Enter or clicking answers it.

### Answer pane

Streaming markdown. No fixed-height container — grows with content, capped at 60vh, then scrolls. No internal cards. The pane itself IS the card.

Newest answer first at 14px / 1.5; the question above it at `small`, normal case, muted. Older answers fold to one `small` row (question · first line). Markdown headings are body-sized-plus (13–14px, 600) with space above; tables use 1px borders and cell padding. Nothing in the overlay goes below `small` except kbd glyphs and the transcript row's speaker label (`meta` mono). Degraded states use `warn`, never raw amber.

### Hotkey hint

Two-tone monospace badge. Modifier keys at lower contrast than the trigger key:

```
⌃⇧⏎   ←  modifier dimmer than primary
```

## Iconography

Lucide. 12px / 14px / 16px only. Stroke-width 1.75 (default 2 reads heavier than the typography).

## Anti-patterns specific to Zanban

- **Hero numbers** as "session count" / "minutes total" on the dashboard. We're not bragging, we're tools.
- **Card grids** for sessions. Use a typographic list with strong rhythm instead.
- **Sparkle icons** on AI buttons. Once, on the "Answer" CTA only — never elsewhere.
- **Tab pills** when ≤4 items. Use underline tabs.
- **Two-color status dots** (green vs red) on the same row. One signal at a time.
