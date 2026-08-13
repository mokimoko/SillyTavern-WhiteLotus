// src/presetInstaller.js
// Installs / updates the bundled White Lotus preset directly into SillyTavern.
//
// The canonical preset ships under the same stable decorative name shown by ST.
// This module fetches that file and writes it into ST's OpenAI preset store via
// the same /api/presets/save endpoint ST's own import uses, then wires it into
// the live in-memory preset lists so it appears in the dropdown without a reload.
//
// Version tracking is embedded in the preset itself. Prompt integrity is checked
// separately so a same-version preset with missing core blocks can be repaired.

import { eventSource, event_types, getRequestHeaders, saveSettingsDebounced } from '../../../../../script.js';
import { extension_settings } from '../../../../extensions.js';
import { oai_settings, openai_setting_names, openai_settings } from '../../../../openai.js';
import { MODULE_NAME } from './settings.js';
import { createLogger } from './debug.js';
import { classifyPromptOrder } from './moduleRegistry.js';
import {
    PRESET_IDS, PRESET_NAMES, PRESET_SCHEMA_VERSION, compareSemanticVersions,
    getPresetMetadata, getSemanticVersionFromName, presetNamesEqual,
} from './presetMetadata.js';

const { log, logWarn, logError } = createLogger('Installer');

// ============================================================
// Constants — bump BUNDLED_VERSION alongside the bundled preset each release
// ============================================================

export const BUNDLED_VERSION = '4.2.1';

/** Stable name the preset is saved under. Kept constant so updates overwrite in place. */
export const INSTALLED_PRESET_NAME = PRESET_NAMES.WHITE_LOTUS;

/** Path (relative to this module) to the bundled preset JSON.
 *  The bundled filename is kept ASCII-basic for portability; the preset's
 *  drawer name comes from INSTALLED_PRESET_NAME (the decorative PRESET_NAMES
 *  value) when it is saved, independent of the file it ships as. */
const PRESET_ASSET_RELATIVE = '../preset/white-lotus-latest.json';

let activeInstall = null;

function clonePreset(preset) {
    return typeof structuredClone === 'function'
        ? structuredClone(preset)
        : JSON.parse(JSON.stringify(preset));
}

/** Resolve the bundled preset URL from this module's own location. */
function getPresetUrl() {
    return new URL(PRESET_ASSET_RELATIVE, import.meta.url).href;
}

// ============================================================
// Load + validate the bundled preset
// ============================================================

function validatePreset(preset) {
    if (!preset || typeof preset !== 'object') {
        throw new Error('Preset JSON did not contain an object.');
    }
    if (!Array.isArray(preset.prompts)) {
        throw new Error('Preset JSON is missing the prompts array.');
    }
    if (!Array.isArray(preset.prompt_order)) {
        throw new Error('Preset JSON is missing prompt_order.');
    }
    return {
        promptCount: preset.prompts.length,
        orderGroups: preset.prompt_order.length,
    };
}

export async function loadBundledPreset() {
    const response = await fetch(`${getPresetUrl()}?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`Could not load bundled preset (${response.status}).`);
    }
    const preset = await response.json();
    const stats = validatePreset(preset);
    return { preset, stats };
}

// ============================================================
// OpenAI preset store integration
// ============================================================

function ensurePresetState() {
    if (!Array.isArray(openai_settings) || !openai_setting_names || typeof openai_setting_names !== 'object') {
        throw new Error('SillyTavern OpenAI preset state is not ready yet.');
    }
}

/** Numeric index of a named preset in ST's store, or null if absent. */
function getPresetIndex(name) {
    if (!Object.prototype.hasOwnProperty.call(openai_setting_names, name)) {
        return null;
    }
    const value = Number(openai_setting_names[name]);
    return Number.isInteger(value) ? value : null;
}

function getPresetNameForIndex(index) {
    return Object.entries(openai_setting_names)
        .find(([, value]) => Number(value) === index)?.[0] || null;
}

/** Find a stored WL preset by identity, stable name, or legacy signature. */
function findInstalledPreset() {
    ensurePresetState();

    const candidates = openai_settings.map((preset, index) => {
        const metadata = getPresetMetadata(preset);
        const integrity = classifyPromptOrder(getPresetPromptOrder(preset)).state === 'current';
        return { preset, index, name: getPresetNameForIndex(index), metadata, integrity };
    });

    const activeName = oai_settings.preset_settings_openai;
    const marked = candidates.filter(item => item.metadata?.id === PRESET_IDS.WHITE_LOTUS);
    const legacy = candidates.filter(item => !item.metadata && (
        item.integrity || /\bwhite\s+lotus\b/i.test(String(item.name || ''))
    ));
    return marked.find(item => item.name === activeName)
        || legacy.find(item => item.name === activeName)
        || marked.find(item => presetNamesEqual(item.name, INSTALLED_PRESET_NAME))
        || marked[0]
        || legacy.find(item => presetNamesEqual(item.name, INSTALLED_PRESET_NAME))
        || legacy.find(item => item.integrity)
        || legacy[0]
        || null;
}

/** True if a marked or recognizable legacy White Lotus preset exists. */
export function isPresetPresent() {
    try {
        return !!findInstalledPreset();
    } catch {
        return false;
    }
}

/** Pick the populated prompt-order group, matching the active-preset bridge. */
function getPresetPromptOrder(preset) {
    if (!Array.isArray(preset?.prompt_order)) return [];

    let best = null;
    for (const entry of preset.prompt_order) {
        if (!best || (entry?.order?.length ?? 0) > (best?.order?.length ?? 0)) {
            best = entry;
        }
    }
    return best?.order ?? [];
}

/** Inspect the actual stored preset rather than relying on an installer receipt. */
function inspectInstalledPreset() {
    try {
        return findInstalledPreset() || { name: null, metadata: null, integrity: false };
    } catch {
        return { name: null, metadata: null, integrity: false };
    }
}

/**
 * Insert or overwrite the preset in ST's live in-memory lists.
 * Overwrites in place when the name already exists (no duplicate entries).
 */
function upsertPreset(name, presetBody, selectAfterInstall) {
    ensurePresetState();

    const existingIndex = getPresetIndex(name);
    let value;

    if (existingIndex !== null) {
        value = existingIndex;
        const current = openai_settings[value] || {};
        Object.keys(current).forEach(key => delete current[key]);
        Object.assign(current, clonePreset(presetBody));
        openai_settings[value] = current;
    } else {
        openai_settings.push(clonePreset(presetBody));
        value = openai_settings.length - 1;
        openai_setting_names[name] = value;
    }

    updatePresetSelectOption(name, value, selectAfterInstall);

    if (selectAfterInstall) {
        oai_settings.preset_settings_openai = name;
        saveSettingsDebounced();
    }
    return value;
}

/** Add/update the <option> in ST's preset dropdown and optionally select it. */
function updatePresetSelectOption(name, value, selectAfterInstall) {
    const select = document.querySelector('#settings_preset_openai');
    if (!select) return;

    const stringValue = String(value);
    let option = select.querySelector(`option[value="${CSS.escape(stringValue)}"]`);
    if (!option) {
        option = document.createElement('option');
        option.value = stringValue;
        select.appendChild(option);
    }
    option.textContent = name;

    if (!selectAfterInstall) return;

    select.value = stringValue;
    option.selected = true;

    const jquery = window.jQuery || window.$;
    if (typeof jquery === 'function') {
        jquery(select).trigger('change');
    } else {
        select.dispatchEvent(new Event('change', { bubbles: true }));
    }
}

/** Persist the preset to disk via ST's own save endpoint, then wire it in. */
async function savePreset(name, presetBody, selectAfterInstall) {
    if (event_types.OAI_PRESET_IMPORT_READY) {
        await eventSource.emit(event_types.OAI_PRESET_IMPORT_READY, { data: presetBody, presetName: name });
    }

    const response = await fetch('/api/presets/save', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ apiId: 'openai', name, preset: presetBody }),
    });
    if (!response.ok) {
        throw new Error(`Preset save failed (${response.status}).`);
    }

    const data = await response.json();
    const savedName = data?.name || name;
    upsertPreset(savedName, presetBody, selectAfterInstall);
    return savedName;
}

// ============================================================
// Install record (extension_settings.WhiteLotus.presetInstaller)
// ============================================================

function getInstallerRecord() {
    const s = extension_settings[MODULE_NAME] || {};
    return s.presetInstaller || null;
}

function setInstallerRecord(record) {
    extension_settings[MODULE_NAME] = extension_settings[MODULE_NAME] || {};
    extension_settings[MODULE_NAME].presetInstaller = record;
    saveSettingsDebounced();
}

/**
 * Compute the current install state from embedded semantic version metadata,
 * then assess required prompt integrity independently.
 * Returns { status, installedVersion, bundledVersion }.
 *   status: 'not_installed' | 'update_available' | 'repair_available'
 *         | 'newer_than_bundled' | 'up_to_date'
 */
export function getInstallState() {
    const present = isPresetPresent();
    const record = getInstallerRecord();

    if (!present) {
        return { status: 'not_installed', installedVersion: null, bundledVersion: BUNDLED_VERSION };
    }

    const { metadata, integrity, name } = inspectInstalledPreset();
    const hasCanonicalName = presetNamesEqual(name, INSTALLED_PRESET_NAME);
    const legacyNameVersion = getSemanticVersionFromName(name);
    const installedVersion = metadata?.version
        || legacyNameVersion
        || (integrity ? BUNDLED_VERSION : null)
        || record?.version
        || null;

    // A current legacy signature can stand in for missing version metadata, but
    // a non-canonical name still gets one migration update to the stable name.
    if (!metadata) {
        if (!hasCanonicalName) {
            return { status: 'update_available', installedVersion, bundledVersion: BUNDLED_VERSION };
        }
        if (integrity) {
            return { status: 'up_to_date', installedVersion: BUNDLED_VERSION, bundledVersion: BUNDLED_VERSION };
        }
        return { status: 'update_available', installedVersion, bundledVersion: BUNDLED_VERSION };
    }
    if (metadata.id !== PRESET_IDS.WHITE_LOTUS) {
        return { status: 'not_installed', installedVersion: null, bundledVersion: BUNDLED_VERSION };
    }
    if (metadata.schema !== PRESET_SCHEMA_VERSION) {
        const status = metadata.schema > PRESET_SCHEMA_VERSION ? 'newer_than_bundled' : 'update_available';
        return { status, installedVersion, bundledVersion: BUNDLED_VERSION };
    }

    const comparison = compareSemanticVersions(metadata.version, BUNDLED_VERSION);
    if (comparison < 0) {
        return { status: 'update_available', installedVersion, bundledVersion: BUNDLED_VERSION };
    }
    if (comparison > 0) {
        return { status: 'newer_than_bundled', installedVersion, bundledVersion: BUNDLED_VERSION };
    }
    if (!hasCanonicalName) {
        return { status: 'update_available', installedVersion, bundledVersion: BUNDLED_VERSION };
    }
    if (!integrity) {
        return { status: 'repair_available', installedVersion, bundledVersion: BUNDLED_VERSION };
    }
    return { status: 'up_to_date', installedVersion: BUNDLED_VERSION, bundledVersion: BUNDLED_VERSION };
}

// ============================================================
// Public install entry point
// ============================================================

/**
 * Install (or update) the bundled White Lotus preset.
 * @param {object} [options]
 * @param {boolean} [options.selectAfterInstall=true] - select the preset after saving
 * @returns {Promise<{ name, version, stats, selected }>}
 */
export async function installBundledPreset(options = {}) {
    if (activeInstall) return activeInstall;

    const { selectAfterInstall = true } = options;

    activeInstall = (async () => {
        const { preset, stats } = await loadBundledPreset();
        const savedName = await savePreset(INSTALLED_PRESET_NAME, preset, selectAfterInstall);

        setInstallerRecord({
            name: savedName,
            version: BUNDLED_VERSION,
            installedAt: new Date().toISOString(),
            promptCount: stats.promptCount,
        });

        log(`Installed ${savedName} v${BUNDLED_VERSION} (${stats.promptCount} prompts)`);
        return { name: savedName, version: BUNDLED_VERSION, stats, selected: selectAfterInstall };
    })();

    try {
        return await activeInstall;
    } catch (err) {
        logError('Preset install failed', err);
        throw err;
    } finally {
        activeInstall = null;
    }
}

// ============================================================
// First-run auto-install
// ============================================================

/**
 * On first run, silently install the bundled preset if it isn't present yet.
 * Does NOT select it if the user already has another preset active — we only
 * force-select when nothing WL-ish exists, to avoid disrupting an active chat.
 *
 * @param {boolean} anyWhiteLotusActive - whether a WL preset (any version) is currently active
 * @returns {Promise<boolean>} true if an install was performed
 */
export async function autoInstallOnFirstRun(anyWhiteLotusActive) {
    try {
        if (isPresetPresent()) return false;

        // Fresh install — put the preset in place. Only auto-select it if the
        // user isn't already sitting on some other White Lotus preset.
        const result = await installBundledPreset({ selectAfterInstall: !anyWhiteLotusActive });
        globalThis.toastr?.success(
            `White Lotus preset ${result.version} installed.`,
            'White Lotus',
        );
        return true;
    } catch (err) {
        logWarn('Auto-install skipped:', err.message);
        return false;
    }
}
