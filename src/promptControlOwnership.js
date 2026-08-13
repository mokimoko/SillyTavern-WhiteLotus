// Keeps prompt toggles owned by the companion panel read-only in ST's Prompt Manager.

import { EXCLUSIVE_GROUPS, INFRA, TOGGLES, TRACKERS } from './moduleRegistry.js';
import { PLUM_BLOSSOM_CHOOSE_PROMPT_IDS } from './plumBlossomControls.js';
import { PRESET_MODES } from './presetModeSwitcher.js';

const WHITE_LOTUS_IDS = new Set();
for (const toggle of Object.values(TOGGLES)) {
    for (const id of toggle.promptIds) WHITE_LOTUS_IDS.add(id);
}
for (const group of Object.values(EXCLUSIVE_GROUPS)) {
    for (const option of Object.values(group.options)) {
        if (option.promptId) WHITE_LOTUS_IDS.add(option.promptId);
    }
    if (group.masterToggleId) WHITE_LOTUS_IDS.add(group.masterToggleId);
}
for (const tracker of Object.values(TRACKERS)) WHITE_LOTUS_IDS.add(tracker.promptId);
if (INFRA.trackerFormatRulesId) WHITE_LOTUS_IDS.add(INFRA.trackerFormatRulesId);

const PLUM_BLOSSOM_IDS = new Set(PLUM_BLOSSOM_CHOOSE_PROMPT_IDS);

let getActiveMode = () => null;
let observer = null;
let discoveryObserver = null;

function ownedIds() {
    const mode = getActiveMode();
    if (mode === PRESET_MODES.WHITE_LOTUS) return WHITE_LOTUS_IDS;
    if (mode === PRESET_MODES.PLUM_BLOSSOM) return PLUM_BLOSSOM_IDS;
    return null;
}

/** Refresh ownership badges whenever ST rebuilds its Prompt Manager list. */
export function refreshPromptControlOwnership() {
    const ids = ownedIds();
    document.querySelectorAll('li[data-pm-identifier]').forEach(row => {
        const owned = !!ids?.has(row.dataset.pmIdentifier);
        row.classList.toggle('wl-prompt-owned', owned);
        const toggle = row.querySelector('.prompt-manager-toggle-action');
        if (!toggle) return;
        if (owned) {
            toggle.setAttribute('aria-disabled', 'true');
            toggle.title = 'Controlled by the White Lotus extension panel';
        } else if (toggle.getAttribute('aria-disabled') === 'true') {
            toggle.removeAttribute('aria-disabled');
            toggle.removeAttribute('title');
        }
    });
}

function blockOwnedToggle(event) {
    const toggle = event.target instanceof Element
        ? event.target.closest('.prompt-manager-toggle-action')
        : null;
    const row = toggle?.closest('li[data-pm-identifier]');
    if (!row || !ownedIds()?.has(row.dataset.pmIdentifier)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    globalThis.toastr?.info('Use the companion side panel to change this option.', 'White Lotus');
}

export function initPromptControlOwnership(activeModeProvider) {
    getActiveMode = activeModeProvider;
    observer?.disconnect();
    discoveryObserver?.disconnect();
    document.removeEventListener('click', blockOwnedToggle, true);
    document.addEventListener('click', blockOwnedToggle, true);

    const attachPromptManagerObserver = (root) => {
        observer?.disconnect();
        observer = new MutationObserver(refreshPromptControlOwnership);
        observer.observe(root, { childList: true, subtree: true });
    };

    const root = document.getElementById('completion_prompt_manager');
    if (root) {
        attachPromptManagerObserver(root);
    } else if (document.body) {
        // Observe the broad DOM only until ST creates Prompt Manager.
        discoveryObserver = new MutationObserver(() => {
            const discoveredRoot = document.getElementById('completion_prompt_manager');
            if (!discoveredRoot) return;
            discoveryObserver?.disconnect();
            discoveryObserver = null;
            attachPromptManagerObserver(discoveredRoot);
            refreshPromptControlOwnership();
        });
        discoveryObserver.observe(document.body, { childList: true, subtree: true });
    }
    refreshPromptControlOwnership();
}
