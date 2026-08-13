// Model-independent state inspector for Plum Blossom.

import { eventSource, event_types, saveSettingsDebounced } from '../../../../../script.js';
import { setPromptEnabled } from './presetBridge.js';
import {
    renderPlumActionsTab,
    resetPlumActionNotice,
    wirePlumActionsTab,
} from './plumBlossomInspectorActions.js';
import {
    buildPlumDebugExport,
    COMPARISON_GROUPS,
    debugValue,
    DIAGNOSTIC_GROUPS,
    getRawVariableGroups,
    readPlumDebugSnapshot,
} from './plumBlossomDebugData.js';

export const PB_NATIVE_DEBUG_PROMPT_ID = 'pb_t_debug';

const state = {
    initialized: false,
    activeTab: 'state',
    rawFilter: '',
    isPlumActive: () => false,
    returnFocus: null,
};

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function presentValue(value, key = '') {
    if (!value) return '<span class="pb-debug-empty">—</span>';
    const text = String(value);
    if (key.includes('scene_memory') || key === 'pb_tmp_author') {
        return `<span title="${escapeHtml(text)}">present · ${text.length.toLocaleString()} chars</span>`;
    }
    const short = text.length > 110 ? `${text.slice(0, 107)}…` : text;
    return `<span title="${escapeHtml(text)}">${escapeHtml(short)}</span>`;
}

function valueTone(value) {
    const normalized = String(value || '').toLowerCase();
    if (!normalized) return 'empty';
    if (['true', '1', 'complete', 'ready'].includes(normalized)) return 'positive';
    if (['false', '0', 'none'].includes(normalized)) return 'quiet';
    if (normalized.includes('stall') || normalized.includes('mismatch')) return 'warning';
    return 'active';
}

function overviewCard(label, value, note = '') {
    return `<div class="pb-debug-overview-card" data-tone="${valueTone(value)}">
        <span>${escapeHtml(label)}</span>
        <strong>${presentValue(value)}</strong>
        ${note ? `<small>${escapeHtml(note)}</small>` : ''}
    </div>`;
}

function collectWarnings(snapshot) {
    const warnings = [];
    const isSet = value => !!value && !['false', '0', 'none', 'off'].includes(String(value).toLowerCase());
    const add = (key, text) => { if (isSet(debugValue(snapshot, key))) warnings.push(text); };
    add('pb_state_estab_stalled', 'Establishment is stalled');
    add('pb_state_focus_stalled', 'Focus tracking is stalled');
    add('pb_stage_focus_agenda_collision', 'Focus and Agenda ownership collide');
    const mismatch = debugValue(snapshot, 'pb_gate_focus_mismatch');
    if (isSet(mismatch)) warnings.push(`Focus mismatch: ${mismatch}`);
    if (!Object.keys(snapshot.variables).length) warnings.push('No PB variables exist in this chat yet');
    return warnings;
}

function renderComparisonGroup(snapshot, group) {
    const rows = group.rows.map(([label, acceptedKey, stagedKey]) => {
        const accepted = debugValue(snapshot, acceptedKey);
        const staged = debugValue(snapshot, stagedKey);
        const changed = !!staged && staged !== accepted;
        return `<div class="pb-debug-compare-row" data-changed="${changed}">
            <div class="pb-debug-field">${escapeHtml(label)}</div>
            <div class="pb-debug-value">${presentValue(accepted, acceptedKey)}</div>
            <div class="pb-debug-arrow" aria-hidden="true">→</div>
            <div class="pb-debug-value pb-debug-value-stage">${presentValue(staged, stagedKey)}</div>
        </div>`;
    }).join('');
    return `<section class="pb-debug-section">
        <h3>${escapeHtml(group.label)}</h3>
        <div class="pb-debug-compare-head"><span>Field</span><span>Accepted</span><span></span><span>Pending</span></div>
        <div class="pb-debug-compare">${rows}</div>
    </section>`;
}

function renderStateTab(snapshot) {
    const phase = debugValue(snapshot, 'pb_phase_establishment') || 'uninitialized';
    const focus = debugValue(snapshot, 'pb_state_focus') || 'none';
    const pendingFocus = debugValue(snapshot, 'pb_stage_focus')
        || debugValue(snapshot, 'pb_state_focus_candidate') || 'none';
    const warnings = collectWarnings(snapshot);
    return `<div class="pb-debug-overview">
        ${overviewCard('Establishment', phase, 'accepted phase')}
        ${overviewCard('Focus', focus, debugValue(snapshot, 'pb_phase_focus') || 'no focus phase')}
        ${overviewCard('Pending focus', pendingFocus, 'current candidate')}
        ${overviewCard('Scene tone', debugValue(snapshot, 'pb_state_tone') || 'none')}
        ${overviewCard('Scene driver', debugValue(snapshot, 'pb_state_scene_driver') || 'none')}
        ${overviewCard('Analysis', snapshot.analysis ? 'attached' : 'none', snapshot.message ? `message ${snapshot.message.index} · swipe ${snapshot.message.swipeId}` : 'no assistant message')}
    </div>
    <div class="pb-debug-health" data-clear="${warnings.length === 0}">
        <span class="pb-debug-health-mark">${warnings.length ? '!' : '✓'}</span>
        <div><strong>${warnings.length ? `${warnings.length} item${warnings.length === 1 ? '' : 's'} need attention` : 'No active warnings'}</strong>
        <span>${warnings.length ? warnings.map(escapeHtml).join(' · ') : 'PB’s saved and staged state is internally quiet.'}</span></div>
    </div>
    ${COMPARISON_GROUPS.map(group => renderComparisonGroup(snapshot, group)).join('')}`;
}

function renderDiagnosticsTab(snapshot) {
    return `<div class="pb-debug-diagnostic-grid">${DIAGNOSTIC_GROUPS.map(group => `
        <section class="pb-debug-section pb-debug-diagnostic-card">
            <h3>${escapeHtml(group.label)}</h3>
            ${group.keys.map(([label, key]) => {
                const value = debugValue(snapshot, key);
                return `<div class="pb-debug-diagnostic-row" data-tone="${valueTone(value)}">
                    <span>${escapeHtml(label)}</span><code>${presentValue(value, key)}</code>
                </div>`;
            }).join('')}
        </section>`).join('')}</div>`;
}

function renderRawTab(snapshot) {
    const query = state.rawFilter.trim().toLowerCase();
    const labels = { state: 'Accepted state', stage: 'Pending stage', gate: 'Gates', temporary: 'Temporary calculations', config: 'Configuration', output: 'Derived output', other: 'Other' };
    const groups = getRawVariableGroups(snapshot);
    const content = Object.entries(groups).map(([name, entries]) => {
        const filtered = entries.filter(([key, value]) => !query
            || key.toLowerCase().includes(query)
            || String(value).toLowerCase().includes(query));
        if (!filtered.length) return '';
        return `<section class="pb-debug-section pb-debug-raw-group">
            <h3>${labels[name]} <span>${filtered.length}</span></h3>
            ${filtered.map(([key, value]) => `<div class="pb-debug-raw-row">
                <code>${escapeHtml(key)}</code><span>${presentValue(String(value), key)}</span>
            </div>`).join('')}
        </section>`;
    }).join('');
    return `<label class="pb-debug-search">
        <span class="fa-solid fa-magnifying-glass" aria-hidden="true"></span>
        <input id="pb-debug-search" type="search" value="${escapeHtml(state.rawFilter)}" placeholder="Filter names or values" autocomplete="off">
    </label>${content || '<div class="pb-debug-empty-state">No variables match this filter.</div>'}`;
}

function renderAnalysisTab(snapshot) {
    if (!snapshot.analysis) {
        return `<div class="pb-debug-empty-state"><strong>No analysis on this swipe</strong><span>Run Analysis or generate a response with scene analysis enabled.</span></div>`;
    }
    return `<div class="pb-debug-analysis-head"><div><span>Current candidate</span><strong>Message ${snapshot.message?.index ?? '—'} · Swipe ${snapshot.message?.swipeId ?? '—'}</strong></div>
        <button class="pb-debug-mini-btn" id="pb-debug-copy-analysis">Copy analysis</button></div>
        <pre class="pb-debug-analysis"><code>${escapeHtml(snapshot.analysis)}</code></pre>`;
}

function ensureModal() {
    let overlay = document.getElementById('pb-debug-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'pb-debug-overlay';
    overlay.className = 'pb-debug-overlay';
    overlay.innerHTML = `<div class="pb-debug-dialog" role="dialog" aria-modal="true" aria-labelledby="pb-debug-title">
        <header class="pb-debug-header">
            <div class="pb-debug-title-wrap"><span class="pb-debug-kicker">Plum Blossom · State Console</span><h2 id="pb-debug-title">Inspector</h2><div id="pb-debug-meta"></div></div>
            <div class="pb-debug-header-actions"><button class="pb-debug-icon-btn" id="pb-debug-refresh" title="Refresh"><i class="fa-solid fa-rotate"></i></button><button class="pb-debug-icon-btn" id="pb-debug-copy" title="Copy JSON"><i class="fa-regular fa-copy"></i></button><button class="pb-debug-icon-btn" id="pb-debug-close" title="Close"><i class="fa-solid fa-xmark"></i></button></div>
        </header>
        <nav class="pb-debug-tabs" aria-label="Inspector sections">
            <button data-pb-debug-tab="state">State</button><button data-pb-debug-tab="diagnostics">Diagnostics</button><button data-pb-debug-tab="raw">Raw Variables</button><button data-pb-debug-tab="analysis">Analysis</button><button data-pb-debug-tab="actions">Actions</button>
        </nav>
        <main class="pb-debug-content" id="pb-debug-content"></main>
    </div>`;
    document.body.appendChild(overlay);

    overlay.addEventListener('click', event => {
        // The Inspector belongs to the open WL panel even though it is mounted on
        // document.body. Do not let its clicks reach the panel's outside-click
        // handler and close the panel behind the modal.
        event.stopPropagation();
        if (event.target === overlay) closePlumDebugInspector();
    });
    overlay.querySelector('#pb-debug-close')?.addEventListener('click', closePlumDebugInspector);
    overlay.querySelector('#pb-debug-refresh')?.addEventListener('click', refreshPlumDebugInspector);
    overlay.querySelector('#pb-debug-copy')?.addEventListener('click', () => copyText(buildPlumDebugExport(readPlumDebugSnapshot()), 'Debug snapshot copied.'));
    overlay.querySelectorAll('[data-pb-debug-tab]').forEach(button => button.addEventListener('click', () => {
        state.activeTab = button.dataset.pbDebugTab;
        refreshPlumDebugInspector();
    }));
    return overlay;
}

async function copyText(text, successMessage) {
    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            const fallback = document.createElement('textarea');
            fallback.value = text;
            fallback.style.position = 'fixed';
            fallback.style.opacity = '0';
            document.body.appendChild(fallback);
            fallback.select();
            document.execCommand('copy');
            fallback.remove();
        }
        globalThis.toastr?.success(successMessage, 'Plum Blossom');
    } catch {
        globalThis.toastr?.error('Could not copy to the clipboard.', 'Plum Blossom');
    }
}

export function refreshPlumDebugInspector() {
    const overlay = document.getElementById('pb-debug-overlay');
    if (!overlay?.classList.contains('pb-debug-open')) return;
    if (!state.isPlumActive()) {
        closePlumDebugInspector();
        return;
    }

    const snapshot = readPlumDebugSnapshot();
    const renderers = { state: renderStateTab, diagnostics: renderDiagnosticsTab, raw: renderRawTab, analysis: renderAnalysisTab, actions: renderPlumActionsTab };
    overlay.querySelector('#pb-debug-content').innerHTML = renderers[state.activeTab](snapshot);
    overlay.querySelector('#pb-debug-meta').textContent = `${Object.keys(snapshot.variables).length} variables · ${snapshot.message ? `message ${snapshot.message.index}, swipe ${snapshot.message.swipeId}` : 'no active message'}`;
    overlay.querySelectorAll('[data-pb-debug-tab]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.pbDebugTab === state.activeTab)));

    overlay.querySelector('#pb-debug-search')?.addEventListener('input', event => {
        state.rawFilter = event.target.value;
        refreshPlumDebugInspector();
        const input = overlay.querySelector('#pb-debug-search');
        input?.focus();
        input?.setSelectionRange(state.rawFilter.length, state.rawFilter.length);
    });
    overlay.querySelector('#pb-debug-copy-analysis')?.addEventListener('click', () => copyText(snapshot.analysis, 'Analysis copied.'));
    wirePlumActionsTab(overlay, refreshPlumDebugInspector);
}

export function openPlumDebugInspector() {
    if (!state.isPlumActive()) {
        globalThis.toastr?.warning('Plum Blossom preset not detected.');
        return;
    }
    const overlay = ensureModal();
    resetPlumActionNotice();
    state.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    overlay.classList.add('pb-debug-open');
    document.body.classList.add('pb-debug-modal-open');
    refreshPlumDebugInspector();
    overlay.querySelector('#pb-debug-close')?.focus();
}

export function closePlumDebugInspector() {
    document.getElementById('pb-debug-overlay')?.classList.remove('pb-debug-open');
    document.body.classList.remove('pb-debug-modal-open');

    const returnFocus = state.returnFocus;
    const owningPanel = returnFocus?.closest?.('#wl-panel');
    const panelIsAvailable = !owningPanel || owningPanel.classList.contains('wl-panel-open');
    const elementIsAvailable = returnFocus?.isConnected
        && !returnFocus.closest?.('.wl-hidden, [hidden]')
        && returnFocus.getClientRects().length > 0;

    if (panelIsAvailable && elementIsAvailable) {
        // A focused control inside a translated-offscreen panel can make the
        // browser horizontally scroll the whole app to reveal it.
        returnFocus.focus({ preventScroll: true });
    }
    state.returnFocus = null;
}

export function updatePlumDebugButton(panel, isPlumActive) {
    const button = panel?.querySelector('#pb-open-debug');
    if (button) button.disabled = !isPlumActive;
    if (!isPlumActive) closePlumDebugInspector();
}

/** Keep PB's prompt-based readout disabled; the Inspector is always available. */
export function syncNativePlumDebug() {
    if (setPromptEnabled(PB_NATIVE_DEBUG_PROMPT_ID, false)) saveSettingsDebounced();
}

export function initPlumDebugInspector(isPlumActive) {
    if (state.initialized) return;
    state.initialized = true;
    state.isPlumActive = isPlumActive;
    const refreshSoon = () => setTimeout(refreshPlumDebugInspector, 0);
    if (event_types.CHAT_CHANGED) {
        eventSource.on(event_types.CHAT_CHANGED, () => {
            resetPlumActionNotice();
            refreshSoon();
        });
    }
    for (const name of ['MESSAGE_RECEIVED', 'MESSAGE_UPDATED', 'MESSAGE_EDITED', 'MESSAGE_SWIPED', 'MESSAGE_DELETED', 'GENERATION_ENDED']) {
        if (event_types[name]) eventSource.on(event_types[name], refreshSoon);
    }
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && document.getElementById('pb-debug-overlay')?.classList.contains('pb-debug-open')) {
            closePlumDebugInspector();
        }
    });
}
