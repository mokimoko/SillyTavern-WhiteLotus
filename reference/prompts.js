// REFERENCE — Lotus Board STscript prompt (to be converted to generateRaw)
// This is the user's original STscript implementation for reference.
// The extension will adapt this into a JS-based generateRaw call.

/*
/profile | /setvar key=profile |
/profile await=true Trackers |
/genraw lock=off as=system 
"You are evaluating stats for a roleplay. You will be evaluating stats for: {{char}}  
== INITIALIZATION ==
If a field is blank/empty, initialize it from the context. Do this on the first evaluation only. Once set, maintain continuity.
== EVALUATION ==
Update every field every evaluation based on what happened in the latest exchange. When evaluating stats, ensure a realistic progression.  Stats may remain the same if nothing has changed. 
You will use the following context to establish
/if left={{getvar::trackerCache}} rule=eq right= else={: 
	{{char}}'s Existing Stats:
	{{getvar::trackerCache}}
:} {: 
	/echo No tracker stats yet  
:} |
{{char}}'s last message: {{lastCharMessage}}
{{user}}'s last message: {{lastUserMessage}}
Use this EXACT format:
<lotus_board>
World State
Date: [Weekday, Month Day, Year] | [Season] | [Temp]
Time: [Scene time]
Location: [Location]
Social
Present: [NPCs present]
Character State
Health: [n]/100 | Hunger: [n]/100 | Energy: [n]/100 | Hygiene: [n]/100 | Arousal: [n]/100
Appearance: [Current appearance and outfit]
Mood: [Current mood/mental state]
Thought: *[An internal, private thought]*
Relationship
Affection: [n]/100 | Attraction: [n]/100 | Trust: [n]/100
</lotus_board>  
Only respond with the stats between the XML tags." |
/setvar key=trackerCache {{pipe}} |
/profile await=true {{getvar::profile}} |
/wait 1000 |
/message-edit message={{lastMessageId}} append= {{newline}}{{newline}}{{getvar::trackerCache}} |
/echo Stats done |
/flushvar profile |
*/

// NPC Sheet template (for NPC Save feature):
/*
[SHEET]
Full Name: 
Also called:
Archetype:
Traits: (top 3)
Appearance: (1-2 sentence)
Background: (concise history)
Affiliation: (if any)
Core Belief: 
Primary Locations: (comma separated list of named locations where this character can usually be found)
Schedule: (on their typical day)
Long-term Goal: 
Short-term Goals:
[/SHEET]
*/

// Location Sheet template (for Location Save feature):
/*
[LSHEET]
Official Name:
Also called: 
Region: 
Adjacent: 
Type: 
Appearance: 
Relevance:
[/LSHEET]
*/
