// Separate scene-analysis sidecar for Plum Blossom.
//
// PB still builds its native pb_tmp_analysis instructions. When its Analyze
// Scene delivery prompt is disabled, this module runs those instructions as a
// second, awaited generation instead of including them with narration.

import {
    chat_metadata, eventSource, event_types, generateRaw, getCharacterCardFields, saveChatConditional,
} from '../../../../../script.js';
import { getLocalVariable } from '../../../../variables.js';
import { getContext } from '../../../../extensions.js';
import { ConnectionManagerRequestService } from '../../../../extensions/shared.js';
import { getSettings } from './settings.js';
import { getActivePromptOrder } from './presetBridge.js';
import { acquireGenerationLock } from './generationLock.js';
import { createLogger } from './debug.js';
import { measurePlumAnalysisPayload } from './payloadCounter.js';

export const PB_ANALYSIS_PROMPT_ID = 'pb_t_analysis';
export const PB_ANALYZE_SCENE_PROMPT_ID = 'pb_analyze_scene';

const ANALYSIS_BLOCK_RE = /<analyze>[\s\S]*?<\/analyze>/gi;
const NATIVE_ANALYSIS_DELIVERY = 'In your reasoning, reserve the final step for <scene_analysis_instructions>.';
const CANDIDATE_TRANSIENT_KEYS = new Set([
    'pb_state_estab_prompted',
    'pb_state_estab_seen_once',
    'pb_state_estab_stalled',
    'pb_state_focus_prompted',
    'pb_state_focus_seen_once',
    'pb_state_focus_stalled',
]);
const { log, logWarn, logError } = createLogger('PlumAnalysis');

let isGenerating = false;
let isCancelled = false;
let messagesSinceLastAnalysis = 0;

function getPromptEnabled(identifier) {
    const entry = getActivePromptOrder().find(item => item.identifier === identifier);
    return entry ? !!entry.enabled : null;
}

export function isPlumSeparateAnalysisEnabled() {
    return !!getSettings().plumBlossomSeparateAnalysis
        && getPromptEnabled(PB_ANALYSIS_PROMPT_ID) === true
        && getPromptEnabled(PB_ANALYZE_SCENE_PROMPT_ID) === false;
}

function getPlumVariableStore() {
    const context = getContext();
    return chat_metadata?.variables
        || context?.chatMetadata?.variables
        || context?.chat_metadata?.variables
        || globalThis.chat_metadata?.variables
        || null;
}

function capturePlumMachineState() {
    const store = getPlumVariableStore();
    if (!store) return null;
    return {
        store,
        values: new Map(Object.entries(store).filter(([key]) => key.startsWith('pb_'))),
    };
}

function discardCurrentCandidate(state) {
    if (!state) return;
    for (const key of Object.keys(state.store)) {
        if (key.startsWith('pb_stage_') || CANDIDATE_TRANSIENT_KEYS.has(key)) {
            delete state.store[key];
        }
    }
}

function restorePlumMachineState(state, { keepCurrentStage = false, discardCandidate = false } = {}) {
    if (!state) return;

    for (const key of Object.keys(state.store)) {
        if (!key.startsWith('pb_')) continue;
        if (keepCurrentStage && key.startsWith('pb_stage_')) continue;
        delete state.store[key];
    }
    for (const [key, value] of state.values) {
        if (keepCurrentStage && key.startsWith('pb_stage_')) continue;
        if (discardCandidate && (key.startsWith('pb_stage_') || CANDIDATE_TRANSIENT_KEYS.has(key))) continue;
        state.store[key] = value;
    }
    if (discardCandidate) {
        for (const key of CANDIDATE_TRANSIENT_KEYS) delete state.store[key];
    }
}

function getTargetMessage() {
    const context = getContext();
    const chatLog = context?.chat;
    if (!Array.isArray(chatLog)) return null;

    for (let index = chatLog.length - 1; index >= 0; index--) {
        const message = chatLog[index];
        if (!message?.is_user && !message?.is_system) {
            return { context, chatLog, message, index, swipeId: message.swipe_id ?? 0 };
        }
    }
    return null;
}

function stripAnalysisBlocks(text) {
    return String(text || '').replace(ANALYSIS_BLOCK_RE, '').trim();
}

function getRecentConversation(depth) {
    const context = getContext();
    const chatLog = context?.chat || [];
    const recent = chatLog.slice(-Math.max(2, Number(depth || 2) * 2));

    return recent.map((message) => {
        if (message?.is_system) return '';
        const name = message?.is_user
            ? (context.name1 || 'User')
            : (context.name2 || 'Character');
        return `${name}: ${stripAnalysisBlocks(message?.mes)}`;
    }).filter(Boolean).join('\n\n');
}

function getStoryContext() {
    try {
        const card = getCharacterCardFields();
        const sections = [];
        if (card.description) sections.push(`Character:\n${card.description}`);
        if (card.personality) sections.push(`Personality:\n${card.personality}`);
        if (card.scenario) sections.push(`Scenario:\n${card.scenario}`);
        if (card.persona) sections.push(`User persona:\n${card.persona}`);
        return sections.join('\n\n');
    } catch (error) {
        logWarn('Could not read character context for analysis.', error);
        return '';
    }
}

function buildAnalysisPrompt(instructions) {
    const settings = getSettings();
    const conversation = getRecentConversation(settings.utilityScanDepth || 2);
    const storyContext = getStoryContext();
    return `You are Plum Blossom's scene-state analyzer. Read the conversation, then follow the supplied scene-analysis instructions exactly.

${storyContext ? `<story_context>\n${storyContext}\n</story_context>\n` : ''}

<conversation>
${conversation}
</conversation>

${instructions}

Output exactly one complete <analyze>...</analyze> block and nothing else.`;
}

function extractCompleteAnalysis(raw) {
    const matches = [...String(raw || '').matchAll(ANALYSIS_BLOCK_RE)];
    return matches.length ? matches[matches.length - 1][0].trim() : null;
}

function targetIsStillCurrent(target) {
    const context = getContext();
    const message = context?.chat?.[target.index];
    return message === target.message && (message?.swipe_id ?? 0) === target.swipeId;
}

async function appendAnalysis(target, analysis) {
    const message = target.message;
    const withoutOldAnalysis = String(message.mes || '')
        .replace(/\s*<analyze>[\s\S]*?<\/analyze>\s*$/i, '')
        .trimEnd();
    message.mes = `${withoutOldAnalysis}\n\n${analysis}`;

    if (Array.isArray(message.swipes) && target.swipeId < message.swipes.length) {
        message.swipes[target.swipeId] = message.mes;
    }

    // The raw block stays attached to this exact swipe. Re-rendering applies PB's
    // display regex; its prompt-only catchers stage the latest block next turn.
    await target.context.updateMessageBlock?.(target.index, message, { rerenderMessage: true });
}

async function requestAnalysis(prompt) {
    const settings = getSettings();
    let result = null;

    if (settings.utilityConnectionProfile) {
        const response = await ConnectionManagerRequestService.sendRequest(
            settings.utilityConnectionProfile,
            prompt,
            settings.utilityMaxTokens || 2000,
            { extractData: true, stream: false, includePreset: false, includeInstruct: false },
            { temperature: settings.utilityTemperature ?? 0.7 },
        );
        result = response?.content || '';
        if (!result) throw new Error('The selected analysis connection returned an empty response.');
    }

    if (!result) {
        result = await generateRaw({
            prompt,
            instructOverride: true,
            quietToLoud: false,
            systemPrompt: '',
            responseLength: settings.utilityMaxTokens || 2000,
            trimNames: true,
        });
    }
    return result;
}

/** Run PB analysis for the current assistant message. */
export async function executePlumAnalysis({ persistResult = true } = {}) {
    if (isGenerating || !isPlumSeparateAnalysisEnabled()) return false;

    const target = getTargetMessage();
    const machineState = capturePlumMachineState();
    // A rerun rejects the currently staged report just like a swipe does. The
    // replacement may stage fresh data, but committed PB state must wait for the
    // next real user turn.
    discardCurrentCandidate(machineState);
    const instructions = String(getLocalVariable('pb_tmp_analysis') || '').trim();
    const prompt = instructions.includes('<scene_analysis_instructions>')
        ? buildAnalysisPrompt(instructions)
        : null;
    if (!target || !prompt) {
        restorePlumMachineState(machineState);
        logWarn('Analysis instructions or target message are not available.');
        if (persistResult) {
            globalThis.toastr?.warning(
                'PB analysis instructions are not ready. Generate one narrated response with Scene Analysis and Separate scene analysis enabled, then try again.',
                'Plum Blossom',
            );
        }
        return false;
    }

    isGenerating = true;
    messagesSinceLastAnalysis = 0;
    isCancelled = false;
    const releaseLock = acquireGenerationLock(() => { isCancelled = true; });
    let analysisAttached = false;

    try {
        log(`Running separate scene analysis for message ${target.index}, swipe ${target.swipeId}.`);
        measurePlumAnalysisPayload(
            `${NATIVE_ANALYSIS_DELIVERY}\n\n${instructions}`,
            getSettings().utilityConnectionProfile || '',
        );
        const raw = await requestAnalysis(prompt);
        if (isCancelled) {
            globalThis.toastr?.info('Scene analysis cancelled.', 'Plum Blossom');
            return false;
        }
        if (!targetIsStillCurrent(target)) {
            logWarn('Target message changed before analysis completed; discarding the result.');
            return false;
        }

        const analysis = extractCompleteAnalysis(raw);
        if (!analysis) {
            globalThis.toastr?.warning('Scene analysis returned an incomplete result, so it was not saved.', 'Plum Blossom');
            return false;
        }

        // Raw/utility generation can emit the normal generation lifecycle. Roll
        // back any PB machine work it caused before staging the replacement.
        restorePlumMachineState(machineState, { discardCandidate: true });
        analysisAttached = true;
        await appendAnalysis(target, analysis);
        restorePlumMachineState(machineState, { keepCurrentStage: true, discardCandidate: true });
        if (persistResult) await saveChatConditional();
        log('Separate scene analysis complete.');
        return true;
    } catch (error) {
        logError('Separate scene analysis failed:', error);
        globalThis.toastr?.error('Scene analysis failed. Check the console for details.', 'Plum Blossom');
        return false;
    } finally {
        restorePlumMachineState(machineState, analysisAttached
            ? { keepCurrentStage: true, discardCandidate: true }
            : {});
        isGenerating = false;
        isCancelled = false;
        releaseLock();
    }
}

export function initPlumAnalysis(isPlumBlossomActive) {
    eventSource.on(event_types.MESSAGE_RECEIVED, async () => {
        if (!isPlumBlossomActive() || !isPlumSeparateAnalysisEnabled()) return;
        if (getLocalVariable('pb_run_assessment')) return;
        if (!getContext()?.chat?.some(message => message?.is_user)) return;

        const settings = getSettings();
        if (settings.plumBlossomAnalysisAutoRun === 'manual') return;
        if (settings.plumBlossomAnalysisAutoRun === 'every_n') {
            messagesSinceLastAnalysis++;
            if (messagesSinceLastAnalysis < (settings.plumBlossomAnalysisAutoRunInterval || 3)) return;
        }

        // The event is awaited by ST. Its normal post-message save persists both
        // the appended analysis and PB variables staged during re-render.
        await executePlumAnalysis({ persistResult: false });
    });

    eventSource.on(event_types.CHAT_CHANGED, () => {
        messagesSinceLastAnalysis = 0;
    });
}
