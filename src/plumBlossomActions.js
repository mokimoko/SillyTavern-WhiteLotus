// Chat-local maintenance actions for Plum Blossom's Inspector.

import { chat_metadata, saveChatConditional, saveSettingsDebounced } from '../../../../../script.js';
import { getContext, saveMetadataDebounced } from '../../../../extensions.js';
import { setPromptEnabled } from './presetBridge.js';

const ANALYSIS_BLOCK_RE = /<analyze(?:\s[^<>]*?)?>[\s\S]*?<\/analyze\s*>/gi;

export const PB_NATIVE_ACTION_PROMPT_IDS = Object.freeze([
    'pb_t_rerun_auto_author',
    'pb_t_reset_all_state',
]);

const STORY_KEYS = Object.freeze([
    'pb_phase_establishment',
    'pb_state_setting_period',
    'pb_state_reality',
    'pb_state_tradition',
    'pb_state_period',
    'pb_state_wuxia',
    'pb_state_transmigration',
    'pb_state_fantasy',
    'pb_state_scenario',
    'pb_state_story_tone',
    'pb_state_estab_prompted',
    'pb_state_estab_seen_once',
    'pb_state_estab_stalled',
    'pb_stage_rerun',
    'pb_stage_phase',
    'pb_stage_setting_period',
    'pb_stage_reality',
    'pb_stage_tradition',
    'pb_stage_period',
    'pb_stage_wuxia',
    'pb_stage_transmigration',
    'pb_stage_fantasy',
    'pb_stage_scenario',
    'pb_stage_story_tone',
    'pb_gate_rerun_now',
    'pb_gate_basic_ready',
    'pb_gate_genre_ready',
]);

const RELATIONSHIP_KEYS = Object.freeze([
    'pb_state_relationship_character',
    'pb_state_attraction',
    'pb_state_familiarity',
    'pb_state_alignment',
    'pb_state_bond',
    'pb_state_focus_candidate',
    'pb_stage_relationship_character',
    'pb_stage_attraction',
    'pb_stage_familiarity',
    'pb_stage_alignment',
    'pb_stage_bond',
    'pb_stage_rebuild_relationship',
    'pb_gate_rebuild_relationship_now',
    'pb_gate_focus_relationship_ready',
    'pb_gate_focus_record_ready',
]);

const FOCUS_KEYS = Object.freeze([
    'pb_phase_focus',
    'pb_state_focus',
    'pb_state_focus_candidate',
    'pb_state_profile_character',
    'pb_state_age_relation',
    'pb_state_height_relation',
    'pb_state_anatomy',
    'pb_state_status_character',
    'pb_state_focus_present',
    'pb_state_impaired',
    'pb_state_injured',
    'pb_state_focus_prompted',
    'pb_state_focus_seen_once',
    'pb_state_focus_stalled',
    'pb_stage_focus',
    'pb_stage_focus_change',
    'pb_stage_focus_change_seen',
    'pb_stage_focus_agenda_collision',
    'pb_stage_age_relation',
    'pb_stage_height_relation',
    'pb_stage_anatomy',
    'pb_stage_status_character',
    'pb_stage_present',
    'pb_stage_present_seen',
    'pb_stage_impaired',
    'pb_stage_impaired_seen',
    'pb_stage_injured',
    'pb_stage_injured_seen',
    'pb_stage_rebuild_focus',
    'pb_gate_rebuild_focus_now',
    ...RELATIONSHIP_KEYS,
]);

function getVariableStore() {
    const context = getContext();
    if (chat_metadata) {
        chat_metadata.variables ??= {};
        return chat_metadata.variables;
    }
    if (context?.chatMetadata) {
        context.chatMetadata.variables ??= {};
        return context.chatMetadata.variables;
    }
    if (context?.chat_metadata) {
        context.chat_metadata.variables ??= {};
        return context.chat_metadata.variables;
    }
    return null;
}

async function persistVariables() {
    const context = getContext();
    if (typeof context?.saveMetadata === 'function') {
        await context.saveMetadata();
    } else {
        saveMetadataDebounced();
    }
}

async function replaceVariables(keys, replacements = {}) {
    const store = getVariableStore();
    if (!store) return 0;

    let removed = 0;
    for (const key of new Set(keys)) {
        if (!Object.hasOwn(store, key)) continue;
        delete store[key];
        removed++;
    }
    Object.assign(store, replacements);
    await persistVariables();
    return removed;
}

/** Re-run story establishment without disturbing Focus, relationship, or scene state. */
export async function rerunPlumEstablishment() {
    const removed = await replaceVariables(STORY_KEYS, { pb_phase_establishment: 'basic' });
    return { removed };
}

/** Clear the current Focus's profile, status, and relationship tracking. */
export async function rebuildPlumFocus() {
    const removed = await replaceVariables(FOCUS_KEYS, {
        pb_phase_focus: 'select',
        pb_state_focus: 'none',
    });
    return { removed };
}

/** Clear relationship tracking while preserving the accepted Focus and status. */
export async function rebuildPlumRelationship() {
    const removed = await replaceVariables(RELATIONSHIP_KEYS);
    return { removed };
}

/** Remove every PB-owned chat variable; the preset initializes fresh state next turn. */
export async function resetAllPlumState() {
    const store = getVariableStore();
    const keys = store ? Object.keys(store).filter(key => key.startsWith('pb_')) : [];
    const removed = await replaceVariables(keys);
    return { removed };
}

function countAnalysisBlocks(text) {
    if (typeof text !== 'string') return 0;
    return text.match(ANALYSIS_BLOCK_RE)?.length || 0;
}

function cleanAnalysisBlocks(text) {
    if (typeof text !== 'string') return text;
    return text
        .replace(ANALYSIS_BLOCK_RE, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function getMessageVersions(message) {
    if (!Array.isArray(message?.swipes) || message.swipes.length === 0) {
        return typeof message?.mes === 'string' ? [message.mes] : [];
    }

    const versions = message.swipes.filter(value => typeof value === 'string');
    const swipeId = Number.isInteger(message.swipe_id) ? message.swipe_id : 0;
    if (typeof message.mes === 'string' && message.mes !== message.swipes[swipeId]) {
        versions.push(message.mes);
    }
    return versions;
}

/** Count complete analysis blocks across all messages and stored swipe alternatives. */
export function scanPlumAnalysisBlocks() {
    const chat = getContext()?.chat;
    const result = { blockCount: 0, messageCount: 0, versionCount: 0 };
    if (!Array.isArray(chat)) return result;

    for (const message of chat) {
        let messageBlocks = 0;
        let messageVersions = 0;
        for (const version of getMessageVersions(message)) {
            const count = countAnalysisBlocks(version);
            if (!count) continue;
            messageBlocks += count;
            messageVersions++;
        }
        if (!messageBlocks) continue;
        result.blockCount += messageBlocks;
        result.messageCount++;
        result.versionCount += messageVersions;
    }
    return result;
}

function rerenderMessages(context, indices) {
    if (!indices.length || typeof context?.messageFormatting !== 'function') return;
    requestAnimationFrame(() => {
        for (const index of indices) {
            const message = context.chat?.[index];
            if (!message) continue;
            try {
                const html = context.messageFormatting(
                    message.mes,
                    message.name,
                    message.is_system,
                    message.is_user,
                    index,
                );
                globalThis.jQuery?.(`#chat .mes[mesid="${index}"] .mes_text`).html(html);
            } catch (error) {
                console.debug('[WhiteLotus] Plum analysis redraw skipped:', error);
            }
        }
    });
}

/** Permanently remove complete analysis blocks from messages and every stored swipe. */
export async function removeAllPlumAnalysisBlocks() {
    const context = getContext();
    const chat = context?.chat;
    const scan = scanPlumAnalysisBlocks();
    if (!scan.blockCount || !Array.isArray(chat)) return scan;

    const rerender = [];
    for (let index = 0; index < chat.length; index++) {
        const message = chat[index];
        if (!message) continue;

        if (Array.isArray(message.swipes)) {
            for (let swipe = 0; swipe < message.swipes.length; swipe++) {
                const source = message.swipes[swipe];
                const cleaned = cleanAnalysisBlocks(source);
                if (cleaned !== source) message.swipes[swipe] = cleaned;
            }
        }

        const cleanedMessage = cleanAnalysisBlocks(message.mes);
        if (cleanedMessage !== message.mes) {
            message.mes = cleanedMessage;
            rerender.push(index);
        }

        // The selected swipe and live message are mirrors in SillyTavern.
        if (Array.isArray(message.swipes) && message.swipes.length > 0) {
            const swipeId = Number.isInteger(message.swipe_id) ? message.swipe_id : 0;
            if (typeof message.swipes[swipeId] === 'string' && message.mes !== message.swipes[swipeId]) {
                message.mes = message.swipes[swipeId];
                if (!rerender.includes(index)) rerender.push(index);
            }
        }
    }

    await saveChatConditional();
    rerenderMessages(context, rerender);
    return scan;
}

/** The extension owns these one-shot jobs while PB is active. */
export function syncNativePlumActions() {
    let changed = false;
    for (const id of PB_NATIVE_ACTION_PROMPT_IDS) {
        changed = setPromptEnabled(id, false) || changed;
    }
    if (changed) saveSettingsDebounced();
}
