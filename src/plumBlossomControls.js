// White Lotus-styled controls for Plum Blossom's native CHOOSE prompt block.

import { saveSettingsDebounced } from '../../../../../script.js';
import { getActivePromptOrder, setPromptEnabled } from './presetBridge.js';
import { PB_ANALYZE_SCENE_PROMPT_ID } from './plumBlossomAnalysis.js';
import { PB_NATIVE_DEBUG_PROMPT_ID } from './plumBlossomDebug.js';
import { PB_NATIVE_ACTION_PROMPT_IDS } from './plumBlossomActions.js';

const TOGGLE_SECTIONS = [
    {
        id: 'permissions', label: 'Permissions',
        toggles: [
            ['pb_t_nsfw', 'Allow NSFW'],
            ['pb_t_violence', 'Allow Violence'],
            ['pb_t_gore', 'Allow Gore'],
        ],
    },
    {
        id: 'narration', label: 'Narration',
        toggles: [
            ['pb_t_drama', 'More Drama'],
            ['pb_t_expl_narr', 'Explicit Narration'],
            ['pb_t_dialogue', 'Better Dialogue'],
            ['pb_t_less_expl_dialogue', 'Less Explicit Dialogue'],
            ['pb_t_write_user', 'Write for User'],
        ],
    },
    {
        id: 'functional', label: 'Model & Function',
        toggles: [
            ['pb_t_glm', 'GLM Fixes'],
            ['55b09351-d006-4552-90f5-5da8d84848ac', 'Mimo Fixes'],
            ['pb_t_concise', 'Kimi Reasoning'],
            ['pb_t_ooc', 'OOC Improvement'],
        ],
    },
    {
        id: 'analysis', label: 'Analysis',
        toggles: [
            ['pb_t_analysis', 'Scene Analysis'],
            ['pb_t_establishment', 'Auto-Author'],
            ['pb_t_relationships', 'Handle Relationships'],
        ],
    },
];

const CHOICE_SECTIONS = [
    {
        id: 'parameters', label: 'Parameters',
        groups: [
            {
                id: 'narrator', label: 'Narrator', options: [
                    ['pb_t_card_narrator', 'Card'],
                    ['pb_t_focus_narrator', 'Focus'],
                    ['pb_t_omniscient', 'Omniscient'],
                ],
            },
            {
                id: 'length', label: 'Length', options: [
                    ['pb_t_len_short', 'Short'],
                    ['pb_t_len_average', 'Average'],
                    ['pb_t_len_long', 'Long'],
                    ['pb_t_len_chapter', 'Chapter'],
                ],
            },
            {
                id: 'pov', label: 'Point of View', options: [
                    ['pb_t_pov_1st', 'First Person'],
                    ['pb_t_pov_3rd', 'Third Person'],
                    ['pb_t_pov_3rd_you', 'Third + “You”'],
                ],
            },
            {
                id: 'tense', label: 'Tense', options: [
                    ['pb_t_tense_present', 'Present'],
                    ['pb_t_tense_past', 'Past'],
                ],
            },
        ],
    },
    {
        id: 'nsfw', label: 'NSFW', dependsOn: 'pb_t_nsfw',
        groups: [
            {
                id: 'nsfw-pacing', label: 'Pacing', options: [
                    ['pb_t_pace_slow', 'Slow Lead-up'],
                    ['pb_t_pace_natural', 'Natural'],
                    ['pb_t_pace_erotica', 'Erotica'],
                ],
            },
            {
                id: 'nsfw-type', label: 'Type', options: [
                    ['pb_t_type_gentle', 'Gentle'],
                    ['pb_t_type_realistic', 'Realistic'],
                    ['pb_t_type_passionate', 'Passionate'],
                    ['pb_t_type_degenerate', 'Degenerate'],
                ],
            },
            {
                id: 'nsfw-spec', label: 'Configuration', options: [
                    ['pb_t_spec_mm', 'M/M'],
                    ['pb_t_spec_mf', 'M/F'],
                    ['pb_t_spec_ff', 'F/F'],
                ],
            },
        ],
    },
    {
        id: 'violence', label: 'Violence', dependsOn: 'pb_t_violence',
        groups: [
            {
                id: 'violence-style', label: 'Style', options: [
                    ['pb_t_viol_action', 'Action Movie'],
                    ['pb_t_viol_webnovel', 'Webnovel'],
                    ['pb_t_viol_brutal', 'Brutal World'],
                ],
            },
        ],
    },
];

const ALL_GROUPS = CHOICE_SECTIONS.flatMap(section => section.groups);

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildToggleRow([id, label, owner]) {
    return `
        <div class="wl-control-row" data-pb-item="${id}">
            <label class="wl-label">${escapeHtml(label)}</label>
            <label class="wl-toggle">
                <input type="checkbox" data-pb-toggle="${id}"${owner ? ` data-pb-owner="${owner}"` : ''}>
                <span class="wl-toggle-slider"></span>
            </label>
        </div>`;
}

function buildChoiceRow(group) {
    const options = group.options
        .map(([id, label]) => `<option value="${id}">${escapeHtml(label)}</option>`)
        .join('');
    return `
        <div class="wl-control-row" data-pb-choice-row="${group.id}">
            <label class="wl-label">${escapeHtml(group.label)}</label>
            <select class="wl-select" data-pb-group="${group.id}">
                <option value="">— Select —</option>
                ${options}
            </select>
        </div>`;
}

function buildSection(id, label, rows, dependsOn = '') {
    const dependency = dependsOn ? ` data-pb-depends-on="${dependsOn}"` : '';
    return `
        <div class="wl-section pb-choose-section" data-pb-section="${id}"${dependency}>
            <div class="wl-section-header">${escapeHtml(label)}</div>
            <div class="wl-section-body">${rows}</div>
        </div>`;
}

function buildChooseBanner() {
    return `
        <div class="wl-choose-banner wl-choose-banner-plum">
            <span class="wl-choose-mark" aria-hidden="true">梅</span>
            <div><strong>Choose</strong><span>Direct control of Plum Blossom’s native prompt block.</span></div>
        </div>`;
}

/** Build PB controls with the same rows, selects, sections, and action styling as WL. */
export function buildPlumBlossomControlsHTML(samplerHTML = '') {
    const choiceSections = CHOICE_SECTIONS.map(section => {
        const rows = `${section.id === 'parameters' ? samplerHTML : ''}${section.groups.map(buildChoiceRow).join('')}`;
        return buildSection(section.id, section.label, rows, section.dependsOn);
    }).join('');

    const permissions = buildSection(
        TOGGLE_SECTIONS[0].id,
        TOGGLE_SECTIONS[0].label,
        TOGGLE_SECTIONS[0].toggles.map(buildToggleRow).join(''),
    );
    const narration = buildSection(
        TOGGLE_SECTIONS[1].id,
        TOGGLE_SECTIONS[1].label,
        TOGGLE_SECTIONS[1].toggles.map(buildToggleRow).join(''),
    );
    const functional = buildSection(
        TOGGLE_SECTIONS[2].id,
        TOGGLE_SECTIONS[2].label,
        TOGGLE_SECTIONS[2].toggles.map(buildToggleRow).join(''),
    );
    const analysisRows = `${TOGGLE_SECTIONS[3].toggles.map(buildToggleRow).join('')}
        <div class="wl-control-row wl-tracker-actions">
            <button class="wl-btn" id="pb-run-analysis" title="Manually run Plum Blossom scene analysis">Run Analysis</button>
            <button class="wl-btn" id="pb-open-debug" title="Inspect and maintain Plum Blossom state">Open Inspector</button>
        </div>`;
    const analysis = buildSection(TOGGLE_SECTIONS[3].id, TOGGLE_SECTIONS[3].label, analysisRows);

    return `${buildChooseBanner()}${choiceSections}${permissions}${narration}${functional}${analysis}`;
}

function getOrderState() {
    return new Map(getActivePromptOrder().map(entry => [entry.identifier, !!entry.enabled]));
}

function setExclusiveChoice(group, selectedId) {
    const ids = group.options.map(([id]) => id);
    for (const id of ids) setPromptEnabled(id, id === selectedId);
    saveSettingsDebounced();
    return ids;
}

function updateDependencies(container, state) {
    container.querySelectorAll('[data-pb-depends-on]').forEach(section => {
        section.classList.toggle('pb-section-dormant', !state.get(section.dataset.pbDependsOn));
    });

    const analysisEnabled = !!state.get('pb_t_analysis');
    for (const id of ['pb_t_establishment', 'pb_t_relationships']) {
        container.querySelector(`[data-pb-item="${id}"]`)?.classList.toggle('pb-item-dormant', !analysisEnabled);
    }
}

export function refreshPlumBlossomControls(container) {
    if (!container) return;
    const state = getOrderState();

    container.querySelectorAll('[data-pb-toggle]').forEach(input => {
        input.checked = !!state.get(input.dataset.pbToggle);
    });
    for (const group of ALL_GROUPS) {
        const active = group.options.find(([id]) => state.get(id));
        const select = container.querySelector(`[data-pb-group="${group.id}"]`);
        if (select) select.value = active?.[0] || '';
    }
    updateDependencies(container, state);
}

export function wirePlumBlossomControls(container, { syncPromptManager, onChanged } = {}) {
    if (!container) return;

    container.querySelectorAll('[data-pb-toggle]').forEach(input => {
        input.addEventListener('change', () => {
            const id = input.dataset.pbToggle;
            setPromptEnabled(id, input.checked);
            saveSettingsDebounced();
            syncPromptManager?.([id]);
            refreshPlumBlossomControls(container);
            onChanged?.();
        });
    });

    for (const group of ALL_GROUPS) {
        container.querySelector(`[data-pb-group="${group.id}"]`)?.addEventListener('change', event => {
            const ids = setExclusiveChoice(group, event.target.value);
            syncPromptManager?.(ids);
            refreshPlumBlossomControls(container);
            onChanged?.();
        });
    }

    refreshPlumBlossomControls(container);
}

export const PLUM_BLOSSOM_CHOOSE_PROMPT_IDS = Object.freeze([
    ...TOGGLE_SECTIONS.flatMap(section => section.toggles.map(([id]) => id)),
    ...ALL_GROUPS.flatMap(group => group.options.map(([id]) => id)),
    PB_ANALYZE_SCENE_PROMPT_ID,
    PB_NATIVE_DEBUG_PROMPT_ID,
    ...PB_NATIVE_ACTION_PROMPT_IDS,
]);
