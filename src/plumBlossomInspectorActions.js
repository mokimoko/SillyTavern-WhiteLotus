// Actions-tab UI for the Plum Blossom Inspector.

import { is_send_press } from '../../../../../script.js';
import {
    rebuildPlumFocus,
    rebuildPlumRelationship,
    removeAllPlumAnalysisBlocks,
    rerunPlumEstablishment,
    resetAllPlumState,
    scanPlumAnalysisBlocks,
} from './plumBlossomActions.js';
import { getActivePromptOrder } from './presetBridge.js';

let actionNotice = '';

function missingRequirements(requirements = []) {
    const enabled = new Set(getActivePromptOrder().filter(entry => entry.enabled).map(entry => entry.identifier));
    return requirements.filter(([id]) => !enabled.has(id)).map(([, label]) => label);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function actionCard({ icon, title, description, action, label, tone = '' }) {
    return `<article class="pb-debug-action-card"${tone ? ` data-tone="${tone}"` : ''}>
        <div class="pb-debug-action-icon"><i class="fa-solid ${icon}" aria-hidden="true"></i></div>
        <div class="pb-debug-action-copy"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(description)}</span></div>
        <button class="pb-debug-action-btn" data-pb-action="${action}">${escapeHtml(label)}</button>
    </article>`;
}

export function renderPlumActionsTab(snapshot) {
    const analysis = scanPlumAnalysisBlocks();
    const variableCount = Object.keys(snapshot.variables).length;
    const analysisSummary = analysis.blockCount
        ? `${analysis.blockCount} complete block${analysis.blockCount === 1 ? '' : 's'} in ${analysis.messageCount} message${analysis.messageCount === 1 ? '' : 's'} (${analysis.versionCount} stored version${analysis.versionCount === 1 ? '' : 's'}).`
        : 'No complete <analyze> blocks found in this chat.';
    return `<div class="pb-debug-actions-intro">
        <div><span>Chat-local maintenance</span><strong>Rebuild only what needs rebuilding.</strong></div>
        <p>State actions do not edit chat messages. Analysis cleanup does not change PB state, so it can be run independently.</p>
    </div>
    ${actionNotice ? `<div class="pb-debug-action-notice" role="status">${escapeHtml(actionNotice)}</div>` : ''}
    <section class="pb-debug-action-group">
        <h3>Targeted rebuilds</h3>
        <div class="pb-debug-action-grid">
            ${actionCard({ icon: 'fa-seedling', title: 'Re-run Establishment', description: 'Clear story classification and Auto-Author setup. Focus, relationship, and scene state stay intact.', action: 'establishment', label: 'Re-run' })}
            ${actionCard({ icon: 'fa-user-pen', title: 'Rebuild Focus', description: 'Clear the Focus profile, status, and relationship so PB selects and rebuilds them from chat history.', action: 'focus', label: 'Rebuild' })}
            ${actionCard({ icon: 'fa-heart-circle-bolt', title: 'Rebuild Relationship', description: 'Keep the accepted Focus and status, but rebuild relationship ownership and values from history.', action: 'relationship', label: 'Rebuild' })}
        </div>
    </section>
    <section class="pb-debug-action-group pb-debug-action-danger-zone">
        <h3>Reset & cleanup</h3>
        <div class="pb-debug-action-grid">
            ${actionCard({ icon: 'fa-arrow-rotate-left', title: 'Reset All State', description: `Remove all ${variableCount} PB variable${variableCount === 1 ? '' : 's'} from this chat. Messages and analysis blocks remain.`, action: 'reset', label: 'Reset State', tone: 'danger' })}
            ${actionCard({ icon: 'fa-broom', title: 'Remove Analysis Blocks', description: analysisSummary, action: 'clean-analysis', label: 'Clean Chat', tone: 'danger' })}
        </div>
    </section>`;
}

const ACTIONS = Object.freeze({
    establishment: {
        confirm: 'Re-run Plum Blossom establishment for this chat? Focus, relationship, and scene state will be preserved.',
        requirements: [['pb_t_analysis', 'Scene Analysis'], ['pb_t_establishment', 'Auto-Author']],
        run: rerunPlumEstablishment,
        success: 'Establishment cleared. PB will rebuild it on the next generation.',
    },
    focus: {
        confirm: 'Rebuild Focus for this chat? The current Focus profile, status, and relationship will be cleared.',
        requirements: [['pb_t_analysis', 'Scene Analysis']],
        run: rebuildPlumFocus,
        success: 'Focus state cleared. PB will rebuild it on the next generation.',
    },
    relationship: {
        confirm: 'Rebuild the current Focus relationship? Focus identity and status will be preserved.',
        requirements: [['pb_t_analysis', 'Scene Analysis'], ['pb_t_relationships', 'Handle Relationships']],
        run: rebuildPlumRelationship,
        success: 'Relationship state cleared. PB will rebuild it on the next generation.',
    },
    reset: {
        confirm: 'Reset all Plum Blossom state in this chat? This removes every PB variable but leaves messages and <analyze> blocks intact.',
        run: resetAllPlumState,
        success: 'All Plum Blossom state was reset for this chat.',
    },
    'clean-analysis': {
        confirm: 'Permanently remove every complete <analyze> block from all messages and stored swipes in this chat? PB state will be preserved.',
        run: removeAllPlumAnalysisBlocks,
        success: result => result.blockCount
            ? `Removed ${result.blockCount} analysis block${result.blockCount === 1 ? '' : 's'} from ${result.messageCount} message${result.messageCount === 1 ? '' : 's'}.`
            : 'No complete analysis blocks were found.',
    },
});

async function runInspectorAction(actionName, overlay, refresh) {
    const action = ACTIONS[actionName];
    if (!action) return;

    if (is_send_press) {
        actionNotice = 'Wait for the current generation to finish before changing PB state or chat history.';
        globalThis.toastr?.info(actionNotice, 'Plum Blossom');
        refresh();
        return;
    }

    const missing = missingRequirements(action.requirements);
    if (missing.length) {
        actionNotice = `Enable ${missing.join(' and ')} in the sidebar before running this rebuild.`;
        globalThis.toastr?.info(actionNotice, 'Plum Blossom');
        refresh();
        return;
    }
    if (!window.confirm(action.confirm)) return;

    const buttons = [...overlay.querySelectorAll('[data-pb-action]')];
    buttons.forEach(button => { button.disabled = true; });
    try {
        const result = await action.run();
        actionNotice = typeof action.success === 'function' ? action.success(result) : action.success;
        globalThis.toastr?.success(actionNotice, 'Plum Blossom');
    } catch (error) {
        console.error('[WhiteLotus] Plum Blossom Inspector action failed:', error);
        actionNotice = 'The action could not be completed. Check the console for details.';
        globalThis.toastr?.error(actionNotice, 'Plum Blossom');
    }
    refresh();
}

export function wirePlumActionsTab(overlay, refresh) {
    overlay.querySelectorAll('[data-pb-action]').forEach(button => button.addEventListener('click', () => {
        runInspectorAction(button.dataset.pbAction, overlay, refresh);
    }));
}

export function resetPlumActionNotice() {
    actionNotice = '';
}
