// Embedded identity shared by bundled presets and the extension.

export const PRESET_METADATA_KEY = 'mokimoko_preset';
export const PRESET_SCHEMA_VERSION = 1;

export const PRESET_IDS = Object.freeze({
    WHITE_LOTUS: 'white-lotus',
    PLUM_BLOSSOM: 'plum-blossom',
});

/** Stable ST preset names. ST also uses these names for the JSON filenames. */
export const PRESET_NAMES = Object.freeze({
    WHITE_LOTUS: '·༻· 𝑊ℎ𝑖𝑡𝑒 𝐿𝑜𝑡𝑢𝑠 ﹒ ᴍᴏᴏɴʟɪᴛ ꜱᴜᴛʀᴀ ·༺·',
    PLUM_BLOSSOM: '❀。𝑃𝑙𝑢𝑚 𝐵𝑙𝑜𝑠𝑠𝑜𝑚 ﹒ ꜱᴘʀɪɴɢ ᴘᴀᴠɪʟɪᴏɴ ❀°',
});

/** Compare preset names without depending on an OS's Unicode normalization. */
export function presetNamesEqual(left, right) {
    return String(left || '').normalize('NFC') === String(right || '').normalize('NFC');
}

/** Read and validate the extension-owned metadata stored inside a preset. */
export function getPresetMetadata(preset) {
    const raw = preset?.extensions?.[PRESET_METADATA_KEY];
    if (!raw || typeof raw !== 'object') return null;

    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const version = typeof raw.version === 'string' ? raw.version.trim() : '';
    const schema = Number(raw.schema);
    if (!id || !isSemanticVersion(version) || !Number.isInteger(schema) || schema < 1) {
        return null;
    }
    return { id, version, schema };
}

export function isSemanticVersion(version) {
    return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(version || ''));
}

/** Read a semantic version embedded in a legacy preset name. */
export function getSemanticVersionFromName(name) {
    const match = String(name || '').match(/(?:^|[^0-9])(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?=$|[^0-9A-Za-z.-])/);
    return match?.[1] || null;
}

/** Compare semver strings. Returns -1, 0, or 1. */
export function compareSemanticVersions(left, right) {
    const a = parseSemanticVersion(left);
    const b = parseSemanticVersion(right);
    if (!a || !b) return null;

    for (let i = 0; i < 3; i++) {
        if (a.parts[i] !== b.parts[i]) return a.parts[i] < b.parts[i] ? -1 : 1;
    }
    if (a.prerelease === b.prerelease) return 0;
    if (!a.prerelease) return 1;
    if (!b.prerelease) return -1;

    const aIds = a.prerelease.split('.');
    const bIds = b.prerelease.split('.');
    for (let index = 0; index < Math.max(aIds.length, bIds.length); index++) {
        if (aIds[index] === undefined) return -1;
        if (bIds[index] === undefined) return 1;
        if (aIds[index] === bIds[index]) continue;

        const aNumeric = /^\d+$/.test(aIds[index]);
        const bNumeric = /^\d+$/.test(bIds[index]);
        if (aNumeric && bNumeric) return Number(aIds[index]) < Number(bIds[index]) ? -1 : 1;
        if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
        return aIds[index] < bIds[index] ? -1 : 1;
    }
    return 0;
}

function parseSemanticVersion(version) {
    const match = String(version || '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
    if (!match) return null;
    return {
        parts: [Number(match[1]), Number(match[2]), Number(match[3])],
        prerelease: match[4] || '',
    };
}
