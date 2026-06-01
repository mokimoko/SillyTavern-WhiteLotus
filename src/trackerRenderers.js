// src/trackerRenderers.js
// DOM overlay HTML builders for tracker display in sep-gen mode.
//
// Each builder parses raw bracket-tagged strings and returns styled HTML
// that visually matches the preset's regex replacement output.
// These are used by the overlay rendering system in utilitiesGen.js —
// they never touch msg.mes; they produce ephemeral DOM elements.

import { getSettings } from './settings.js';

const log = (...args) => console.log('[WL Renderers]', ...args);

// ============================================================
// Shared Constants
// ============================================================

/** CSS for the overlay wrapper — identifies it for cleanup */
const OVERLAY_CLASS = 'wl-tracker-overlay';

/** Weather → emoji map (replaces the CSS ::before pseudo-element approach
 *  from the Temporal regex, which used a <style> block that DOMPurify strips) */
const WEATHER_EMOJI = {
    sunny:  '☀️',
    clear:  '🌙',
    cloudy: '☁️',
    rainy:  '🌧️',
    stormy: '⛈️',
    snowy:  '❄️',
    foggy:  '🌫️',
    windy:  '💨',
};

// ============================================================
// Parsers — extract fields from raw bracket-tagged strings
// ============================================================

/**
 * Parse Status Board bracket blocks into fields.
 * Format (v2.1, multi-entry):
 *   [LOTUS|Name|HP|HNG|ENG|HYG|ARO|Mood|Location|Attire|Thought][/LOTUS]
 * One per character present in the scene.
 *
 * @param {string} raw - Full bracket-tagged string (may contain multiple entries)
 * @returns {object[]|null} Array of parsed field objects, or null if none found
 */
function parseLotus(raw) {
    const entries = [];

    // Strict: with closing tag — 10 fields: Name|HP|HNG|ENG|HYG|ARO|Mood|Location|Attire|Thought
    const reStrict = /\[LOTUS\|([^|]+?)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([\s\S]*?)\]\s*\[\/LOTUS\]/gis;
    let m;
    while ((m = reStrict.exec(raw)) !== null) {
        entries.push({
            name:    m[1].trim(),
            hp:      parseInt(m[2], 10),
            hunger:  parseInt(m[3], 10),
            energy:  parseInt(m[4], 10),
            hygiene: parseInt(m[5], 10),
            arousal: parseInt(m[6], 10),
            mood:    m[7].trim(),
            location: m[8].trim(),
            attire:  m[9].trim(),
            thought: m[10].trim().replace(/^\*|\*$/g, ''),
        });
    }

    // Fallback: no closing tag (LLM often omits it)
    if (entries.length === 0) {
        const reFallback = /\[LOTUS\|([^|]+?)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^\]]+?)\]/gi;
        while ((m = reFallback.exec(raw)) !== null) {
            entries.push({
                name:    m[1].trim(),
                hp:      parseInt(m[2], 10),
                hunger:  parseInt(m[3], 10),
                energy:  parseInt(m[4], 10),
                hygiene: parseInt(m[5], 10),
                arousal: parseInt(m[6], 10),
                mood:    m[7].trim(),
                location: m[8].trim(),
                attire:  m[9].trim(),
                thought: m[10].trim().replace(/^\*|\*$/g, ''),
            });
        }
        if (entries.length > 0) {
            log('parseLotus: used fallback regex (missing [/LOTUS] tags)');
        }
    }

    return entries.length > 0 ? entries : null;
}

/**
 * Parse a Temporal bracket block into fields.
 * Format: [TEMPORAL|Time|Weather|Location][/TEMPORAL]
 *
 * @param {string} raw - Full bracket-tagged string
 * @returns {object|null} Parsed fields or null if parse fails
 */
function parseTemporal(raw) {
    const re = /\[TEMPORAL\|([^|]+)\|([^|]+)\|([^\]]+)\](?:\s*(?:.*?)\s*\[\/TEMPORAL\])?/is;
    const m = raw.match(re);
    if (!m) {
        log('parseTemporal: no match');
        return null;
    }
    return {
        time:     m[1].trim(),
        weather:  m[2].trim(),
        location: m[3].trim(),
    };
}

/**
 * Parse RPS bracket blocks into fields.
 * Format: [RPS|CharName|HOS|INT|OBL|TRS|ATR][/RPS]
 *
 * @param {string} raw - Full bracket-tagged string (may contain multiple entries)
 * @returns {object[]|null} Array of parsed character entries, or null
 */
function parseRPS(raw) {
    const re = /\[RPS\|([^|]+)\|(\d+)\|(\d+)\|(\d+)\|(\d+)\|(\d+)\](?:\s*(?:.*?)\s*\[\/RPS\])?/gis;
    const entries = [];
    let m;
    while ((m = re.exec(raw)) !== null) {
        entries.push({
            name:       m[1].trim(),
            hostility:  parseInt(m[2], 10),
            interest:   parseInt(m[3], 10),
            obligation: parseInt(m[4], 10),
            trust:      parseInt(m[5], 10),
            attraction: parseInt(m[6], 10),
        });
    }
    return entries.length > 0 ? entries : null;
}

// ============================================================
// HTML Builders — produce styled HTML matching regex output
// ============================================================

/**
 * Build a stat bar span (shared by Lotus and RPS).
 * @param {string} label - Short label (e.g. 'HP', 'HOS')
 * @param {number} value - Current value
 * @param {string} color - Bar fill color
 * @param {number} max - Maximum value (100 for Lotus, 10 for RPS)
 */
function statBar(label, value, color, max = 100) {
    const pct = max === 10 ? `calc(${value} * 10%)` : `${value}%`;
    return `<span style="white-space:nowrap;">` +
        `<span style="opacity:0.55;font-size:0.85em;">${label}</span>` +
        `<span style="display:inline-block;width:42px;height:4px;margin:0 4px;border-radius:99px;vertical-align:middle;` +
        `background:linear-gradient(to right,${color} ${pct},rgba(255,255,255,0.14) 0);"></span>` +
        `${value}</span>`;
}

/**
 * Build Status Board overlay HTML for one or more characters.
 * Multi-entry: one collapsible card per character (like a stat snapshot).
 * Heading shows only the character name (no "Status Board" label).
 *
 * @param {string} raw - Raw [LOTUS|...][/LOTUS] string (possibly multiple)
 * @returns {string|null} HTML string or null if parse fails
 */
export function buildLotusOverlay(raw) {
    const entries = parseLotus(raw);
    if (!entries) return null;

    return entries.map(d => {
        return `<details class="${OVERLAY_CLASS}" data-wl-tracker="lotus" data-wl-lotus-name="${escAttr(d.name)}" open ` +
            `style="margin:8px 0;font-size:0.82em;opacity:0.86;font-family:'Inter','Segoe UI',sans-serif;">` +
            `<summary style="cursor:pointer;list-style:none;padding:8px 12px;border:1px solid rgba(255,255,255,0.12);border-radius:1px;` +
            `background:radial-gradient(circle at top left,rgba(250,177,160,0.10),transparent 35%),linear-gradient(135deg,rgba(255,255,255,0.045),rgba(255,255,255,0.015));` +
            `box-shadow:0 4px 18px rgba(0,0,0,0.18);">` +
                `<span style="color:#fab1a0;font-weight:700;">${escHtml(d.name)}</span>` +
            `</summary>` +
            `<div style="margin-top:4px;padding:10px 12px;line-height:1.45;border:1px solid rgba(255,255,255,0.10);border-top:none;border-radius:0 0 10px 10px;` +
            `background:linear-gradient(135deg,rgba(255,255,255,0.035),rgba(255,255,255,0.012));box-shadow:0 4px 18px rgba(0,0,0,0.14);">` +
                // Stat bars grid
                `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(92px,1fr));gap:6px 10px;margin:4px 0;font-family:monospace;">` +
                    statBar('HP',  d.hp,      '#ff7675') +
                    statBar('HNG', d.hunger,  '#c8a97e') +
                    statBar('ENG', d.energy,  '#7fa7b8') +
                    statBar('HYG', d.hygiene, '#6f93a3') +
                    statBar('ARO', d.arousal, '#9a7f88') +
                `</div>` +
                // Mood
                `<div style="margin-top:7px;"><b style="color:#fdcb6e;opacity:0.85;text-transform:uppercase;font-size:0.72em;letter-spacing:0.08em;">Mood</b> ${escHtml(d.mood)}</div>` +
                // Location
                `<div style="margin-top:5px;"><b style="color:#74b9ff;opacity:0.85;text-transform:uppercase;font-size:0.72em;letter-spacing:0.08em;">Location</b> ${escHtml(d.location)}</div>` +
                // Attire
                `<div style="margin-top:5px;"><b style="color:#81ecec;opacity:0.85;text-transform:uppercase;font-size:0.72em;letter-spacing:0.08em;">Attire</b> ${escHtml(d.attire)}</div>` +
                // Thought
                (d.thought
                    ? `<div style="margin-top:8px;padding:7px 9px;border-radius:8px;background:rgba(0,0,0,0.14);color:#dfe6e9;font-style:italic;opacity:0.88;">✦ ${escHtml(d.thought)}</div>`
                    : '') +
            `</div>` +
        `</details>`;
    }).join('\n');
}

/**
 * Build Temporal overlay HTML.
 * Inline emoji for weather instead of CSS ::before pseudo-elements.
 *
 * @param {string} raw - Raw [TEMPORAL|...][/TEMPORAL] string
 * @returns {string|null} HTML string or null if parse fails
 */
export function buildTemporalOverlay(raw) {
    const d = parseTemporal(raw);
    if (!d) return null;

    const emoji = WEATHER_EMOJI[d.weather.toLowerCase()] || '';

    return `<div class="${OVERLAY_CLASS}" data-wl-tracker="temporal" ` +
        `style="font-size:0.8em;opacity:0.75;margin:4px 0;border-left:2px solid rgba(255,255,255,0.2);padding-left:10px;` +
        `display:flex;align-items:center;gap:12px;flex-wrap:wrap;">` +
        `<b style="text-transform:uppercase;font-size:0.85em;opacity:0.6;">ENV</b>` +
        `<div style="display:flex;gap:12px;flex-wrap:wrap;font-family:monospace;">` +
            `<span title="Location">LOC <span style="opacity:0.9;color:#81ecec;">${escHtml(d.location)}</span></span>` +
            `<span title="Time">TIME <span style="opacity:0.9;color:#fdcb6e;">${escHtml(d.time)}</span></span>` +
            `<span title="Weather">WX <span style="opacity:0.9;color:#fab1a0;font-weight:bold;">${emoji}${escHtml(d.weather)}</span></span>` +
        `</div>` +
    `</div>`;
}

/**
 * Build RPS (Relationship) overlay HTML for one or more characters.
 *
 * @param {string} raw - Raw [RPS|...][/RPS] string (possibly multiple)
 * @returns {string|null} HTML string or null if parse fails
 */
export function buildRelationshipOverlay(raw) {
    const entries = parseRPS(raw);
    if (!entries) return null;

    const stats = [
        { key: 'hostility',  label: 'HOS', color: '#ff7675' },
        { key: 'interest',   label: 'INT', color: '#fdcb6e' },
        { key: 'obligation', label: 'OBL', color: '#81ecec' },
        { key: 'trust',      label: 'TRS', color: '#74b9ff' },
        { key: 'attraction', label: 'ATR', color: '#fab1a0' },
    ];

    return entries.map(entry => {
        const bars = stats.map(s =>
            `<span title="${capitalize(s.key)}">${s.label} ` +
            `<span style="display:inline-block;width:40px;height:3px;` +
            `background:linear-gradient(to right,${s.color} calc(${entry[s.key]} * 10%),rgba(255,255,255,0.15) 0);` +
            `vertical-align:middle;margin:0 4px;border-radius:2px;"></span> ${entry[s.key]}</span>`,
        ).join('\n    ');

        return `<div class="${OVERLAY_CLASS}" data-wl-tracker="rps" data-wl-rps-name="${escAttr(entry.name)}" ` +
            `style="font-size:0.8em;opacity:0.75;margin:4px 0;border-left:2px solid rgba(255,255,255,0.2);padding-left:10px;` +
            `display:flex;align-items:center;gap:12px;flex-wrap:wrap;">` +
            `<b style="text-transform:uppercase;font-size:0.85em;opacity:0.6;">${escHtml(entry.name)}</b>` +
            `<div style="display:flex;gap:12px;flex-wrap:wrap;font-family:monospace;">` +
                bars +
            `</div>` +
        `</div>`;
    }).join('\n');
}

// ============================================================
// Master Builder — routes raw tag string to the correct builder
// ============================================================

/** Map tracker setting keys to their builder functions */
const BUILDERS = {
    trackerLotusBoard:   buildLotusOverlay,
    trackerTemporal:     buildTemporalOverlay,
    trackerRelationship: buildRelationshipOverlay,
};

/**
 * Build overlay HTML for a custom user-defined tracker.
 * Strips wrapper tags, runs the user's regex find/replace, falls back to raw text.
 *
 * @param {string} rawTag - Raw bracket-tagged string from parser
 * @param {object} customDef - Custom tracker definition from settings
 * @returns {string|null} HTML string or null
 */
function buildCustomOverlay(rawTag, customDef) {
    const tag = customDef.tag;

    // Strip wrapper tags. Models often collapse content into a pipe-tag style
    // [TAG|content][/TAG] instead of the requested [TAG]content[/TAG] because
    // the surrounding built-in trackers all use pipe-in-tag format. We accept
    // both shapes so the user's regex operates on the same inner content
    // either way.
    let inner = rawTag;

    // Try bracket-style wrapper first: [TAG]content[/TAG]
    let wrapMatch = rawTag.match(new RegExp(`\\[${tag}\\]([\\s\\S]*?)\\[/${tag}\\]`, 'i'));

    // Fall back to pipe-style wrapper: [TAG|content][/TAG] (model variant)
    if (!wrapMatch) {
        wrapMatch = rawTag.match(new RegExp(`\\[${tag}\\|([\\s\\S]*?)\\]\\s*\\[/${tag}\\]`, 'i'));
    }

    if (wrapMatch) {
        inner = wrapMatch[1].trim();
    } else {
        // Final fallback: strip just an opening tag of either shape
        inner = rawTag.replace(new RegExp(`^\\[${tag}(?:\\|[^\\]]*)?\\]\\s*`, 'i'), '').trim();
    }

    if (!inner) return null;

    // Try user's regex find/replace
    if (customDef.regexFind) {
        try {
            const findRe = new RegExp(customDef.regexFind, 'gi');
            const replaced = inner.replace(findRe, customDef.regexReplace || '');
            if (replaced && replaced !== inner) {
                return `<div class="${OVERLAY_CLASS}" data-wl-tracker="custom" data-wl-custom-id="${escAttr(customDef.id)}">${replaced}</div>`;
            }
        } catch (e) {
            log(`Custom tracker regex error (${customDef.label}):`, e.message);
        }
    }

    // Fallback: raw text in a basic styled container
    return `<div class="${OVERLAY_CLASS}" data-wl-tracker="custom" data-wl-custom-id="${escAttr(customDef.id)}" ` +
        `style="margin:8px 0;font-size:0.82em;opacity:0.86;padding:8px 12px;border:1px solid rgba(255,255,255,0.10);` +
        `background:linear-gradient(135deg,rgba(255,255,255,0.035),rgba(255,255,255,0.012));font-family:monospace;">` +
        `<div style="font-size:0.72em;text-transform:uppercase;letter-spacing:0.08em;opacity:0.5;margin-bottom:4px;">${escHtml(customDef.label)}</div>` +
        `${escHtml(inner)}</div>`;
}

/**
 * Build overlay HTML for a tracker entry.
 * Routes built-in trackers to their dedicated builders,
 * custom trackers to the generic regex-based builder.
 *
 * @param {string} trackerKey - e.g. 'trackerLotusBoard' or 'custom_abc123'
 * @param {string} rawTag - Raw bracket-tagged string from parser
 * @returns {string|null} HTML string or null if key unknown / parse fails
 */
export function buildTrackerOverlay(trackerKey, rawTag) {
    // Built-in tracker
    const builder = BUILDERS[trackerKey];
    if (builder) return builder(rawTag);

    // Custom tracker — look up definition from settings
    if (trackerKey.startsWith('custom_')) {
        const settings = getSettings();
        const customId = trackerKey.slice(7);
        const customDef = (settings.customTrackers || []).find(ct => ct.id === customId);
        if (customDef) return buildCustomOverlay(rawTag, customDef);
    }

    log(`buildTrackerOverlay: no builder for key '${trackerKey}'`);
    return null;
}

/**
 * Build a combined overlay wrapper containing all active tracker displays.
 * @param {object} trackerData - { trackerLotusBoard: rawTag, trackerTemporal: rawTag, ... }
 * @returns {string|null} Combined HTML or null if no data rendered
 */
export function buildCombinedOverlay(trackerData) {
    const parts = [];

    for (const [key, rawTag] of Object.entries(trackerData)) {
        if (!rawTag) continue;
        const html = buildTrackerOverlay(key, rawTag);
        if (html) parts.push(html);
    }

    if (parts.length === 0) return null;

    return `<div class="${OVERLAY_CLASS}-wrapper" data-wl-tracker-group="true" ` +
        `style="margin-top:8px;border-top:1px solid rgba(255,255,255,0.06);padding-top:6px;">` +
        parts.join('\n') +
    `</div>`;
}

// ============================================================
// Exports for overlay class name (used by cleanup logic)
// ============================================================

export { OVERLAY_CLASS };

// ============================================================
// Utility helpers
// ============================================================

/** Escape HTML special characters */
function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Escape for use in HTML attribute values */
function escAttr(str) {
    return escHtml(str).replace(/'/g, '&#39;');
}

/** Capitalize first letter */
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
