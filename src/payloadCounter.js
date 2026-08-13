import { eventSource, event_types } from '../../../../../script.js';
import { getChatCompletionModel, oai_settings, promptManager } from '../../../../openai.js';
import { power_user } from '../../../../power-user.js';
import { countTokensOpenAIAsync } from '../../../../tokenizers.js';
import { ConnectionManagerRequestService } from '../../../../extensions/shared.js';

import { createLogger } from './debug.js';
import { buildCategoryMap } from './moduleRegistry.js';
import { PRESET_MODES } from './presetModeSwitcher.js';
import { getSettings } from './settings.js';

// Observe the collection SillyTavern already prepared so stateful PB macros
// are measured after expansion without executing them a second time.
const { log, logError } = createLogger('Payload');
const PROMPT_COLLECTION_HOOK = Symbol.for('whiteLotus.payloadCounter.promptCollectionHook');
const OBSERVER_ID = 'white-lotus-payload-counter';
const ABSOLUTE_POSITION = 1;
const PB_ANALYZE_SCENE_PROMPT_ID = 'pb_analyze_scene';
const NARRATIVE_GENERATION_TYPES = new Set(['normal', 'swipe', 'regenerate', 'continue']);
const PB_CONDITIONAL_MACRO_RE = /\{\{\s*(?:if\b|else\b|\/if\b|getvar::|outlet::|\.pb_)/i;

const WL_CATEGORY_MAP = buildCategoryMap();
const CATEGORY_ORDER = {
    [PRESET_MODES.WHITE_LOTUS]: ['Main', 'Core', 'Parameters', 'Tweaks', 'Fixes', 'Tools', 'NSFW', 'Trackers'],
    [PRESET_MODES.PLUM_BLOSSOM]: ['Constant', 'Conditional', 'Analysis'],
};

const MODEL_SETTING_KEYS = {
    openai: 'openai_model',
    claude: 'claude_model',
    makersuite: 'google_model',
    vertexai: 'vertexai_model',
    openrouter: 'openrouter_model',
    ai21: 'ai21_model',
    mistralai: 'mistralai_model',
    custom: 'custom_model',
    cohere: 'cohere_model',
    perplexity: 'perplexity_model',
    groq: 'groq_model',
    siliconflow: 'siliconflow_model',
    minimax: 'minimax_model',
    electronhub: 'electronhub_model',
    chutes: 'chutes_model',
    nanogpt: 'nanogpt_model',
    deepseek: 'deepseek_model',
    aimlapi: 'aimlapi_model',
    xai: 'xai_model',
    pollinations: 'pollinations_model',
    cometapi: 'cometapi_model',
    moonshot: 'moonshot_model',
    fireworks: 'fireworks_model',
    azure_openai: 'azure_openai_model',
    zai: 'zai_model',
    workers_ai: 'workers_ai_model',
};

const measurements = new Map();
let plumAnalysisMeasurement = null;
let getActiveMode = () => null;
let onUpdated = () => {};
let pendingGeneration = null;
let contextRevision = 0;
let measurementTicket = 0;
let analysisMeasurementTicket = 0;
let initialized = false;

function clonePreparedPrompts(collection) {
    if (!Array.isArray(collection?.collection)) return [];

    return collection.collection.map(prompt => ({
        identifier: String(prompt?.identifier || ''),
        role: String(prompt?.role || 'system'),
        content: typeof prompt?.content === 'string' ? prompt.content : '',
        injectionPosition: Number(prompt?.injection_position || 0),
        injectionDepth: Number(prompt?.injection_depth || 0),
        injectionOrder: Number(prompt?.injection_order ?? 100),
    }));
}

function installPromptCollectionObserver() {
    if (!promptManager || typeof promptManager.getPromptCollection !== 'function') {
        logError('Prompt Manager is unavailable; last-payload measurement is disabled.');
        return false;
    }

    let hook = promptManager[PROMPT_COLLECTION_HOOK];
    if (!hook) {
        const original = promptManager.getPromptCollection.bind(promptManager);
        hook = { observers: new Map() };

        promptManager.getPromptCollection = function (...args) {
            const collection = original(...args);
            for (const observer of hook.observers.values()) {
                try {
                    observer(collection, args[0]);
                } catch (error) {
                    logError('Failed to observe the prepared prompt collection:', error);
                }
            }
            return collection;
        };

        Object.defineProperty(promptManager, PROMPT_COLLECTION_HOOK, {
            value: hook,
            configurable: false,
            enumerable: false,
            writable: false,
        });
    }

    hook.observers.set(OBSERVER_ID, (collection, generationType) => {
        if (!pendingGeneration || pendingGeneration.consumed) return;
        pendingGeneration.generationType = normalizeGenerationType(generationType || pendingGeneration.generationType);
        pendingGeneration.prompts = clonePreparedPrompts(collection);
    });
    return true;
}

function normalizeGenerationType(value) {
    return String(value || 'normal').trim().toLowerCase();
}

function getOwnedPromptMap() {
    const result = new Map();
    const prompts = Array.isArray(oai_settings.prompts) ? oai_settings.prompts : [];
    for (const prompt of prompts) {
        const identifier = String(prompt?.identifier || '');
        const content = typeof prompt?.content === 'string' ? prompt.content : '';
        if (identifier && content.trim()) result.set(identifier, content);
    }
    return result;
}

function getCategory(mode, identifier, sourceContent) {
    if (mode === PRESET_MODES.PLUM_BLOSSOM) {
        if (identifier === PB_ANALYZE_SCENE_PROMPT_ID) return 'Analysis';
        return PB_CONDITIONAL_MACRO_RE.test(sourceContent) ? 'Conditional' : 'Constant';
    }
    return WL_CATEGORY_MAP[identifier] || 'Core';
}

function hashString(hash, value) {
    let result = hash >>> 0;
    for (let index = 0; index < value.length; index += 1) {
        result ^= value.charCodeAt(index);
        result = Math.imul(result, 16777619);
    }
    return result >>> 0;
}

function getCurrentFingerprint(mode) {
    let hash = 2166136261;
    const activeOrder = promptManager?.getPromptOrderForCharacter?.(promptManager.activeCharacter);
    const order = Array.isArray(activeOrder) ? activeOrder : [];
    const prompts = Array.isArray(oai_settings.prompts) ? oai_settings.prompts : [];
    const contentById = new Map(prompts.map(prompt => [
        String(prompt?.identifier || ''),
        typeof prompt?.content === 'string' ? prompt.content : '',
    ]));

    for (const entry of order) {
        const identifier = String(entry?.identifier || '');
        const content = contentById.get(identifier) || '';
        if (!identifier || !content.trim()) continue;
        const enabled = !!entry?.enabled;
        hash = hashString(hash, `${identifier}\0${enabled ? '1' : '0'}\0`);
        if (enabled) hash = hashString(hash, `${content}\0`);
    }

    return [
        mode,
        contextRevision,
        oai_settings.chat_completion_source || '',
        getChatCompletionModel() || '',
        power_user.tokenizer ?? '',
        hash.toString(16),
    ].join('|');
}

function buildCountGroups(mode, prompts, ownedPromptMap) {
    const groups = new Map();

    for (const prompt of prompts) {
        if (!ownedPromptMap.has(prompt.identifier) || !prompt.content.trim()) continue;
        const category = getCategory(mode, prompt.identifier, ownedPromptMap.get(prompt.identifier));
        const isAbsolute = prompt.injectionPosition === ABSOLUTE_POSITION;
        const key = isAbsolute
            ? `absolute:${prompt.injectionDepth}:${prompt.injectionOrder}:${prompt.role}:${category}`
            : `prompt:${prompt.identifier}`;
        const existing = groups.get(key);

        if (existing) {
            existing.contents.push(prompt.content);
        } else {
            groups.set(key, {
                category,
                role: prompt.role || 'system',
                contents: [prompt.content],
                separator: isAbsolute ? '\n' : '',
            });
        }
    }

    return [...groups.values()];
}

async function countPreparedPayload(mode, prompts) {
    const ownedPromptMap = getOwnedPromptMap();
    const groups = buildCountGroups(mode, prompts, ownedPromptMap);
    const categories = {};

    // Avoid bursting one tokenizer request per uncached prompt all at once.
    const counts = [];
    for (const group of groups) {
        const content = group.contents.join(group.separator).trim();
        if (!content) {
            counts.push({ category: group.category, tokens: 0 });
            continue;
        }
        const tokens = await countTokensOpenAIAsync({ role: group.role, content }, false, oai_settings);
        counts.push({ category: group.category, tokens: Math.max(0, Number(tokens) || 0) });
    }

    for (const count of counts) {
        categories[count.category] = (categories[count.category] || 0) + count.tokens;
    }

    return {
        categories,
        total: Object.values(categories).reduce((sum, value) => sum + value, 0),
        promptCount: groups.length,
    };
}

function startGeneration(generationType, _options, dryRun) {
    const mode = getActiveMode();
    pendingGeneration = mode ? {
        mode,
        generationType: normalizeGenerationType(generationType),
        dryRun: !!dryRun,
        prompts: [],
        consumed: false,
        fingerprint: getCurrentFingerprint(mode),
    } : null;
}

function handlePromptReady(eventData) {
    const pending = pendingGeneration;
    if (!pending || pending.consumed) return;
    pending.consumed = true;

    if (pending.dryRun || eventData?.dryRun) return;
    if (!NARRATIVE_GENERATION_TYPES.has(pending.generationType)) return;
    if (!pending.prompts.length) return;

    const ticket = ++measurementTicket;
    const snapshot = { ...pending, prompts: pending.prompts.map(prompt => ({ ...prompt })) };
    void countPreparedPayload(snapshot.mode, snapshot.prompts)
        .then(result => {
            if (ticket !== measurementTicket) return;
            measurements.set(snapshot.mode, {
                ...result,
                fingerprint: snapshot.fingerprint,
                measuredAt: Date.now(),
            });
            log(`Measured ${snapshot.mode} preset payload: ${result.total.toLocaleString()} tokens across ${result.promptCount} prompt groups.`);
            onUpdated();
            flashBadge();
        })
        .catch(error => logError('Failed to measure the last preset payload:', error));
}

function markContextChanged() {
    contextRevision += 1;
    measurementTicket += 1;
    analysisMeasurementTicket += 1;
    pendingGeneration = null;
    onUpdated();
}

function getAnalysisTokenSettings(profileId) {
    if (!profileId) return { settings: oai_settings, profileKey: 'current' };

    try {
        const profile = ConnectionManagerRequestService.getProfile(profileId);
        const api = ConnectionManagerRequestService.validateProfile(profile);
        if (api.selected !== 'openai' || !api.source) {
            return { settings: oai_settings, profileKey: `${profileId}|${profile.api}|${profile.model || ''}` };
        }

        const settings = { ...oai_settings, chat_completion_source: api.source };
        const modelKey = MODEL_SETTING_KEYS[api.source];
        if (modelKey) settings[modelKey] = profile.model;
        return { settings, profileKey: `${profileId}|${profile.api}|${api.source}|${profile.model || ''}` };
    } catch (error) {
        logError('Could not resolve the analysis profile for token measurement:', error);
        return { settings: oai_settings, profileKey: `${profileId}|unresolved` };
    }
}

function getAnalysisFingerprint(profileId) {
    const { profileKey } = getAnalysisTokenSettings(profileId);
    return `${contextRevision}|${profileKey}|${power_user.tokenizer ?? ''}`;
}

export function measurePlumAnalysisPayload(prompt, profileId = '') {
    const content = String(prompt || '').trim();
    if (!content) return;

    const ticket = ++analysisMeasurementTicket;
    const fingerprint = getAnalysisFingerprint(profileId);
    const { settings } = getAnalysisTokenSettings(profileId);
    // Mirror PB's native Analyze Scene prompt role. The sidecar's surrounding
    // context is intentionally excluded so both delivery modes report the same block.
    void countTokensOpenAIAsync({ role: 'system', content }, false, settings)
        .then(tokens => {
            if (ticket !== analysisMeasurementTicket) return;
            plumAnalysisMeasurement = {
                tokens: Math.max(0, Number(tokens) || 0),
                fingerprint,
                measuredAt: Date.now(),
            };
            onUpdated();
        })
        .catch(error => logError('Failed to measure the separate analysis payload:', error));
}

function flashBadge() {
    const badge = document.getElementById('wl-payload-count');
    if (!badge) return;
    badge.classList.add('wl-payload-flash');
    setTimeout(() => badge.classList.remove('wl-payload-flash'), 400);
}

function formatTokens(value) {
    return Number(value || 0).toLocaleString();
}

export function renderPayloadCounter(mode, isPresetActive) {
    const footer = document.getElementById('wl-panel-footer');
    const title = document.getElementById('wl-payload-title');
    const badge = document.getElementById('wl-payload-count');
    const breakdown = document.getElementById('wl-payload-breakdown');
    if (!badge) return;

    if (title) {
        title.textContent = mode === PRESET_MODES.PLUM_BLOSSOM
            ? 'Last story payload'
            : 'Last preset payload';
    }
    const measurement = measurements.get(mode);
    const stale = !!measurement && measurement.fingerprint !== getCurrentFingerprint(mode);
    footer?.classList.toggle('wl-payload-stale', stale);

    const settings = getSettings();
    const hasInlineAnalysis = mode === PRESET_MODES.PLUM_BLOSSOM
        && Number(measurement?.categories?.Analysis || 0) > 0;
    const showSeparateAnalysis = mode === PRESET_MODES.PLUM_BLOSSOM
        && settings.plumBlossomSeparateAnalysis
        && !hasInlineAnalysis;
    const analysisStale = !!plumAnalysisMeasurement
        && plumAnalysisMeasurement.fingerprint !== getAnalysisFingerprint(settings.utilityConnectionProfile || '');
    const analysisRow = showSeparateAnalysis
        ? `<span class="wl-payload-row wl-payload-row-separate" title="Expanded PB analysis instructions sent to the sidecar. Wrapper, story context, and copied conversation are excluded; this is not included in the story total."><span>Analysis <small>(separate)</small></span><span class="${analysisStale ? 'wl-payload-value-stale' : ''}">${plumAnalysisMeasurement ? formatTokens(plumAnalysisMeasurement.tokens) : '—'}${analysisStale ? '*' : ''}</span></span>`
        : '';

    if (!measurement) {
        badge.textContent = '—';
        footer?.setAttribute('title', isPresetActive
            ? 'Send a message to measure the preset payload.'
            : 'Activate this preset and send a message to measure its payload.');
        if (breakdown) {
            const status = isPresetActive
                ? 'Send a message to measure.'
                : 'Activate this preset and send a message.';
            breakdown.innerHTML = `<span class="wl-payload-status">${status}</span>${analysisRow}`;
        }
        return;
    }

    badge.textContent = `${formatTokens(measurement.total)}${stale ? '*' : ''}`;
    footer?.setAttribute('title', stale
        ? 'Controls, context, or model changed. The value will refresh after the next message.'
        : 'Measured from the last narrative request using SillyTavern’s active tokenizer.');

    if (!breakdown) return;
    const rows = [];
    if (stale) {
        rows.push('<span class="wl-payload-status">Changed since last request · refreshes next message</span>');
    }
    for (const category of CATEGORY_ORDER[mode] || []) {
        const tokens = measurement.categories[category] || 0;
        if (tokens > 0) {
            const rowTitle = mode === PRESET_MODES.PLUM_BLOSSOM && category === 'Analysis'
                ? 'Native analysis instructions included in this story total.'
                : '';
            rows.push(`<span class="wl-payload-row"${rowTitle ? ` title="${rowTitle}"` : ''}><span>${category}</span><span>${formatTokens(tokens)}</span></span>`);
        }
    }
    if (analysisRow) rows.push(analysisRow);
    breakdown.innerHTML = rows.join('');
}

export function initPayloadCounter(activeModeGetter, updateCallback) {
    getActiveMode = typeof activeModeGetter === 'function' ? activeModeGetter : getActiveMode;
    onUpdated = typeof updateCallback === 'function' ? updateCallback : onUpdated;
    if (initialized) return;
    initialized = true;

    if (!installPromptCollectionObserver()) return;
    eventSource.on(event_types.GENERATION_AFTER_COMMANDS, startGeneration);
    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, handlePromptReady);
    eventSource.on(event_types.CHAT_CHANGED, markContextChanged);

    for (const eventType of [
        event_types.OAI_PRESET_CHANGED_AFTER,
        event_types.CHATCOMPLETION_SOURCE_CHANGED,
        event_types.CHATCOMPLETION_MODEL_CHANGED,
    ]) {
        if (eventType) eventSource.on(eventType, markContextChanged);
    }

    for (const eventType of [
        event_types.CONNECTION_PROFILE_LOADED,
        event_types.CONNECTION_PROFILE_UPDATED,
        event_types.CONNECTION_PROFILE_DELETED,
    ]) {
        if (eventType) eventSource.on(eventType, onUpdated);
    }
}
