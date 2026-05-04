# Zanban

## Register

product

## Users

Operators in live, high-stakes conversations: sales reps on discovery calls, engineers in interviews, founders in investor calls, support agents on escalations. They keep one eye on the human and one eye on the screen. Two states matter:

- **Heads-up** — actively talking. Glance only. Nothing should pull focus.
- **Heads-down** — between turns. Type / read / pick. They have ~3 seconds before the room notices.

They are technical enough to install an Electron app, edit a hotkey, and paste an API key. They are NOT the kind of user who reads onboarding.

## Product purpose

A floating overlay that listens to a meeting (mic + system audio), transcribes in real time, detects questions directed at the user, and surfaces an answer in under two seconds. Hidden from screen-share by design. Functional analogue of Cluely, MIT-licensed.

The dashboard is the storage / settings home. Sessions, transcripts, exports, provider keys, personas. It runs when nothing is live.

## Anti-references

- **Generic SaaS dashboard look.** Tinted-navy + blue accent + card grid. The category reflex.
- **"AI" gradient + sparkle iconography.** Already cliché.
- **Modal-first interactions.** Stop-the-world dialogs interrupt heads-up state by definition.
- **Slack-style row lists.** Every line indistinguishable, no rhythm.
- **Cluely's exact aesthetic.** We're a functional analogue, not a visual clone.

## Strategic principles

1. **Overlay glanceability beats everything.** During heads-up, the user reads ONE thing: the answer. Status, chrome, controls — all secondary. Anything that competes with the answer is wrong.
2. **Stealth is brand.** The product is invisible to screen-share. The UI itself should feel like it doesn't want to be seen — not chunky, not chromed, not "look at me." Restrained > committed.
3. **Mono-chromatic with one signal color.** The signal color carries semantic load (recording, pending question). It is rarely on screen. When it is, the user looks immediately.
4. **Density without crowding.** Operators read fast. We can pack more than a normal app — but every glyph earns space.
5. **Keyboard parity.** Every action reachable by hotkey. The mouse path exists for discovery, not for daily use.

## Tone

Terminal-adjacent. Quiet, precise, technical. Mono for metadata, sans for content. Lowercase status words ("idle", "recording 02:31"). No marketing phrasing in the UI itself.
