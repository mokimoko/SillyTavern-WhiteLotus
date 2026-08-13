// Shared ownership-safe wrapper around SillyTavern's native generation lock.

import {
    is_send_press, setSendButtonState, activateSendButtons, deactivateSendButtons,
} from '../../../../../script.js';

/**
 * Hold the real send lock for a sidecar generation.
 * If the main generation still owns the lock, the returned release function
 * leaves that lock alone. Otherwise the sidecar acquires and releases it.
 */
export function acquireGenerationLock(onStop) {
    const alreadyLocked = !!is_send_press;
    if (!alreadyLocked) {
        setSendButtonState(true);
        deactivateSendButtons();
    }

    const handleStop = (event) => {
        if (!event.target.closest('#mes_stop, .mes_stop')) return;
        onStop?.();
    };
    document.addEventListener('click', handleStop, true);

    return () => {
        document.removeEventListener('click', handleStop, true);
        if (!alreadyLocked) activateSendButtons();
    };
}
