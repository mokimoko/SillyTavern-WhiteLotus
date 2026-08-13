// Installs and version-checks the bundled Plum Blossom preset.

import { eventSource, event_types, getRequestHeaders, saveSettingsDebounced } from '../../../../../script.js';
import { oai_settings, openai_setting_names, openai_settings } from '../../../../openai.js';
import {
    PRESET_IDS, PRESET_NAMES, PRESET_SCHEMA_VERSION, compareSemanticVersions,
    getPresetMetadata, getSemanticVersionFromName, presetNamesEqual,
} from './presetMetadata.js';

export const BUNDLED_PB_VERSION = '1.0.0';
export const INSTALLED_PB_NAME = PRESET_NAMES.PLUM_BLOSSOM;

// Bundled filename kept ASCII-basic for portability; INSTALLED_PB_NAME (the
// decorative PRESET_NAMES value) still supplies the drawer name at save time.
const ASSET = '../preset/plum-blossom-latest.json';
const CORE_IDS = ['pb_defaults', 'pb_t_analysis', 'pb_e3_commit', 'pb_turnstart'];
const BUNDLED_IDS = [...CORE_IDS, 'pb_analyze_scene'];

let activeInstall = null;

function ensureStore() {
    if (!Array.isArray(openai_settings) || !openai_setting_names || typeof openai_setting_names !== 'object') {
        throw new Error('SillyTavern OpenAI preset state is not ready yet.');
    }
}

function nameForIndex(index) {
    return Object.entries(openai_setting_names).find(([, value]) => Number(value) === index)?.[0] || null;
}

function promptIds(preset) {
    return new Set((preset?.prompts || []).map(prompt => prompt.identifier));
}

function hasIds(preset, ids) {
    const present = promptIds(preset);
    return ids.every(id => present.has(id));
}

function findStoredPreset() {
    ensureStore();
    const activeName = oai_settings.preset_settings_openai;
    const candidates = openai_settings.map((preset, index) => ({
        preset,
        index,
        name: nameForIndex(index),
        metadata: getPresetMetadata(preset),
        legacyIntegrity: hasIds(preset, CORE_IDS),
        integrity: hasIds(preset, BUNDLED_IDS),
    }));
    const marked = candidates.filter(item => item.metadata?.id === PRESET_IDS.PLUM_BLOSSOM);
    const legacy = candidates.filter(item => !item.metadata && (
        item.legacyIntegrity || /\bplum\s+blossom\b/i.test(String(item.name || ''))
    ));
    return marked.find(item => item.name === activeName)
        || marked.find(item => presetNamesEqual(item.name, INSTALLED_PB_NAME))
        || marked[0]
        || legacy.find(item => item.name === activeName)
        || legacy.find(item => presetNamesEqual(item.name, INSTALLED_PB_NAME))
        || legacy.find(item => item.legacyIntegrity)
        || legacy[0]
        || null;
}

export function getPlumBlossomInstallState() {
    let stored;
    try {
        stored = findStoredPreset();
    } catch {
        stored = null;
    }
    if (!stored) {
        return { status: 'not_installed', installedVersion: null, bundledVersion: BUNDLED_PB_VERSION };
    }

    const metadata = stored.metadata;
    const hasCanonicalName = presetNamesEqual(stored.name, INSTALLED_PB_NAME);
    const legacyNameVersion = getSemanticVersionFromName(stored.name);
    const installedVersion = metadata?.version
        || legacyNameVersion
        || null;
    if (!metadata) {
        if (!legacyNameVersion || !hasCanonicalName) {
            return { status: 'update_available', installedVersion, bundledVersion: BUNDLED_PB_VERSION };
        }
        const comparison = compareSemanticVersions(installedVersion, BUNDLED_PB_VERSION);
        if (comparison < 0) return { status: 'update_available', installedVersion, bundledVersion: BUNDLED_PB_VERSION };
        if (comparison > 0) return { status: 'newer_than_bundled', installedVersion, bundledVersion: BUNDLED_PB_VERSION };
        if (!stored.integrity) return { status: 'repair_available', installedVersion, bundledVersion: BUNDLED_PB_VERSION };
        return { status: 'up_to_date', installedVersion: BUNDLED_PB_VERSION, bundledVersion: BUNDLED_PB_VERSION };
    }
    if (metadata.id !== PRESET_IDS.PLUM_BLOSSOM) {
        return { status: 'not_installed', installedVersion: null, bundledVersion: BUNDLED_PB_VERSION };
    }
    if (metadata.schema !== PRESET_SCHEMA_VERSION) {
        return {
            status: metadata.schema > PRESET_SCHEMA_VERSION ? 'newer_than_bundled' : 'update_available',
            installedVersion,
            bundledVersion: BUNDLED_PB_VERSION,
        };
    }

    const comparison = compareSemanticVersions(metadata.version, BUNDLED_PB_VERSION);
    if (comparison < 0) return { status: 'update_available', installedVersion, bundledVersion: BUNDLED_PB_VERSION };
    if (comparison > 0) return { status: 'newer_than_bundled', installedVersion, bundledVersion: BUNDLED_PB_VERSION };
    if (!hasCanonicalName) return { status: 'update_available', installedVersion, bundledVersion: BUNDLED_PB_VERSION };
    if (!stored.integrity) return { status: 'repair_available', installedVersion, bundledVersion: BUNDLED_PB_VERSION };
    return { status: 'up_to_date', installedVersion, bundledVersion: BUNDLED_PB_VERSION };
}

function clone(value) {
    return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function upsert(name, preset, selectAfterInstall) {
    const existing = Object.prototype.hasOwnProperty.call(openai_setting_names, name)
        ? Number(openai_setting_names[name])
        : null;
    let index = Number.isInteger(existing) ? existing : null;
    if (index === null) {
        openai_settings.push(clone(preset));
        index = openai_settings.length - 1;
        openai_setting_names[name] = index;
    } else {
        const current = openai_settings[index] || {};
        Object.keys(current).forEach(key => delete current[key]);
        Object.assign(current, clone(preset));
        openai_settings[index] = current;
    }

    const select = document.querySelector('#settings_preset_openai');
    if (select) {
        let option = select.querySelector(`option[value="${CSS.escape(String(index))}"]`);
        if (!option) {
            option = document.createElement('option');
            option.value = String(index);
            select.appendChild(option);
        }
        option.textContent = name;
        if (selectAfterInstall) {
            select.value = String(index);
            (window.jQuery || window.$)?.(select).trigger('change');
        }
    }
    if (selectAfterInstall) {
        oai_settings.preset_settings_openai = name;
        saveSettingsDebounced();
    }
}

export async function installBundledPlumBlossom({ selectAfterInstall = true } = {}) {
    if (activeInstall) return activeInstall;
    activeInstall = (async () => {
        const url = new URL(ASSET, import.meta.url).href;
        const response = await fetch(`${url}?v=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) throw new Error(`Could not load bundled Plum Blossom (${response.status}).`);
        const preset = await response.json();
        if (!hasIds(preset, BUNDLED_IDS)) throw new Error('Bundled Plum Blossom failed its integrity check.');

        const name = INSTALLED_PB_NAME;
        if (event_types.OAI_PRESET_IMPORT_READY) {
            await eventSource.emit(event_types.OAI_PRESET_IMPORT_READY, { data: preset, presetName: name });
        }
        const saved = await fetch('/api/presets/save', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ apiId: 'openai', name, preset }),
        });
        if (!saved.ok) throw new Error(`Preset save failed (${saved.status}).`);
        const savedName = (await saved.json())?.name || name;
        upsert(savedName, preset, selectAfterInstall);
        return { name: savedName, version: BUNDLED_PB_VERSION, promptCount: preset.prompts.length };
    })();

    try {
        return await activeInstall;
    } finally {
        activeInstall = null;
    }
}
