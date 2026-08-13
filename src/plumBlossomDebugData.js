// Reads Plum Blossom's chat-local machine variables for the extension inspector.

import { chat_metadata } from '../../../../../script.js';
import { getContext } from '../../../../extensions.js';

const ANALYSIS_BLOCK_RE = /<analyze>[\s\S]*?<\/analyze>/gi;

export const COMPARISON_GROUPS = Object.freeze([
    {
        label: 'Story establishment',
        rows: [
            ['Phase', 'pb_phase_establishment', 'pb_stage_phase'],
            ['Setting period', 'pb_state_setting_period', 'pb_stage_setting_period'],
            ['Reality', 'pb_state_reality', 'pb_stage_reality'],
            ['Tradition', 'pb_state_tradition', 'pb_stage_tradition'],
            ['Era', 'pb_state_period', 'pb_stage_period'],
            ['Wuxia / xianxia', 'pb_state_wuxia', 'pb_stage_wuxia'],
            ['Transmigration', 'pb_state_transmigration', 'pb_stage_transmigration'],
            ['Fantasy', 'pb_state_fantasy', 'pb_stage_fantasy'],
            ['Scenario', 'pb_state_scenario', 'pb_stage_scenario'],
            ['Story tone', 'pb_state_story_tone', 'pb_stage_story_tone'],
        ],
    },
    {
        label: 'Focus & relationship',
        rows: [
            ['Focus', 'pb_state_focus', 'pb_stage_focus'],
            ['Focus candidate', 'pb_state_focus_candidate', 'pb_stage_focus'],
            ['Age relation', 'pb_state_age_relation', 'pb_stage_age_relation'],
            ['Height relation', 'pb_state_height_relation', 'pb_stage_height_relation'],
            ['Anatomy', 'pb_state_anatomy', 'pb_stage_anatomy'],
            ['Present', 'pb_state_focus_present', 'pb_stage_present'],
            ['Impaired', 'pb_state_impaired', 'pb_stage_impaired'],
            ['Injured', 'pb_state_injured', 'pb_stage_injured'],
            ['Attraction', 'pb_state_attraction', 'pb_stage_attraction'],
            ['Familiarity', 'pb_state_familiarity', 'pb_stage_familiarity'],
            ['Alignment', 'pb_state_alignment', 'pb_stage_alignment'],
            ['Bond', 'pb_state_bond', 'pb_stage_bond'],
        ],
    },
    {
        label: 'Scene routing',
        rows: [
            ['Tone', 'pb_state_tone', 'pb_stage_tone'],
            ['Violence', 'pb_state_violence', 'pb_stage_violence'],
            ['NSFW', 'pb_state_nsfw', 'pb_stage_nsfw'],
            ['Emotional', 'pb_state_emotional', 'pb_stage_emotional'],
            ['Scene driver', 'pb_state_scene_driver', 'pb_stage_scene_driver'],
            ['Agenda 1', 'pb_state_prominent_1', 'pb_stage_agenda_1'],
            ['Agenda 2', 'pb_state_prominent_2', 'pb_stage_agenda_2'],
            ['Scene memory', 'pb_state_scene_memory', 'pb_stage_scene_memory'],
        ],
    },
]);

export const DIAGNOSTIC_GROUPS = Object.freeze([
    {
        label: 'Focus gates',
        keys: [
            ['Record ready', 'pb_gate_focus_record_ready'],
            ['Same focus', 'pb_gate_focus_same'],
            ['Candidate pending', 'pb_gate_focus_candidate_pending'],
            ['Install ready', 'pb_gate_focus_install_ready'],
            ['None ready', 'pb_gate_focus_none_ready'],
            ['Focus changed', 'pb_gate_focus_changed'],
            ['Mismatch', 'pb_gate_focus_mismatch'],
            ['Watch OK', 'pb_gate_focus_watch_ok'],
        ],
    },
    {
        label: 'Progress watches',
        keys: [
            ['Establishment prompted', 'pb_state_estab_prompted'],
            ['Establishment seen once', 'pb_state_estab_seen_once'],
            ['Establishment stalled', 'pb_state_estab_stalled'],
            ['Focus prompted', 'pb_state_focus_prompted'],
            ['Focus seen once', 'pb_state_focus_seen_once'],
            ['Focus stalled', 'pb_state_focus_stalled'],
            ['Scene ready', 'pb_gate_scene_ready'],
            ['Modules ready', 'pb_gate_modules_ready'],
        ],
    },
    {
        label: 'Rebuild & rerun',
        keys: [
            ['Rebuild focus now', 'pb_gate_rebuild_focus_now'],
            ['Rebuild relationship now', 'pb_gate_rebuild_relationship_now'],
            ['Staged focus rebuild', 'pb_stage_rebuild_focus'],
            ['Staged relationship rebuild', 'pb_stage_rebuild_relationship'],
            ['Auto-author request', 'pb_cfg_auto_author_rerun'],
            ['Auto-author latched', 'pb_state_auto_author_rerun_latched'],
            ['Staged story rebuild', 'pb_stage_rerun'],
            ['Role collision', 'pb_stage_focus_agenda_collision'],
        ],
    },
    {
        label: 'Author routing',
        keys: [
            ['Family', 'pb_tmp_family'],
            ['Refinement', 'pb_tmp_refine'],
            ['Selection', 'pb_tmp_pick'],
            ['Author prompt ready', 'pb_tmp_author'],
            ['Narrator mode', 'pb_cfg_narrator_mode'],
            ['Active module names', 'pb_out_module_names'],
        ],
    },
]);

function getVariableStore(context) {
    return chat_metadata?.variables
        || context?.chatMetadata?.variables
        || context?.chat_metadata?.variables
        || globalThis.chat_metadata?.variables
        || {};
}

function getCurrentAssistantMessage(context) {
    const chat = Array.isArray(context?.chat) ? context.chat : [];
    for (let index = chat.length - 1; index >= 0; index--) {
        const message = chat[index];
        if (!message?.is_user && !message?.is_system) {
            const swipeId = message.swipe_id ?? 0;
            const text = Array.isArray(message.swipes) && message.swipes[swipeId] != null
                ? message.swipes[swipeId]
                : message.mes;
            return { index, swipeId, text: String(text || '') };
        }
    }
    return null;
}

function getCurrentAnalysis(message) {
    const matches = [...String(message?.text || '').matchAll(ANALYSIS_BLOCK_RE)];
    return matches.length ? matches[matches.length - 1][0].trim() : '';
}

export function readPlumDebugSnapshot() {
    const context = getContext();
    const variables = Object.fromEntries(
        Object.entries(getVariableStore(context))
            .filter(([key]) => key.startsWith('pb_'))
            .sort(([a], [b]) => a.localeCompare(b)),
    );
    const message = getCurrentAssistantMessage(context);
    return {
        variables,
        message: message ? { index: message.index, swipeId: message.swipeId } : null,
        analysis: getCurrentAnalysis(message),
        capturedAt: new Date().toISOString(),
    };
}

export function debugValue(snapshot, key) {
    const value = snapshot?.variables?.[key];
    return value == null || String(value).trim() === '' ? '' : String(value);
}

export function getRawVariableGroups(snapshot) {
    const groups = { state: [], stage: [], gate: [], temporary: [], config: [], output: [], other: [] };
    for (const [key, value] of Object.entries(snapshot.variables)) {
        if (key.startsWith('pb_state_') || key.startsWith('pb_phase_')) groups.state.push([key, value]);
        else if (key.startsWith('pb_stage_')) groups.stage.push([key, value]);
        else if (key.startsWith('pb_gate_')) groups.gate.push([key, value]);
        else if (key.startsWith('pb_tmp_')) groups.temporary.push([key, value]);
        else if (key.startsWith('pb_cfg_')) groups.config.push([key, value]);
        else if (key.startsWith('pb_out_')) groups.output.push([key, value]);
        else groups.other.push([key, value]);
    }
    return groups;
}

export function buildPlumDebugExport(snapshot) {
    return JSON.stringify({
        type: 'plum-blossom-debug-snapshot',
        capturedAt: snapshot.capturedAt,
        message: snapshot.message,
        analysis: snapshot.analysis || null,
        variables: snapshot.variables,
    }, null, 2);
}
