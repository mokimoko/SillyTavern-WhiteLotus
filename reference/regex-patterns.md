# White Lotus — Bracket Tag Formats & Regex Patterns

Reference for the bracket-tag formats used by all three tracker modules.
These tags are produced by the LLM in **preset mode** (inline generation)
and by the **separate generation pipeline** (utilitiesGen.js).

Regex scripts in the preset JSON style these for display.
In sep-gen mode, `trackerRenderers.js` parses and renders them as DOM overlays.

---

## Tag Formats

### LOTUS — Status Board (multi-entry)

One entry per character present in the scene.

```
[LOTUS|Name|HP|HNG|ENG|HYG|ARO|Mood|Thought][/LOTUS]
```

**Fields (pipe-delimited):**
- Name — character name
- HP — health (0–100)
- HNG — hunger (0–100)
- ENG — energy (0–100)
- HYG — hygiene (0–100)
- ARO — arousal (0–100)
- Mood — free-text mood description
- Thought — internal thought (may have surrounding asterisks)

**Example output:**
```
[LOTUS|Sakura|85|60|70|90|10|Cautiously optimistic|*I wonder if he noticed me watching*][/LOTUS]
[LOTUS|Kai|92|45|80|75|5|Distracted|*Where did I leave my keys...*][/LOTUS]
```

### TEMPORAL — Environmental State (single entry)

```
[TEMPORAL|Time|Weather|Location][/TEMPORAL]
```

**Fields:**
- Time — scene time (e.g. "Late Afternoon", "9:30 PM")
- Weather — one of: Sunny, Clear, Cloudy, Rainy, Stormy, Snowy, Foggy, Windy
- Location — current scene location

**Example output:**
```
[TEMPORAL|Late Afternoon|Sunny|Riverside Market District][/TEMPORAL]
```

### RPS — Relationship Tracker (multi-entry)

One entry per tracked character relationship.

```
[RPS|CharName|HOS|INT|OBL|TRS|ATR][/RPS]
```

**Fields:**
- CharName — character name
- HOS — hostility (0–10)
- INT — interest (0–10)
- OBL — obligation (0–10)
- TRS — trust (0–10)
- ATR — attraction (0–10)

**Example output:**
```
[RPS|Sakura|1|7|3|5|6][/RPS]
[RPS|Old Man Chen|0|4|8|9|0][/RPS]
```

---

## Preset Regex Patterns

These are the SillyTavern regex scripts used in the preset JSON to style
bracket tags for display when trackers run inline (preset mode).

### Style — Lotus Board

Matches one `[LOTUS|...|Thought][/LOTUS]` entry at a time.

**Capture groups (8):**
$1 = Name, $2 = HP, $3 = Hunger, $4 = Energy, $5 = Hygiene,
$6 = Arousal, $7 = Mood, $8 = Thought

```
/\[LOTUS\|([^|]+?)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*\*?(.+?)\*?\s*\]\s*\[\/LOTUS\]/gi
```

### Style — Temporal

**Capture groups (3):**
$1 = Time, $2 = Weather, $3 = Location

```
/\[TEMPORAL\|([^|]+)\|([^|]+)\|([^\]]+)\]\s*\[\/TEMPORAL\]/gi
```

### Style — RPS (Relationship)

**Capture groups (6):**
$1 = Name, $2 = Hostility, $3 = Interest, $4 = Obligation,
$5 = Trust, $6 = Attraction

```
/\[RPS\|([^|]+)\|(\d+)\|(\d+)\|(\d+)\|(\d+)\|(\d+)\]\s*\[\/RPS\]/gi
```

### Trim — All Tracker Tags

Strips all bracket-tagged tracker output from prompt context to prevent
accumulation across messages. Applied with `minDepth: 2`.

```
/\[(?:LOTUS|TEMPORAL|RPS)[|][\s\S]*?\[\/(?:LOTUS|TEMPORAL|RPS)\]/gi
```

Replace: (empty string)
Placement: prompt only, minDepth: 2
