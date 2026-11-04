// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * CSS value parsing for Plauna's own style and layout passes.
 *
 * Plauna's GPU mode lays out and paints the element tree itself, so it reads
 * inline CSS text (what DOMRenderer and widgets write) and needs to turn it
 * into numbers: var() references, colours (including color-mix), lengths with
 * calc(), box shadows, linear gradients and 2D transforms.
 *
 * Colours parse through the engine's CSS colour parser; this module adds the
 * pieces it does not cover (var(), color-mix(), currentcolor).
 */

import { cssColorParseReport, CSS_SYSTEM_COLOR_KEYWORDS, CSS_DEPRECATED_SYSTEM_COLOR_MAP } from '../../../engine/core/math/MathColor.js';

const CACHE_LIMIT = 4096;

function cacheGet(cache, key) {
    return cache.get(key);
}

function cacheSet(cache, key, value) {
    if (cache.size >= CACHE_LIMIT) {
        cache.delete(cache.keys().next().value);
    }
    cache.set(key, value);
    return value;
}

// ── Tokenizing ──────────────────────────────────────────────────────────────

/** Split on a separator that is not inside parentheses or quotes. */
export function splitTopLevel(value, separator = ',') {
    const parts = [];
    let depth = 0;
    let quote = null;
    let start = 0;
    const text = String(value);
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quote) {
            if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '(') depth++;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        else if (depth === 0 && ch === separator) {
            parts.push(text.slice(start, i).trim());
            start = i + 1;
        }
    }
    parts.push(text.slice(start).trim());
    return parts.filter((part, index) => part !== '' || index < parts.length - 1);
}

/** Split on whitespace that is not inside parentheses. */
export function splitWhitespace(value) {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const ch of String(value).trim()) {
        if (ch === '(') depth++;
        if (ch === ')') depth = Math.max(0, depth - 1);
        if (depth === 0 && /\s/.test(ch)) {
            if (current) parts.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    if (current) parts.push(current);
    return parts;
}

/** Find the matching close paren for the open paren at `open`. */
function matchParen(text, open) {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        if (text[i] === '(') depth++;
        else if (text[i] === ')') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

// ── var() ───────────────────────────────────────────────────────────────────

/**
 * Replace var(--name, fallback) references. `lookup(name)` returns the custom
 * property's value or undefined. Unresolvable references with no fallback
 * make the whole value invalid (null), as in CSS.
 */
export function resolveVars(value, lookup, depth = 0) {
    if (value == null) return value;
    let text = String(value);
    if (!text.includes('var(')) return text;
    if (depth > 16) return null;
    let index = text.indexOf('var(');
    while (index !== -1) {
        const close = matchParen(text, index + 3);
        if (close === -1) return null;
        const inner = text.slice(index + 4, close);
        const comma = splitTopLevel(inner, ',');
        const name = comma[0].trim();
        const fallback = comma.length > 1 ? inner.slice(inner.indexOf(',') + 1).trim() : undefined;
        let replacement = lookup(name);
        if (replacement == null || String(replacement).trim() === '') {
            replacement = fallback;
        }
        if (replacement == null) return null;
        replacement = resolveVars(replacement, lookup, depth + 1);
        if (replacement == null) return null;
        text = text.slice(0, index) + replacement + text.slice(close + 1);
        index = text.indexOf('var(', index + replacement.length);
    }
    return text;
}

// ── Colours ─────────────────────────────────────────────────────────────────

const colorCache = new Map();
export const TRANSPARENT = Object.freeze([0, 0, 0, 0]);

// CSS system colours (Canvas, CanvasText, Highlight...) and their deprecated aliases
const SYSTEM_COLOR_NAMES = [...Object.keys(CSS_SYSTEM_COLOR_KEYWORDS), ...Object.keys(CSS_DEPRECATED_SYSTEM_COLOR_MAP)];
/** Matches a value that names a CSS system colour. */
export const SYSTEM_COLOR = new RegExp(`(?<![\\w-])(?:${SYSTEM_COLOR_NAMES.join('|')})(?![\\w-])`, 'i');

const systemColorTables = new Map();

/**
 * The browser's value of system colour `name` in the page's colour scheme
 * (and forced colours, when active), as [r, g, b, a], or null without a page.
 */
function systemColor(name) {
    if (typeof document === 'undefined' || !document.documentElement || typeof getComputedStyle === 'undefined') return null;
    const media = (query) => (typeof matchMedia === 'function' ? matchMedia(query).matches : false);
    const scheme = `${media('(forced-colors: active)')}|${media('(prefers-color-scheme: dark)')}|${getComputedStyle(document.documentElement).colorScheme}`;
    let table = systemColorTables.get(scheme);
    if (!table) {
        table = new Map();
        systemColorTables.set(scheme, table);
    }
    const key = name.toLowerCase();
    if (!table.has(key)) {
        const probe = document.createElement('span');
        probe.style.color = name;
        document.documentElement.appendChild(probe);
        const resolved = getComputedStyle(probe).color;
        probe.remove();
        table.set(key, resolved && !SYSTEM_COLOR.test(resolved) ? parseColor(resolved) : null);
    }
    const color = table.get(key);
    return color ? [...color] : null;
}

/**
 * Parse a CSS colour to straight-alpha [r, g, b, a] in 0..1, or null.
 * `currentColor` is the element's resolved colour for `currentcolor`.
 */
export function parseColor(value, currentColor = null) {
    if (value == null) return null;
    const text = String(value).trim();
    if (!text) return null;
    const lower = text.toLowerCase();
    if (lower === 'currentcolor') return currentColor ? [...currentColor] : null;
    if (lower === 'transparent') return [...TRANSPARENT];
    if (lower.startsWith('color-mix(')) return parseColorMix(text, currentColor);
    if (lower.includes('currentcolor')) return null;
    const cached = cacheGet(colorCache, text);
    if (cached !== undefined) return cached ? [...cached] : null;
    const report = cssColorParseReport(text);
    // A system colour has no value of its own: the browser's, in the page's scheme
    if (report.valid && !report.rgb) return report.syntax === 'system-color' ? systemColor(text) : null;
    const color = report.valid ? [report.rgb[0], report.rgb[1], report.rgb[2], report.alpha] : null;
    cacheSet(colorCache, text, color);
    return color ? [...color] : null;
}

// color-mix(in srgb, A p%, B q%) — sRGB interpolation with premultiplied alpha
function parseColorMix(text, currentColor) {
    const inner = text.slice(text.indexOf('(') + 1, text.lastIndexOf(')'));
    const parts = splitTopLevel(inner, ',');
    if (parts.length !== 3) return null;
    const space = parts[0].trim().toLowerCase();
    if (!space.startsWith('in ')) return null;
    const read = (part) => {
        const tokens = splitWhitespace(part);
        let pct = null;
        const colorTokens = [];
        for (const token of tokens) {
            if (/^-?[\d.]+%$/.test(token)) pct = parseFloat(token) / 100;
            else colorTokens.push(token);
        }
        return { color: parseColor(colorTokens.join(' '), currentColor), pct };
    };
    const a = read(parts[1]);
    const b = read(parts[2]);
    if (!a.color || !b.color) return null;
    let p1 = a.pct;
    let p2 = b.pct;
    if (p1 == null && p2 == null) { p1 = 0.5; p2 = 0.5; }
    else if (p1 == null) p1 = 1 - p2;
    else if (p2 == null) p2 = 1 - p1;
    const sum = p1 + p2;
    if (sum <= 0) return null;
    const alphaScale = Math.min(1, sum);
    p1 /= sum;
    p2 /= sum;
    const alpha = a.color[3] * p1 + b.color[3] * p2;
    const mixed = [0, 0, 0, alpha * alphaScale];
    for (let i = 0; i < 3; i++) {
        const premul = a.color[i] * a.color[3] * p1 + b.color[i] * b.color[3] * p2;
        mixed[i] = alpha > 0 ? premul / alpha : 0;
    }
    return mixed;
}

export function colorToCss(color) {
    if (!color) return 'transparent';
    const [r, g, b, a] = color;
    return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${+a.toFixed(4)})`;
}

// ── Lengths ─────────────────────────────────────────────────────────────────

/**
 * A length is { px, pct, em, rem, vw, vh } (any subset), the string 'auto',
 * or null when invalid. calc() with + - * / folds into one linear combination.
 */
const lengthCache = new Map();
const UNIT_RE = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px|%|em|rem|vw|vh|vmin|vmax|pt|ch|cqw|cqh|cqi|cqb|cqmin|cqmax)?$/i;

/**
 * The size a container query unit is a percentage of, on `axis` (width,
 * height, inline or block): `ctx.containerSize(axis)` gives the nearest
 * query container's (or the small viewport when there is none); a context
 * without it takes the small viewport, which is the viewport on a desktop
 * browser.
 */
function containerAxis(ctx, axis) {
    const size = typeof ctx.containerSize === 'function' ? ctx.containerSize(axis) : null;
    if (size != null) return size;
    return axis === 'height' || axis === 'block' ? (ctx.vh ?? 0) : (ctx.vw ?? 0);
}

export function parseLength(value) {
    if (value == null) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? { px: value } : null;
    const text = String(value).trim().toLowerCase();
    if (!text) return null;
    if (text === 'auto') return 'auto';
    const cached = cacheGet(lengthCache, text);
    if (cached !== undefined) return cached;
    let result = null;
    if (text.startsWith('calc(') || text.startsWith('min(') || text.startsWith('max(') || text.startsWith('clamp(')) {
        result = parseMathFunction(text);
    } else {
        result = parseUnitLength(text);
    }
    return cacheSet(lengthCache, text, result);
}

function parseUnitLength(text) {
    const match = UNIT_RE.exec(text);
    if (!match) return null;
    const number = parseFloat(match[1]);
    const unit = (match[2] || '').toLowerCase();
    if (!unit) return number === 0 ? { px: 0 } : { number };
    if (unit === 'px') return { px: number };
    if (unit === '%') return { pct: number };
    if (unit === 'pt') return { px: number * 4 / 3 };
    if (unit === 'ch') return { ch: number };
    if (unit === 'vmin' || unit === 'vmax') return { [unit]: number };
    return { [unit]: number };
}

function addLengths(a, b, sign = 1) {
    const out = { ...a };
    for (const [key, value] of Object.entries(b)) out[key] = (out[key] || 0) + sign * value;
    return out;
}

function scaleLength(a, factor) {
    const out = {};
    for (const [key, value] of Object.entries(a)) out[key] = value * factor;
    return out;
}

function isPlainNumber(length) {
    return length && Object.keys(length).length === 1 && 'number' in length;
}

// calc()/min()/max()/clamp(). min/max/clamp of mixed units keep the first
// argument's shape when they cannot be compared now (resolved later).
function parseMathFunction(text) {
    const open = text.indexOf('(');
    const name = text.slice(0, open);
    const close = matchParen(text, open);
    if (close !== text.length - 1) return null;
    const inner = text.slice(open + 1, close);
    if (name === 'calc') return parseCalcExpression(inner);
    const args = splitTopLevel(inner, ',').map(parseCalcExpression);
    if (args.some((arg) => !arg)) return null;
    return { [name]: args };
}

function parseCalcExpression(expression) {
    const tokens = [];
    const text = expression.trim();
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (/\s/.test(ch)) { i++; continue; }
        if (ch === '(') {
            const close = matchParen(text, i);
            if (close === -1) return null;
            const inner = parseCalcExpression(text.slice(i + 1, close));
            if (!inner) return null;
            tokens.push(inner);
            i = close + 1;
            continue;
        }
        if ('+-*/'.includes(ch) && !(ch === '-' && (tokens.length === 0 || typeof tokens[tokens.length - 1] === 'string') && /[\d.]/.test(text[i + 1] || ''))) {
            tokens.push(ch);
            i++;
            continue;
        }
        let j = i;
        while (j < text.length && !/\s/.test(text[j]) && !'()*/'.includes(text[j]) && !(j > i && '+'.includes(text[j]))) j++;
        const word = text.slice(i, j);
        const fn = /^[a-z]+$/.test(word) && text[j] === '(';
        if (fn) {
            const close = matchParen(text, j);
            if (close === -1) return null;
            const inner = parseLength(`${word}(${text.slice(j + 1, close)})`);
            if (!inner) return null;
            tokens.push(inner);
            i = close + 1;
            continue;
        }
        const length = parseUnitLength(word.toLowerCase());
        if (!length) return null;
        tokens.push(length);
        i = j;
    }
    // * and / first
    const terms = [];
    for (let k = 0; k < tokens.length; k++) {
        const token = tokens[k];
        if (token === '*' || token === '/') {
            const left = terms.pop();
            const right = tokens[++k];
            if (!left || !right || typeof right === 'string') return null;
            if (token === '*') {
                if (isPlainNumber(right)) terms.push(scaleLength(left, right.number));
                else if (isPlainNumber(left)) terms.push(scaleLength(right, left.number));
                else return null;
            } else {
                if (!isPlainNumber(right) || right.number === 0) return null;
                terms.push(scaleLength(left, 1 / right.number));
            }
        } else {
            terms.push(token);
        }
    }
    let result = null;
    let sign = 1;
    for (const term of terms) {
        if (term === '+') sign = 1;
        else if (term === '-') sign = -1;
        else {
            result = result ? addLengths(result, term, sign) : scaleLength(term, sign);
            sign = 1;
        }
    }
    return result;
}

/**
 * Resolve a parsed length to pixels. `ctx` has percentBase (null when the
 * percentage cannot resolve), fontSize, rootFontSize, vw, vh, and
 * containerSize(axis) for container query units.
 * Returns null when a percentage has no base.
 */
export function resolveLength(length, ctx = {}) {
    if (length == null || length === 'auto') return null;
    if (typeof length === 'number') return length;
    let total = 0;
    for (const [key, value] of Object.entries(length)) {
        switch (key) {
            case 'px': total += value; break;
            case 'number': total += value; break;
            case 'pct':
                if (ctx.percentBase == null) return null;
                total += value / 100 * ctx.percentBase;
                break;
            case 'em': total += value * (ctx.fontSize ?? 16); break;
            // The advance of '0' in the element's font; half an em without one
            case 'ch': total += value * (typeof ctx.chWidth === 'function' ? ctx.chWidth() : ctx.chWidth ?? (ctx.fontSize ?? 16) / 2); break;
            case 'rem': total += value * (ctx.rootFontSize ?? 16); break;
            case 'vw': total += value / 100 * (ctx.vw ?? 0); break;
            case 'vh': total += value / 100 * (ctx.vh ?? 0); break;
            case 'vmin': total += value / 100 * Math.min(ctx.vw ?? 0, ctx.vh ?? 0); break;
            case 'vmax': total += value / 100 * Math.max(ctx.vw ?? 0, ctx.vh ?? 0); break;
            // Container query units: of the nearest query container on their axis
            case 'cqw': total += value / 100 * containerAxis(ctx, 'width'); break;
            case 'cqh': total += value / 100 * containerAxis(ctx, 'height'); break;
            case 'cqi': total += value / 100 * containerAxis(ctx, 'inline'); break;
            case 'cqb': total += value / 100 * containerAxis(ctx, 'block'); break;
            case 'cqmin': total += value / 100 * Math.min(containerAxis(ctx, 'inline'), containerAxis(ctx, 'block')); break;
            case 'cqmax': total += value / 100 * Math.max(containerAxis(ctx, 'inline'), containerAxis(ctx, 'block')); break;
            case 'min':
            case 'max':
            case 'clamp': {
                const values = value.map((arg) => resolveLength(arg, ctx));
                if (values.some((v) => v == null)) return null;
                if (key === 'min') total += Math.min(...values);
                else if (key === 'max') total += Math.max(...values);
                else total += Math.min(Math.max(values[1], values[0]), values[2]);
                break;
            }
            default: break;
        }
    }
    return total;
}

/** True when the length depends on a percentage. */
export function hasPercent(length) {
    if (!length || length === 'auto' || typeof length !== 'object') return false;
    if ('pct' in length && length.pct !== 0) return true;
    for (const key of ['min', 'max', 'clamp']) {
        if (Array.isArray(length[key]) && length[key].some(hasPercent)) return true;
    }
    return false;
}

// ── Time ────────────────────────────────────────────────────────────────────

export function parseTime(value) {
    const match = /^(-?[\d.]+)(ms|s)$/i.exec(String(value).trim());
    if (!match) return 0;
    const n = parseFloat(match[1]);
    return match[2].toLowerCase() === 's' ? n * 1000 : n;
}

// ── Box shadows ─────────────────────────────────────────────────────────────

/** Parse a box-shadow list into [{ x, y, blur, spread, color, inset }]. */
export function parseBoxShadow(value, currentColor, lengthCtx = {}) {
    if (value == null) return [];
    const text = String(value).trim();
    if (!text || text === 'none') return [];
    const shadows = [];
    for (const part of splitTopLevel(text, ',')) {
        const tokens = splitWhitespace(part);
        let inset = false;
        const lengths = [];
        const colorTokens = [];
        for (const token of tokens) {
            if (token.toLowerCase() === 'inset') { inset = true; continue; }
            const length = /^[-\d.]/.test(token) || token.startsWith('calc(') ? parseLength(token) : null;
            if (length && length !== 'auto') lengths.push(resolveLength(length, lengthCtx) ?? 0);
            else colorTokens.push(token);
        }
        if (lengths.length < 2) continue;
        const color = colorTokens.length ? parseColor(colorTokens.join(' '), currentColor) : (currentColor ? [...currentColor] : [0, 0, 0, 1]);
        if (!color) continue;
        shadows.push({
            x: lengths[0],
            y: lengths[1],
            blur: Math.max(0, lengths[2] ?? 0),
            spread: lengths[3] ?? 0,
            color,
            inset
        });
    }
    return shadows;
}

/** drop-shadow(...) entries of a filter, as box-shadow-shaped records. */
export function parseDropShadowFilter(value, currentColor, lengthCtx = {}) {
    if (!value || value === 'none') return [];
    const shadows = [];
    let index = String(value).indexOf('drop-shadow(');
    const text = String(value);
    while (index !== -1) {
        const close = matchParen(text, index + 11);
        if (close === -1) break;
        const inner = text.slice(index + 12, close);
        shadows.push(...parseBoxShadow(inner, currentColor, lengthCtx));
        index = text.indexOf('drop-shadow(', close);
    }
    return shadows;
}

/**
 * The colour functions of a filter value (brightness, contrast, grayscale,
 * saturate, sepia, invert, hue-rotate, opacity) composed into one filter on
 * premultiplied colour: rgb' = k * (m * rgb + o * a), a' = k * a, with m a
 * row-major 3x3 matrix. null when there are none. Each function is linear in
 * premultiplied colour, so applying the result to every item of a subtree
 * equals filtering the subtree as a group.
 */
export function parseColorFilter(value) {
    const text = String(value || '').trim();
    if (!text || text === 'none') return null;
    let m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    let o = [0, 0, 0];
    let k = 1;
    let any = false;
    const pattern = /(brightness|contrast|grayscale|saturate|sepia|invert|hue-rotate|opacity)\(\s*([^)]*)\)/gi;
    let match;
    while ((match = pattern.exec(text))) {
        const name = match[1].toLowerCase();
        const arg = match[2].trim();
        const amount = (fallback) => {
            if (!arg) return fallback;
            return arg.endsWith('%') ? parseFloat(arg) / 100 : parseFloat(arg);
        };
        let fm = null;
        let fo = [0, 0, 0];
        let fk = 1;
        if (name === 'brightness') { const b = amount(1); fm = [b, 0, 0, 0, b, 0, 0, 0, b]; }
        else if (name === 'contrast') { const c = amount(1); fm = [c, 0, 0, 0, c, 0, 0, 0, c]; fo = Array(3).fill((1 - c) / 2); }
        else if (name === 'invert') { const a = Math.min(1, amount(1)); fm = [1 - 2 * a, 0, 0, 0, 1 - 2 * a, 0, 0, 0, 1 - 2 * a]; fo = [a, a, a]; }
        else if (name === 'opacity') { fk = Math.max(0, Math.min(1, amount(1))); fm = [1, 0, 0, 0, 1, 0, 0, 0, 1]; }
        else if (name === 'grayscale') {
            const a = 1 - Math.min(1, amount(1));
            fm = [0.2126 + 0.7874 * a, 0.7152 - 0.7152 * a, 0.0722 - 0.0722 * a,
                0.2126 - 0.2126 * a, 0.7152 + 0.2848 * a, 0.0722 - 0.0722 * a,
                0.2126 - 0.2126 * a, 0.7152 - 0.7152 * a, 0.0722 + 0.9278 * a];
        } else if (name === 'sepia') {
            const a = 1 - Math.min(1, amount(1));
            fm = [0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a,
                0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a,
                0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a];
        } else if (name === 'saturate') {
            const s = amount(1);
            fm = [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
                0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
                0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s];
        } else if (name === 'hue-rotate') {
            const t = (parseAngle(arg || '0') ?? 0) * Math.PI / 180;
            const c = Math.cos(t);
            const s = Math.sin(t);
            fm = [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
                0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
                0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072];
        }
        if (!fm) continue;
        any = true;
        // Apply after what came before: m = fm * m, o = fm * o + fo, k = fk * k
        const mul = (a, b) => [0, 1, 2].flatMap((r) => [0, 1, 2].map((col) => a[r * 3] * b[col] + a[r * 3 + 1] * b[3 + col] + a[r * 3 + 2] * b[6 + col]));
        o = [0, 1, 2].map((r) => fm[r * 3] * o[0] + fm[r * 3 + 1] * o[1] + fm[r * 3 + 2] * o[2] + fo[r]);
        m = mul(fm, m);
        k *= fk;
    }
    return any ? { m, o, k } : null;
}

/** The blur() radius of a filter value in px (0 when none). */
export function parseBlurFilter(value, lengthCtx = {}) {
    const match = /blur\(\s*([^)]*)\)/i.exec(String(value || ''));
    if (!match) return 0;
    const px = resolveLength(parseLength(match[1].trim() || '0px'), lengthCtx);
    return Math.max(0, px || 0);
}

// ── Gradients ───────────────────────────────────────────────────────────────

const SIDE_ANGLES = { 'to top': 0, 'to right': 90, 'to bottom': 180, 'to left': 270 };

// Corner keywords: the corner's side along x and y (y down). The angle
// depends on the box (linearGradientAngle); the layer's angle is a square's.
const CORNERS = {
    'to top right': [1, -1], 'to right top': [1, -1], 'to bottom right': [1, 1], 'to right bottom': [1, 1],
    'to bottom left': [-1, 1], 'to left bottom': [-1, 1], 'to top left': [-1, -1], 'to left top': [-1, -1]
};

function parseAngle(token) {
    const match = /^(-?[\d.]+)(deg|rad|turn|grad)?$/i.exec(String(token).trim());
    if (!match) return null;
    const n = parseFloat(match[1]);
    switch ((match[2] || 'deg').toLowerCase()) {
        case 'rad': return n * 180 / Math.PI;
        case 'turn': return n * 360;
        case 'grad': return n * 0.9;
        default: return n;
    }
}

// Colour stops: positions are fractions (0..1), { px } lengths, or for conic
// gradients angles as fractions of a turn; null positions are distributed later
function parseStops(args, currentColor, angular = false) {
    const stops = [];
    for (const arg of args) {
        const tokens = splitWhitespace(arg);
        const positions = [];
        const colorTokens = [];
        for (const token of tokens) {
            if (/^-?[\d.]+%$/.test(token)) positions.push(parseFloat(token) / 100);
            else if (!angular && /^-?[\d.]+px$/.test(token)) positions.push({ px: parseFloat(token) });
            else if (angular && /^-?[\d.]+(deg|rad|turn|grad)$/i.test(token)) positions.push(parseAngle(token) / 360);
            else colorTokens.push(token);
        }
        const color = parseColor(colorTokens.join(' '), currentColor);
        if (!color) continue;
        if (positions.length === 0) stops.push({ color, pos: null });
        for (const pos of positions) stops.push({ color, pos });
    }
    return stops;
}

const POSITION_KEYWORDS = { left: 0, center: 0.5, right: 1, top: 0, bottom: 1 };

/**
 * A <position> (gradient centre, background-position): { x, y } where each is
 * { pct } (0..1 of the free space or box) or { px }.
 */
export function parsePosition(text) {
    const tokens = splitWhitespace(String(text || '').trim()).filter(Boolean);
    const one = (token) => {
        const lower = token.toLowerCase();
        if (POSITION_KEYWORDS[lower] != null) return { pct: POSITION_KEYWORDS[lower] };
        if (/^-?[\d.]+%$/.test(token)) return { pct: parseFloat(token) / 100 };
        const px = parseFloat(token);
        return Number.isFinite(px) ? { px } : { pct: 0.5 };
    };
    if (!tokens.length) return { x: { pct: 0.5 }, y: { pct: 0.5 } };
    if (tokens.length === 1) {
        const lower = tokens[0].toLowerCase();
        if (lower === 'top' || lower === 'bottom') return { x: { pct: 0.5 }, y: one(tokens[0]) };
        return { x: one(tokens[0]), y: { pct: 0.5 } };
    }
    // Edge offsets: right 10px bottom 20px
    if (tokens.length >= 3) {
        const axis = (edge, offset) => {
            const v = one(offset);
            const far = edge === 'right' || edge === 'bottom';
            if ('pct' in v) return { pct: far ? 1 - v.pct : v.pct };
            return far ? { pct: 1, px: -v.px } : { px: v.px };
        };
        const [a, b, c, d] = tokens.map((t) => t.toLowerCase());
        const x = ['left', 'right'].includes(a) ? (POSITION_KEYWORDS[b] != null ? one(a) : axis(a, b)) : one(a);
        const yEdge = POSITION_KEYWORDS[b] != null && b !== a ? b : c;
        const yOffset = POSITION_KEYWORDS[b] != null && b !== a ? c : d;
        const y = yOffset && POSITION_KEYWORDS[yOffset] == null ? axis(yEdge, yOffset) : one(yEdge || 'center');
        return { x, y };
    }
    const [a, b] = tokens;
    if (['top', 'bottom'].includes(a.toLowerCase()) || ['left', 'right'].includes(b.toLowerCase())) return { x: one(b), y: one(a) };
    return { x: one(a), y: one(b) };
}

/** Resolve a parsed position axis against `free` px (box minus image). */
export function resolvePositionAxis(axis, free) {
    if (!axis) return free * 0.5;
    return (axis.pct != null ? axis.pct * free : 0) + (axis.px || 0);
}

const RADIAL_HEAD = /(^|\s)(circle|ellipse|closest-side|closest-corner|farthest-side|farthest-corner|at)(\s|$)/i;

// The colour space a gradient blends in, as CSS Images 4 sets it: Oklab,
// unless every colour is a legacy sRGB one (hex, named, rgb(), hsl(), hwb())
const NON_LEGACY_COLOR = /(^|[\s,(])(color|lab|lch|oklab|oklch|color-mix)\(/i;
const interpolationSpace = (args) => (args.some((arg) => NON_LEGACY_COLOR.test(arg)) ? 'oklab' : 'srgb');

function parseLinearArgs(args, repeating, currentColor) {
    let angle = 180;
    let first = 0;
    let corner = null;
    const head = args[0]?.trim().toLowerCase();
    if (head && SIDE_ANGLES[head] != null) { angle = SIDE_ANGLES[head]; first = 1; }
    else if (head && CORNERS[head]) { corner = CORNERS[head]; angle = linearGradientAngle({ angle, corner }, 1, 1); first = 1; }
    else if (head && parseAngle(head) != null) { angle = parseAngle(head); first = 1; }
    const stops = parseStops(args.slice(first), currentColor);
    if (!stops.length) return { type: 'none' };
    const space = interpolationSpace(args);
    return corner ? { type: 'linear', angle, corner, stops, repeating, space } : { type: 'linear', angle, stops, repeating, space };
}

/**
 * A linear gradient's angle (deg, CSS convention) in a width x height box.
 * A corner keyword points the line so that the other two corners share a
 * colour (its 50% line joins them), so the angle follows the box's aspect
 * ratio: to top right is atan(height / width).
 */
export function linearGradientAngle(layer, width, height) {
    if (!layer.corner) return layer.angle;
    const [sx, sy] = layer.corner;
    return Math.atan2(sx * height, -sy * width) * 180 / Math.PI;
}

function parseRadialArgs(args, repeating, currentColor) {
    let shape = null;
    let size = 'farthest-corner';
    let lengths = null;
    let at = { x: { pct: 0.5 }, y: { pct: 0.5 } };
    let first = 0;
    const head = args[0]?.trim() || '';
    const onlyLengths = splitWhitespace(head).every((t) => /^-?[\d.]+(px|%)?$/.test(t));
    if (RADIAL_HEAD.test(head) || (head && onlyLengths && !parseColor(head))) {
        first = 1;
        const tokens = splitWhitespace(head);
        const atIndex = tokens.findIndex((t) => t.toLowerCase() === 'at');
        const before = atIndex === -1 ? tokens : tokens.slice(0, atIndex);
        if (atIndex !== -1) at = parsePosition(tokens.slice(atIndex + 1).join(' '));
        const sized = [];
        for (const token of before) {
            const lower = token.toLowerCase();
            if (lower === 'circle' || lower === 'ellipse') shape = lower;
            else if (/^(closest|farthest)-(side|corner)$/.test(lower)) size = lower;
            else if (/^-?[\d.]+%$/.test(token)) sized.push({ pct: parseFloat(token) / 100 });
            else if (Number.isFinite(parseFloat(token))) sized.push({ px: parseFloat(token) });
        }
        if (sized.length) lengths = sized;
    }
    if (!shape) shape = lengths && lengths.length === 1 ? 'circle' : 'ellipse';
    const stops = parseStops(args.slice(first), currentColor);
    return stops.length ? { type: 'radial', shape, size, lengths, at, stops, repeating, space: interpolationSpace(args) } : { type: 'none' };
}

function parseConicArgs(args, repeating, currentColor) {
    let from = 0;
    let at = { x: { pct: 0.5 }, y: { pct: 0.5 } };
    let first = 0;
    const head = args[0]?.trim() || '';
    if (/(^|\s)(from|at)(\s|$)/i.test(head)) {
        first = 1;
        const tokens = splitWhitespace(head);
        const fromIndex = tokens.findIndex((t) => t.toLowerCase() === 'from');
        const atIndex = tokens.findIndex((t) => t.toLowerCase() === 'at');
        if (fromIndex !== -1) from = parseAngle(tokens[fromIndex + 1]) ?? 0;
        if (atIndex !== -1) at = parsePosition(tokens.slice(atIndex + 1, fromIndex > atIndex ? fromIndex : undefined).join(' '));
    }
    const stops = parseStops(args.slice(first), currentColor, true);
    return stops.length ? { type: 'conic', from, at, stops, repeating, space: interpolationSpace(args) } : { type: 'none' };
}

/**
 * Every layer of a background-image value, top layer first: { type:
 * 'linear' | 'radial' | 'conic' | 'url' | 'none', ... }. Layers that cannot
 * be shown stay as 'none' so per-layer size, position and repeat lists keep
 * their indices.
 */
export function parseBackgroundLayers(value, currentColor) {
    if (!value) return [];
    const text = String(value).trim();
    if (!text || text === 'none' || text === 'initial') return [];
    const out = [];
    for (const layer of splitLayers(text)) {
        const trimmed = layer.trim();
        const lower = trimmed.toLowerCase();
        if (lower.startsWith('url(')) {
            const match = /^url\(\s*(["']?)(.*?)\1\s*\)/i.exec(trimmed);
            out.push(match && match[2] ? { type: 'url', url: match[2] } : { type: 'none' });
            continue;
        }
        const kind = /^(repeating-)?(linear|radial|conic)-gradient\(/.exec(lower);
        const open = trimmed.indexOf('(');
        const close = kind ? matchParen(trimmed, open) : -1;
        if (!kind || close === -1) {
            out.push({ type: 'none' });
            continue;
        }
        const args = splitTopLevel(trimmed.slice(open + 1, close), ',');
        const repeating = Boolean(kind[1]);
        if (kind[2] === 'linear') out.push(parseLinearArgs(args, repeating, currentColor));
        else if (kind[2] === 'radial') out.push(parseRadialArgs(args, repeating, currentColor));
        else out.push(parseConicArgs(args, repeating, currentColor));
    }
    return out;
}

/**
 * The linear-gradient layers of a background-image value: { angle (deg, CSS
 * convention), stops: [{ color, pos }], repeating }, plus corner for a corner
 * keyword, whose angle depends on the box (linearGradientAngle).
 */
export function parseLinearGradients(value, currentColor) {
    return parseBackgroundLayers(value, currentColor).filter((layer) => layer.type === 'linear');
}

// Background layers are comma-separated, but so are gradient arguments.
function splitLayers(text) {
    return splitTopLevel(text, ',').reduce((layers, part) => {
        if (/^(repeating-)?(linear|radial|conic)-gradient\(|^url\(/i.test(part) || layers.length === 0) layers.push(part);
        else layers[layers.length - 1] += `, ${part}`;
        return layers;
    }, []);
}

/** Resolve stop positions to 0..1 along a gradient line of `length` px. */
export function normalizeStops(stops, length) {
    const resolved = stops.map((stop) => ({
        color: stop.color,
        pos: stop.pos == null ? null : typeof stop.pos === 'number' ? stop.pos : (length > 0 ? stop.pos.px / length : 0)
    }));
    if (resolved.length === 1) return [{ ...resolved[0], pos: 0 }, { ...resolved[0], pos: 1 }];
    if (resolved[0].pos == null) resolved[0].pos = 0;
    if (resolved[resolved.length - 1].pos == null) resolved[resolved.length - 1].pos = 1;
    // A stop before the start of the line keeps its place (a repeating period can begin there)
    let max = -Infinity;
    for (const stop of resolved) {
        if (stop.pos != null) { stop.pos = Math.max(stop.pos, max); max = stop.pos; }
    }
    for (let i = 1; i < resolved.length - 1; i++) {
        if (resolved[i].pos != null) continue;
        let j = i;
        while (resolved[j].pos == null) j++;
        const start = resolved[i - 1].pos;
        const end = resolved[j].pos;
        const count = j - i + 1;
        for (let k = i; k < j; k++) resolved[k].pos = start + (end - start) * (k - i + 1) / count;
    }
    return resolved;
}

// ── Transforms ──────────────────────────────────────────────────────────────

const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

/** Multiply 2D affine matrices [a, b, c, d, e, f] (CSS matrix order). */
export function multiplyAffine(m, n) {
    return [
        m[0] * n[0] + m[2] * n[1],
        m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4],
        m[1] * n[4] + m[3] * n[5] + m[5]
    ];
}

export function invertAffine(m) {
    const det = m[0] * m[3] - m[1] * m[2];
    if (!det) return null;
    const inv = 1 / det;
    return [
        m[3] * inv, -m[1] * inv, -m[2] * inv, m[0] * inv,
        (m[2] * m[5] - m[3] * m[4]) * inv,
        (m[1] * m[4] - m[0] * m[5]) * inv
    ];
}

export function applyAffine(m, x, y) {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function isIdentity(m) {
    return !m || (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0);
}

/**
 * Parse a transform list into a 2D affine matrix, with translate percentages
 * relative to the element's border box (width, height). 3D functions keep
 * their 2D part.
 */
export function parseTransform(value, width, height, lengthCtx = {}) {
    if (!value) return null;
    const text = String(value).trim();
    if (!text || text === 'none') return null;
    let matrix = [...IDENTITY];
    const re = /([a-zA-Z0-9]+)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
    let match;
    const len = (token, base) => resolveLength(parseLength(token), { ...lengthCtx, percentBase: base }) ?? 0;
    while ((match = re.exec(text))) {
        const fn = match[1].toLowerCase();
        const args = splitTopLevel(match[2], ',').map((s) => s.trim());
        let m = IDENTITY;
        switch (fn) {
            case 'translate': m = [1, 0, 0, 1, len(args[0], width), len(args[1] ?? '0', height)]; break;
            case 'translatex': m = [1, 0, 0, 1, len(args[0], width), 0]; break;
            case 'translatey': m = [1, 0, 0, 1, 0, len(args[0], height)]; break;
            case 'translate3d': m = [1, 0, 0, 1, len(args[0], width), len(args[1] ?? '0', height)]; break;
            case 'scale': {
                const sx = parseFloat(args[0]);
                const sy = args[1] != null ? parseFloat(args[1]) : sx;
                m = [sx, 0, 0, sy, 0, 0];
                break;
            }
            case 'scalex': m = [parseFloat(args[0]), 0, 0, 1, 0, 0]; break;
            case 'scaley': m = [1, 0, 0, parseFloat(args[0]), 0, 0]; break;
            case 'scale3d': m = [parseFloat(args[0]), 0, 0, parseFloat(args[1]), 0, 0]; break;
            case 'rotate':
            case 'rotatez': {
                const rad = (parseAngle(args[0]) ?? 0) * Math.PI / 180;
                const c = Math.cos(rad);
                const s = Math.sin(rad);
                m = [c, s, -s, c, 0, 0];
                break;
            }
            case 'skew':
            case 'skewx':
            case 'skewy': {
                const ax = fn === 'skewy' ? 0 : (parseAngle(args[0]) ?? 0) * Math.PI / 180;
                const ay = fn === 'skewx' ? 0 : (parseAngle(fn === 'skewy' ? args[0] : args[1] ?? '0') ?? 0) * Math.PI / 180;
                m = [1, Math.tan(ay), Math.tan(ax), 1, 0, 0];
                break;
            }
            case 'matrix': {
                const v = args.map(Number);
                if (v.length === 6 && v.every(Number.isFinite)) m = v;
                break;
            }
            default: break; // 3D-only functions keep identity
        }
        matrix = multiplyAffine(matrix, m);
    }
    return isIdentity(matrix) ? null : matrix;
}

/** transform-origin to px within the box (defaults to the centre). */
export function parseTransformOrigin(value, width, height, lengthCtx = {}) {
    const tokens = value ? splitWhitespace(String(value)) : [];
    const keyword = { left: 0, top: 0, center: 50, right: 100, bottom: 100 };
    const axis = (token, base, fallback) => {
        if (token == null) return fallback;
        const lower = token.toLowerCase();
        if (lower in keyword) return keyword[lower] / 100 * base;
        return resolveLength(parseLength(token), { ...lengthCtx, percentBase: base }) ?? fallback;
    };
    let [xToken, yToken] = tokens;
    if (xToken && ['top', 'bottom'].includes(xToken.toLowerCase())) [xToken, yToken] = [yToken, xToken];
    return [axis(xToken, width, width / 2), axis(yToken, height, height / 2)];
}

// ── Transitions ─────────────────────────────────────────────────────────────

/** Parse a transition list into [{ property, duration, delay, easing }]. */
export function parseTransitions(value) {
    if (!value || value === 'none') return [];
    return splitTopLevel(String(value), ',').map((part) => {
        const tokens = splitWhitespace(part);
        const times = tokens.filter((t) => /^-?[\d.]+m?s$/i.test(t)).map(parseTime);
        const property = tokens.find((t) => !/^-?[\d.]+m?s$/i.test(t) && !/^(ease|linear|ease-in|ease-out|ease-in-out|step-start|step-end|cubic-bezier\(.*\)|steps\(.*\))$/i.test(t)) || 'all';
        const easing = tokens.find((t) => /^(ease|linear|ease-in|ease-out|ease-in-out|cubic-bezier\(.*\))$/i.test(t)) || 'ease';
        return { property: property.toLowerCase(), duration: times[0] ?? 0, delay: times[1] ?? 0, easing: easing.toLowerCase() };
    }).filter((t) => t.duration > 0);
}

/** Convert camelCase to kebab-case CSS property names. */
export function toKebab(property) {
    return property.startsWith('--') ? property : property.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}
