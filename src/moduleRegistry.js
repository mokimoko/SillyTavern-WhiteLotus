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
    // --- Main Prompt ---
    mainLotusEngine:     { category: 'Main', label: 'Lotus Engine',      settingDefault: true, promptIds: ['72e0c614-9eb5-4353-b490-efbc5312f4a2'] },
    mainUserAutonomy:    { category: 'Main', label: 'User Autonomy',     settingDefault: true, promptIds: ['4f6996e5-b902-45c2-9b8a-6255df7d715a'] },
    mainAisTurn:         { category: 'Main', label: "AI's Turn",         settingDefault: true, promptIds: ['0f0e4d5d-ec5e-42ee-97c6-107670eff9f4'] },

    // --- Main Prompt: SillyTavern default blocks (preset 4.2.1) ---
    // The White Lotus preset now keeps ST's built-in prompt blocks separate
    // from its own. These expose the safe-to-toggle defaults; structural blocks
    // (char info, chat history, lore, persona, scenario, examples) are left out
    // deliberately so they can't be disabled by accident. All default OFF to
    // match their state in the shipped preset.
    stMainPrompt:         { category: 'Main', label: 'ST: Main Prompt',          settingDefault: false, promptIds: ['main'] },
    stEnhanceDefinitions: { category: 'Main', label: 'ST: Enhance Definitions',  settingDefault: false, promptIds: ['enhanceDefinitions'] },
    stAuxiliaryPrompt:    { category: 'Main', label: 'ST: Auxiliary Prompt',     settingDefault: false, promptIds: ['nsfw'] },
    stJailbreak:          { category: 'Main', label: 'ST: Post-History',         settingDefault: false, promptIds: ['jailbreak'] },

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
    // Tense & POV — as of preset 4.2.0 these are normal exclusive groups
    // (each option is its own prompt that sets promptTense / promptPOV via
    // {{setvar}}), replacing the old single content-swapped "Set Variables"
    // prompt. Option values are the UI keys; the preset prompts hold the
    // human-readable variable content consumed by {{getvar::promptPOV}} etc.
    tense: {
        category: 'Parameters',
        label: 'Tense',
        settingDefault: 'past',
        options: {
            past:    { label: 'Past',    promptId: 'b3507a5d-becb-45a4-a69a-4c4f3fff8624' },
            present: { label: 'Present', promptId: 'e058cedd-d2fc-42c5-90dc-2d812607af22' },
        },
    },
    pov: {
        category: 'Parameters',
        label: 'POV',
        settingDefault: '3rd_you',
        options: {
            '1st':     { label: '1st Person',           promptId: '2fafcd42-1422-4f1b-85e6-f9403c8d2d3c' },
            '3rd':     { label: '3rd Person',           promptId: 'e130e259-3002-457c-8cdd-defc0761f907' },
            '3rd_you': { label: '3rd Person (uses "you")', promptId: '4c07346d-b997-4e39-84d3-5a680e681f78' },
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
            girthy:      { label: 'Girthy',       promptId: '157db729-1654-47f3-8ef3-de77f54e4b0f' },
            flexible:    { label: 'Flexible',     promptId: '8f1944bb-7f94-4e1a-ae23-1a8c20261ba0' },
        },
    },
    narratorType: {
        category: 'Parameters',
        label: 'Narrator',
        settingDefault: 'omniscient',
        options: {
            omniscient:  { label: 'Omniscient',  promptId: 'daf44e20-d152-4d3c-b166-f516ecb56273' },
            character:   { label: 'Character',   promptId: 'faecca79-3620-4433-9983-cd0387c8eece' },
            storyteller: { label: 'Storyteller', promptId: 'a1262ebf-5543-44fb-b478-284d821a2d22' },
        },
        // linkedToggles: toggleKey → array of group values that ENABLE the toggle.
        // Any other value (or null) disables it.
        linkedToggles: {
            mainUserAutonomy: ['omniscient', 'character'],
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
        settingDefault: '',
        options: {
            '':                 { label: 'None',              promptId: 'd79819e5-691c-4ade-a978-d2d420c404ac' },
            contemporary:       { label: 'Contemporary',        promptId: '961bbf5e-82d8-452f-abd4-5ada4e7c641b' },
            dark_fantasy:       { label: 'Dark Fantasy',        promptId: '6720343a-8ecc-4b37-9f53-af398ede1bef' },
            southern_gothic:    { label: 'Southern Gothic',     promptId: 'e5d3f809-8737-4cb4-93da-4ff935e46e7f' },
            slice_of_life:      { label: 'Slice of Life',       promptId: '80848b52-e538-4497-8c33-20c26d809356' },
            sci_fi:             { label: 'Sci-Fi',              promptId: 'ca9fbc49-8c1f-42c5-b177-09ac82daa9e9' },
            regency:            { label: 'Regency',             promptId: 'e38fec8c-5858-4f38-8673-06564d42e96a' },
            danmei_historical:  { label: 'Historical Chinese', promptId: 'da5ddfce-747a-4bc3-8e53-135d007ccce2' },
            danmei_modern:      { label: 'Modern Chinese',     promptId: '96e86d28-0b07-41d0-96e0-bc960ed5da0a' },
            litrpg:             { label: 'LitRPG',              promptId: '84be9b37-eacf-4cb2-b94d-da32a9878df5' },
            space_opera:        { label: 'Space Opera',          promptId: 'ec56ce42-5911-4c8f-a191-c81724553aff' },
            grimdark_comedy:    { label: 'Grimdark Comedy',      promptId: 'bb9d75e7-84c8-4b13-a576-03ef2a6b2716' },
        },
    },
    nsfwStyle: {
        category: 'NSFW',
        label: 'Style',
        settingDefault: null,
        // Preset 4.2.1 split ST's default 'nsfw' block out (now "Auxiliary
        // Prompt"); the actual NSFW master content moved to this new block.
        masterToggleId: '2174cd63-4ccc-4069-870e-f304f2583a37',
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
    // NOTE: The old content-swapped "Set Variables" prompt (cb7a858f-…) was
    // removed in preset 4.2.0. Tense/POV are now exclusive groups (see above),
    // so there is no variableSetterId anymore.

    /** Shared format rules for all trackers — auto-managed dependency */
    trackerFormatRulesId: '5e4646fc-4225-4c0b-a0e6-8981e08b7f1f',

    /**
     * Signature IDs for CURRENT-version preset detection.
     * These IDs must all be present in the active prompt order for the preset
     * to be considered the current bundled White Lotus. If only SOME WL prompt
     * IDs are present (see collectAllPromptIds), the preset is an older WL
     * version — detected as "outdated" so the panel can prompt an update.
     */
    signatureIds: [
        '414477ab-e91a-4851-8f30-c98eb2e98a33',  // Tense group header (4.2.0+)
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
        id: 'parameters',
        label: 'Parameters',
        type: 'mixed',
        // tense + pov are now normal exclusive groups (preset 4.2.0+)
        groups: ['tense', 'pov', 'length', 'narratorType', 'diction', 'genre'],
        toggles: [],
    },
    {
        id: 'main-prompt',
        label: 'Main Prompt',
        type: 'toggles',
        category: 'Main',
        collapsible: true,
        collapsed: true,
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

// ============================================================
// Preset detection — signature-based
//
// The extension now ships its own preset, so detection no longer relies on the
// preset name. Instead we look at which known White Lotus prompt IDs appear in
// the active prompt order:
//   - ALL current signature IDs present  → current WL (full support)
//   - SOME WL prompt IDs present, but a signature ID missing → outdated WL
//   - no WL prompt IDs present           → not a WL preset
// ============================================================

/**
 * Collect every prompt ID this registry knows about (toggles, group options,
 * master toggles, trackers, infra). Used to recognise older WL presets whose
 * signature IDs may have changed but which still share many prompt IDs.
 * @returns {Set<string>}
 */
export function collectAllPromptIds() {
    const ids = new Set();

    for (const def of Object.values(TOGGLES)) {
        for (const id of def.promptIds) ids.add(id);
    }
    for (const group of Object.values(EXCLUSIVE_GROUPS)) {
        for (const opt of Object.values(group.options)) {
            if (opt.promptId) ids.add(opt.promptId);
        }
        if (group.masterToggleId) ids.add(group.masterToggleId);
    }
    for (const tracker of Object.values(TRACKERS)) {
        ids.add(tracker.promptId);
    }
    if (INFRA.trackerFormatRulesId) ids.add(INFRA.trackerFormatRulesId);
    for (const id of INFRA.signatureIds) ids.add(id);

    return ids;
}

/**
 * Classify the active prompt order.
 * @param {Array<{identifier:string}>} order - active prompt_order entries
 * @returns {{ state: 'current'|'outdated'|'none', matched: number, total: number }}
 *   state   — 'current' (all signature IDs present), 'outdated' (some WL IDs
 *             but not a full signature match), or 'none' (no WL IDs at all)
 *   matched — how many current signature IDs were found
 *   total   — number of current signature IDs
 */
export function classifyPromptOrder(order) {
    const total = INFRA.signatureIds.length;
    if (!Array.isArray(order) || order.length === 0) {
        return { state: 'none', matched: 0, total };
    }

    const present = new Set(order.map(e => e && e.identifier).filter(Boolean));

    let matched = 0;
    for (const sigId of INFRA.signatureIds) {
        if (present.has(sigId)) matched++;
    }
    // Binary: a full signature match is current WL; anything else (foreign
    // preset OR an older WL version) is treated as not WL.
    if (matched === total) {
        return { state: 'current', matched, total };
    }
    return { state: 'none', matched, total };
}
