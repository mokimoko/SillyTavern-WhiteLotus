// index.js — White Lotus Extension
// Entry point: preset detection, settings init, event wiring, panel toggle
//
// UI sections and module routing are driven by moduleRegistry.js.
// Adding a new toggle/group/tracker to the registry auto-wires it
// into the panel, preset bridge, payload counter, and settings.

import { eventSource, event_types, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { oai_settings } from '../../../openai.js';
import { ConnectionManagerRequestService } from '../../../extensions/shared.js';

import { MODULE_NAME, ensureSettings, getSettings, getSetting, setSetting } from './src/settings.js';
import {
    initGenerationHooks,
    readPresetState,
    applyToggle,
    applyExclusiveGroup,
    applyTrackerToggle,
    getActivePromptOrder,
} from './src/presetBridge.js';
import {
    initUtilitiesGen,
    resetTrackerState,
    triggerManualGen,
    hasActiveTrackers,
    cancelUtilitiesGen,
    isUtilitiesGenRunning,
} from './src/utilitiesGen.js';
// UI modules (presetDrawer, userSettingsDrawer, personaLore, charDrawer,
// worldInfoDrawer, chatDesign) have moved to the UI Bedazzler extension.

// Module registry — single source of truth for all modules
import {
    TOGGLES, EXCLUSIVE_GROUPS, TRACKERS, INFRA, UI_SECTIONS,
    TOGGLE_KEYS, TRACKER_KEYS, GROUP_KEYS,
    buildCategoryMap, getTogglesByCategory, getGroupOptions,
} from './src/moduleRegistry.js';

// Sampler presets — quick-switch sampler configurations per model
import { applySamplerPreset, buildSamplerDropdownHTML, getSamplerNote } from './src/samplerPresets.js';

const log = (...args) => console.log('[WhiteLotus]', ...args);
const logError = (...args) => console.error('[WhiteLotus]', ...args);

// ============================================================
// Payload Estimation
// ============================================================

/** Category map built from the registry — promptId → category string */
const CATEGORY_MAP = buildCategoryMap();

/**
 * Calculate estimated token payload from all enabled WL-managed prompts.
 */
function calculatePayload() {
    if (!Array.isArray(oai_settings.prompts)) return null;

    const order = getActivePromptOrder();
    const enabledIds = new Set(order.filter(e => e.enabled).map(e => e.identifier));

    const contentById = {};
    for (const prompt of oai_settings.prompts) {
        if (prompt.identifier && prompt.content) {
            contentById[prompt.identifier] = prompt.content;
        }
    }

    const charCounts = { Main: 0, Core: 0, Parameters: 0, Tweaks: 0, Fixes: 0, Tools: 0, NSFW: 0, Trackers: 0 };

    for (const id of enabledIds) {
        const content = contentById[id];
        if (!content) continue;
        const cat = CATEGORY_MAP[id] || 'Core';
        charCounts[cat] += content.length;
    }

    const tokens = {};
    let total = 0;
    for (const [cat, chars] of Object.entries(charCounts)) {
        tokens[cat] = Math.ceil(chars / 4);
        total += tokens[cat];
    }

    return { tokens, total };
}

/**
 * Update the payload display in the panel footer.
 */
function updatePayloadDisplay() {
    const badge = document.getElementById('wl-payload-count');
    const breakdown = document.getElementById('wl-payload-breakdown');
    if (!badge) return;

    const result = calculatePayload();
    if (!result) {
        badge.textContent = '—';
        if (breakdown) breakdown.innerHTML = '';
        return;
    }

    badge.textContent = `~${result.total}`;

    badge.style.color = 'var(--wl-accent)';
    setTimeout(() => { badge.style.color = ''; }, 400);

    if (breakdown) {
        const lines = [];
        const order = ['Main', 'Core', 'Parameters', 'Tweaks', 'Fixes', 'Tools', 'NSFW', 'Trackers'];
        for (const cat of order) {
            const t = result.tokens[cat] || 0;
            if (t > 0) {
                lines.push(`<span class="wl-payload-row"><span>${cat}</span><span>~${t}</span></span>`);
            }
        }
        breakdown.innerHTML = lines.join('');
    }
}

// ============================================================
// State
// ============================================================

let isWhiteLotusActive = false;
let isPanelOpen = false;
let isPanelPinned = false;
let detectedVersion = null;
let detectedVariant = null;

// ============================================================
// Preset Detection
// ============================================================

/**
 * Check if the current preset is White Lotus by name.
 * Only presets with "White Lotus" in the name are managed by this extension.
 */
function detectWhiteLotusPreset() {
    const presetName = oai_settings.preset_settings_openai || '';

    // Versioned bracket format: WHITE LOTUS [2.0.0] or WHITE LOTUS [2.0.0] [Variant]
    const versionMatch = presetName.match(/WHITE\s*LOTUS\s*\[(\d+\.\d+\.\d+)\](?:\s*\[(.+?)\])?/i);
    if (versionMatch) {
        return { active: true, version: versionMatch[1], variant: versionMatch[2] || null };
    }

    // Hyphenated shipped format: white-lotus-3.0.0 (optionally trailing -variant)
    const hyphenMatch = presetName.match(/white-lotus-(\d+\.\d+\.\d+)(?:-(.+))?/i);
    if (hyphenMatch) {
        return { active: true, version: hyphenMatch[1], variant: hyphenMatch[2] || null };
    }

    // Unversioned fallback: any preset name containing "White Lotus"
    if (/white\s*lotus/i.test(presetName)) {
        return { active: true, version: null, variant: null };
    }

    return { active: false, version: null, variant: null };
}

function refreshPresetDetection() {
    const wasActive = isWhiteLotusActive;
    const prevVersion = detectedVersion;
    const detection = detectWhiteLotusPreset();
    isWhiteLotusActive = detection.active;
    detectedVersion = detection.version;
    detectedVariant = detection.variant;

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

    // Refresh panel UI when open (handles pinned panel on preset switch)
    if (isPanelOpen) {
        refreshPanelUI();
    }
}

/**
 * Read current preset state into extension settings (one-time bootstrap).
 * NOT used in the normal activation flow — applySettingsToPreset() handles that.
 * Kept for potential future use (e.g. "Reset to preset defaults" button).
 */
function syncSettingsFromPreset() {
    const presetState = readPresetState();
    const settings = getSettings();

    // When useSeparateGen is active, skip tracker keys
    const skipKeys = settings.useSeparateGen
        ? new Set(TRACKER_KEYS)
        : new Set();

    for (const [key, value] of Object.entries(presetState)) {
        if (skipKeys.has(key)) continue;
        if (key in settings && value !== undefined) {
            settings[key] = value;
        }
    }

    saveSettingsDebounced();
    log('Synced settings from preset state', skipKeys.size ? `(skipped ${skipKeys.size} tracker keys — useSeparateGen active)` : '');
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
        <i class="wl-cancel-icon fa-solid fa-xmark"></i>
    `;
    btn.addEventListener('click', () => {
        if (isUtilitiesGenRunning()) {
            cancelUtilitiesGen();
        } else {
            togglePanel();
        }
    });
    document.body.appendChild(btn);
    updateTriggerButton();
}

function updateTriggerButton() {
    const btn = document.getElementById('wl-trigger-btn');
    if (!btn) return;

    btn.classList.toggle('wl-active', isWhiteLotusActive);
    if (isWhiteLotusActive) {
        const label = detectedVersion ? `White Lotus ${detectedVersion}` : 'White Lotus';
        const tag = detectedVariant ? ` [${detectedVariant}]` : '';
        btn.title = `${label}${tag} (Active)`;
    } else {
        btn.title = 'White Lotus (Preset not detected)';
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

function buildPanelHTML() {
    // Build controls view sections from the registry
    let controlSections = '';
    for (const section of UI_SECTIONS) {
        controlSections += buildSectionHTML(section);
    }

    return `
        <div class="wl-panel-header">
            <div class="wl-panel-title-group">
                <div class="wl-panel-title">White Lotus</div>
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

            ${controlSections}

            </div><!-- end wl-view-controls -->

            <!-- ═══ SETTINGS VIEW ═══ -->
            <div class="wl-view wl-hidden" id="wl-view-settings">

                <div class="wl-settings-back" id="wl-settings-back">← Back to Controls</div>

                <!-- Tracker Generation -->
                <div class="wl-section" data-section="tracker-gen">
                    <div class="wl-section-header">Tracker Generation</div>
                    <div class="wl-section-body">
                        ${buildToggleRow('useSeparateGen', 'Use separate generation')}
                        <div class="wl-setting-hint">When on, trackers run as a separate AI call after each response instead of inline in the main generation.</div>

                        <div class="wl-sep-gen-options" id="wl-sep-gen-options">
                            <div class="wl-control-row">
                                <label class="wl-label">Connection</label>
                                <select class="wl-select" id="wl-utility-profile">
                                    <option value="">Current model</option>
                                </select>
                            </div>
                            <div class="wl-setting-hint" id="wl-profile-hint">Use a saved Connection Profile for tracker generation. Create profiles in ST's Connection Manager.</div>
                            ${buildSelectRow('utilityAutoRun', 'Auto-run', {
                                every: 'Every message',
                                every_n: 'Every N messages',
                                manual: 'Manual only',
                            })}
                            <div class="wl-control-row wl-autorun-n" id="wl-autorun-n-row">
                                <label class="wl-label">N</label>
                                <input type="number" class="wl-input-number" data-key="utilityAutoRunInterval" min="2" max="10" value="3">
                            </div>
                            ${buildSelectRow('utilityScanDepth', 'Scan Depth', {
                                '1': '1 pair',
                                '2': '2 pairs',
                                '3': '3 pairs',
                            })}
                        </div>
                    </div>
                </div>

                <!-- Gen Parameters -->
                <div class="wl-section" data-section="gen-params">
                    <div class="wl-section-header">Generation Parameters</div>
                    <div class="wl-section-body">
                        <div class="wl-control-row">
                            <label class="wl-label">Temperature</label>
                            <input type="number" class="wl-input-number" data-key="utilityTemperature" min="0" max="1.5" step="0.1" value="0.7">
                        </div>
                        <div class="wl-control-row">
                            <label class="wl-label">Max Tokens</label>
                            <input type="number" class="wl-input-number" data-key="utilityMaxTokens" min="500" max="2000" step="100" value="1000">
                        </div>
                    </div>
                </div>

                <!-- Custom Trackers -->
                <div class="wl-section" data-section="custom-trackers">
                    <div class="wl-section-header" style="display:flex;justify-content:space-between;align-items:center;">
                        <span>Custom Trackers</span>
                        <span class="wl-ct-add" id="wl-ct-add" title="Add custom tracker" style="cursor:pointer;font-size:1em;opacity:0.5;line-height:1;">+</span>
                    </div>
                    <div class="wl-section-body" id="wl-ct-list"></div>
                    <div class="wl-setting-hint">User-defined trackers for sep-gen pipeline. Each needs a bracket tag, prompt, and regex for rendering.</div>
                </div>

                <!-- About -->
                <div class="wl-about-text">White Lotus Extension v0.2.0</div>

            </div><!-- end wl-view-settings -->

        </div>

        <!-- ═══ PAYLOAD FOOTER ═══ -->
        <div class="wl-panel-footer" id="wl-panel-footer">
            <div class="wl-payload-label">
                <span>Payload</span>
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

    if (key in TOGGLES) {
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
// Routes setting changes to the correct bridge function.
// Uses the registry to determine routing — no hardcoded maps.
// ============================================================

function applySettingToPreset(key, value) {
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

    // Exclusive groups (including NSFW — masterToggleId handled generically)
    if (key in EXCLUSIVE_GROUPS) {
        applyExclusiveGroup(key, value);
        return;
    }

    // tense, pov → deferred to generation time (content swap needs save/restore)
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
            updatePayloadDisplay();
            log(`Setting changed: ${key} = ${value}`);
        });
    });

    // Sampler preset dropdown — applies sampler values to oai_settings + sliders
    panel.querySelector('#wl-sampler-preset')?.addEventListener('change', (e) => {
        const presetKey = e.target.value;
        if (!presetKey) return;

        const applied = applySamplerPreset(presetKey);
        if (applied) {
            setSetting('samplerPreset', presetKey);
            const note = getSamplerNote(presetKey);
            log(`Sampler preset applied: ${presetKey}${note ? ` (${note})` : ''}`);
        }
    });

    // Toggle changes — generic handler
    panel.querySelectorAll('.wl-toggle input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const key = e.target.dataset.key;
            const value = e.target.checked;
            setSetting(key, value);

            // All remaining toggles are registry-managed modules
            applySettingToPreset(key, value);
            syncPromptManagerDOM(getAffectedPromptIds(key));

            updatePayloadDisplay();
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

    // Status indicator
    const statusDot = panel.querySelector('.wl-status-dot');
    const statusText = panel.querySelector('.wl-status-text');
    if (statusDot && statusText) {
        statusDot.classList.toggle('wl-status-active', isWhiteLotusActive);
        if (isWhiteLotusActive) {
            const label = detectedVersion ? `White Lotus ${detectedVersion}` : 'White Lotus';
            const tag = detectedVariant ? ` [${detectedVariant}]` : '';
            statusText.textContent = `${label}${tag} Active`;
        } else {
            statusText.textContent = 'Preset Not Detected';
        }
    }

    // Disable controls if preset not active (except sampler — useful for any preset)
    const controlsView = panel.querySelector('#wl-view-controls');
    if (controlsView) {
        controlsView.querySelectorAll('.wl-select, .wl-toggle input').forEach(el => {
            if (el.id === 'wl-sampler-preset') return;
            el.disabled = !isWhiteLotusActive;
        });
    }

    // Sync select values
    panel.querySelectorAll('.wl-select').forEach(select => {
        const key = select.dataset.key;
        if (!key) return;
        select.value = settings[key] ?? '';
    });

    // Sync toggle values
    panel.querySelectorAll('.wl-toggle input[type="checkbox"]').forEach(checkbox => {
        const key = checkbox.dataset.key;
        checkbox.checked = !!settings[key];
    });

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

    const nRow = panel.querySelector('#wl-autorun-n-row');
    if (nRow) nRow.style.display = settings.utilityAutoRun === 'every_n' ? '' : 'none';

    renderCustomTrackerList();
    updatePayloadDisplay();
}

// ============================================================
// Active Settings Provider
// ============================================================

function getActiveSettings() {
    // Lightweight guard — if the preset name no longer contains "White Lotus",
    // force inactive. Catches stale state when OAI_PRESET_CHANGED_AFTER is missing.
    if (isWhiteLotusActive) {
        const presetName = oai_settings.preset_settings_openai || '';
        if (!/white\s*lotus/i.test(presetName)) {
            log('Preset name no longer matches — deactivating');
            isWhiteLotusActive = false;
        }
    }

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

    ensureSettings();

    createTriggerButton();
    createPanel();

    refreshPresetDetection();

    initGenerationHooks(getActiveSettings);
    initUtilitiesGen(() => isWhiteLotusActive);

    eventSource.on(event_types.CHAT_CHANGED, () => {
        refreshPresetDetection();
    });

    if (event_types.OAI_PRESET_CHANGED_AFTER) {
        eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, () => {
            refreshPresetDetection();
        });
    }

    initConnectionProfileDropdown();

    // UI modules (drawer takeovers, Chat Design) now live in UI Bedazzler

    log('Initialized ✓');
});
