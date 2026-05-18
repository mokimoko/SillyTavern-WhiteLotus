// src/moduleRegistry.js
// Central registry for all White Lotus modules (toggles, groups, trackers).
// Single source of truth for prompt IDs, setting defaults, UI metadata,
// bracket tags, fallback prompts, and payload categories.
//
// To add a new module: add ONE entry here. Consuming files derive everything
// from this registry — no other files need manual ID/default/label updates.

// ============================================================
// TOGGLES — simple on/off modules
// Each entry: { category, label, settingDefault, promptIds, hint? }
//
// promptIds can contain multiple IDs (e.g. Kimi wrangling uses two prompts).
// ============================================================

export const TOGGLES = {
    // --- Tweaks ---
    tweakNPCs:          { category: 'Tweaks', label: 'Better NPCs',      settingDefault: false, promptIds: ['aae6f802-1860-46e1-9d0a-4f30859adc18'] },
    tweakDisabilities:  { category: 'Tweaks', label: 'Disabilities',     settingDefault: false, promptIds: ['83392def-1a7d-46b0-9c03-1d9917cab4d7'] },
    tweakViolence:      { category: 'Tweaks', label: 'Intense Violence', settingDefault: false, promptIds: ['3939dc89-6cbe-42d6-896a-bf29d79ce990'] },
    tweakAbuse:         { category: 'Tweaks', label: 'Abuse / Toxic',    settingDefault: false, promptIds: ['cf9fc6fa-2074-492c-a411-6d8beb002456'] },
    tweakNegativity:    { category: 'Tweaks', label: 'Negativity Bias',  settingDefault: false, promptIds: ['7a70192d-51ad-44ac-a0e5-ae4672c01908'] },

    // --- Fixes ---
    fixAntiSlop:        { category: 'Fixes', label: 'Anti-Slop',         settingDefault: false, promptIds: ['05233b1e-de2c-430a-8a97-13284c37dae5'] },
    fixConsent:         { category: 'Fixes', label: 'Consent Override',   settingDefault: false, promptIds: ['ac239e00-fe78-4edc-bb50-f2689f23d89d'] },
    fixKimiWrangling:   { category: 'Fixes', label: 'Kimi Wrangling',    settingDefault: false, promptIds: ['b14b45f9-b8f6-4b0b-95d0-a2f253385645', '3889da79-c9c0-49fd-92dc-a2014cbeb8f1'] },

    // --- Tools ---
    toolNPCCrafter:     { category: 'Tools', label: 'NPC Crafter',       settingDefault: false, promptIds: ['7ff54f24-9031-4d44-96bf-6a59d1d144af'] },
    toolVariety:        { category: 'Tools', label: 'Variety Toggle',    settingDefault: false, promptIds: ['6673c839-5f9e-4f38-a359-c59be7cacdf8'] },
    toolBrainstorm:     { category: 'Tools', label: 'Brainstorm CoT',    settingDefault: false, promptIds: ['7b58f7ef-c0f6-4fe1-aef6-3135b2987b9c'] },
    toolHyperMode:      { category: 'Tools', label: 'Hyper-Mode CoT',    settingDefault: false, promptIds: ['1c3629ab-8a90-4db9-abcd-f9cc7a7300a8'] },
};

// ============================================================
// EXCLUSIVE_GROUPS — radio-style selectors, one active at a time
// Each group: { category, label, settingDefault, masterToggleId?, options }
// options: { value: { label, promptId? } }
//
// masterToggleId — an extra prompt that gets enabled when any real option
// is selected and disabled when the group is off (e.g. NSFW master toggle).
//
// Options with no promptId are UI-only placeholders —
// selecting them disables all prompts in the group.
// Options WITH a promptId (even '' / 'None') enable that prompt when selected.
// ============================================================

export const EXCLUSIVE_GROUPS = {
    modelFamily: {
        category: 'Setup',
        label: 'Model Family',
        settingDefault: '',
        options: {
            '':       { label: 'None',     promptId: '77647009-b4f9-4ca1-ad32-da0aa6c7eedd' },
            glm:      { label: 'GLM',      promptId: '6179d1ca-c72f-41c3-9aeb-c94ad211bb74' },
            deepseek: { label: 'Deepseek', promptId: '17ace0f3-f5b5-4c9d-99a1-8a82f417e630' },
            kimi:     { label: 'Kimi',     promptId: '5a25ca18-47da-47ba-ae08-f6bba75928bf' },
        },
    },
    length: {
        category: 'Parameters',
        label: 'Length',
        settingDefault: 'flexible',
        options: {
            super_short: { label: 'Super Short', promptId: 'b8461485-2fa3-43c0-b7d3-0f768105cd24' },
            short:       { label: 'Short',       promptId: '3a2050f5-b4b7-4e51-9b0f-eef5606ee843' },
            moderate:    { label: 'Moderate',     promptId: '7ee02f7d-af53-4abf-afd5-18bd12917f36' },
            flexible:    { label: 'Flexible',     promptId: '8f1944bb-7f94-4e1a-ae23-1a8c20261ba0' },
        },
    },
    narratorType: {
        category: 'Parameters',
        label: 'Narrator',
        settingDefault: 'omniscient',
        options: {
            omniscient: { label: 'Omniscient', promptId: 'daf44e20-d152-4d3c-b166-f516ecb56273' },
            character:  { label: 'Character',  promptId: 'faecca79-3620-4433-9983-cd0387c8eece' },
        },
    },
    diction: {
        category: 'Parameters',
        label: 'Diction',
        settingDefault: 'none',
        options: {
            none:       { label: 'None',       promptId: '5918f9dc-4190-4bbe-b8b8-1957082d30ed' },
            china:      { label: 'China',      promptId: 'b2b708f9-dce7-4552-8df3-f5bdbe1dec75' },
            japan:      { label: 'Japan',      promptId: '22c7ec43-7d11-4130-a0fb-2d401a3e01b9' },
            historical: { label: 'Historical', promptId: '83c1a799-31d6-4edf-9ebd-b850981de62c' },
        },
    },
    genre: {
        category: 'Parameters',
        label: 'Genre',
        settingDefault: null,
        options: {
            '':                 { label: 'None' },
            contemporary:       { label: 'Contemporary',        promptId: '961bbf5e-82d8-452f-abd4-5ada4e7c641b' },
            dark_fantasy:       { label: 'Dark Fantasy',        promptId: '6720343a-8ecc-4b37-9f53-af398ede1bef' },
            southern_gothic:    { label: 'Southern Gothic',     promptId: 'e5d3f809-8737-4cb4-93da-4ff935e46e7f' },
            slice_of_life:      { label: 'Slice of Life',       promptId: '80848b52-e538-4497-8c33-20c26d809356' },
            sci_fi:             { label: 'Sci-Fi',              promptId: 'ca9fbc49-8c1f-42c5-b177-09ac82daa9e9' },
            regency:            { label: 'Regency',             promptId: 'e38fec8c-5858-4f38-8673-06564d42e96a' },
            danmei_historical:  { label: 'Danmei (Historical)', promptId: 'da5ddfce-747a-4bc3-8e53-135d007ccce2' },
            danmei_modern:      { label: 'Danmei (Modern)',     promptId: '96e86d28-0b07-41d0-96e0-bc960ed5da0a' },
            litrpg:             { label: 'LitRPG',              promptId: '84be9b37-eacf-4cb2-b94d-da32a9878df5' },
        },
    },
    nsfwStyle: {
        category: 'NSFW',
        label: 'Style',
        settingDefault: null,
        masterToggleId: 'nsfw',
        options: {
            '':              { label: 'Off' },
            realistic:       { label: 'Realistic',       promptId: '63638103-d121-4958-88f4-7948128b5400' },
            gooner:          { label: 'Gooner',          promptId: '324759a5-069d-46ea-b535-47d0db0c7262' },
        },
    },
};

// ============================================================
// TRACKERS — modules that participate in the utilities gen pipeline
// Each entry: { label, settingDefault, promptId, bracketTag, multiEntry }
//
// bracketTag — the tag name used in LLM output: [TAG|...] or [TAG]...[/TAG]
// multiEntry — if true, multiple instances can appear (e.g. one [RPS|...] per character)
//
// NOTE: Only trackers that run via the separate utilities gen pipeline belong
// here. The Omniscient Director (Slate) is NOT managed here — it's produced
// inline by the main LLM as part of Brainstorm CoT and styled by the
// "Style - Omniscient" preset regex script.
// ============================================================

export const TRACKERS = {
    trackerLotusBoard: {
        label: 'Status Board',
        settingDefault: false,
        promptId: '042279e6-820f-4e9d-aec1-a3e5b37f8453',
        bracketTag: 'LOTUS',
        multiEntry: true,
    },
    trackerTemporal: {
        label: 'Temporal Tracker',
        settingDefault: false,
        promptId: '3ade7755-3093-4116-98b9-37d2efe6d1f0',
        bracketTag: 'TEMPORAL',
        multiEntry: false,
    },
    trackerRelationship: {
        label: 'Relationship Tracker',
        settingDefault: false,
        promptId: 'fe1afd93-8e59-4902-b6ca-10ef32d49401',
        bracketTag: 'RPS',
        multiEntry: true,
    },
};

// ============================================================
// INFRASTRUCTURE — non-module prompt IDs used by the system
// These are special prompts that don't fit the toggle/group/tracker model.
// ============================================================

export const INFRA = {
    /** Variable setter prompt — content-swapped at generation time for tense/POV */
    variableSetterId: 'cb7a858f-2105-434e-ba11-a073485b2bb2',

    /** Shared format rules for all trackers — auto-managed dependency */
    trackerFormatRulesId: '5e4646fc-4225-4c0b-a0e6-8981e08b7f1f',

    /** Signature IDs for preset detection (fallback when name doesn't match) */
    signatureIds: [
        'cb7a858f-2105-434e-ba11-a073485b2bb2',  // Set Variables
        '8f1944bb-7f94-4e1a-ae23-1a8c20261ba0',  // Flexible length
        '05233b1e-de2c-430a-8a97-13284c37dae5',  // Anti-Slop
        '7ff54f24-9031-4d44-96bf-6a59d1d144af',  // NPC Crafter
    ],
};

// ============================================================
// UI_SECTIONS — defines the order and content of the controls panel
// Each section declares which registry entries it renders.
//
// type: 'toggles' → renders buildToggleRow for each key
// type: 'selects' → renders buildSelectRow for each group key
// type: 'mixed'   → renders selects first, then toggles
// prefix/suffix   → raw HTML strings injected before/after auto-generated rows
// ============================================================

export const UI_SECTIONS = [
    {
        id: 'setup',
        label: 'Setup',
        type: 'selects',
        groups: ['modelFamily'],
    },
    {
        id: 'parameters',
        label: 'Parameters',
        type: 'mixed',
        // tense + pov are variable-setter params, not registry modules — hand-coded prefix
        prefix: `__SELECT:tense:Tense:past=Past,present=Present__
__SELECT:pov:POV:1st=1st Person,2nd=2nd Person,3rd=3rd Person__`,
        groups: ['length', 'narratorType', 'diction', 'genre'],
        toggles: [],
    },
    {
        id: 'nsfw',
        label: 'NSFW',
        type: 'selects',
        groups: ['nsfwStyle'],
    },
    {
        id: 'tweaks',
        label: 'Tweaks',
        type: 'toggles',
        category: 'Tweaks',
    },
    {
        id: 'fixes',
        label: 'Fixes',
        type: 'toggles',
        category: 'Fixes',
    },
    {
        id: 'tools',
        label: 'Tools',
        type: 'toggles',
        category: 'Tools',
    },
    {
        id: 'display',
        label: 'Display',
        type: 'toggles',
        category: 'Display',
    },
    {
        id: 'trackers',
        label: 'Trackers',
        type: 'toggles',
        category: 'Trackers',
        suffix: `<div class="wl-control-row wl-tracker-actions">
            <button class="wl-btn" id="wl-run-trackers" title="Manually run tracker evaluation">Run Trackers</button>
        </div>`,
    },
];

// ============================================================
// Derived helpers — computed from the registry above
// ============================================================

/** All toggle setting keys */
export const TOGGLE_KEYS = Object.keys(TOGGLES);

/** All tracker setting keys */
export const TRACKER_KEYS = Object.keys(TRACKERS);

/** All exclusive group keys */
export const GROUP_KEYS = Object.keys(EXCLUSIVE_GROUPS);

/** All bracket tags used by trackers */
export const ALL_BRACKET_TAGS = Object.values(TRACKERS).map(t => t.bracketTag);

/**
 * Build a flat category map: promptId → category string.
 * Used by the payload counter to categorize token costs.
 */
export function buildCategoryMap() {
    const map = {};

    // Toggles
    for (const def of Object.values(TOGGLES)) {
        for (const id of def.promptIds) {
            map[id] = def.category;
        }
    }

    // Exclusive groups
    for (const group of Object.values(EXCLUSIVE_GROUPS)) {
        for (const opt of Object.values(group.options)) {
            if (opt.promptId) map[opt.promptId] = group.category;
        }
        if (group.masterToggleId) map[group.masterToggleId] = group.category;
    }

    // Trackers
    for (const tracker of Object.values(TRACKERS)) {
        map[tracker.promptId] = 'Trackers';
    }

    // Infrastructure
    map[INFRA.variableSetterId] = 'Parameters';
    if (INFRA.trackerFormatRulesId) map[INFRA.trackerFormatRulesId] = 'Trackers';

    return map;
}

/**
 * Build default setting values from all registry entries.
 * Merged into settings.js DEFAULT_SETTINGS.
 */
export function buildModuleDefaults() {
    const defaults = {};

    for (const [key, def] of Object.entries(TOGGLES)) {
        defaults[key] = def.settingDefault;
    }
    for (const [key, group] of Object.entries(EXCLUSIVE_GROUPS)) {
        defaults[key] = group.settingDefault;
    }
    for (const [key, tracker] of Object.entries(TRACKERS)) {
        defaults[key] = tracker.settingDefault;
    }

    return defaults;
}

/**
 * Get all toggles that belong to a given category.
 * Returns array of { key, ...toggleDef } in registry order.
 */
export function getTogglesByCategory(category) {
    const result = [];
    // Include toggles from TOGGLES
    for (const [key, def] of Object.entries(TOGGLES)) {
        if (def.category === category) result.push({ key, ...def });
    }
    // Include trackers under the 'Trackers' category
    if (category === 'Trackers') {
        for (const [key, def] of Object.entries(TRACKERS)) {
            result.push({ key, label: def.label, settingDefault: def.settingDefault, promptIds: [def.promptId], category: 'Trackers' });
        }
    }
    return result;
}

/**
 * Build select options from an exclusive group definition.
 * Returns { value: label } object for buildSelectRow.
 */
export function getGroupOptions(groupKey) {
    const group = EXCLUSIVE_GROUPS[groupKey];
    if (!group) return {};
    const opts = {};
    for (const [value, opt] of Object.entries(group.options)) {
        opts[value] = opt.label;
    }
    return opts;
}
