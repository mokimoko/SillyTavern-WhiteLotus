// index.js — White Lotus Extension
// Entry point: preset detection, settings init, event wiring, panel toggle
//
// UI sections and module routing are driven by moduleRegistry.js.
// Adding a new toggle/group/tracker to the registry auto-wires it
// into the panel, preset controls, payload counter, and settings.

import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { oai_settings } from '../../../openai.js';
import { ConnectionManagerRequestService } from '../../../extensions/shared.js';

import { ensureSettings, getSettings, getSetting, setSetting } from './src/settings.js';
import {
    initGenerationHooks,
    applyToggle,
    applyExclusiveGroup,
    applyTrackerToggle,
    getActivePromptOrder,
    setPromptEnabled,
} from './src/presetBridge.js';
import {
    initUtilitiesGen,
    resetTrackerState,
    triggerManualGen,
    hasActiveTrackers,
} from './src/utilitiesGen.js';
// UI modules (presetDrawer, userSettingsDrawer, personaLore, charDrawer,
// worldInfoDrawer, chatDesign) have moved to the UI Bedazzler extension.

// Module registry — single source of truth for all modules
import {
    TOGGLES, EXCLUSIVE_GROUPS, TRACKERS, INFRA, UI_SECTIONS,
    TOGGLE_KEYS, TRACKER_KEYS, GROUP_KEYS,
    getTogglesByCategory, getGroupOptions,
    classifyPromptOrder,
} from './src/moduleRegistry.js';

// Preset installer — bundled White Lotus preset install/update
import {
    installBundledPreset,
    getInstallState,
    BUNDLED_VERSION,
} from './src/presetInstaller.js';

// Sampler presets — quick-switch sampler configurations per model
import { applySamplerPreset, buildSamplerDropdownHTML, getSamplerNote } from './src/samplerPresets.js';
import { createLogger } from './src/debug.js';
import {
    PRESET_IDS,
    getPresetMetadata,
    getSemanticVersionFromName,
} from './src/presetMetadata.js';
import {
    BUNDLED_PB_VERSION,
    getPlumBlossomInstallState,
    installBundledPlumBlossom,
} from './src/plumBlossomInstaller.js';
import {
    PB_ANALYZE_SCENE_PROMPT_ID,
    executePlumAnalysis,
    initPlumAnalysis,
    isPlumSeparateAnalysisEnabled,
} from './src/plumBlossomAnalysis.js';
import {
    buildPlumBlossomControlsHTML,
    refreshPlumBlossomControls,
    wirePlumBlossomControls,
} from './src/plumBlossomControls.js';
import {
    PB_NATIVE_DEBUG_PROMPT_ID,
    initPlumDebugInspector,
    openPlumDebugInspector,
    syncNativePlumDebug,
    updatePlumDebugButton,
} from './src/plumBlossomDebug.js';
import {
    PB_NATIVE_ACTION_PROMPT_IDS,
    syncNativePlumActions,
} from './src/plumBlossomActions.js';
import {
    PRESET_MODES,
    getPresetModeAvailability,
    selectPresetMode,
} from './src/presetModeSwitcher.js';
import {
    initPromptControlOwnership,
    refreshPromptControlOwnership,
} from './src/promptControlOwnership.js';
import { initPayloadCounter, renderPayloadCounter } from './src/payloadCounter.js';

const { log, logError } = createLogger();

// ============================================================
// State
// ============================================================

let isWhiteLotusActive = false;
let isPlumBlossomActive = false;
// Runtime suspend (not persisted): while set, White Lotus / Plum Blossom act as
// if no supported preset is active — generation hooks, separate-gen, and the
// Prompt Manager ownership lock all stand down. The UI Bedazzler "Preset Drawer
// Expanded" flips this on while it's open so the raw preset can be tested
// without WL's runtime taking over prompt blocks, trackers, or scene analysis.
let isSuspended = false;
let isPanelOpen = false;
let isPanelPinned = false;
let detectedVersion = null;
let detectedVariant = null;
let detectedPlumVersion = null;
let modeSwitchInProgress = false;
let panelMode = PRESET_MODES.WHITE_LOTUS;

function refreshPayloadDisplay() {
    const active = panelMode === PRESET_MODES.PLUM_BLOSSOM
        ? isPlumBlossomActive
        : isWhiteLotusActive;
    renderPayloadCounter(panelMode, active);
}

// ============================================================
// Preset Detection
// ============================================================

/**
 * Detect White Lotus from embedded preset metadata, with signature fallback for
 * legacy 4.2.1 imports that predate the metadata marker.
 *
 * Returns: { active, version, variant }
 */
function detectWhiteLotusPreset() {
    const order = getActivePromptOrder();
    const { state } = classifyPromptOrder(order);
    const metadata = getPresetMetadata({ extensions: oai_settings.extensions });
    const presetName = oai_settings.preset_settings_openai || '';

    const markedWhiteLotus = metadata?.id === PRESET_IDS.WHITE_LOTUS;
    const legacyWhiteLotus = !metadata && (
        state === 'current' || /\bwhite\s+lotus\b/i.test(presetName)
    );

    if (markedWhiteLotus || legacyWhiteLotus) {
        const variantMatch = presetName.match(/\[(?:[^\]]*?)\]\s*\[(.+?)\]/);
        const variant = variantMatch ? variantMatch[1] : null;
        const version = metadata?.version
            || getSemanticVersionFromName(presetName)
            || (state === 'current' ? BUNDLED_VERSION : null);
        return { active: true, version, variant };
    }

    return { active: false, version: null, variant: null };
}

/** Detect a compatible Plum Blossom preset from identity plus state-machine prompts. */
function detectPlumBlossomPreset() {
    const metadata = getPresetMetadata({ extensions: oai_settings.extensions });
    if (metadata && metadata.id !== PRESET_IDS.PLUM_BLOSSOM) {
        return { active: false, version: null };
    }

    const promptIds = new Set((oai_settings.prompts || []).map(prompt => prompt.identifier));
    const requiredIds = ['pb_defaults', 'pb_t_analysis', 'pb_e3_commit', 'pb_turnstart'];
    const compatible = requiredIds.every(id => promptIds.has(id));
    const presetName = oai_settings.preset_settings_openai || '';
    const active = metadata?.id === PRESET_IDS.PLUM_BLOSSOM
        || compatible
        || (!metadata && /\bplum\s+blossom\b/i.test(presetName));
    const version = active
        ? metadata?.version || getSemanticVersionFromName(presetName) || BUNDLED_PB_VERSION
        : null;
    return { active, version };
}

function refreshPresetDetection() {
    const wasActive = isWhiteLotusActive;
    const wasPlumActive = isPlumBlossomActive;
    const prevVersion = detectedVersion;
    const detection = detectWhiteLotusPreset();
    isWhiteLotusActive = detection.active;
    detectedVersion = detection.version;
    detectedVariant = detection.variant;
    const plumDetection = detectPlumBlossomPreset();
    isPlumBlossomActive = plumDetection.active;
    detectedPlumVersion = plumDetection.version;

    // Supported presets follow their matching view. Unrelated presets do not
    // change the user's remembered WL/PB panel mode.
    const detectedMode = isPlumBlossomActive
        ? PRESET_MODES.PLUM_BLOSSOM
        : isWhiteLotusActive ? PRESET_MODES.WHITE_LOTUS : null;
    if (detectedMode && panelMode !== detectedMode) {
        panelMode = detectedMode;
        setSetting('panelMode', panelMode);
    }

    if (isWhiteLotusActive && !wasActive) {
        log('White Lotus preset detected ✓',
            detectedVersion ? `v${detectedVersion}` : '(unversioned)',
            detectedVariant ? `[${detectedVariant}]` : '');
        applySettingsToPreset();
        updateTriggerButton();
    } else if (isWhiteLotusActive && wasActive && detectedVersion !== prevVersion) {
        // Switched between WL preset versions — re-apply stored settings
        log('White Lotus preset version changed:',
            prevVersion ? `v${prevVersion}` : '(unversioned)', '→',
            detectedVersion ? `v${detectedVersion}` : '(unversioned)');
        applySettingsToPreset();
        updateTriggerButton();
    } else if (!isWhiteLotusActive && wasActive) {
        log('White Lotus preset no longer active');
        detectedVersion = null;
        detectedVariant = null;
        updateTriggerButton();
    }

    if (isPlumBlossomActive) {
        syncNativePlumDebug();
        syncNativePlumActions();
        if ((oai_settings.prompts || []).some(prompt => prompt.identifier === PB_ANALYZE_SCENE_PROMPT_ID)) {
            setPromptEnabled(PB_ANALYZE_SCENE_PROMPT_ID, !getSetting('plumBlossomSeparateAnalysis'));
        }
        syncPromptManagerDOM([PB_ANALYZE_SCENE_PROMPT_ID, PB_NATIVE_DEBUG_PROMPT_ID, ...PB_NATIVE_ACTION_PROMPT_IDS]);
        if (!wasPlumActive) {
            log('Plum Blossom preset detected ✓', detectedPlumVersion ? `v${detectedPlumVersion}` : '');
        }
    } else if (wasPlumActive) {
        log('Plum Blossom preset no longer active');
    }

    updateTriggerButton();
    refreshPromptControlOwnership();

    // Keep the installer button label in sync with install/version state
    updateInstallerButton();

    // Refresh panel UI when open (handles pinned panel on preset switch)
    if (isPanelOpen) {
        refreshPanelUI();
    }
}

/**
 * Apply stored extension settings TO the preset's prompt order.
 * Called when WL becomes active — ensures the preset reflects user's saved settings
 * rather than overwriting them with whatever the preset file has.
 */
function applySettingsToPreset() {
    const settings = getSettings();

    for (const key of TOGGLE_KEYS) {
        applyToggle(key, !!settings[key]);
    }

    for (const key of TRACKER_KEYS) {
        applyTrackerToggle(key, !!settings[key]);
    }

    for (const key of GROUP_KEYS) {
        applyExclusiveGroup(key, settings[key]);
    }

    log('Applied stored settings to preset');
}

// ============================================================
// Trigger Button
// ============================================================

function createTriggerButton() {
    if (document.getElementById('wl-trigger-btn')) return;

    const btn = document.createElement('div');
    btn.id = 'wl-trigger-btn';
    btn.title = 'White Lotus';
    btn.innerHTML = `
        <svg class="wl-lotus-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 13.5c0 1.5.5 3 1.5 3.5" opacity="0.4"/>
            <path d="M21 13.5c0 1.5-.5 3-1.5 3.5" opacity="0.4"/>
            <path d="M4.5 11c-.3 2 .3 4.5 2 6 .5.5 1.5.8 2.5.3"/>
            <path d="M19.5 11c.3 2-.3 4.5-2 6-.5.5-1.5.8-2.5.3"/>
            <path d="M7 7.5c-.6 2.5-.3 5.5 1.5 7.5.7.7 1.8 1 3.5.5"/>
            <path d="M17 7.5c.6 2.5.3 5.5-1.5 7.5-.7.7-1.8 1-3.5.5"/>
            <path d="M12 4c-2 3-3 6-3 8.5S11 16 12 16s3-1 3-3.5S14 7 12 4z" fill="currentColor" fill-opacity="0.15" stroke="currentColor"/>
            <circle cx="12" cy="11" r="1.2" fill="currentColor" fill-opacity="0.5" stroke="none"/>
            <path d="M12 20v-4"/>
        </svg>
    `;
    btn.addEventListener('click', () => {
        togglePanel();
    });
    document.body.appendChild(btn);
    updateTriggerButton();
}

function updateTriggerButton() {
    const btn = document.getElementById('wl-trigger-btn');
    if (!btn) return;

    btn.classList.toggle('wl-active', isWhiteLotusActive || isPlumBlossomActive);
    if (isPlumBlossomActive) {
        btn.title = `Plum Blossom${detectedPlumVersion ? ` ${detectedPlumVersion}` : ''} (Active)`;
    } else if (isWhiteLotusActive) {
        const label = detectedVersion ? `White Lotus ${detectedVersion}` : 'White Lotus';
        const tag = detectedVariant ? ` [${detectedVariant}]` : '';
        btn.title = `${label}${tag} (Active)`;
    } else {
        btn.title = 'White Lotus (Preset not detected)';
    }
}

function getActivePresetMode() {
    if (isSuspended) return null;
    if (isPlumBlossomActive) return PRESET_MODES.PLUM_BLOSSOM;
    if (isWhiteLotusActive) return PRESET_MODES.WHITE_LOTUS;
    return null;
}

/** Suspend / resume White Lotus's runtime takeover without unloading it.
 *  Exposed on window.WhiteLotus for the UI Bedazzler preset drawer. */
function setSuspended(next) {
    const value = !!next;
    if (isSuspended === value) return;
    isSuspended = value;
    log(value
        ? 'Suspended — preset drawer open; runtime takeover paused'
        : 'Resumed — runtime takeover re-enabled');
    // Drop or restore the read-only ownership lock on Prompt Manager rows live.
    refreshPromptControlOwnership();
    updateTriggerButton();
}

async function togglePresetMode(panel) {
    if (modeSwitchInProgress) return;
    const targetMode = panelMode === PRESET_MODES.PLUM_BLOSSOM
        ? PRESET_MODES.WHITE_LOTUS
        : PRESET_MODES.PLUM_BLOSSOM;
    panelMode = targetMode;
    setSetting('panelMode', panelMode);
    refreshPanelUI();

    // A header click switches through ST's native preset lifecycle when the
    // companion is installed. If it is absent, the view still toggles so the
    // user can see its inactive controls without an implicit installation.
    const availability = getPresetModeAvailability();
    if (!availability[targetMode] || targetMode === getActivePresetMode()) return;
    modeSwitchInProgress = true;
    panel?.querySelector('#wl-mode-trigger')?.setAttribute('aria-busy', 'true');
    try {
        selectPresetMode(targetMode);
        setTimeout(refreshPresetDetection, 0);
    } catch (error) {
        logError('Preset mode switch failed:', error);
        globalThis.toastr?.error('Could not switch presets. Check the console for details.', 'White Lotus / Plum Blossom');
    } finally {
        modeSwitchInProgress = false;
        panel?.querySelector('#wl-mode-trigger')?.removeAttribute('aria-busy');
    }
}

// ============================================================
// Installer Button (panel header)
// ============================================================

let installInProgress = false;

/**
 * Update the panel-header installer button label/visibility from install state.
 *   - not installed      → "Install preset"
 *   - update available   → "Update preset"
 *   - up to date         → hidden (nothing to do)
 */
function updateInstallerButton() {
    const btn = document.getElementById('wl-installer-btn');
    if (!btn) return;

    if (installInProgress) {
        btn.textContent = 'Installing…';
        btn.classList.remove('wl-hidden');
        btn.disabled = true;
        return;
    }
    btn.disabled = false;

    // The button belongs to the mode being viewed, even when the other preset
    // (or an unrelated preset) is currently active in SillyTavern.
    const isPlum = panelMode === PRESET_MODES.PLUM_BLOSSOM;
    const { status } = isPlum ? getPlumBlossomInstallState() : getInstallState();
    const presetLabel = isPlum ? 'Plum Blossom' : 'White Lotus';
    const bundledVersion = isPlum ? BUNDLED_PB_VERSION : BUNDLED_VERSION;
    btn.dataset.presetMode = panelMode;

    if (status === 'not_installed') {
        btn.textContent = 'Install Preset';
        btn.title = `Install the bundled ${presetLabel} preset (v${bundledVersion}).`;
        btn.dataset.mode = 'install';
        btn.classList.remove('wl-hidden');
    } else if (status === 'update_available') {
        btn.textContent = 'Update Preset';
        btn.title = `Update the ${presetLabel} preset to v${bundledVersion}.`;
        btn.dataset.mode = 'update';
        btn.classList.remove('wl-hidden');
    } else if (status === 'repair_available') {
        btn.textContent = 'Repair Preset';
        btn.title = `Restore required ${presetLabel} v${bundledVersion} prompt blocks.`;
        btn.dataset.mode = 'repair';
        btn.classList.remove('wl-hidden');
    } else {
        // up to date — nothing to offer
        btn.classList.add('wl-hidden');
    }
}

/** Run an install/update from the panel button. */
async function handleInstallerClick() {
    if (installInProgress) return;
    const btn = document.getElementById('wl-installer-btn');
    const targetMode = btn?.dataset.presetMode || panelMode;
    const isPlum = targetMode === PRESET_MODES.PLUM_BLOSSOM;
    installInProgress = true;
    updateInstallerButton();

    try {
        const result = isPlum
            ? await installBundledPlumBlossom({ selectAfterInstall: true })
            : await installBundledPreset({ selectAfterInstall: true });
        const presetLabel = isPlum ? 'Plum Blossom' : 'White Lotus';
        globalThis.toastr?.success(`${presetLabel} preset ${result.version} installed.`, presetLabel);
        // Re-detect against the freshly installed/selected preset.
        refreshPresetDetection();
    } catch (err) {
        logError('Preset install/update failed:', err);
        globalThis.toastr?.error('Preset install failed. Check the console for details.', isPlum ? 'Plum Blossom' : 'White Lotus');
    } finally {
        installInProgress = false;
        updateInstallerButton();
    }
}

// ============================================================
// Side Panel
// ============================================================

function createPanel() {
    if (document.getElementById('wl-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'wl-panel';
    panel.innerHTML = buildPanelHTML();
    document.body.appendChild(panel);

    wirePanelEvents(panel);
}

function togglePanel() {
    isPanelOpen = !isPanelOpen;
    const panel = document.getElementById('wl-panel');
    const btn = document.getElementById('wl-trigger-btn');
    if (panel) {
        panel.classList.toggle('wl-panel-open', isPanelOpen);
        if (isPanelOpen) refreshPanelUI();
    }
    if (btn) btn.classList.toggle('wl-btn-hidden', isPanelOpen);
}

function closePanel() {
    isPanelOpen = false;
    isPanelPinned = false;
    const panel = document.getElementById('wl-panel');
    const btn = document.getElementById('wl-trigger-btn');
    if (panel) {
        panel.classList.remove('wl-panel-open');
        const pinBtn = panel.querySelector('#wl-panel-pin');
        if (pinBtn) pinBtn.classList.remove('wl-pinned');
    }
    if (btn) btn.classList.remove('wl-btn-hidden');
}

// ============================================================
// Panel HTML — generated from the module registry
// ============================================================

function buildSelectRow(key, label, options) {
    const optionHTML = Object.entries(options)
        .map(([val, text]) => `<option value="${val}">${text}</option>`)
        .join('');

    return `
        <div class="wl-control-row">
            <label class="wl-label">${label}</label>
            <select class="wl-select" data-key="${key}">${optionHTML}</select>
        </div>
    `;
}

function buildToggleRow(key, label, icon) {
    const iconHtml = icon ? `<i class="fa-solid ${icon} wl-toggle-icon"></i>` : '';
    return `
        <div class="wl-control-row">
            <label class="wl-label">${iconHtml}${label}</label>
            <label class="wl-toggle">
                <input type="checkbox" data-key="${key}">
                <span class="wl-toggle-slider"></span>
            </label>
        </div>
    `;
}

/**
 * Build controls section HTML from a UI_SECTIONS entry.
 * Generates toggle rows and select rows from the registry.
 */
function buildSectionHTML(section) {
    let rows = '';

    // Sampler preset dropdown — first element in Parameters section
    if (section.id === 'parameters') {
        rows += buildSamplerDropdownHTML();
    }

    // Custom prefix (hand-coded controls like tense/pov)
    if (section.prefix) {
        rows += parsePrefixSelects(section.prefix);
    }

    // Exclusive group selects
    if (section.groups) {
        for (const groupKey of section.groups) {
            const group = EXCLUSIVE_GROUPS[groupKey];
            if (!group) continue;
            rows += buildSelectRow(groupKey, group.label, getGroupOptions(groupKey));
        }
    }

    // Toggle rows — auto-collected by category from TOGGLES + TRACKERS
    if (section.category) {
        const toggles = getTogglesByCategory(section.category);
        for (const toggle of toggles) {
            rows += buildToggleRow(toggle.key, toggle.label, toggle.icon);
            if (toggle.hint) {
                rows += `<div class="wl-setting-hint">${toggle.hint}</div>`;
            }
        }
    }

    // Explicit toggle list (overrides category collection)
    if (section.toggles) {
        for (const key of section.toggles) {
            const def = TOGGLES[key];
            if (!def) continue;
            rows += buildToggleRow(key, def.label, def.icon);
            if (def.hint) {
                rows += `<div class="wl-setting-hint">${def.hint}</div>`;
            }
        }
    }

    // Custom suffix (e.g. Run Trackers button)
    if (section.suffix) {
        rows += section.suffix;
    }

    const collapsibleClass = section.collapsible ? ' wl-collapsible' : '';
    const collapsedClass = section.collapsed ? ' wl-collapsed' : '';
    const chevronHtml = section.collapsible ? '<span class="wl-section-chevron">▸</span>' : '';

    return `
        <div class="wl-section${collapsibleClass}${collapsedClass}" data-section="${section.id}">
            <div class="wl-section-header">${chevronHtml}${section.label}</div>
            <div class="wl-section-body">${rows}</div>
        </div>`;
}

/**
 * Parse the prefix mini-DSL for non-registry selects (tense, pov).
 * Format: __SELECT:key:Label:val1=Label1,val2=Label2__
 */
function parsePrefixSelects(prefix) {
    let html = '';
    const re = /__SELECT:(\w+):([^:]+):(.+?)__/g;
    let match;
    while ((match = re.exec(prefix)) !== null) {
        const [, key, label, optStr] = match;
        const options = {};
        for (const pair of optStr.split(',')) {
            const [val, text] = pair.split('=');
            options[val] = text;
        }
        html += buildSelectRow(key, label, options);
    }
    return html;
}

function buildWhiteLotusChooseBanner() {
    return `
        <div class="wl-choose-banner wl-choose-banner-lotus">
            <span class="wl-choose-mark" aria-hidden="true">蓮</span>
            <div><strong>Choose</strong><span>Shape White Lotus to fit this story and model.</span></div>
        </div>`;
}

function buildPanelHTML() {
    // Build controls view sections from the registry
    let controlSections = '';
    for (const section of UI_SECTIONS) {
        controlSections += buildSectionHTML(section);
    }

    return `
        <div class="wl-panel-header">
            <div class="wl-panel-title-group">
                <button class="wl-panel-mode-trigger" id="wl-mode-trigger" type="button" title="Switch between White Lotus and Plum Blossom">
                    <span class="wl-panel-title">White Lotus</span>
                    <i class="fa-solid fa-repeat" aria-hidden="true"></i>
                </button>
                <button class="wl-installer-btn wl-hidden" id="wl-installer-btn" type="button" title="Install or update the bundled White Lotus preset"></button>
            </div>
            <div class="wl-panel-header-actions">
                <div class="wl-panel-pin" id="wl-panel-pin" title="Pin panel open"><i class="fa-solid fa-thumbtack"></i></div>
                <div class="wl-panel-gear" id="wl-panel-gear" title="Settings">⚙</div>
                <div class="wl-panel-close" id="wl-panel-close">✕</div>
            </div>
        </div>
        <div class="wl-panel-body">

            <!-- ═══ CONTROLS VIEW ═══ -->
            <div class="wl-view" id="wl-view-controls">

            <!-- Status -->
            <div class="wl-panel-status" id="wl-status">
                <span class="wl-status-dot"></span>
                <span class="wl-status-text">Detecting preset...</span>
            </div>

            <div id="wl-mode-controls">
                ${buildWhiteLotusChooseBanner()}
                ${controlSections}
            </div>

            <div id="pb-mode-controls" class="wl-hidden">
                ${buildPlumBlossomControlsHTML(buildSamplerDropdownHTML('pb-sampler-preset'))}
            </div>

            </div><!-- end wl-view-controls -->

            <!-- ═══ SETTINGS VIEW ═══ -->
            <div class="wl-view wl-hidden" id="wl-view-settings">

                <div class="wl-settings-back" id="wl-settings-back">← Back to Controls</div>

                <!-- White Lotus tracker scheduling -->
                <div class="wl-section" id="wl-settings-tracker-gen" data-section="tracker-gen">
                    <div class="wl-section-header">Tracker Generation</div>
                    <div class="wl-section-body">
                        ${buildToggleRow('useSeparateGen', 'Use separate generation')}
                        <div class="wl-setting-hint">When on, trackers run as a separate AI call after each response instead of inline in the main generation.</div>

                        <div class="wl-sep-gen-options" id="wl-sep-gen-options">
                            ${buildSelectRow('utilityAutoRun', 'Auto-run', {
                                every: 'Every message',
                                every_n: 'Every N messages',
                                manual: 'Manual only',
                            })}
                            <div class="wl-control-row wl-autorun-n" id="wl-autorun-n-row">
                                <label class="wl-label">N</label>
                                <input type="number" class="wl-input-number" data-key="utilityAutoRunInterval" min="2" max="10" value="3">
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Plum Blossom analysis scheduling -->
                <div class="wl-section wl-hidden" id="pb-settings-analysis-gen" data-section="analysis-gen">
                    <div class="wl-section-header">Analysis Generation</div>
                    <div class="wl-section-body">
                        ${buildToggleRow('plumBlossomSeparateAnalysis', 'Use separate generation')}
                        <div class="wl-setting-hint">When on, scene analysis runs as a separate AI call instead of inline with narration.</div>

                        <div class="wl-sep-gen-options" id="pb-sep-gen-options">
                            ${buildSelectRow('plumBlossomAnalysisAutoRun', 'Auto-run', {
                                every: 'Every message',
                                every_n: 'Every N messages',
                                manual: 'Manual only',
                            })}
                            <div class="wl-control-row" id="pb-autorun-n-row">
                                <label class="wl-label">N</label>
                                <input type="number" class="wl-input-number" data-key="plumBlossomAnalysisAutoRunInterval" min="2" max="10" value="3">
                            </div>
                            <div class="wl-setting-hint">Manual Run Analysis remains available at any interval.</div>
                        </div>
                    </div>
                </div>

                <!-- Shared sidecar parameters -->
                <div class="wl-section" data-section="gen-params">
                    <div class="wl-section-header">Sidecar Generation</div>
                    <div class="wl-section-body">
                        <div class="wl-control-row">
                            <label class="wl-label">Connection</label>
                            <select class="wl-select" id="wl-utility-profile">
                                <option value="">Current model</option>
                            </select>
                        </div>
                        <div class="wl-setting-hint" id="wl-profile-hint">Use a saved Connection Profile for separate tracker or scene-analysis generation.</div>
                        ${buildSelectRow('utilityScanDepth', 'Scan Depth', {
                            '1': '1 pair',
                            '2': '2 pairs',
                            '3': '3 pairs',
                        })}
                        <div class="wl-control-row">
                            <label class="wl-label">Temperature</label>
                            <input type="number" class="wl-input-number" data-key="utilityTemperature" min="0" max="1.5" step="0.1" value="0.7">
                        </div>
                        <div class="wl-setting-hint">Temperature applies to saved Connection Profiles. “Current model” uses the active SillyTavern sampler settings.</div>
                        <div class="wl-control-row">
                            <label class="wl-label">Max Tokens</label>
                            <input type="number" class="wl-input-number" data-key="utilityMaxTokens" min="500" max="2000" step="100" value="1000">
                        </div>
                    </div>
                </div>

                <!-- Custom Trackers -->
                <div class="wl-section" id="wl-settings-custom-trackers" data-section="custom-trackers">
                    <div class="wl-section-header" style="display:flex;justify-content:space-between;align-items:center;">
                        <span>Custom Trackers</span>
                        <span class="wl-ct-add" id="wl-ct-add" title="Add custom tracker" style="cursor:pointer;font-size:1em;opacity:0.5;line-height:1;">+</span>
                    </div>
                    <div class="wl-section-body" id="wl-ct-list"></div>
                    <div class="wl-setting-hint">User-defined trackers for sep-gen pipeline. Each needs a bracket tag, prompt, and regex for rendering.</div>
                </div>

                <div class="wl-section wl-collapsible wl-collapsed" data-section="preset-integrity">
                    <div class="wl-section-header"><span class="wl-section-chevron">▸</span>Advanced Preset Integrity</div>
                    <div class="wl-section-body">
                        <div class="wl-control-row">
                            <span class="wl-label">Status</span>
                            <span id="wl-integrity-status">Checking…</span>
                        </div>
                        <div class="wl-setting-hint" id="wl-integrity-detail">Compares the preset's embedded version and required White Lotus prompt blocks.</div>
                    </div>
                </div>

                <!-- About -->
                <div class="wl-about-text">White Lotus / Plum Blossom Extension v0.5.6 · WL ${BUNDLED_VERSION} · PB ${BUNDLED_PB_VERSION}</div>

            </div><!-- end wl-view-settings -->

        </div>

        <!-- ═══ PAYLOAD FOOTER ═══ -->
        <div class="wl-panel-footer" id="wl-panel-footer">
            <div class="wl-payload-label">
                <span id="wl-payload-title">Last preset payload</span>
                <span class="wl-payload-badge" id="wl-payload-count">—</span>
            </div>
            <div class="wl-payload-breakdown" id="wl-payload-breakdown"></div>
        </div>
    `;
}

// ============================================================
// Prompt Manager DOM Sync
// When WL toggles a prompt, reflect the change in ST's preset panel.
// ============================================================

/**
 * Get all prompt IDs that could be visually affected by a setting change.
 * Used to sync ST's Prompt Manager list after WL sidebar changes.
 */
function getAffectedPromptIds(key) {
    const ids = [];

    if (key === 'plumBlossomSeparateAnalysis') {
        ids.push(PB_ANALYZE_SCENE_PROMPT_ID);
    } else if (key in TOGGLES) {
        ids.push(...TOGGLES[key].promptIds);
    } else if (key in TRACKERS) {
        ids.push(TRACKERS[key].promptId);
        // Tracker format rules may flip when any tracker toggles
        if (INFRA.trackerFormatRulesId) ids.push(INFRA.trackerFormatRulesId);
    } else if (key in EXCLUSIVE_GROUPS) {
        const group = EXCLUSIVE_GROUPS[key];
        for (const opt of Object.values(group.options)) {
            if (opt.promptId) ids.push(opt.promptId);
        }
        if (group.masterToggleId) ids.push(group.masterToggleId);
        // Include prompt IDs from linked toggles
        if (group.linkedToggles) {
            for (const toggleKey of Object.keys(group.linkedToggles)) {
                const toggle = TOGGLES[toggleKey];
                if (toggle) ids.push(...toggle.promptIds);
            }
        }
    }

    return ids;
}

/**
 * Sync the visual state of prompt entries in ST's Prompt Manager list.
 * Updates the toggle icon and disabled class to match the actual prompt order state.
 */
function syncPromptManagerDOM(identifiers) {
    const order = getActivePromptOrder();

    for (const id of identifiers) {
        const li = document.querySelector(`li[data-pm-identifier="${id}"]`);
        if (!li) continue;

        const orderEntry = order.find(e => e.identifier === id);
        if (!orderEntry) continue;

        const isEnabled = orderEntry.enabled;

        // Toggle disabled class
        li.classList.toggle('completion_prompt_manager_prompt_disabled', !isEnabled);

        // Toggle the icon
        const toggleSpan = li.querySelector('.prompt-manager-toggle-action');
        if (toggleSpan) {
            toggleSpan.classList.toggle('fa-toggle-on', isEnabled);
            toggleSpan.classList.toggle('fa-toggle-off', !isEnabled);
        }
    }
}

// ============================================================
// Immediate Preset Application
// Routes setting changes to the correct preset-control function.
// Uses the registry to determine routing — no hardcoded maps.
// ============================================================

function applySettingToPreset(key, value) {
    if (key === 'plumBlossomSeparateAnalysis') {
        if (!isPlumBlossomActive) return;
        setPromptEnabled(PB_ANALYZE_SCENE_PROMPT_ID, !value);
        return;
    }

    if (!isWhiteLotusActive) return;

    // Simple toggles (tweaks, fixes, tools — including multi-prompt like Kimi)
    if (key in TOGGLES) {
        applyToggle(key, !!value);
        return;
    }

    // Tracker toggles
    if (key in TRACKERS) {
        applyTrackerToggle(key, !!value);
        return;
    }

    // Exclusive groups — includes tense/pov (4.2.0+), NSFW (masterToggleId),
    // length, narrator, diction, genre. All handled generically.
    if (key in EXCLUSIVE_GROUPS) {
        applyExclusiveGroup(key, value);
        return;
    }
}

// ============================================================
// Custom Tracker UI
// ============================================================

/** Generate a short random ID for new custom trackers */
function generateCtId() {
    return Math.random().toString(36).slice(2, 9);
}

/**
 * Render the custom tracker list in the settings panel.
 * Rebuilds the entire list from settings and wires per-card events.
 */
function renderCustomTrackerList() {
    const container = document.getElementById('wl-ct-list');
    if (!container) return;

    const settings = getSettings();
    const trackers = settings.customTrackers || [];

    if (trackers.length === 0) {
        container.innerHTML = '<div style="padding:8px 16px;font-size:0.72em;opacity:0.35;text-align:center;font-style:italic;">No custom trackers</div>';
        return;
    }

    container.innerHTML = trackers.map((ct, i) => `
        <div class="wl-ct-card" data-ct-idx="${i}" data-ct-id="${ct.id}">
            <div class="wl-ct-card-header">
                <span class="wl-ct-chevron">▾</span>
                <span class="wl-ct-name">${ct.label || 'Untitled'}</span>
                <span class="wl-ct-tag">${ct.tag || '—'}</span>
                <label class="wl-toggle wl-ct-toggle">
                    <input type="checkbox" ${ct.enabled ? 'checked' : ''} data-ct-field="enabled">
                    <span class="wl-toggle-slider"></span>
                </label>
            </div>
            <div class="wl-ct-card-body" style="display:none;">
                <div class="wl-ct-field-row">
                    <div class="wl-ct-field" style="flex:1;">
                        <div class="wl-ct-field-label">Label</div>
                        <input class="wl-ct-input" data-ct-field="label" value="${escAttr(ct.label || '')}">
                    </div>
                    <div class="wl-ct-field" style="width:60px;">
                        <div class="wl-ct-field-label">Tag</div>
                        <input class="wl-ct-input" data-ct-field="tag" value="${escAttr(ct.tag || '')}">
                    </div>
                </div>
                <div class="wl-ct-field-row" style="padding:2px 0;">
                    <span style="font-size:0.72em;color:var(--wl-text-muted);">Multi-entry</span>
                    <label class="wl-toggle" style="width:26px;height:13px;">
                        <input type="checkbox" ${ct.multiEntry ? 'checked' : ''} data-ct-field="multiEntry">
                        <span class="wl-toggle-slider"></span>
                    </label>
                </div>
                <div class="wl-ct-field">
                    <div class="wl-ct-field-label">Prompt</div>
                    <textarea class="wl-ct-input wl-ct-textarea wl-ct-textarea-tall" data-ct-field="prompt">${escHtml(ct.prompt || '')}</textarea>
                </div>
                <div class="wl-ct-field">
                    <div class="wl-ct-field-label">Regex find</div>
                    <textarea class="wl-ct-input wl-ct-textarea" data-ct-field="regexFind">${escHtml(ct.regexFind || '')}</textarea>
                </div>
                <div class="wl-ct-field">
                    <div class="wl-ct-field-label">Regex replace</div>
                    <textarea class="wl-ct-input wl-ct-textarea" data-ct-field="regexReplace">${escHtml(ct.regexReplace || '')}</textarea>
                </div>
                <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:6px;padding-top:4px;border-top:1px solid var(--wl-border);">
                    <span class="wl-ct-action wl-ct-delete" data-ct-action="delete">delete</span>
                    <span class="wl-ct-action" data-ct-action="duplicate">duplicate</span>
                </div>
            </div>
        </div>
    `).join('');

    // Wire per-card events
    container.querySelectorAll('.wl-ct-card').forEach(card => {
        const idx = parseInt(card.dataset.ctIdx, 10);

        // Expand/collapse
        card.querySelector('.wl-ct-card-header').addEventListener('click', (e) => {
            if (e.target.closest('.wl-ct-toggle')) return;
            const body = card.querySelector('.wl-ct-card-body');
            const chevron = card.querySelector('.wl-ct-chevron');
            const open = body.style.display !== 'none';
            body.style.display = open ? 'none' : '';
            chevron.classList.toggle('wl-ct-chevron-open', !open);
        });

        // Field changes
        card.querySelectorAll('[data-ct-field]').forEach(input => {
            const field = input.dataset.ctField;
            const event = input.type === 'checkbox' ? 'change' : 'input';
            input.addEventListener(event, () => {
                const s = getSettings();
                const val = input.type === 'checkbox' ? input.checked : input.value;
                s.customTrackers[idx][field] = val;
                saveSettingsDebounced();

                // Update collapsed card display
                if (field === 'label') card.querySelector('.wl-ct-name').textContent = val || 'Untitled';
                if (field === 'tag') card.querySelector('.wl-ct-tag').textContent = val || '—';
            });
        });

        // Actions
        card.querySelectorAll('[data-ct-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const s = getSettings();
                if (btn.dataset.ctAction === 'delete') {
                    s.customTrackers.splice(idx, 1);
                } else if (btn.dataset.ctAction === 'duplicate') {
                    const clone = JSON.parse(JSON.stringify(s.customTrackers[idx]));
                    clone.id = generateCtId();
                    clone.label += ' (copy)';
                    s.customTrackers.splice(idx + 1, 0, clone);
                }
                saveSettingsDebounced();
                renderCustomTrackerList();
            });
        });
    });
}

/** Escape for HTML attributes */
function escAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape for HTML content */
function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ============================================================
// Panel Event Wiring
// ============================================================

function wirePanelEvents(panel) {
    // Close button
    panel.querySelector('#wl-panel-close')?.addEventListener('click', closePanel);

    // Installer button (Install / Update bundled preset)
    panel.querySelector('#wl-installer-btn')?.addEventListener('click', handleInstallerClick);
    updateInstallerButton();

    const modeTrigger = panel.querySelector('#wl-mode-trigger');
    modeTrigger?.addEventListener('click', () => togglePresetMode(panel));

    // Collapsible section headers
    panel.querySelectorAll('.wl-section.wl-collapsible .wl-section-header').forEach(header => {
        header.addEventListener('click', () => {
            const section = header.closest('.wl-section');
            if (section) section.classList.toggle('wl-collapsed');
        });
    });

    // Pin button — toggle pinned state (prevents click-outside close)
    panel.querySelector('#wl-panel-pin')?.addEventListener('click', () => {
        isPanelPinned = !isPanelPinned;
        const pinBtn = panel.querySelector('#wl-panel-pin');
        if (pinBtn) {
            pinBtn.classList.toggle('wl-pinned', isPanelPinned);
            pinBtn.title = isPanelPinned ? 'Unpin panel' : 'Pin panel open';
        }
    });

    // Gear icon — toggle between controls and settings views
    panel.querySelector('#wl-panel-gear')?.addEventListener('click', () => {
        const controls = panel.querySelector('#wl-view-controls');
        const settings = panel.querySelector('#wl-view-settings');
        if (!controls || !settings) return;
        controls.classList.toggle('wl-hidden');
        settings.classList.toggle('wl-hidden');
    });

    // Settings back button
    panel.querySelector('#wl-settings-back')?.addEventListener('click', () => {
        const controls = panel.querySelector('#wl-view-controls');
        const settings = panel.querySelector('#wl-view-settings');
        if (!controls || !settings) return;
        controls.classList.remove('wl-hidden');
        settings.classList.add('wl-hidden');
    });

    // Click outside to close (unless pinned)
    document.addEventListener('click', (e) => {
        if (!isPanelOpen || isPanelPinned) return;
        const panel = document.getElementById('wl-panel');
        const btn = document.getElementById('wl-trigger-btn');
        if (panel && !panel.contains(e.target) && btn && !btn.contains(e.target)) {
            closePanel();
        }
    });

    // Select changes — generic handler
    panel.querySelectorAll('.wl-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const key = e.target.dataset.key;
            if (!key) return;
            const value = e.target.value;
            setSetting(key, value);
            applySettingToPreset(key, value);
            syncPromptManagerDOM(getAffectedPromptIds(key));

            // Sync linked toggles — update settings and panel checkboxes
            if (key in EXCLUSIVE_GROUPS) {
                const group = EXCLUSIVE_GROUPS[key];
                if (group.linkedToggles) {
                    for (const [toggleKey, enableValues] of Object.entries(group.linkedToggles)) {
                        const shouldEnable = enableValues.includes(value);
                        setSetting(toggleKey, shouldEnable);
                        const cb = panel.querySelector(`.wl-toggle input[data-key="${toggleKey}"]`);
                        if (cb) cb.checked = shouldEnable;
                    }
                }
            }

            refreshPayloadDisplay();
            log(`Setting changed: ${key} = ${value}`);
        });
    });

    // Sampler preset dropdown — applies sampler values to oai_settings + sliders
    panel.querySelectorAll('[data-sampler-preset]').forEach(sampler => {
        sampler.addEventListener('change', (e) => {
            const presetKey = e.target.value;
            if (!presetKey) return;

            const applied = applySamplerPreset(presetKey);
            if (applied) {
                setSetting('samplerPreset', presetKey);
                panel.querySelectorAll('[data-sampler-preset]').forEach(other => {
                    other.value = presetKey;
                });
                const note = getSamplerNote(presetKey);
                log(`Sampler preset applied: ${presetKey}${note ? ` (${note})` : ''}`);
            }
        });
    });

    // Toggle changes — generic handler
    panel.querySelectorAll('.wl-toggle input[type="checkbox"][data-key]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const key = e.target.dataset.key;
            const value = e.target.checked;
            setSetting(key, value);

            // All remaining toggles are registry-managed modules
            applySettingToPreset(key, value);
            syncPromptManagerDOM(getAffectedPromptIds(key));

            refreshPayloadDisplay();
            log(`Toggle changed: ${key} = ${value}`);
        });
    });

    // Run Trackers button
    const runTrackersBtn = panel.querySelector('#wl-run-trackers');
    if (runTrackersBtn) {
        runTrackersBtn.addEventListener('click', async () => {
            if (!isWhiteLotusActive) {
                toastr.warning('White Lotus preset not detected.');
                return;
            }
            if (!hasActiveTrackers()) {
                toastr.info('Enable at least one tracker first.');
                return;
            }
            runTrackersBtn.disabled = true;
            runTrackersBtn.textContent = 'Running...';
            try {
                const success = await triggerManualGen();
                if (success) {
                    toastr.success('Trackers updated.');
                }
                // Failure toasts are handled inside executeUtilitiesGen
            } catch (err) {
                logError('Manual tracker gen failed:', err);
                toastr.error('Tracker generation failed.');
            } finally {
                runTrackersBtn.disabled = false;
                runTrackersBtn.textContent = 'Run Trackers';
            }
        });
    }

    const runAnalysisBtn = panel.querySelector('#pb-run-analysis');
    runAnalysisBtn?.addEventListener('click', async () => {
        if (!isPlumBlossomActive) {
            globalThis.toastr?.warning('Plum Blossom preset not detected.');
            return;
        }
        if (!isPlumSeparateAnalysisEnabled()) {
            globalThis.toastr?.info('Enable both Scene Analysis and Separate scene analysis first.');
            return;
        }

        runAnalysisBtn.disabled = true;
        runAnalysisBtn.textContent = 'Running...';
        try {
            const success = await executePlumAnalysis();
            if (success) globalThis.toastr?.success('Scene analysis updated.', 'Plum Blossom');
        } finally {
            runAnalysisBtn.disabled = false;
            runAnalysisBtn.textContent = 'Run Analysis';
        }
    });

    panel.querySelector('#pb-open-debug')?.addEventListener('click', openPlumDebugInspector);

    wirePlumBlossomControls(panel.querySelector('#pb-mode-controls'), {
        syncPromptManager: syncPromptManagerDOM,
        onChanged: refreshPanelUI,
    });

    // Settings view: number inputs
    panel.querySelectorAll('.wl-input-number').forEach(input => {
        input.addEventListener('change', (e) => {
            const key = e.target.dataset.key;
            const value = parseFloat(e.target.value);
            if (!isNaN(value)) {
                setSetting(key, value);
                log(`Setting changed: ${key} = ${value}`);
            }
        });
    });

    // Settings view: useSeparateGen toggle controls sub-option visibility
    const sepGenToggle = panel.querySelector('.wl-toggle input[data-key="useSeparateGen"]');
    if (sepGenToggle) {
        const updateSepGenVisibility = () => {
            const opts = panel.querySelector('#wl-sep-gen-options');
            if (opts) opts.style.display = sepGenToggle.checked ? '' : 'none';

            // Re-apply all tracker toggles with the new mode
            const s = getSettings();
            for (const key of TRACKER_KEYS) {
                applyTrackerToggle(key, !!s[key]);
            }

            // Sync prompt manager DOM for all tracker prompts + format rules
            const trackerIds = TRACKER_KEYS.map(k => TRACKERS[k].promptId);
            if (INFRA.trackerFormatRulesId) trackerIds.push(INFRA.trackerFormatRulesId);
            syncPromptManagerDOM(trackerIds);
        };
        sepGenToggle.addEventListener('change', updateSepGenVisibility);
        updateSepGenVisibility();
    }

    const plumSepGenToggle = panel.querySelector('.wl-toggle input[data-key="plumBlossomSeparateAnalysis"]');
    if (plumSepGenToggle) {
        const updatePlumSepGenVisibility = () => {
            const opts = panel.querySelector('#pb-sep-gen-options');
            if (opts) opts.style.display = plumSepGenToggle.checked ? '' : 'none';
            const runAnalysisBtn = panel.querySelector('#pb-run-analysis');
            if (runAnalysisBtn) {
                runAnalysisBtn.disabled = !isPlumBlossomActive || !isPlumSeparateAnalysisEnabled();
            }
        };
        plumSepGenToggle.addEventListener('change', updatePlumSepGenVisibility);
        updatePlumSepGenVisibility();
    }

    // Settings view: auto-run select controls N row visibility
    const autoRunSelect = panel.querySelector('.wl-select[data-key="utilityAutoRun"]');
    if (autoRunSelect) {
        const updateNVisibility = () => {
            const nRow = panel.querySelector('#wl-autorun-n-row');
            if (nRow) nRow.style.display = autoRunSelect.value === 'every_n' ? '' : 'none';
        };
        autoRunSelect.addEventListener('change', updateNVisibility);
        updateNVisibility();
    }

    const plumAutoRunSelect = panel.querySelector('.wl-select[data-key="plumBlossomAnalysisAutoRun"]');
    if (plumAutoRunSelect) {
        const updatePlumNVisibility = () => {
            const nRow = panel.querySelector('#pb-autorun-n-row');
            if (nRow) nRow.style.display = plumAutoRunSelect.value === 'every_n' ? '' : 'none';
        };
        plumAutoRunSelect.addEventListener('change', updatePlumNVisibility);
        updatePlumNVisibility();
    }

    // Custom tracker: add button
    panel.querySelector('#wl-ct-add')?.addEventListener('click', () => {
        const s = getSettings();
        s.customTrackers.push({
            id: generateCtId(),
            label: '',
            tag: 'CUSTOM',
            prompt: '',
            regexFind: '',
            regexReplace: '',
            multiEntry: false,
            enabled: false,
        });
        saveSettingsDebounced();
        renderCustomTrackerList();
    });

    // Initial render
    renderCustomTrackerList();
}

// ============================================================
// Panel UI Refresh
// ============================================================

function refreshPanelUI() {
    const panel = document.getElementById('wl-panel');
    if (!panel) return;

    const settings = getSettings();

    const viewingPlum = panelMode === PRESET_MODES.PLUM_BLOSSOM;
    const viewedPresetActive = viewingPlum ? isPlumBlossomActive : isWhiteLotusActive;
    const integrity = viewingPlum ? getPlumBlossomInstallState() : getInstallState();
    const integrityStatus = panel.querySelector('#wl-integrity-status');
    const integrityDetail = panel.querySelector('#wl-integrity-detail');
    if (integrityStatus && integrityDetail) {
        const labels = {
            not_installed: 'Not installed',
            update_available: 'Update available',
            repair_available: 'Repair available',
            newer_than_bundled: 'Newer than bundled',
            up_to_date: 'Healthy',
        };
        integrityStatus.textContent = labels[integrity.status] || 'Unknown';
        const installed = integrity.installedVersion ? `Installed ${integrity.installedVersion}. ` : '';
        integrityDetail.textContent = `${installed}Bundled ${integrity.bundledVersion}. Version identity and required prompt blocks are checked separately.`;
    }

    const title = panel.querySelector('.wl-panel-title');
    if (title) title.textContent = viewingPlum ? 'Plum Blossom' : 'White Lotus';
    const modeTrigger = panel.querySelector('#wl-mode-trigger');
    if (modeTrigger) {
        modeTrigger.title = viewingPlum ? 'Switch to White Lotus' : 'Switch to Plum Blossom';
        modeTrigger.setAttribute('aria-label', modeTrigger.title);
    }

    // Status indicator
    const statusDot = panel.querySelector('.wl-status-dot');
    const statusText = panel.querySelector('.wl-status-text');
    if (statusDot && statusText) {
        statusDot.classList.toggle('wl-status-active', viewedPresetActive);
        if (viewingPlum && isPlumBlossomActive) {
            statusText.textContent = `Plum Blossom${detectedPlumVersion ? ` ${detectedPlumVersion}` : ''} Active`;
        } else if (!viewingPlum && isWhiteLotusActive) {
            const label = detectedVersion ? `White Lotus ${detectedVersion}` : 'White Lotus';
            const tag = detectedVariant ? ` [${detectedVariant}]` : '';
            statusText.textContent = `${label}${tag} Active`;
        } else {
            statusText.textContent = `${viewingPlum ? 'Plum Blossom' : 'White Lotus'} Preset Not Active`;
        }
    }

    panel.querySelector('#wl-mode-controls')?.classList.toggle('wl-hidden', viewingPlum);
    panel.querySelector('#pb-mode-controls')?.classList.toggle('wl-hidden', !viewingPlum);
    panel.querySelector('#wl-settings-tracker-gen')?.classList.toggle('wl-hidden', viewingPlum);
    panel.querySelector('#pb-settings-analysis-gen')?.classList.toggle('wl-hidden', !viewingPlum);
    panel.querySelector('#wl-settings-custom-trackers')?.classList.toggle('wl-hidden', viewingPlum);
    panel.classList.toggle('wl-mode-plum', viewingPlum);
    if (viewingPlum) refreshPlumBlossomControls(panel.querySelector('#pb-mode-controls'));

    // Each view is tied only to its own preset. Samplers stay available for any
    // active ST preset, including presets unrelated to either companion.
    const whiteLotusControls = panel.querySelector('#wl-mode-controls');
    whiteLotusControls?.querySelectorAll('.wl-select, .wl-toggle input, .wl-btn').forEach(el => {
        if (el.matches('[data-sampler-preset]')) return;
        el.disabled = !isWhiteLotusActive;
    });
    const pbControls = panel.querySelector('#pb-mode-controls');
    pbControls?.querySelectorAll('.wl-select, .wl-toggle input, .wl-btn').forEach(el => {
        if (el.matches('[data-sampler-preset]')) return;
        el.disabled = !isPlumBlossomActive;
    });

    panel.querySelectorAll('#wl-view-settings .wl-select, #wl-view-settings .wl-toggle input, #wl-view-settings .wl-input-number, #wl-view-settings .wl-btn').forEach(el => {
        el.disabled = !viewedPresetActive;
    });

    // Sync select values
    panel.querySelectorAll('.wl-select').forEach(select => {
        const key = select.dataset.key;
        if (!key) return;
        select.value = settings[key] ?? '';
    });

    // Sync toggle values
    panel.querySelectorAll('.wl-toggle input[type="checkbox"][data-key]').forEach(checkbox => {
        const key = checkbox.dataset.key;
        checkbox.checked = !!settings[key];
    });

    const runAnalysisBtn = panel.querySelector('#pb-run-analysis');
    if (runAnalysisBtn) {
        runAnalysisBtn.disabled = !isPlumBlossomActive || !isPlumSeparateAnalysisEnabled();
    }
    updatePlumDebugButton(panel, isPlumBlossomActive);

    const profileHint = panel.querySelector('#wl-profile-hint');
    if (profileHint) {
        profileHint.textContent = viewingPlum
            ? 'Use a saved Connection Profile for separate scene analysis. If selected, PB will not silently fall back to the narrative model.'
            : 'Use a saved Connection Profile for separate tracker generation. Current model uses the active chat connection.';
    }

    // Sync number inputs
    panel.querySelectorAll('.wl-input-number').forEach(input => {
        const key = input.dataset.key;
        if (key && settings[key] !== undefined) {
            input.value = settings[key];
        }
    });

    // Update conditional visibility
    const sepGenOpts = panel.querySelector('#wl-sep-gen-options');
    if (sepGenOpts) sepGenOpts.style.display = settings.useSeparateGen ? '' : 'none';

    const plumSepGenOpts = panel.querySelector('#pb-sep-gen-options');
    if (plumSepGenOpts) plumSepGenOpts.style.display = settings.plumBlossomSeparateAnalysis ? '' : 'none';

    const nRow = panel.querySelector('#wl-autorun-n-row');
    if (nRow) nRow.style.display = settings.utilityAutoRun === 'every_n' ? '' : 'none';

    const plumNRow = panel.querySelector('#pb-autorun-n-row');
    if (plumNRow) plumNRow.style.display = settings.plumBlossomAnalysisAutoRun === 'every_n' ? '' : 'none';

    renderCustomTrackerList();
    renderPayloadCounter(panelMode, viewedPresetActive);
    updateInstallerButton();
}

// ============================================================
// Active Settings Provider
// ============================================================

function getActiveSettings() {
    // Lightweight guard — re-check signatures at generation time in case the
    // active preset changed without OAI_PRESET_CHANGED_AFTER firing.
    if (isWhiteLotusActive) {
        const { state } = classifyPromptOrder(getActivePromptOrder());
        if (state === 'none') {
            log('Active preset no longer matches WL signatures — deactivating');
            isWhiteLotusActive = false;
        }
    }

    if (isSuspended) return null;
    if (!isWhiteLotusActive) return null;
    return getSettings();
}

// ============================================================
// Connection Profile Dropdown
// ============================================================

function initConnectionProfileDropdown() {
    const settings = getSettings();

    try {
        ConnectionManagerRequestService.handleDropdown(
            '#wl-utility-profile',
            settings.utilityConnectionProfile || '',
            (profile) => {
                setSetting('utilityConnectionProfile', profile?.id || '');
                log('Utility connection profile changed:', profile?.name || 'Current model');
            },
            () => {},
            () => {},
            (profile) => {
                if (getSetting('utilityConnectionProfile') === profile.id) {
                    setSetting('utilityConnectionProfile', '');
                    log('Utility connection profile deleted — reverted to current model');
                }
            },
        );
        log('Connection profile dropdown initialized');
    } catch (err) {
        log('Connection Manager not available — profile dropdown disabled:', err.message);
        const dropdown = document.getElementById('wl-utility-profile');
        if (dropdown) {
            dropdown.disabled = true;
            dropdown.title = 'Enable Connection Manager extension to use this feature';
        }
        const hint = document.getElementById('wl-profile-hint');
        if (hint) {
            hint.textContent = 'Connection Manager extension is not active. Enable it in Extensions to select a model.';
        }
    }
}

// ============================================================
// Init
// ============================================================

jQuery(async () => {
    log('Initializing...');

    const initialSettings = ensureSettings();
    panelMode = initialSettings.panelMode === PRESET_MODES.PLUM_BLOSSOM
        ? PRESET_MODES.PLUM_BLOSSOM
        : PRESET_MODES.WHITE_LOTUS;

    createTriggerButton();
    createPanel();
    initPromptControlOwnership(getActivePresetMode);

    refreshPresetDetection();

    initGenerationHooks(getActiveSettings);
    initUtilitiesGen(() => isWhiteLotusActive && !isSuspended);
    initPlumAnalysis(() => isPlumBlossomActive && !isSuspended);
    initPlumDebugInspector(() => isPlumBlossomActive);

    // Public control surface for the UI Bedazzler preset drawer (optional peer).
    globalThis.WhiteLotus = Object.assign(globalThis.WhiteLotus || {}, {
        suspend: () => setSuspended(true),
        resume: () => setSuspended(false),
        isSuspended: () => isSuspended,
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        refreshPresetDetection();
    });

    if (event_types.OAI_PRESET_CHANGED_AFTER) {
        eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, () => {
            refreshPresetDetection();
        });
    }

    initPayloadCounter(getActivePresetMode, refreshPayloadDisplay);
    initConnectionProfileDropdown();
    refreshPanelUI();

    // UI modules (drawer takeovers, Chat Design) now live in UI Bedazzler

    log('Initialized ✓');
});
