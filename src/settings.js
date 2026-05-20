// src/settings.js
// Settings management for White Lotus extension
// Handles: defaults, per-character profiles, persistence
//
// Module defaults (toggles, groups, trackers) come from moduleRegistry.js.
// Infrastructure defaults (gen params, interface toggles) are defined here.

import { extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';
import { buildModuleDefaults } from './moduleRegistry.js';

export const MODULE_NAME = 'WhiteLotus';

const log = (...args) => console.log('[WhiteLotus]', ...args);

// ============================================================
// Default Settings
// ============================================================

/** Infrastructure defaults — settings NOT managed by the module registry */
const INFRA_DEFAULTS = {
    // --- Variable setter params (content-swapped, not toggles) ---
    tense: 'past',           // past | present
    pov: '3rd',              // 1st | 2nd | 3rd

    // --- Sampler ---
    samplerPreset: '',       // key from SAMPLER_PRESETS (empty = none selected)

    // --- Utilities Settings ---
    useSeparateGen: false,
    utilityScanDepth: 2,
    utilityAutoRun: 'every',
    utilityAutoRunInterval: 3,
    utilityConnectionProfile: '',
    utilityMaxTokens: 2000,
    utilityTemperature: 0.7,

    // --- Interface (moved to UI Bedazzler) ---
    // presetDrawerTakeover, userSettingsDrawerTakeover, personaDrawerTakeover,
    // charDrawerTakeover, worldInfoDrawerTakeover, personaDesigns, chatDesign,
    // profiles, activeProfile — all managed by UIBedazzler extension now
};

/** Combined defaults: module registry + infrastructure */
const DEFAULT_SETTINGS = {
    ...buildModuleDefaults(),
    ...INFRA_DEFAULTS,
};

// ============================================================
// Settings Access
// ============================================================

/**
 * Ensure settings structure exists, applying defaults for missing keys.
 */
export function ensureSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = {};
    }
    const s = extension_settings[MODULE_NAME];

    for (const [key, defaultVal] of Object.entries(DEFAULT_SETTINGS)) {
        if (!(key in s)) {
            s[key] = typeof defaultVal === 'object' && defaultVal !== null
                ? JSON.parse(JSON.stringify(defaultVal))
                : defaultVal;
        }
    }

    return s;
}

/**
 * Get the full settings object (with defaults ensured).
 */
export function getSettings() {
    return ensureSettings();
}

/**
 * Get a single setting value.
 */
export function getSetting(key) {
    const s = ensureSettings();
    return s[key];
}

/**
 * Set a single setting value and persist.
 */
export function setSetting(key, value) {
    const s = ensureSettings();
    s[key] = value;
    saveSettingsDebounced();
}
