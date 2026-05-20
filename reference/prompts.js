// REFERENCE — Tracker Generation Architecture
//
// This file documents how tracker prompts are sourced and executed.
// The extension does NOT contain hardcoded prompt text — it pulls
// tracker instructions from the preset's prompt entries at runtime.
//
// ═══════════════════════════════════════════════════════════
// Architecture: Two Modes
// ═══════════════════════════════════════════════════════════
//
// 1. PRESET MODE (useSeparateGen = false)
//    - Tracker prompts live in the preset's prompt list (oai_settings.prompts)
//    - Extension toggles them on/off via the prompt order
//    - LLM writes bracket tags inline in its response
//    - SillyTavern regex scripts style the tags for display
//    - No separate generation call needed
//
// 2. SEPARATE GEN MODE (useSeparateGen = true)
//    - Tracker prompt entries are DISABLED in the preset (not sent to main LLM)
//    - After each main generation, the extension runs a separate generateRaw call
//    - It pulls the prompt TEXT from the preset entries as instructions
//    - Parsed results are stored in chat_metadata, displayed as DOM overlays
//    - Never touches msg.mes — avoids the reload/wipe issues
//
// ═══════════════════════════════════════════════════════════
// Prompt Source: Preset Entries (Single Source of Truth)
// ═══════════════════════════════════════════════════════════
//
// Each tracker has a prompt entry in the preset JSON, identified by UUID:
//
//   trackerLotusBoard  → 042279e6-820f-4e9d-aec1-a3e5b37f8453
//   trackerTemporal    → 3ade7755-3093-4116-98b9-37d2efe6d1f0
//   trackerRelationship → fe1afd93-8e59-4902-b6ca-10ef32d49401
//
// These IDs are registered in moduleRegistry.js → TRACKERS.
// The extension reads prompt.content from these entries at generation time.
//
// ═══════════════════════════════════════════════════════════
// Sep-Gen Prompt Structure (built by utilitiesGen.js)
// ═══════════════════════════════════════════════════════════
//
// The generateRaw prompt is assembled from:
//
//   1. System framing — identifies {{char}} as the evaluation target
//   2. Character context — card fields, persona, cached world info
//   3. Recent conversation — last N message pairs (configurable scan depth)
//   4. Previous state — latest tracker values for continuity
//   5. Instructions — strict output format rules
//   6. Format rules — from preset entry (INFRA.trackerFormatRulesId)
//   7. Tracker instructions — from each active tracker's preset entry
//
// The model responds with ONLY bracket-tagged sections:
//
//   [LOTUS|Name|HP|HNG|ENG|HYG|ARO|Mood|Thought][/LOTUS]
//   [TEMPORAL|Time|Weather|Location][/TEMPORAL]
//   [RPS|CharName|HOS|INT|OBL|TRS|ATR][/RPS]
//
// See regex-patterns.md for full format documentation.
//
// ═══════════════════════════════════════════════════════════
// NPC & Location Sheet Templates
// ═══════════════════════════════════════════════════════════
//
// Used by the NPC Crafter tool (toolNPCCrafter) for generating
// structured character and location entries.

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
Primary Locations: (comma separated list)
Schedule: (on their typical day)
Long-term Goal:
Short-term Goals:
[/SHEET]
*/

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
