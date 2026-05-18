# White Lotus — Finalized Regex Patterns

All four regex scripts for the preset. Ready to add to the JSON.

---

## 1. Style — Lotus Board (NEW)

### Capture Groups (13):
$1 = Character name
$2 = Present (NPCs)
$3 = Health, $4 = Hunger, $5 = Energy, $6 = Hygiene, $7 = Arousal
$8 = Appearance
$9 = Mood
$10 = Thought (asterisks stripped)
$11 = Affection, $12 = Attraction, $13 = Trust

### LLM Output Format:
```
<lotus_board>
Character: Sakura
Present: Kai, Old Man Chen
Health: 85/100 | Hunger: 60/100 | Energy: 70/100 | Hygiene: 90/100 | Arousal: 10/100
Appearance: Wearing a blue day dress, hair slightly disheveled from the wind
Mood: Cautiously optimistic
Thought: *I wonder if he noticed me watching*
Affection: 45/100 | Attraction: 55/100 | Trust: 30/100
</lotus_board>
```

### Find Regex:
```
/<lotus_board>\s*Character:\s*(.+?)\s*\n\s*Present:\s*(.+?)\s*\n\s*Health:\s*(\d+)\s*\/\s*100\s*\|\s*Hunger:\s*(\d+)\s*\/\s*100\s*\|\s*Energy:\s*(\d+)\s*\/\s*100\s*\|\s*Hygiene:\s*(\d+)\s*\/\s*100\s*\|\s*Arousal:\s*(\d+)\s*\/\s*100\s*\n\s*Appearance:\s*(.+?)\s*\n\s*Mood:\s*(.+?)\s*\n\s*Thought:\s*\*?(.+?)\*?\s*\n\s*Affection:\s*(\d+)\s*\/\s*100\s*\|\s*Attraction:\s*(\d+)\s*\/\s*100\s*\|\s*Trust:\s*(\d+)\s*\/\s*100\s*\n?\s*<\/lotus_board>/gi
```

---

## 2. Style — Temporal (backward compat)

$1 = Time, $2 = Weather, $3 = Location

### Find Regex:
```
/(?:\[ENV\]|<temporal>)\s*Time:\s*([^|]+?)\s*\|\s*Weather:\s*([^|]+?)\s*\|\s*Location:\s*(.*?)\s*(?:\[\/ENV\]|<\/temporal>)/gi
```

---

## 3. Style — RPS (backward compat)

$1 = Character name, $2 = Hostility, $3 = Interest, $4 = Obligation, $5 = Base Attraction

### Find Regex:
```
/(?:\[RPS\]|<rps>)(.*?): \{Hostility: (\d*)\} \| \{Interest: (\d*)\} \| \{Obligation: (\d*)\} \| \{Base Attraction: (\d*)\}(?:\[\/RPS\]|<\/rps>)/g
```

---

## 4. Trim — Stats (backward compat, updated)

### Find Regex:
```
/(?:\[RPS\]|<rps>).*?(?:\[\/RPS\]|<\/rps>)|(?:\[ENV\]|<temporal>).*?(?:\[\/ENV\]|<\/temporal>)|<lotus_board>[\s\S]*?<\/lotus_board>/gs
```

Replace: (empty string)
Placement: prompt only, minDepth: 2
