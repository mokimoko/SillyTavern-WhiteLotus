<p align="center">
  <br>
  <em>small by default · pretty if desired · modular when needed · prose-first always</em>
  <br><br>
</p>

# White Lotus 

A companion extension for the *White Lotus* (and *Plum Blossom*) presets for SillyTavern.

`Current Preset Versions: White Lotus [4.2.1] · Plum Blossom [1.0.0]`

Both White Lotus and Plum Blossom can still be used as standalone presets, but this extension makes it easy to toggle features on and off without digging through the prompt manager. 

Click the lotus button (top-right corner on desktop) to open a side panel with access to all toggles and settings.

## Features

**Module Toggles** — Flip preset prompt blocks on and off from the sidebar: tweaks, fixes, tools, trackers, NSFW styles, genre overlays, narrator modes, length presets, and diction styles. Changes apply immediately to the prompt order. Matching switches in SillyTavern's Prompt Manager are read-only while the preset is active so the two interfaces cannot drift out of sync.

**Preset Mode Switcher** — Click the panel title once to toggle between installed White Lotus and Plum Blossom presets. The panel remembers its current view when an unrelated preset is active.

**Plum Blossom Choose Controls** — PB’s complete Choose block is available in the sidebar, including permissions, narration, narrator, NSFW and violence styles, model fixes, analysis, length, POV, and tense. The preset prompt order remains the source of truth.

**Separate Scene Analysis** — Optionally run Plum Blossom’s native `<analyze>` report as an awaited sidecar after narration. Choose every message, every N messages, or manual only. The result is attached to the exact message and swipe before SillyTavern’s normal save finishes. Running it again replaces that swipe's prior report, and the prior report is excluded from the new analysis request.

**Plum Blossom Inspector** — Always available while PB is active. Inspect accepted state, pending candidates, progress gates, raw variables, and the current `<analyze>` block without adding a debug readout to the model prompt. Its Actions tab can re-run Establishment, rebuild Focus or Relationship tracking, reset all PB state, or permanently remove `<analyze>` blocks from every stored chat swipe.

**Sampler Presets** — Switch between tuned sampler configurations for different models (GLM, Kimi, Deepseek, Gemma, and custom/community sets). The sampler dropdown stays enabled even when you're using a different preset — it's useful for any setup.

**Separate Tracker Generation** — Offload tracker evaluation (Status Board, Temporal, Relationships) to a dedicated LLM call instead of running inline. Choose a different model via Connection Manager, set auto-run frequency (every message, every N messages, or manual only), and configure scan depth and generation parameters. Tracker data is stored in chat metadata and displayed as overlays — it never touches message content.

**Custom Trackers** — Available for White Lotus tracker generation. Plum Blossom custom trackers are intentionally deferred while its native analysis sidecar is stabilized.

**Last Payload Counter** — The panel footer shows the tokenized preset size from the last story request. White Lotus is broken down by module category. Plum Blossom is measured after macro expansion and split into Constant, Conditional or mixed, and Analysis blocks. Native Analysis is included in the story total; when separate scene analysis is enabled, the equivalent expanded instruction block appears on its own row outside the story total. Sidecar wrapper text, copied conversation, and card context are deliberately excluded from that row. An asterisk means the corresponding value is stale.

## Installation

Use SillyTavern's built-in extension installer:

```
https://github.com/mokimoko/SillyTavern-WhiteLotus
```

White Lotus and Plum Blossom can be installed or updated from the extension panel. Sampler presets work with any active preset.

## Usage

1. Click the lotus icon (top-right) to open the sidebar
2. Click the panel title to switch between White Lotus and Plum Blossom
3. Toggle modules or PB Choose options — changes are live in the active preset
4. Configure tracker or analysis sidecars through the ⚙ settings view
5. Pin the panel open with the thumbtack if you want it to stay while you chat
