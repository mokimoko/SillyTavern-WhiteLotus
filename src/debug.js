// Shared logging utility for SillyTavern-WhiteLotus.
// Created to back the createLogger() refactor that replaced the per-module
// inline console.log helpers.
//
// createLogger(tag?) returns { log, logWarn, logError }.
//   - log:      verbose/debug output, gated behind DEBUG (off by default)
//   - logWarn:  always shown
//   - logError: always shown
//
// Toggle verbose logging at runtime from the browser console:
//   window.WhiteLotusDebug = true;

const BASE_PREFIX = 'WhiteLotus';

function isDebugEnabled() {
    try {
        return typeof window !== 'undefined' && window.WhiteLotusDebug === true;
    } catch (e) {
        return false;
    }
}

export function createLogger(tag) {
    const prefix = tag ? `[${BASE_PREFIX}:${tag}]` : `[${BASE_PREFIX}]`;

    const log = (...args) => {
        if (isDebugEnabled()) {
            console.log(prefix, ...args);
        }
    };

    const logWarn = (...args) => {
        console.warn(prefix, ...args);
    };

    const logError = (...args) => {
        console.error(prefix, ...args);
    };

    return { log, logWarn, logError };
}
