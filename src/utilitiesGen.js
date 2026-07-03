// src/utilitiesGen.js
// Shared utilities generation pipeline for White Lotus trackers.
//
// Architecture (session 18 rearchitect):
// - Sep-gen mode: tracker data stored in chat_metadata, displayed via DOM overlays.
//   Never touches msg.mes. Never calls reloadCurrentChat (the root cause of chat wipe).
//   Uses saveChatConditional only for metadata persistence (safe — no reload race).
// - Preset mode: LLM writes tags inline in msg.mes, regex styles them. Unchanged.
//
// All tracker definitions (tags, fallbacks, multiEntry) come from moduleRegistry.js.
// Overlay HTML builders live in trackerRenderers.js.

import { eventSource, event_types, chat, chat_metadata, saveChatConditional, generateRaw, getCharacterCardFields } from '../../../../../script.js';
import { getContext } from '../../../../extensions.js';
import { ConnectionManagerRequestService } from '../../../../extensions/shared.js';
import { getSetting, getSettings } from './settings.js';
import { findPrompt } from './presetBridge.js';
import { TRACKERS, TRACKER_KEYS, ALL_BRACKET_TAGS, INFRA } from './moduleRegistry.js';
import { buildCombinedOverlay, OVERLAY_CLASS } from './trackerRenderers.js';
import { createLogger } from './debug.js';

const { log, logWarn, logError } = createLogger('Utilities');

// ============================================================
// Constants
// ============================================================

/** Legacy HTML comment markers — kept for cleaning old messages only */
const TRACKER_BLOCK_RE = /<!--WL_TRACKER_START-->[\s\S]*?<!--WL_TRACKER_END-->/g;

// ============================================================
// Stop Button Integration (native ST #mes_stop)
// ============================================================
//
// During separate tracker gen the main generation is already finished, so
// ST's stop button is hidden. We reuse it to cancel tracker gen: show it on
// start, hide it on finish. A capture-phase listener intercepts the click and
// routes it to cancelUtilitiesGen() before ST's own (no-op) stopGeneration().

/** Saved value of body[data-generating] so we can restore it after tracker gen. */
let prevGeneratingAttr = null;

/** Capture-phase click handler — cancels tracker gen when the stop button is hit. */
function onStopButtonClick(e) {
    if (!isGenerating) return;
    // Only react to the stop button itself
    if (!e.target.closest('#mes_stop, .mes_stop')) return;
    cancelUtilitiesGen();
    // Don't preventDefault — ST's stopGeneration() is a harmless no-op here.
}

/** Show ST's native stop button and arm our cancel listener. */
function showStopButtonForGen() {
    const stop = document.getElementById('mes_stop');
    if (stop) stop.style.display = 'flex';
    // Mirror ST's generating state so the send button (and friends) hide.
    // Save the prior value so we can restore it without clobbering a real gen.
    if (typeof document !== 'undefined' && document.body) {
        prevGeneratingAttr = document.body.getAttribute('data-generating');
        document.body.setAttribute('data-generating', 'true');
    }
    // Capture phase so we run before ST's delegated bubble-phase handler.
    document.addEventListener('click', onStopButtonClick, true);
}

/** Hide the stop button and disarm our listener (unless main gen still owns it). */
function hideStopButtonForGen() {
    document.removeEventListener('click', onStopButtonClick, true);
    const stop = document.getElementById('mes_stop');
    // Only hide if a real generation isn't in progress (don't steal it from main gen).
    const streamingProcessor = typeof window !== 'undefined' ? window?.SillyTavern?.streamingProcessor : null;
    const mainGenActive = streamingProcessor && !streamingProcessor.isFinished;
    if (stop && !mainGenActive) stop.style.display = 'none';
    // Restore the generating attribute to whatever it was before we ran,
    // unless a real gen took over in the meantime.
    if (typeof document !== 'undefined' && document.body && !mainGenActive) {
        if (prevGeneratingAttr === null) {
            document.body.removeAttribute('data-generating');
        } else {
            document.body.setAttribute('data-generating', prevGeneratingAttr);
        }
    }
    prevGeneratingAttr = null;
}

// ============================================================
// Custom Tracker Helpers
// ============================================================

/**
 * Get enabled custom tracker definitions from settings.
 * @returns {object[]} Array of custom tracker defs with valid tag + prompt
 */
function getActiveCustomTrackers() {
    const settings = getSettings();
    return (settings.customTrackers || []).filter(ct => ct.enabled && ct.tag && ct.prompt);
}

/**
 * Get ALL custom tracker defs (enabled or not) — for state management.
 */
function getAllCustomTrackers() {
    const settings = getSettings();
    return settings.customTrackers || [];
}

/** Setting key for a custom tracker: 'custom_{id}' */
function customKey(ct) {
    return `custom_${ct.id}`;
}

/**
 * Get all effective tracker keys (built-in + custom).
 * Used everywhere TRACKER_KEYS was used before.
 */
function getEffectiveKeys() {
    return [...TRACKER_KEYS, ...getAllCustomTrackers().map(customKey)];
}

/**
 * Get the tracker definition for a key (built-in or custom).
 * @param {string} key - e.g. 'trackerLotusBoard' or 'custom_abc123'
 * @returns {object|null} Tracker-like definition
 */
function getTrackerDef(key) {
    if (TRACKERS[key]) return TRACKERS[key];
    if (key.startsWith('custom_')) {
        const id = key.slice(7);
        const ct = getAllCustomTrackers().find(c => c.id === id);
        if (ct) return { label: ct.label, bracketTag: ct.tag, multiEntry: ct.multiEntry || false, isCustom: true, ...ct };
    }
    return null;
}

/**
 * Check if a tracker key is active (enabled in settings).
 * Built-in trackers check settings[key], custom trackers check the enabled flag.
 */
function isTrackerActive(key) {
    if (TRACKERS[key]) return !!getSettings()[key];
    if (key.startsWith('custom_')) {
        const id = key.slice(7);
        return getActiveCustomTrackers().some(ct => ct.id === id);
    }
    return false;
}

/**
 * Get all bracket tags (built-in + active custom).
 */
function getEffectiveBracketTags() {
    return [...ALL_BRACKET_TAGS, ...getActiveCustomTrackers().map(ct => ct.tag)];
}

// ============================================================
// State
// ============================================================

/** Latest parsed tracker data, persists across messages.
 *  Keyed by tracker setting key (e.g. 'trackerLotusBoard', 'custom_abc123'). */
let latestTrackerState = Object.fromEntries(TRACKER_KEYS.map(k => [k, null]));

/** Tracks how many messages since last utility gen (for every_n mode) */
let messagesSinceLastGen = 0;

/** Prevents re-entrant generation */
let isGenerating = false;

/** Set to true to abort a running generation (results are discarded) */
let isCancelled = false;

/** Cached world info entries from the last main generation.
 *  Populated by WORLD_INFO_ACTIVATED event during normal gen,
 *  then included in the utility gen prompt for tracker context. */
let cachedWorldInfo = [];

// ============================================================
// Public API
// ============================================================

/**
 * Get the latest tracker state (for injection into context).
 */
export function getLatestTrackerState() {
    return latestTrackerState;
}

/**
 * Reset tracker state (e.g. on chat change).
 */
export function resetTrackerState() {
    latestTrackerState = Object.fromEntries(getEffectiveKeys().map(k => [k, null]));
    cachedWorldInfo = [];
    messagesSinceLastGen = 0;
    isGenerating = false;

    // Load latest state from chat_metadata if available
    loadTrackerStateFromMetadata();

    log('Tracker state reset');
}

/**
 * Check if any tracker module is active AND separate gen is enabled.
 */
export function hasActiveTrackers() {
    const s = getSettings();
    if (!s.useSeparateGen) return false;
    const builtInActive = TRACKER_KEYS.some(key => s[key]);
    const customActive = getActiveCustomTrackers().length > 0;
    return builtInActive || customActive;
}

// ============================================================
// Metadata Storage (Summarizer-style)
// ============================================================

/**
 * Get or initialize the whiteLotus metadata namespace on chat_metadata.
 * @returns {object} The whiteLotus metadata object
 */
function getMetadata() {
    // Use the directly imported chat_metadata (live global reference)
    // rather than getContext().chat_metadata, which may not expose it.
    if (!chat_metadata || typeof chat_metadata !== 'object') {
        log('getMetadata: chat_metadata not available (no active chat?)');
        return null;
    }

    if (!chat_metadata.whiteLotus) {
        chat_metadata.whiteLotus = { trackerHistory: [] };
    }
    if (!chat_metadata.whiteLotus.trackerHistory) {
        chat_metadata.whiteLotus.trackerHistory = [];
    }
    return chat_metadata.whiteLotus;
}

/**
 * Load latestTrackerState from chat_metadata on chat change.
 * Finds the most recent history entry whose swipeId matches the message's
 * currently active swipe, so we don't load stale data from an inactive swipe.
 */
function loadTrackerStateFromMetadata() {
    const meta = getMetadata();
    if (!meta || meta.trackerHistory.length === 0) return;

    const context = getContext();
    const chatLog = context.chat;

    // Walk backwards to find the most recent entry matching the active swipe
    for (let i = meta.trackerHistory.length - 1; i >= 0; i--) {
        const entry = meta.trackerHistory[i];
        const msg = chatLog?.[entry.messageIndex];
        const activeSwipeId = msg?.swipe_id ?? 0;
        const entrySwipeId = entry.swipeId ?? 0;

        if (entrySwipeId === activeSwipeId && entry.data) {
            for (const key of getEffectiveKeys()) {
                if (entry.data[key]) {
                    latestTrackerState[key] = entry.data[key];
                }
            }
            log(`Loaded tracker state from metadata (message ${entry.messageIndex}, swipe ${entrySwipeId})`);
            return;
        }
    }
}

/**
 * Store parsed tracker results in chat_metadata.
 * Replaces any existing entry for the same messageIndex + swipeId.
 *
 * @param {object} parsed - Parsed tracker data keyed by setting key
 */
async function storeTrackerResult(parsed) {
    const meta = getMetadata();
    if (!meta) {
        logError('storeTrackerResult: chat_metadata not available');
        return;
    }

    // Find the last assistant message index
    const context = getContext();
    const chatLog = context.chat;
    let messageIndex = -1;
    if (chatLog && chatLog.length > 0) {
        for (let i = chatLog.length - 1; i >= 0; i--) {
            if (!chatLog[i].is_user && !chatLog[i].is_system) {
                messageIndex = i;
                break;
            }
        }
    }

    if (messageIndex < 0) {
        log('storeTrackerResult: no assistant message found');
        return;
    }

    // Get the active swipe_id for this message
    const swipeId = chatLog[messageIndex]?.swipe_id ?? 0;

    // Build data object (only non-null entries)
    const data = {};
    for (const key of getEffectiveKeys()) {
        if (parsed[key]) data[key] = parsed[key];
    }

    if (Object.keys(data).length === 0) {
        log('storeTrackerResult: no data to store');
        return;
    }

    // Replace existing entry for this messageIndex+swipeId (don't accumulate across swipes)
    meta.trackerHistory = meta.trackerHistory.filter(
        e => !(e.messageIndex === messageIndex && (e.swipeId ?? 0) === swipeId),
    );

    // Push new entry
    const entry = {
        messageIndex,
        swipeId,
        timestamp: Date.now(),
        data,
    };
    meta.trackerHistory.push(entry);

    // Trim history if it gets too long (keep last 50 entries)
    if (meta.trackerHistory.length > 50) {
        meta.trackerHistory = meta.trackerHistory.slice(-50);
    }

    // Save metadata via ST's native persistence
    try {
        await saveChatConditional();
        log(`Stored tracker data for message ${messageIndex} swipe ${swipeId} (${Object.keys(data).length} trackers, history size: ${meta.trackerHistory.length})`);
    } catch (err) {
        logError('Failed to save chat metadata:', err);
    }
}

// ============================================================
// Swipe-Aware State Helpers
// ============================================================

/**
 * Get the accumulated tracker state from BEFORE a given message index.
 * Walks history backwards for the most recent entry with messageIndex < target
 * whose swipeId matches that message's currently active swipe.
 * Used to reset latestTrackerState before utility gen so swipe data doesn't bleed.
 *
 * @param {number} targetMessageIndex - The message index we're about to evaluate
 * @returns {object} Tracker data keyed by setting key, or empty object
 */
function getStateBeforeMessage(targetMessageIndex) {
    const meta = getMetadata();
    if (!meta || meta.trackerHistory.length === 0) return {};

    const context = getContext();
    const chatLog = context.chat;

    for (let i = meta.trackerHistory.length - 1; i >= 0; i--) {
        const entry = meta.trackerHistory[i];
        if (entry.messageIndex >= targetMessageIndex) continue;

        // Verify this entry matches the currently active swipe for its message
        const msg = chatLog?.[entry.messageIndex];
        const activeSwipeId = msg?.swipe_id ?? 0;
        const entrySwipeId = entry.swipeId ?? 0;

        if (entrySwipeId === activeSwipeId) {
            return entry.data || {};
        }
    }
    return {};
}

// ============================================================
// DOM Overlay Rendering
// ============================================================

/**
 * Render tracker overlay for a single history entry.
 * Finds the message div by mesid and inserts styled HTML after .mes_text.
 * Only renders if the entry's swipeId matches the message's active swipe.
 *
 * @param {object} entry - A trackerHistory entry { messageIndex, swipeId, timestamp, data }
 */
function renderTrackerOverlay(entry) {
    const $msg = $(`#chat .mes[mesid="${entry.messageIndex}"]`);
    if ($msg.length === 0) return false;

    // Only render for the currently active swipe
    const context = getContext();
    const msg = context.chat?.[entry.messageIndex];
    const activeSwipeId = msg?.swipe_id ?? 0;
    const entrySwipeId = entry.swipeId ?? 0;
    if (entrySwipeId !== activeSwipeId) return false;

    // Skip if overlay already exists for this message
    const existingWrapper = $msg.find(`.${OVERLAY_CLASS}-wrapper[data-wl-tracker-group]`);
    if (existingWrapper.length > 0) return false;

    const html = buildCombinedOverlay(entry.data);
    if (!html) return false;

    $msg.find('.mes_text').after(html);
    return true;
}

/**
 * Render all tracker overlays from history.
 * Called on CHAT_CHANGED / MESSAGE_RENDERED to rebuild ephemeral DOM elements.
 */
function renderAllTrackerOverlays() {
    const meta = getMetadata();
    if (!meta || meta.trackerHistory.length === 0) return;

    // Clean existing overlays first
    clearAllOverlays();

    let rendered = 0;
    for (const entry of meta.trackerHistory) {
        if (renderTrackerOverlay(entry)) rendered++;
    }

    if (rendered > 0) {
        log(`Rendered ${rendered} tracker overlay(s) from history`);
    }
}

/**
 * Remove all tracker overlay DOM elements.
 */
function clearAllOverlays() {
    $(`.${OVERLAY_CLASS}-wrapper[data-wl-tracker-group]`).remove();
}

// ============================================================
// Prompt Builder
// ============================================================

/**
 * Gather the last N messages from chat for context.
 * @param {number} depth - How many message pairs to include
 * @returns {string} Formatted recent conversation
 */
function getRecentMessages(depth = 3) {
    const context = getContext();
    const chatLog = context.chat;
    if (!chatLog || chatLog.length === 0) return '';

    const count = Math.min(depth * 2, chatLog.length);
    const recent = chatLog.slice(-count);

    return recent.map(msg => {
        if (msg.is_system) return '';
        const name = msg.is_user ? (context.name1 || 'User') : (context.name2 || 'Character');
        // Strip legacy tracker blocks if present in older messages
        const cleanMes = (msg.mes || '').replace(TRACKER_BLOCK_RE, '').trim();
        return `${name}: ${cleanMes}`;
    }).filter(Boolean).join('\n\n');
}

/**
 * Build the previous tracker state string for the prompt.
 * Iterates all trackers from the registry.
 */
function getPreviousStateString() {
    const parts = [];

    for (const [key, tracker] of Object.entries(TRACKERS)) {
        if (latestTrackerState[key]) {
            parts.push(`Previous ${tracker.label} state:\n${latestTrackerState[key]}`);
        }
    }

    // Custom trackers
    for (const ct of getAllCustomTrackers()) {
        const k = customKey(ct);
        if (latestTrackerState[k]) {
            parts.push(`Previous ${ct.label} state:\n${latestTrackerState[k]}`);
        }
    }

    return parts.length > 0 ? parts.join('\n\n') : '';
}

// ============================================================
// Character & World Context
// ============================================================

/**
 * Build a context string with character card info, persona, and cached world info.
 * Gives the tracker model the same world knowledge the main generation had.
 */
function buildCharacterContext() {
    const context = getContext();
    const charName = context.name2 || 'Character';
    const userName = context.name1 || 'User';
    const parts = [];

    // Pull character card fields (description, personality, scenario)
    try {
        const card = getCharacterCardFields();

        const charParts = [];
        if (card.description) charParts.push(card.description);
        if (card.personality) charParts.push(`Personality: ${card.personality}`);
        if (card.scenario)    charParts.push(`Scenario: ${card.scenario}`);

        if (charParts.length > 0) {
            parts.push(`== CHARACTER: ${charName} ==\n${charParts.join('\n')}`);
        }

        // Persona
        if (card.persona) {
            parts.push(`== PERSONA: ${userName} ==\n${card.persona}`);
        }
    } catch (err) {
        log('Could not read character card fields:', err.message);
    }

    // Cached world info entries from last main generation
    if (cachedWorldInfo.length > 0) {
        const wiContent = cachedWorldInfo
            .map(entry => entry.content?.trim())
            .filter(Boolean)
            .join('\n\n');
        if (wiContent) {
            parts.push(`== WORLD INFO ==\n${wiContent}`);
            log(`Including ${cachedWorldInfo.length} cached world info entries in utility prompt`);
        }
    }

    return parts.length > 0 ? parts.join('\n\n') + '\n\n' : '';
}

// ============================================================
// Preset Prompt Helpers
// ============================================================

/**
 * Get tracker prompt content — pulls from the preset first, falls back to registry.
 * Replaces {{char}} and {{user}} macros with actual names.
 * @param {string} settingKey - e.g. 'trackerLotusBoard'
 * @param {string} charName
 * @param {string} userName
 * @returns {string} Prompt content with macros resolved
 */
function getTrackerPromptContent(settingKey, charName, userName) {
    const tracker = TRACKERS[settingKey];
    if (!tracker) return '';

    let content = null;

    // Try preset prompt (single source of truth)
    const prompt = findPrompt(tracker.promptId);
    if (prompt?.content) {
        content = prompt.content;
        log(`Using preset prompt for ${settingKey}`);
    }

    if (!content) {
        logWarn(`Preset prompt not found for ${settingKey} (${tracker.promptId}) — skipping tracker`);
        return '';
    }

    return content
        .replace(/\{\{char\}\}/gi, charName)
        .replace(/\{\{user\}\}/gi, userName);
}

/**
 * Build the full generateRaw prompt.
 * Pulls tracker instructions from the preset prompts (single source of truth).
 * Only includes instructions for active tracker modules.
 *
 * Structure (kept minimal to avoid confusing small models):
 *   1. Role + conversation context
 *   2. Tracker instructions (what to output)
 *   3. Previous state (if any)
 *   4. Output rules
 */
function buildUtilityPrompt() {
    const settings = getSettings();
    const context = getContext();
    const charName = context.name2 || 'Character';
    const userName = context.name1 || 'User';

    const recentChat = getRecentMessages(settings.utilityScanDepth || 2);
    const previousState = getPreviousStateString();

    // Build the allowlist of tags valid for THIS response (only active trackers)
    const activeBuiltInTags = TRACKER_KEYS
        .filter(k => settings[k])
        .map(k => TRACKERS[k].bracketTag);
    const activeCustomTags = getActiveCustomTrackers().map(ct => ct.tag);
    const allActiveTags = [...activeBuiltInTags, ...activeCustomTags];
    const tagList = allActiveTags.map(t => `[${t}]`).join(', ');

    // ---- Section 1: Role + Context ----
    let prompt = `You are a data extraction system. Read the following roleplay conversation and output ONLY structured tracker data. Do not write narrative, dialogue, or commentary.

<conversation>
${recentChat}
</conversation>

`;

    // ---- Section 2: Tracker Instructions ----
    prompt += `<trackers>
`;

    // Include shared format rules only when built-in trackers are active
    const hasActiveBuiltIn = TRACKER_KEYS.some(k => settings[k]);
    if (hasActiveBuiltIn) {
        const rulesId = INFRA.trackerFormatRulesId;
        if (rulesId) {
            const rulesPrompt = findPrompt(rulesId);
            if (rulesPrompt?.content) {
                const rulesContent = rulesPrompt.content
                    .replace(/\{\{\/\/.*?\}\}/g, '')
                    .replace(/\{\{trim\}\}/gi, '')
                    .trim();
                if (rulesContent) {
                    prompt += rulesContent + '\n\n';
                }
            }
        }

        // Built-in tracker definitions from preset
        for (const key of TRACKER_KEYS) {
            if (settings[key]) {
                prompt += getTrackerPromptContent(key, charName, userName) + '\n\n';
            }
        }
    }

    // Custom tracker definitions
    for (const ct of getActiveCustomTrackers()) {
        const ctPrompt = ct.prompt
            .replace(/\{\{char\}\}/gi, charName)
            .replace(/\{\{user\}\}/gi, userName);
        prompt += `${ctPrompt}

Output format for this tracker — the wrapper tags MUST appear exactly as shown, each on its own line, with the tracker content between them:
[${ct.tag}]
(content as specified above)
[/${ct.tag}]

`;
    }

    prompt += `</trackers>

`;

    // ---- Section 3: Previous State ----
    if (previousState) {
        prompt += `<previous_state>
${previousState}
</previous_state>

`;
    }

    // ---- Section 4: Output Rules ----
    prompt += `Output ONLY the following tags: ${tagList}
No other text. No narrative. No explanation. Begin:`;

    return prompt;
}

// ============================================================
// Response Parsing
// ============================================================

/**
 * Extract a bracket-tagged section from the response.
 * Matches [TAG|pipe|data]...[/TAG] (pipe-in-tag) or [TAG]content[/TAG] (simple wrapper).
 * Returns the FULL block including tags.
 * Falls back to grabbing from open tag to next section or end-of-string
 * if the response was truncated (no closing tag).
 * @param {string} text - Raw LLM response
 * @param {string} tag - Tag name (e.g. 'LOTUS', 'TEMPORAL')
 * @returns {string|null} Full tagged block, or null if not found
 */
function extractSection(text, tag) {
    // Strict match: opening tag through closing tag
    const re = new RegExp(`\\[${tag}[|\\]][\\s\\S]*?\\[/${tag}\\]`, 'i');
    const match = text.match(re);
    if (match) return match[0].trim();

    // Fallback for truncated responses
    const allTags = getEffectiveBracketTags().join('|');
    const fallbackRe = new RegExp(`\\[${tag}[|\\]][\\s\\S]*?(?=\\[(?:${allTags})[|\\]]|$)`, 'i');
    const fallbackMatch = text.match(fallbackRe);
    if (fallbackMatch && fallbackMatch[0].trim()) {
        log(`extractSection('${tag}'): used truncation fallback — response may have hit token limit`);
        return fallbackMatch[0].trim();
    }

    return null;
}

/**
 * Extract ALL occurrences of a bracket tag (for multi-entry tags like [RPS|...]).
 * Returns full blocks including tags.
 * @param {string} text - Raw LLM response
 * @param {string} tag - Tag name (e.g. 'RPS')
 * @returns {string[]|null} Array of full block strings, or null if none found
 */
function extractAllSections(text, tag) {
    // Strict: with closing tags
    const re = new RegExp(`\\[${tag}[|\\]][\\s\\S]*?\\[/${tag}\\]`, 'gi');
    const matches = [...text.matchAll(re)].map(m => m[0].trim());
    if (matches.length > 0) return matches;

    // Fallback: opening tags only (truncated response)
    const fallbackRe = new RegExp(`\\[${tag}[|\\]][^\\[]*`, 'gi');
    const fallbackMatches = [...text.matchAll(fallbackRe)].map(m => m[0].trim()).filter(Boolean);
    if (fallbackMatches.length > 0) {
        log(`extractAllSections('${tag}'): used truncation fallback`);
        return fallbackMatches;
    }
    return null;
}

/**
 * Parse the full utility gen response into tracker sections.
 * Iterates all trackers from the registry — uses multiEntry flag to choose
 * between single-block and multi-block extraction.
 * @param {string} rawResponse - Raw generateRaw response
 * @returns {object} Parsed sections keyed by tracker setting key
 */
function parseUtilityResponse(rawResponse) {
    const allKeys = getEffectiveKeys();
    const parsed = Object.fromEntries(allKeys.map(k => [k, null]));

    // Built-in trackers — only parse ACTIVE ones, otherwise we'd accept
    // tracker blocks the model produced uninvited (e.g. TEMPORAL appearing
    // when the user only had Status Board + custom enabled).
    for (const [key, tracker] of Object.entries(TRACKERS)) {
        if (!isTrackerActive(key)) continue;
        if (tracker.multiEntry) {
            const lines = extractAllSections(rawResponse, tracker.bracketTag);
            if (lines) parsed[key] = lines.join('\n');
        } else {
            parsed[key] = extractSection(rawResponse, tracker.bracketTag);
        }
    }

    // Custom trackers — extract by their user-defined tag
    for (const ct of getActiveCustomTrackers()) {
        const k = customKey(ct);
        if (ct.multiEntry) {
            const lines = extractAllSections(rawResponse, ct.tag);
            if (lines) parsed[k] = lines.join('\n');
        } else {
            // Custom tags: try bracket-style wrapper [TAG]...[/TAG] first
            const re = new RegExp(`\\[${ct.tag}\\]([\\s\\S]*?)\\[/${ct.tag}\\]`, 'i');
            const match = rawResponse.match(re);
            if (match) {
                parsed[k] = match[0].trim();
            } else {
                // Pipe-style fallback: [TAG|content][/TAG]
                // Models often collapse into this shape because every built-in
                // tracker in the prompt uses [TAG|val|val] format.
                const pipeRe = new RegExp(`\\[${ct.tag}\\|[\\s\\S]*?\\]\\s*\\[/${ct.tag}\\]`, 'i');
                const pipeMatch = rawResponse.match(pipeRe);
                if (pipeMatch) {
                    parsed[k] = pipeMatch[0].trim();
                    log(`parseUtilityResponse: custom tracker '${ct.label}' captured pipe-style wrapper`);
                } else {
                    // Fallback 1: missing opening tag — LLM forgot [TAG] but kept [/TAG]
                    const missingOpenRe = new RegExp(`(?:\\[/(?:${getEffectiveBracketTags().filter(t => t !== ct.tag).join('|')})\\]|^)([\\s\\S]*?)\\[/${ct.tag}\\]`, 'i');
                    const om = rawResponse.match(missingOpenRe);
                    if (om && om[1] && om[1].trim()) {
                        parsed[k] = `[${ct.tag}]${om[1].trim()}[/${ct.tag}]`;
                        log(`parseUtilityResponse: custom tracker '${ct.label}' recovered missing opening tag`);
                    } else {
                        // Fallback 2: missing closing tag — opening present, no closer
                        const fallbackRe = new RegExp(`\\[${ct.tag}\\][\\s\\S]*?(?=\\[(?:${getEffectiveBracketTags().join('|')})[|\\]]|$)`, 'i');
                        const fm = rawResponse.match(fallbackRe);
                        if (fm && fm[0].trim()) {
                            parsed[k] = fm[0].trim();
                            log(`parseUtilityResponse: custom tracker '${ct.label}' used truncation fallback`);
                        } else {
                            // Fallback 3: mangled opening tag — model merged the tag
                            // with its first content line, e.g. "[SPARK: 25|Flickering"
                            // or "[SPARK 25|...". Capture from the tag name (keeping it,
                            // since the user's content format may start with "TAG:")
                            // to the next known tag or end-of-string, then normalize
                            // into a clean [TAG]...[/TAG] wrapper.
                            const mangledRe = new RegExp(`\\[(${ct.tag}[\\s:|][\\s\\S]*?)(?=\\[(?:${getEffectiveBracketTags().join('|')})[|\\]:]|$)`, 'i');
                            const mm = rawResponse.match(mangledRe);
                            if (mm && mm[1] && mm[1].trim()) {
                                const inner = mm[1].trim().replace(/\]+$/, '').trim();
                                parsed[k] = `[${ct.tag}]\n${inner}\n[/${ct.tag}]`;
                                log(`parseUtilityResponse: custom tracker '${ct.label}' recovered mangled opening tag`);
                            }
                        }
                    }
                }
            }
        }
    }

    return parsed;
}

// ============================================================
// Context Injection (CHAT_COMPLETION_PROMPT_READY)
// ============================================================

/**
 * Handle CHAT_COMPLETION_PROMPT_READY for context injection.
 *
 * New architecture (session 18):
 * - Sep-gen mode: No tracker data in msg.mes → nothing to strip.
 *   Inject a formatted natural-language state summary.
 * - Preset mode: Tags are in msg.mes (LLM wrote them) → leave them.
 *   They provide useful continuity for the LLM.
 *   Optionally inject latest state to reinforce current values.
 * - Both modes: Strip legacy <!--WL_TRACKER_START--> blocks if found.
 *
 * @param {object} eventData - { chat: Array, dryRun: boolean }
 */
function onPromptReady(eventData) {
    if (eventData.dryRun) return;

    const settings = getSettings();
    const chatMessages = eventData.chat;
    if (!Array.isArray(chatMessages)) return;

    // Strip legacy tracker wrapper blocks if any exist from old sessions
    let stripped = 0;
    for (const msg of chatMessages) {
        if (msg.content && typeof msg.content === 'string') {
            TRACKER_BLOCK_RE.lastIndex = 0;
            if (TRACKER_BLOCK_RE.test(msg.content)) {
                msg.content = msg.content.replace(TRACKER_BLOCK_RE, '').trimEnd();
                stripped++;
            }
        }
    }
    if (stripped > 0) {
        log(`Stripped ${stripped} legacy tracker wrapper block(s)`);
    }

    // Only inject state if trackers are relevant
    const anyTrackerActive = TRACKER_KEYS.some(key => settings[key]) || getActiveCustomTrackers().length > 0;
    if (!anyTrackerActive) return;

    // Build state injection based on mode
    const stateStr = settings.useSeparateGen
        ? buildFormattedStateInjection()
        : buildRawStateInjection();

    if (!stateStr) return;

    // Insert before the last user message
    let insertIdx = chatMessages.length;
    for (let i = chatMessages.length - 1; i >= 0; i--) {
        if (chatMessages[i].role === 'user') {
            insertIdx = i;
            break;
        }
    }

    chatMessages.splice(insertIdx, 0, {
        role: 'system',
        content: stateStr,
    });

    log(`Injected tracker state into context (${settings.useSeparateGen ? 'formatted' : 'raw'} mode)`);
}

/**
 * Build a raw bracket-tag state injection for preset mode.
 * The main LLM generates and reads these tags, so we send them as-is.
 */
function buildRawStateInjection() {
    const parts = [];
    for (const key of getEffectiveKeys()) {
        if (latestTrackerState[key]) parts.push(latestTrackerState[key]);
    }
    if (parts.length === 0) return null;
    return `[Current tracker state — use this to maintain continuity]\n${parts.join('\n')}`;
}

/**
 * Build a natural-language state injection for sep-gen mode.
 * The main LLM doesn't generate tracker tags — it just needs to understand
 * the current scene state in plain language. More token-efficient and model-friendly.
 */
function buildFormattedStateInjection() {
    const parts = [];
    const context = getContext();
    const charName = context.name2 || 'Character';

    // Temporal — scene environment
    const temporal = latestTrackerState.trackerTemporal;
    if (temporal) {
        const m = temporal.match(/\[TEMPORAL\|([^|]+)\|([^|]+)\|([^\]]+)\]/i);
        if (m) {
            parts.push(`Time: ${m[1].trim()}, Weather: ${m[2].trim()}, Location: ${m[3].trim()}`);
        }
    }

    // Status Board — per-character status (multiEntry)
    const lotus = latestTrackerState.trackerLotusBoard;
    if (lotus) {
        const re = /\[LOTUS\|([^|]+?)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([\s\S]*?)\]\s*\[\/LOTUS\]/gi;
        const charParts = [];
        let lm;
        while ((lm = re.exec(lotus)) !== null) {
            const name = lm[1].trim();
            charParts.push(
                `${name} — HP: ${lm[2]}, Hunger: ${lm[3]}, Energy: ${lm[4]}, Hygiene: ${lm[5]}, Arousal: ${lm[6]}. ` +
                `Mood: ${lm[7].trim()}. Location: ${lm[8].trim()}. Attire: ${lm[9].trim()}.`,
            );
        }
        if (charParts.length > 0) {
            parts.push(`Character statuses:\n${charParts.join('\n')}`);
        }
    }

    // Relationships — per-character
    const rps = latestTrackerState.trackerRelationship;
    if (rps) {
        const re = /\[RPS\|([^|]+)\|(\d+)\|(\d+)\|(\d+)\|(\d+)\|(\d+)\]/gi;
        const relParts = [];
        let rm;
        while ((rm = re.exec(rps)) !== null) {
            const name = rm[1].trim();
            relParts.push(
                `${name} — Hostility: ${rm[2]}/10, Interest: ${rm[3]}/10, Obligation: ${rm[4]}/10, Trust: ${rm[5]}/10, Attraction: ${rm[6]}/10`,
            );
        }
        if (relParts.length > 0) {
            parts.push(`Relationships with ${charName}:\n${relParts.join('\n')}`);
        }
    }

    // Custom trackers — raw passthrough (we don't know their field structure)
    for (const ct of getAllCustomTrackers()) {
        const k = customKey(ct);
        if (latestTrackerState[k]) {
            // Strip wrapper tags for a cleaner injection
            let inner = latestTrackerState[k];
            const stripRe = new RegExp(`\\[${ct.tag}\\]([\\s\\S]*?)\\[/${ct.tag}\\]`, 'i');
            const sm = inner.match(stripRe);
            if (sm) inner = sm[1].trim();
            parts.push(`${ct.label}: ${inner}`);
        }
    }

    if (parts.length === 0) return null;

    return `[Current scene state — reference for continuity, do not reproduce these tags]\n${parts.join('\n')}`;
}

// ============================================================
// Generation Pipeline
// ============================================================

/**
 * Run the utilities generation pipeline.
 * Called after main generation completes.
 * Includes Summarizer-style safety guards against race conditions.
 */
async function runUtilitiesGen() {
    if (isGenerating) {
        log('Skipping — already generating');
        return;
    }

    if (!hasActiveTrackers()) return;

    // Don't run on a fresh chat — wait until the user has sent at least one message.
    // The greeting alone doesn't give trackers enough context to evaluate.
    const context = getContext();
    const chatLog = context.chat;
    if (chatLog && !chatLog.some(m => m.is_user)) {
        log('Skipping — no user messages yet (new chat)');
        return;
    }

    const settings = getSettings();

    // Check auto-run policy
    if (settings.utilityAutoRun === 'manual') {
        return;
    }

    if (settings.utilityAutoRun === 'every_n') {
        messagesSinceLastGen++;
        if (messagesSinceLastGen < (settings.utilityAutoRunInterval || 3)) {
            return;
        }
    }

    // ---- Summarizer-style safety guards ----

    // Check if streaming is still in progress
    if (typeof window !== 'undefined') {
        const streamingProcessor = window?.SillyTavern?.streamingProcessor;
        if (streamingProcessor && !streamingProcessor.isFinished) {
            log('Skipping — streaming still in progress');
            return;
        }
    }

    // Check if a VerseManager agent run is active
    if (window?.VerseManager?.agents?.isAgentRunActive?.()) {
        log('Skipping — VM agent run active');
        return;
    }

    // Yield 1000ms then re-check guards (Summarizer pattern)
    await new Promise(r => setTimeout(r, 1000));

    // Re-check after yield
    if (isGenerating) return;
    if (typeof window !== 'undefined') {
        const streamingProcessor = window?.SillyTavern?.streamingProcessor;
        if (streamingProcessor && !streamingProcessor.isFinished) {
            log('Skipping after yield — streaming still in progress');
            return;
        }
    }
    if (window?.VerseManager?.agents?.isAgentRunActive?.()) {
        log('Skipping after yield — VM agent run active');
        return;
    }

    await executeUtilitiesGen();
}

/**
 * Execute the utilities gen (can be called manually or automatically).
 */
export async function executeUtilitiesGen() {
    if (isGenerating) {
        log('Skipping — already generating');
        return false;
    }

    if (!hasActiveTrackers()) {
        log('No active trackers, skipping');
        return false;
    }

    isGenerating = true;
    messagesSinceLastGen = 0;
    isCancelled = false;
    let success = false;

    // Show ST's native stop (✕) button so the user can cancel tracker gen,
    // even with the WL panel pinned open.
    showStopButtonForGen();

    try {
        const settings = getSettings();

        // ---- Swipe awareness ----
        // Before building the prompt, revert latestTrackerState to the state
        // from BEFORE the target message. This prevents swipe N's tracker data
        // from bleeding into swipe N+1's "previous state" context.
        const context = getContext();
        const chatLog = context.chat;
        let targetMessageIndex = -1;
        if (chatLog && chatLog.length > 0) {
            for (let i = chatLog.length - 1; i >= 0; i--) {
                if (!chatLog[i].is_user && !chatLog[i].is_system) {
                    targetMessageIndex = i;
                    break;
                }
            }
        }
        if (targetMessageIndex >= 0) {
            const preState = getStateBeforeMessage(targetMessageIndex);
            for (const key of getEffectiveKeys()) {
                latestTrackerState[key] = preState[key] || null;
            }
            log(`Reverted tracker state to pre-message ${targetMessageIndex} (swipe-safe)`);
        }

        const prompt = buildUtilityPrompt();

        log('Running utilities gen...');
        log('Prompt length:', prompt.length, 'chars');

        let result;

        if (settings.utilityConnectionProfile) {
            log('Using connection profile:', settings.utilityConnectionProfile);
            try {
                const messages = [
                    { role: 'user', content: prompt },
                    { role: 'assistant', content: '[' },
                ];
                const response = await ConnectionManagerRequestService.sendRequest(
                    settings.utilityConnectionProfile,
                    messages,
                    settings.utilityMaxTokens || 2000,
                    { extractData: true, stream: false, includePreset: false },
                );
                result = response?.content || '';
                // Re-prepend the prefill character so the parser sees a complete first tag
                if (result && !result.startsWith('[')) result = '[' + result;
            } catch (profileErr) {
                logError('Connection profile request failed:', profileErr);
                log('Falling back to generateRaw...');
                result = null;
            }
        }

        if (!result) {
            result = await generateRaw({
                prompt: prompt,
                instructOverride: true,
                quietToLoud: false,
                systemPrompt: '',
                responseLength: settings.utilityMaxTokens || 2000,
                trimNames: true,
            });
        }

        if (!result || typeof result !== 'string') {
            logError('generateRaw returned empty result:', result);
            toastr.warning('Tracker generation returned an empty response. The model may have been busy or timed out.', 'White Lotus');
            return;
        }

        // Check if user cancelled during generation
        if (isCancelled) {
            log('Generation was cancelled — discarding results');
            toastr.info('Tracker generation cancelled.', 'White Lotus');
            return;
        }

        log('Raw response:', result.substring(0, 500));
        log('Response total length:', result.length, 'chars');

        // Strip thinking/preamble before first '[' and trailing prose after last ']'
        const firstBracket = result.indexOf('[');
        const lastBracket = result.lastIndexOf(']');
        if (firstBracket > 0 || (lastBracket >= 0 && lastBracket < result.length - 1)) {
            const before = result.length;
            if (firstBracket > 0) result = result.slice(firstBracket);
            if (lastBracket >= 0 && lastBracket < result.length - 1) result = result.slice(0, lastBracket + 1);
            log(`Stripped non-tag content: ${before} → ${result.length} chars`);
        }

        // Log closing tag detection for each ACTIVE tracker only
        const closingTags = {};
        for (const [key, tracker] of Object.entries(TRACKERS)) {
            if (!isTrackerActive(key)) continue;
            closingTags[key] = result.includes(`[/${tracker.bracketTag}]`);
        }
        for (const ct of getActiveCustomTrackers()) {
            closingTags[customKey(ct)] = result.includes(`[/${ct.tag}]`);
        }
        log('Closing tags found:', closingTags);

        // Parse
        const parsed = parseUtilityResponse(result);
        const parsedSummary = {};
        for (const key of getEffectiveKeys()) {
            if (!isTrackerActive(key)) continue;
            parsedSummary[key] = parsed[key] ? `${parsed[key].length} chars` : 'null';
        }
        log('Parsed sections:', parsedSummary);

        // Update in-memory state
        for (const key of getEffectiveKeys()) {
            if (parsed[key]) latestTrackerState[key] = parsed[key];
        }

        // Store in metadata + render overlay (new architecture)
        const hasData = Object.values(parsed).some(v => v !== null);
        if (hasData) {
            await storeTrackerResult(parsed);
            renderAllTrackerOverlays();
            log('Utilities gen complete');
            success = true;
        } else {
            log('No tracker data parsed from response — model may have produced unexpected format');
            toastr.info('Tracker generation completed but no data could be parsed. Check console for the raw response.', 'White Lotus');
        }

    } catch (err) {
        logError('Utilities gen failed:', err);
        toastr.error(`Tracker generation failed: ${err.message || 'Unknown error'}`, 'White Lotus');
    } finally {
        isGenerating = false;
        isCancelled = false;
        hideStopButtonForGen();
    }

    return success;
}

/**
 * Manually trigger utilities gen (for button or slash command).
 */
export async function triggerManualGen() {
    return await executeUtilitiesGen();
}

/**
 * Cancel a running utilities gen. Results will be discarded.
 */
export function cancelUtilitiesGen() {
    if (!isGenerating) return;
    isCancelled = true;
    log('Generation cancelled by user');
}

/**
 * Check if utilities gen is currently running.
 */
export function isUtilitiesGenRunning() {
    return isGenerating;
}

// ============================================================
// Initialization
// ============================================================

/** Regex to detect any tracker bracket tags in message content.
 *  Built from ALL_BRACKET_TAGS registry. */
const TRACKER_TAG_RE = new RegExp(
    `\\[(?:${ALL_BRACKET_TAGS.join('|')})[|\\]]`, 'i',
);

/**
 * Wire up event hooks for the utilities pipeline.
 * Called from index.js during init.
 *
 * @param {() => boolean} isActiveCheck - Function that returns whether WL preset is active
 */
export function initUtilitiesGen(isActiveCheck) {
    // Capture triggered world info entries for use in utility gen prompts
    eventSource.on(event_types.WORLD_INFO_ACTIVATED, (entries) => {
        if (!isActiveCheck()) return;
        if (Array.isArray(entries) && entries.length > 0) {
            cachedWorldInfo = entries;
            log(`Cached ${entries.length} world info entries from main generation`);
        }
    });

    // After main generation completes
    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        if (!isActiveCheck()) return;

        const settings = getSettings();

        if (settings.useSeparateGen) {
            // Fire-and-forget — do NOT await inside this handler.
            // ST awaits MESSAGE_RECEIVED listeners, so awaiting here blocks the
            // rest of the generation pipeline (send button re-enable, chat save)
            // until tracker gen finishes. saveChatConditional then deadlocks
            // against the generation lock we're holding open → "Timeout waiting
            // for chat to save". The guards inside runUtilitiesGen already
            // handle streaming/agent-run race conditions.
            setTimeout(() => {
                runUtilitiesGen().catch(err => logError('Auto utilities gen failed:', err));
            }, 0);
        }
        // Preset mode: LLM writes tags inline, regex styles them.
        // No reloadCurrentChat needed — ST renders regex on its own.
    });

    // Rebuild overlays when chat renders (ephemeral DOM elements)
    eventSource.on(event_types.CHAT_CHANGED, () => {
        resetTrackerState();
        // Defer overlay rendering slightly to let DOM settle
        setTimeout(() => {
            if (isActiveCheck()) renderAllTrackerOverlays();
        }, 200);
    });

    // Swipe awareness: when user navigates to a different swipe,
    // refresh the overlay and update latestTrackerState for the active swipe.
    if (event_types.MESSAGE_SWIPED) {
        eventSource.on(event_types.MESSAGE_SWIPED, (mesId) => {
            if (!isActiveCheck()) return;

            const numericId = Number(mesId);
            log(`Swipe detected on message ${numericId}`);

            // Clear the overlay for the swiped message
            $(`#chat .mes[mesid="${numericId}"] .${OVERLAY_CLASS}-wrapper[data-wl-tracker-group]`).remove();

            // Look up tracker data for the now-active swipe
            const meta = getMetadata();
            const context = getContext();
            const msg = context.chat?.[numericId];
            const activeSwipeId = msg?.swipe_id ?? 0;

            if (meta) {
                const matchingEntry = meta.trackerHistory.find(
                    e => e.messageIndex === numericId && (e.swipeId ?? 0) === activeSwipeId,
                );

                if (matchingEntry?.data) {
                    // This swipe has tracker data — render it and update state
                    for (const key of getEffectiveKeys()) {
                        if (matchingEntry.data[key]) {
                            latestTrackerState[key] = matchingEntry.data[key];
                        }
                    }
                    renderTrackerOverlay(matchingEntry);
                    log(`Restored tracker overlay for message ${numericId} swipe ${activeSwipeId}`);
                } else {
                    // No data for this swipe — revert to state before this message
                    const preState = getStateBeforeMessage(numericId);
                    for (const key of getEffectiveKeys()) {
                        latestTrackerState[key] = preState[key] || null;
                    }
                    log(`No tracker data for message ${numericId} swipe ${activeSwipeId} — reverted to pre-message state`);
                }
            }
        });
    }

    // Also rebuild after individual messages render
    if (event_types.MESSAGE_RENDERED) {
        eventSource.on(event_types.MESSAGE_RENDERED, () => {
            if (!isActiveCheck()) return;
            renderAllTrackerOverlays();
        });
    }

    // Context injection before sending to main LLM
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, (eventData) => {
        if (!isActiveCheck()) return;
        onPromptReady(eventData);
    });

    log('Utilities gen pipeline initialized (rearchitected — metadata + DOM overlay mode)');
}
