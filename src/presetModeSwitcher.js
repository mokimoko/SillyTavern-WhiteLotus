// Finds and selects the installed preset belonging to each companion mode.

import { saveSettingsDebounced } from '../../../../../script.js';
import { oai_settings, openai_setting_names, openai_settings } from '../../../../openai.js';
import { classifyPromptOrder } from './moduleRegistry.js';
import { PRESET_IDS, PRESET_NAMES, getPresetMetadata, presetNamesEqual } from './presetMetadata.js';

export const PRESET_MODES = Object.freeze({
    WHITE_LOTUS: 'white-lotus',
    PLUM_BLOSSOM: 'plum-blossom',
});

const PB_REQUIRED_IDS = ['pb_defaults', 'pb_t_analysis', 'pb_e3_commit', 'pb_turnstart'];

function getPromptOrder(preset) {
    if (!Array.isArray(preset?.prompt_order)) return [];
    return preset.prompt_order.reduce((best, item) =>
        (item?.order?.length ?? 0) > (best?.order?.length ?? 0) ? item : best,
    { order: [] }).order || [];
}

function getNameForIndex(index) {
    return Object.entries(openai_setting_names || {})
        .find(([, value]) => Number(value) === index)?.[0] || null;
}

function matchesMode(preset, mode, name) {
    const metadata = getPresetMetadata(preset);
    if (metadata?.id === mode) return true;
    if (metadata) return false;

    if (mode === PRESET_MODES.WHITE_LOTUS) {
        return classifyPromptOrder(getPromptOrder(preset)).state === 'current'
            || /white\s+lotus/i.test(String(name || ''));
    }

    const ids = new Set((preset?.prompts || []).map(prompt => prompt.identifier));
    return PB_REQUIRED_IDS.every(id => ids.has(id))
        || /\bplum\s+blossom\b/i.test(String(name || ''));
}

/** Return the best stored preset candidate for a mode, including renamed imports. */
export function findPresetMode(mode) {
    const activeName = oai_settings.preset_settings_openai;
    const canonicalName = mode === PRESET_MODES.PLUM_BLOSSOM
        ? PRESET_NAMES.PLUM_BLOSSOM
        : PRESET_NAMES.WHITE_LOTUS;
    const candidates = (openai_settings || []).map((preset, index) => ({
        preset,
        index,
        name: getNameForIndex(index),
        metadata: getPresetMetadata(preset),
    })).filter(item => matchesMode(item.preset, mode, item.name));

    return candidates.find(item => item.name === activeName)
        || candidates.find(item => presetNamesEqual(item.name, canonicalName))
        || candidates.find(item => item.metadata?.id === mode)
        || candidates[0]
        || null;
}

export function getPresetModeAvailability() {
    return {
        [PRESET_MODES.WHITE_LOTUS]: findPresetMode(PRESET_MODES.WHITE_LOTUS),
        [PRESET_MODES.PLUM_BLOSSOM]: findPresetMode(PRESET_MODES.PLUM_BLOSSOM),
    };
}

/** Select a stored preset through ST's native dropdown lifecycle. */
export function selectPresetMode(mode) {
    const target = findPresetMode(mode);
    if (!target) return false;

    const select = document.querySelector('#settings_preset_openai');
    if (!select) return false;

    select.value = String(target.index);
    oai_settings.preset_settings_openai = target.name;
    saveSettingsDebounced();

    const jquery = globalThis.jQuery || globalThis.$;
    if (typeof jquery === 'function') {
        jquery(select).trigger('change');
    } else {
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
}
