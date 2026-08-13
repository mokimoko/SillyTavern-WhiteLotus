// src/presetBridge.js
// Bridges White Lotus extension ↔ White Lotus preset prompts
// Handles: prompt toggling, parameter swapping, save/restore lifecycle
//
// All prompt IDs and module definitions come from moduleRegistry.js.
// This file provides the generic operations (toggle, exclusive group,
// tracker toggle, variable setter) and the generation lifecycle hooks.

import { eventSource, event_types, saveSettingsDebounced } from '../../../../../script.js';
import { oai_settings } from '../../../../openai.js';
import { getSetting } from './settings.js';
import {
    TOGGLES, EXCLUSIVE_GROUPS, TRACKERS, INFRA,
    TOGGLE_KEYS, TRACKER_KEYS, GROUP_KEYS,
} from './moduleRegistry.js';
import { createLogger } from './debug.js';

const { log, logWarn } = createLogger('Bridge');

// ============================================================
// Prompt Order Access
// ============================================================

/**
 * Get the active prompt order array (picks the one with most entries).
 */
export function getActivePromptOrder() {
    if (!oai_settings.prompt_order) return [];

    let best = null;
    for (const entry of oai_settings.prompt_order) {
        if (!best || (entry.order?.length ?? 0) > (best.order?.length ?? 0)) {
            best = entry;
        }
    }
    return best?.order ?? [];
}

/**
 * Find a prompt entry in the prompt order by identifier.
 */
function findOrderEntry(identifier) {
    const order = getActivePromptOrder();
    return order.find(e => e.identifier === identifier);
}

/**
 * Find a prompt definition in oai_settings.prompts by identifier.
 */
export function findPrompt(identifier) {
    return oai_settings.prompts?.find(p => p.identifier === identifier);
}

// ============================================================
// Toggle Operations
// ============================================================

/**
 * Enable or disable a prompt in the prompt order.
 * @param {string} identifier - Prompt identifier
 * @param {boolean} enabled - Desired state
 * @returns {boolean} True if the state changed
 */
export function setPromptEnabled(identifier, enabled) {
    const entry = findOrderEntry(identifier);
    if (!entry) {
        logWarn(`Prompt not found in order: ${identifier}`);
        return false;
    }
    if (entry.enabled === enabled) return false;

    entry.enabled = enabled;
    return true;
}

/**
 * Apply a toggle setting — enables/disables all prompt IDs for the module.
 * Handles single-prompt and multi-prompt toggles generically (e.g. Kimi wrangling).
 * @param {string} settingKey - Key in TOGGLES registry
 * @param {boolean} enabled
 */
export function applyToggle(settingKey, enabled) {
    const def = TOGGLES[settingKey];
    if (!def) {
        logWarn(`No toggle definition for: ${settingKey}`);
        return;
    }
    for (const id of def.promptIds) {
        setPromptEnabled(id, enabled);
    }
}

/**
 * Apply an exclusive group setting.
 * Enables the selected member, disables all others in the group.
 * If the group has a masterToggleId, it gets enabled/disabled with the group.
 *
 * @param {string} groupKey - Key in EXCLUSIVE_GROUPS registry
 * @param {string|null} selectedValue - Value to enable, or null/'' for none
 */
export function applyExclusiveGroup(groupKey, selectedValue) {
    const group = EXCLUSIVE_GROUPS[groupKey];
    if (!group) {
        logWarn(`Unknown exclusive group: ${groupKey}`);
        return;
    }

    // Enable/disable master toggle if present (e.g. NSFW master)
    if (group.masterToggleId) {
        const hasSelection = selectedValue != null && selectedValue !== '';
        setPromptEnabled(group.masterToggleId, hasSelection);
    }

    // Enable the selected option, disable all others
    for (const [value, opt] of Object.entries(group.options)) {
        if (opt.promptId) {
            setPromptEnabled(opt.promptId, value === selectedValue);
        }
    }

    // Handle linked toggles — auto-enable/disable toggles based on selection
    if (group.linkedToggles) {
        for (const [toggleKey, enableValues] of Object.entries(group.linkedToggles)) {
            const shouldEnable = enableValues.includes(selectedValue);
            applyToggle(toggleKey, shouldEnable);
        }
    }
}

/**
 * Apply a tracker toggle.
 * Behavior depends on useSeparateGen setting:
 * - OFF: enable/disable the in-preset tracker prompt normally
 * - ON: always DISABLE the in-preset prompt (extension pipeline handles it)
 * Also manages the shared Tracker Format Rules dependency.
 *
 * @param {string} settingKey - Key in TRACKERS registry
 * @param {boolean} enabled - Whether the tracker is active
 */
export function applyTrackerToggle(settingKey, enabled) {
    const tracker = TRACKERS[settingKey];
    if (!tracker) return;

    const useSeparateGen = getSetting('useSeparateGen');

    if (useSeparateGen) {
        // Extension handles generation — always disable in-preset version
        setPromptEnabled(tracker.promptId, false);
    } else {
        // In-preset mode — enable/disable normally
        setPromptEnabled(tracker.promptId, enabled);
    }

    // Sync Tracker Format Rules dependency
    syncTrackerFormatRules();
}

/**
 * Enable or disable the shared Tracker Format Rules prompt based on
 * whether any tracker is currently active in settings.
 */
function syncTrackerFormatRules() {
    const rulesId = INFRA.trackerFormatRulesId;
    if (!rulesId) return;

    const useSeparateGen = getSetting('useSeparateGen');
    const anyActive = TRACKER_KEYS.some(key => getSetting(key));

    if (useSeparateGen) {
        // Separate gen mode — format rules baked into utility prompt
        setPromptEnabled(rulesId, false);
    } else {
        // In-preset mode — enable if any tracker is active
        setPromptEnabled(rulesId, anyActive);
    }
}

// ============================================================
// Apply
//
// As of preset 4.2.0, tense & POV are ordinary exclusive groups (each option
// is its own {{setvar}} prompt), so they flow through applyExclusiveGroup with
// every other group — no content-swapping or save/restore is needed anymore.
// ============================================================

/**
 * Apply all current settings to the preset prompts.
 * Called at GENERATION_AFTER_COMMANDS.
 *
 * @param {object} settings - Current extension settings (or per-character merged)
 */
export function applyAllSettings(settings) {
    // --- Simple toggles (tweaks, fixes, tools) ---
    for (const key of TOGGLE_KEYS) {
        applyToggle(key, !!settings[key]);
    }

    // --- Tracker toggles ---
    for (const key of TRACKER_KEYS) {
        applyTrackerToggle(key, !!settings[key]);
    }

    // --- Exclusive groups ---
    for (const key of GROUP_KEYS) {
        applyExclusiveGroup(key, settings[key]);
    }

    log('Applied all settings to preset');
}

// ============================================================
// Sync: Read current preset state into settings
// ============================================================

/**
 * Read the current state of preset prompts and return corresponding settings.
 * Useful for initializing extension UI from whatever the preset already has enabled.
 */
export function readPresetState() {
    const state = {};

    // Read toggles — check first promptId for enabled state
    for (const [key, def] of Object.entries(TOGGLES)) {
        if (def.promptIds.length === 0) continue; // UI-only toggle, no preset state
        const entry = findOrderEntry(def.promptIds[0]);
        state[key] = entry?.enabled ?? false;
    }

    // Read tracker toggles
    for (const [key, tracker] of Object.entries(TRACKERS)) {
        const entry = findOrderEntry(tracker.promptId);
        state[key] = entry?.enabled ?? false;
    }

    // Read exclusive groups
    for (const [groupKey, group] of Object.entries(EXCLUSIVE_GROUPS)) {
        state[groupKey] = null;
        for (const [value, opt] of Object.entries(group.options)) {
            if (!opt.promptId) continue; // UI-only placeholder (no prompt to check)
            const entry = findOrderEntry(opt.promptId);
            if (entry?.enabled) {
                state[groupKey] = value;
                break;
            }
        }

        // For groups with masterToggleId: if master is off, force null
        if (group.masterToggleId) {
            const masterEntry = findOrderEntry(group.masterToggleId);
            if (!masterEntry?.enabled) {
                state[groupKey] = null;
            }
        }
    }

    // tense & POV are exclusive groups now — already read by the loop above.

    return state;
}

// ============================================================
// Event Wiring
// ============================================================

/**
 * Initialize the generation lifecycle hooks.
 * @param {() => object} getActiveSettings - Function returning current settings to apply
 */
export function initGenerationHooks(getActiveSettings) {
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, () => {
        const settings = getActiveSettings();
        if (settings) {
            applyAllSettings(settings);
        }
    });

    log('Generation hooks initialized');
}
