<p align="center">
  <br>
  <em>small by default · pretty if desired · modular when needed · prose-first always</em>
  <br><br>
</p>

# White Lotus

A companion extension for the *White Lotus preset* for SillyTavern.

White Lotus is a preset designed to be modular — use what you want, ignore what you don't. This extension makes it easy to toggle features on and off without digging through the prompt manager. Click the lotus button (top-right corner on desktop) to open a side panel with access to all toggles and settings.

## Features

**Module Toggles** — Flip preset prompt blocks on and off from the sidebar: tweaks, fixes, tools, trackers, NSFW styles, genre overlays, narrator modes, length presets, and diction styles. Changes apply immediately to the prompt order.

**Sampler Presets** — Switch between tuned sampler configurations for different models (GLM, Kimi, Deepseek, Gemma, and custom/community sets). The sampler dropdown stays enabled even when you're using a different preset — it's useful for any setup.

**Separate Tracker Generation** — Offload tracker evaluation (Status Board, Temporal, Relationships) to a dedicated LLM call instead of running inline. Choose a different model via Connection Manager, set auto-run frequency (every message, every N messages, or manual only), and configure scan depth and generation parameters. Tracker data is stored in chat metadata and displayed as overlays — it never touches message content.

**Payload Counter** — The panel footer shows an estimated token count for all active White Lotus prompts, broken down by category. Hover to see the breakdown.

## Installation

Use SillyTavern's built-in extension installer:

```
https://github.com/nrahis/SillyTavern-WhiteLotus
```

Or clone directly into your extensions folder:

```bash
cd data/<your-user>/extensions
git clone https://github.com/nrahis/SillyTavern-WhiteLotus
```

Requires the White Lotus preset to be loaded for most features. The sampler presets work with any preset.

## Usage

1. Load a White Lotus preset — the status indicator in the panel will turn active
2. Click the lotus icon (top-right) to open the sidebar
3. Toggle modules, pick a genre, set NSFW style, adjust length — changes are live
4. For trackers: enable them in the Trackers section, optionally configure separate generation via the ⚙ settings view
5. Pin the panel open with the thumbtack if you want it to stay while you chat
