// src/samplerPresets.js
// Sampler parameter presets — named configurations for quick model switching.
// Each preset defines temperature, penalties, and sampling parameters.
//
// To add a new preset: add one entry to SAMPLER_PRESETS with a unique key.
// It will auto-appear in the dropdown, grouped by family.

import { oai_settings } from '../../../../openai.js';
import { saveSettingsDebounced } from '../../../../../script.js';

// ============================================================
// SAMPLER_PRESETS — preset definitions grouped by model family
// ============================================================

export const SAMPLER_PRESETS = {
    // --- Default ---
    'default': {
        label: 'Default',
        family: 'Default',
        settings: {
            temp_openai: 1.0,
            freq_pen_openai: 0,
            pres_pen_openai: 0,
            top_p_openai: 1,
            top_k_openai: 0,
            repetition_penalty_openai: 1,
            min_p_openai: 0,
            top_a_openai: 1,
        },
    },

    // --- GLM Family ---
    'glm-4.7': {
        label: 'GLM 4.7',
        family: 'GLM',
        settings: {
            temp_openai: 1.0,
            freq_pen_openai: 0,
            pres_pen_openai: 0,
            top_p_openai: 0.95,
            top_k_openai: 40,
            repetition_penalty_openai: 1,
            min_p_openai: 0,
            top_a_openai: 0,
        },
    },
    'glm-5': {
        label: 'GLM 5',
        family: 'GLM',
        note: 'Post-processing: Semi-strict recommended',
        settings: {
            temp_openai: 1.0,
            freq_pen_openai: 0,
            pres_pen_openai: 0,
            top_p_openai: 0.95,
            top_k_openai: 40,
            repetition_penalty_openai: 1,
            min_p_openai: 0,
            top_a_openai: 0,
        },
    },
    'glm-5-alt': {
        label: 'GLM 5 Alt',
        family: 'GLM',
        note: 'Post-processing: Semi-strict recommended',
        settings: {
            temp_openai: 1.0,
            freq_pen_openai: 0.02,
            pres_pen_openai: 0.03,
            top_p_openai: 1,
            top_k_openai: 0,
            repetition_penalty_openai: 1,
            min_p_openai: 0.05,
            top_a_openai: 0.4,
        },
    },
    'glm-5.1': {
        label: 'GLM 5.1T',
        family: 'GLM',
        note: 'Post-processing: Semi-strict recommended',
        settings: {
            temp_openai: 1.0,
            freq_pen_openai: 0,
            pres_pen_openai: 0,
            top_p_openai: 0.95,
            top_k_openai: 40,
            repetition_penalty_openai: 1,
            min_p_openai: 0,
            top_a_openai: 0,
        },
    },
    'glm-5.1-alt': {
        label: 'GLM 5.1T Alt',
        family: 'GLM',
        note: 'Post-processing: Semi-strict recommended',
        settings: {
            temp_openai: 1.0,
            freq_pen_openai: 0.02,
            pres_pen_openai: 0.03,
            top_p_openai: 1,
            top_k_openai: 0,
            repetition_penalty_openai: 1,
            min_p_openai: 0.05,
            top_a_openai: 0.4,
        },
    },

    // --- Kimi Family ---
    'kimi-2.5t': {
        label: 'Kimi 2.5T',
        family: 'Kimi',
        settings: {
            temp_openai: 1.0,
            freq_pen_openai: 0,
            pres_pen_openai: 0,
            top_p_openai: 0.90,
            top_k_openai: 0,
            repetition_penalty_openai: 1,
            min_p_openai: 0.01,
            top_a_openai: 0,
        },
    },
    'kimi-2.5t-alt': {
        label: 'Kimi 2.5T Alt',
        family: 'Kimi',
        settings: {
            temp_openai: 1.0,
            freq_pen_openai: 0,
            pres_pen_openai: 0,
            top_p_openai: 0.95,
            top_k_openai: 25,
            repetition_penalty_openai: 1,
            min_p_openai: 0,
            top_a_openai: 1,
        },
    },
    'kimi-2.5': {
        label: 'Kimi 2.5',
        family: 'Kimi',
        note: 'Non-thinking mode',
        settings: {
            temp_openai: 0.6,
            freq_pen_openai: 0,
            pres_pen_openai: 0,
            top_p_openai: 0.95,
            top_k_openai: 0,
            repetition_penalty_openai: 1,
            min_p_openai: 0.01,
            top_a_openai: 0,
        },
    },
    'kimi-2.6': {
        label: 'Kimi 2.6',
        family: 'Kimi',
        settings: {
            temp_openai: 1.0,
            freq_pen_openai: 0,
            pres_pen_openai: 0,
            top_p_openai: 1.0,
            top_k_openai: 0,
            repetition_penalty_openai: 1,
            min_p_openai: 0,
            top_a_openai: 0,
        },
    },

    // --- Deepseek Family ---
    'ds-3.2-exp': {
        label: 'DS 3.2 Exp (Thinking)',
        family: 'Deepseek',
        note: 'DS API ignores most sampler params for this model',
        settings: {
            temp_openai: 1.0,
            freq_pen_openai: 0,
            pres_pen_openai: 0,
            top_p_openai: 0.95,
            top_k_openai: 0,
            repetition_penalty_openai: 1,
            min_p_openai: 0,
            top_a_openai: 0,
        },
    },
    'ds-4-flash': {
        label: 'DS 4 Flash',
        family: 'Deepseek',
        note: 'Very temp-sensitive — tested at 0.7',
        settings: {
            temp_openai: 0.7,
            freq_pen_openai: 0,
            pres_pen_openai: 0,
            top_p_openai: 0,
            top_k_openai: 0,
            repetition_penalty_openai: 1,
            min_p_openai: 0,
            top_a_openai: 0,
        },
    },
    'ds-4-flash-t': {
        label: 'DS 4 Flash (Thinking)',
        family: 'Deepseek',
        settings: {
            temp_openai: 1.0,
            freq_pen_openai: 0,
            pres_pen_openai: 0,
            top_p_openai: 1.0,
            top_k_openai: 0,
            repetition_penalty_openai: 1,
            min_p_openai: 0,
            top_a_openai: 0,
        },
    },
    'ds-4-pro': {
        label: 'DS 4 Pro',
        family: 'Deepseek',
        settings: {
            temp_openai: 1.0,
            freq_pen_openai: 0,
            pres_pen_openai: 0,
            top_p_openai: 1.0,
            top_k_openai: 0,
            repetition_penalty_openai: 1,
            min_p_openai: 0,
            top_a_openai: 0,
        },
    },

    // --- Other Models ---
    'gemma-4-31b': {
        label: 'Gemma 4 31B',
        family: 'Other',
        settings: {
            temp_openai: 1.0,
            freq_pen_openai: 0,
            pres_pen_openai: 0,
            top_p_openai: 0.95,
            top_k_openai: 64,
            repetition_penalty_openai: 1,
            min_p_openai: 0,
            top_a_openai: 0,
        },
    },

    // --- Custom / Tested ---
    'balanced-creativity': {
        label: 'Balanced Creativity',
        family: 'Custom',
        note: 'Tested with GLM 5 Thinking',
        settings: {
            temp_openai: 1.0,
            freq_pen_openai: 0,
            pres_pen_openai: 0,
            top_p_openai: 0.95,
            top_k_openai: 0,
            repetition_penalty_openai: 1,
            min_p_openai: 0,
            top_a_openai: 0,
        },
    },
    'high-top-k': {
        label: 'High Top K',
        family: 'Custom',
        note: 'Wide Top K pool with Top A tail cut',
        settings: {
            temp_openai: 0.85,
            freq_pen_openai: 0,
            pres_pen_openai: 0,
            top_p_openai: 0.95,
            top_k_openai: 255,
            repetition_penalty_openai: 1,
            min_p_openai: 0,
            top_a_openai: 1,
        },
    },
    'soft-floor': {
        label: 'Soft Floor',
        family: 'Custom',
        note: 'Minimal intervention — gentle Min P floor only',
        settings: {
            temp_openai: 1.0,
            freq_pen_openai: 0,
            pres_pen_openai: 0,
            top_p_openai: 0.99,
            top_k_openai: 0,
            repetition_penalty_openai: 1,
            min_p_openai: 0.05,
            top_a_openai: 0,
        },
    },
};

// ============================================================
// DOM selector map — matches settingsToUpdate in openai.js
// ============================================================

const SAMPLER_SELECTORS = {
    temp_openai:                '#temp_openai',
    freq_pen_openai:            '#freq_pen_openai',
    pres_pen_openai:            '#pres_pen_openai',
    top_p_openai:               '#top_p_openai',
    top_k_openai:               '#top_k_openai',
    top_a_openai:               '#top_a_openai',
    min_p_openai:               '#min_p_openai',
    repetition_penalty_openai:  '#repetition_penalty_openai',
};

// ============================================================
// Apply logic
// ============================================================

/**
 * Apply a sampler preset — updates oai_settings + DOM sliders.
 * @param {string} presetKey — key in SAMPLER_PRESETS
 * @returns {boolean} true if applied successfully
 */
export function applySamplerPreset(presetKey) {
    const preset = SAMPLER_PRESETS[presetKey];
    if (!preset) return false;

    for (const [settingKey, value] of Object.entries(preset.settings)) {
        const selector = SAMPLER_SELECTORS[settingKey];
        if (!selector) continue;

        // Update oai_settings
        oai_settings[settingKey] = value;

        // Update DOM slider/input — trigger('input') updates the counter display
        $(selector).val(value).trigger('input', { source: 'whiteLotus' });
    }

    saveSettingsDebounced();
    return true;
}

// ============================================================
// UI helpers
// ============================================================

/**
 * Build the dropdown HTML for the sampler preset selector.
 * Groups presets by family using <optgroup>.
 */
export function buildSamplerDropdownHTML() {
    // Collect families in order of first appearance
    const families = [];
    const familyMap = {};
    for (const [key, preset] of Object.entries(SAMPLER_PRESETS)) {
        if (!familyMap[preset.family]) {
            familyMap[preset.family] = [];
            families.push(preset.family);
        }
        familyMap[preset.family].push({ key, label: preset.label, note: preset.note });
    }

    let optionsHTML = '<option value="">— Select Sampler —</option>';
    for (const family of families) {
        optionsHTML += `<optgroup label="${family}">`;
        for (const { key, label, note } of familyMap[family]) {
            const title = note ? ` title="${note}"` : '';
            optionsHTML += `<option value="${key}"${title}>${label}</option>`;
        }
        optionsHTML += '</optgroup>';
    }

    return `
        <div class="wl-control-row wl-sampler-row">
            <label class="wl-label"><i class="fa-solid fa-sliders wl-toggle-icon"></i>Sampler</label>
            <select class="wl-select" id="wl-sampler-preset" data-key="samplerPreset">${optionsHTML}</select>
        </div>`;
}

/**
 * Get the note/tooltip for a preset, if any.
 * @param {string} presetKey
 * @returns {string|null}
 */
export function getSamplerNote(presetKey) {
    return SAMPLER_PRESETS[presetKey]?.note ?? null;
}
