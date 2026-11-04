// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * StyleResolver - Plauna's own style pass.
 *
 * Computes the style of each element in a Plauna scene with the CSS cascade:
 * the element defaults in UserAgentStyles, then the page's author style
 * rules (StyleRules, by specificity and source order), then inline styles
 * (which is how DOMRenderer and widgets style most things), with !important
 * declarations on top in the reverse order; then inheritance. var()
 * references resolve against custom properties set on the element and its
 * ancestors and then the theme variables of the host page.
 *
 * Output values are layout-ready: colours as [r, g, b, a] in 0..1, font sizes
 * in px, and lengths as parsed objects that the layout pass resolves once the
 * containing block is known.
 *
 * Computed styles are reused across layouts while an element's inputs stay
 * the same: its parent's computed style (the same object), its style
 * attribute, the rules that match it, the attributes UA defaults read, the
 * viewport and the resolver's generation (invalidate() moves it on, as
 * theme variable changes must). Unchanged subtrees therefore cost nothing on
 * relayout. Computed style objects are never modified after compute().
 *
 * An element whose inputs changed takes the values of any element computed
 * with the same inputs (sharedStyle): siblings rendered alike, a control
 * returning to an earlier state, a re-rendered widget. Declaration blocks are
 * read from CSSOM once (digest()): author rule blocks until the rules or the
 * generation change, inline styles by their style attribute text.
 *
 * Each element is cascaded with the rules of its own tree (its root node: the
 * document or a shadow root, as the browser keeps them apart) when the
 * resolver uses a tree's shared rules: an element in a shadow tree nested in
 * the scene takes that tree's sheets and UA defaults. A shadow host also
 * takes its shadow tree's :host rules, and a slotted element the ::slotted()
 * rules of each slot it is assigned to; normal declarations of the outer
 * tree win over those, !important ones of the inner tree win, past inline
 * !important too (CSS Cascade's context step, as Chrome measures it).
 *
 * Fields Chrome computes beyond layout and paint basics: scrollbarWidth,
 * scrollbarGutter, scrollbarColor, webkitScrollbar (the ::-webkit-scrollbar
 * part styles a scroll container uses), accentColor, imageRendering,
 * webkitTextFillColor, fontVariantNumeric, fontFeatureSettings, lineClamp
 * and selection (::selection, with Chrome's highlight inheritance); each is
 * described where it is computed.
 */

import {
    parseColor, parseLength, resolveLength, resolveVars, splitWhitespace, splitTopLevel,
    parseBoxShadow, parseDropShadowFilter, parseColorFilter, parseBlurFilter, parseBackgroundLayers, parseTransitions, TRANSPARENT,
    SYSTEM_COLOR
} from './CssValues.js';
import { INHERITED, userAgentStyles, userAgentStylesFor, isTreeDefaults, exactPx } from './UserAgentStyles.js';
import { styleRules, rulesFor, isTreeRules } from './StyleRules.js';
import { snapBorderWidth, roundUnit } from '../layout/LayoutUnits.js';

const SIDES = ['top', 'right', 'bottom', 'left'];
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];

const FONT_SIZE_KEYWORDS = {
    'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18, 'x-large': 24, 'xx-large': 32, 'xxx-large': 48
};

const BORDER_WIDTH_KEYWORDS = { thin: 1, medium: 3, thick: 5 };

// Shorthands whose longhands CSSOM leaves empty while a var() is pending
const SHORTHANDS = [
    'margin', 'padding', 'inset', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
    'border-width', 'border-style', 'border-color', 'border-radius', 'background', 'flex', 'gap',
    'overflow', 'outline', 'text-decoration', 'list-style', 'flex-flow', 'place-items', 'place-content',
    'grid-template', 'grid-area', 'grid-column', 'grid-row'
];

const INITIAL = {
    display: 'inline', position: 'static', 'box-sizing': 'content-box', 'z-index': 'auto',
    top: 'auto', right: 'auto', bottom: 'auto', left: 'auto',
    width: 'auto', height: 'auto', 'min-width': 'auto', 'min-height': 'auto', 'max-width': 'none', 'max-height': 'none',
    'background-color': 'transparent', 'background-image': 'none', 'box-shadow': 'none', opacity: '1',
    'overflow-x': 'visible', 'overflow-y': 'visible', 'flex-direction': 'row', 'flex-wrap': 'nowrap',
    'justify-content': 'normal', 'align-items': 'normal', 'align-self': 'auto', 'align-content': 'normal',
    'flex-grow': '0', 'flex-shrink': '1', 'flex-basis': 'auto', order: '0', 'row-gap': 'normal', 'column-gap': 'normal',
    'grid-template-columns': 'none', 'grid-template-rows': 'none', 'grid-template-areas': 'none',
    'grid-auto-flow': 'row', 'grid-auto-rows': 'auto',
    'grid-auto-columns': 'auto', 'justify-items': 'normal', 'justify-self': 'auto',
    'grid-column-start': 'auto', 'grid-column-end': 'auto', 'grid-row-start': 'auto', 'grid-row-end': 'auto',
    color: 'rgb(0, 0, 0)', 'font-family': 'Times New Roman', 'font-size': '16px', 'font-weight': '400',
    'font-style': 'normal', 'line-height': 'normal', 'letter-spacing': 'normal', 'word-spacing': '0px',
    'text-align': 'start', 'text-transform': 'none', 'text-decoration-line': 'none', 'text-decoration-color': 'currentcolor',
    'text-decoration-style': 'solid', 'text-overflow': 'clip', 'white-space': 'normal', 'overflow-wrap': 'normal',
    'word-break': 'normal', 'vertical-align': 'baseline', 'list-style-type': 'disc', 'list-style-position': 'outside',
    cursor: 'auto', 'pointer-events': 'auto', 'user-select': 'auto', visibility: 'visible',
    'aspect-ratio': 'auto', transform: 'none', translate: 'none', rotate: 'none', scale: 'none', 'transform-origin': '50% 50%', 'outline-width': 'medium', 'outline-style': 'none',
    'outline-color': 'currentcolor', 'outline-offset': '0px', fill: 'black', stroke: 'none', 'stroke-width': '1',
    'object-fit': 'fill', 'border-collapse': 'separate', 'border-spacing': '0px', 'table-layout': 'auto',
    filter: 'none', 'backdrop-filter': 'none', 'text-shadow': 'none', 'text-indent': '0px', transition: '', animation: '',
    'animation-name': 'none', 'animation-duration': '0s', 'animation-timing-function': 'ease',
    'animation-iteration-count': '1', 'animation-direction': 'normal', 'animation-delay': '0s',
    'background-size': 'auto', 'background-position-x': '0%', 'background-position-y': '0%',
    'background-repeat': 'repeat', 'background-clip': 'border-box', 'background-origin': 'padding-box', '-webkit-line-clamp': 'none', direction: 'ltr',
    'caret-color': 'auto', isolation: 'auto', 'mix-blend-mode': 'normal', 'will-change': 'auto', contain: 'none',
    'content-visibility': 'visible', 'clip-path': 'none', 'mask-image': 'none', perspective: 'none',
    'transform-style': 'flat', 'view-transition-name': 'none', 'offset-path': 'none', '-webkit-box-reflect': 'none',
    'scrollbar-width': 'auto', 'scrollbar-gutter': 'auto', 'scrollbar-color': 'auto', 'accent-color': 'auto',
    'image-rendering': 'auto', '-webkit-text-fill-color': 'currentcolor', 'font-variant-numeric': 'normal',
    'font-feature-settings': 'normal', '-webkit-box-orient': 'horizontal'
};
for (const side of SIDES) {
    INITIAL[`margin-${side}`] = '0px';
    INITIAL[`padding-${side}`] = '0px';
    INITIAL[`border-${side}-width`] = 'medium';
    INITIAL[`border-${side}-style`] = 'none';
    INITIAL[`border-${side}-color`] = 'currentcolor';
}
for (const corner of CORNERS) INITIAL[`border-${corner}-radius`] = '0px';

function expandBox(values) {
    const [t, r = t, b = t, l = r] = values;
    return [t, r, b, l];
}

function isLengthToken(token) {
    return /^[-+]?(\d|\.\d)/.test(token) || /^(calc|min|max|clamp)\(/i.test(token) || token === '0';
}

const BORDER_STYLES = new Set(['none', 'hidden', 'dotted', 'dashed', 'solid', 'double', 'groove', 'ridge', 'inset', 'outset']);

// What a `background` layer resets besides colour and image, as the browser does
const BACKGROUND_LONGHANDS = [
    'background-position-x', 'background-position-y', 'background-size', 'background-repeat',
    'background-attachment', 'background-origin', 'background-clip'
];
const POSITION_WORDS = new Set(['left', 'right', 'top', 'bottom', 'center']);
const REPEAT_WORDS = new Set(['repeat', 'no-repeat', 'repeat-x', 'repeat-y', 'space', 'round']);
const BOX_WORDS = new Set(['border-box', 'padding-box', 'content-box', 'text']);

/** One background layer: <image> || <position> [/ <size>] || <repeat> || <attachment> || <box>{1,2}. */
function backgroundLayer(text) {
    const [head, ...tail] = splitTopLevel(text, '/');
    const after = tail.length ? splitWhitespace(tail.join('/')) : [];
    // The size follows the slash: cover, contain, or one or two lengths
    const size = [];
    if (after.length && /^(cover|contain)$/i.test(after[0])) size.push(after.shift());
    else {
        while (size.length < 2 && after.length && (after[0].toLowerCase() === 'auto' || isLengthToken(after[0]))) size.push(after.shift());
    }
    const layer = { image: 'none', rest: [] };
    const position = [];
    const repeat = [];
    const boxes = [];
    let attachment = 'scroll';
    for (const token of [...splitWhitespace(head), ...after]) {
        const lower = token.toLowerCase();
        if (/^(?:repeating-)?(?:linear|radial|conic)-gradient\(|^url\(|^none$/i.test(token)) layer.image = token;
        else if (POSITION_WORDS.has(lower) || isLengthToken(token)) position.push(token);
        else if (REPEAT_WORDS.has(lower)) repeat.push(lower);
        else if (lower === 'scroll' || lower === 'fixed' || lower === 'local') attachment = lower;
        else if (BOX_WORDS.has(lower)) boxes.push(lower);
        else layer.rest.push(token);
    }
    const [x, y] = positionAxes(position);
    layer['background-position-x'] = x;
    layer['background-position-y'] = y;
    layer['background-size'] = size.length ? size.join(' ') : 'auto';
    layer['background-repeat'] = repeat.length ? repeat.join(' ') : 'repeat';
    layer['background-attachment'] = attachment;
    layer['background-origin'] = boxes[0] && boxes[0] !== 'text' ? boxes[0] : 'padding-box';
    layer['background-clip'] = boxes[1] || boxes[0] || 'border-box';
    return layer;
}

/** A <position> split into its x and y parts ("right 10px", "center", "25%"). */
function positionAxes(tokens) {
    if (!tokens.length) return ['0%', '0%'];
    const lower = tokens.map((t) => t.toLowerCase());
    const isX = (t) => t === 'left' || t === 'right';
    const isY = (t) => t === 'top' || t === 'bottom';
    if (tokens.length === 1) return isY(lower[0]) ? ['center', tokens[0]] : [tokens[0], 'center'];
    if (tokens.length === 2) return isY(lower[0]) || isX(lower[1]) ? [tokens[1], tokens[0]] : [tokens[0], tokens[1]];
    // Three or four values: an edge keyword and its offset, then the other axis
    const groups = [];
    for (let i = 0; i < tokens.length; i++) {
        if (i + 1 < tokens.length && !POSITION_WORDS.has(lower[i + 1])) groups.push(`${tokens[i]} ${tokens[++i]}`);
        else groups.push(tokens[i]);
    }
    const [a, b = 'center'] = groups;
    return isY(lower[0]) || isX(b.split(' ')[0].toLowerCase()) ? [b, a] : [a, b];
}

/** Expand a shorthand (vars already resolved) into kebab-case longhands. */
export function expandShorthand(name, value) {
    const out = {};
    const text = String(value).trim();
    const tokens = splitWhitespace(text);
    switch (name) {
        case 'margin':
        case 'padding': {
            expandBox(tokens).forEach((v, i) => { out[`${name}-${SIDES[i]}`] = v; });
            break;
        }
        case 'inset': {
            expandBox(tokens).forEach((v, i) => { out[SIDES[i]] = v; });
            break;
        }
        case 'border':
        case 'border-top':
        case 'border-right':
        case 'border-bottom':
        case 'border-left':
        case 'outline': {
            let width = 'medium';
            let style = 'none';
            const colorTokens = [];
            for (const token of tokens) {
                if (BORDER_STYLES.has(token.toLowerCase()) || (name === 'outline' && token === 'auto')) style = token.toLowerCase();
                else if (isLengthToken(token) || BORDER_WIDTH_KEYWORDS[token]) width = token;
                else colorTokens.push(token);
            }
            const color = colorTokens.length ? colorTokens.join(' ') : 'currentcolor';
            if (name === 'outline') {
                out['outline-width'] = width;
                out['outline-style'] = style;
                out['outline-color'] = color;
                break;
            }
            const sides = name === 'border' ? SIDES : [name.slice(7)];
            for (const side of sides) {
                out[`border-${side}-width`] = width;
                out[`border-${side}-style`] = style;
                out[`border-${side}-color`] = color;
            }
            break;
        }
        case 'border-width':
        case 'border-style':
        case 'border-color': {
            const kind = name.slice(7);
            const parts = kind === 'color' ? splitWhitespace(text) : tokens;
            expandBox(parts).forEach((v, i) => { out[`border-${SIDES[i]}-${kind}`] = v; });
            break;
        }
        case 'border-radius': {
            const [h, v] = text.split('/').map((part) => expandBox(splitWhitespace(part.trim())));
            CORNERS.forEach((corner, i) => { out[`border-${corner}-radius`] = v ? `${h[i]} ${v[i]}` : h[i]; });
            break;
        }
        case 'background': {
            const layers = splitTopLevel(text || 'none', ',').map(backgroundLayer);
            let color = 'transparent';
            for (const token of layers[layers.length - 1].rest) {
                if (parseColor(token) || token.startsWith('rgb') || token.startsWith('#') || token.startsWith('color-mix')) color = token;
            }
            out['background-color'] = color;
            out['background-image'] = layers.some((layer) => layer.image !== 'none') ? layers.map((layer) => layer.image).join(', ') : 'none';
            for (const name of BACKGROUND_LONGHANDS) out[name] = layers.map((layer) => layer[name]).join(', ');
            break;
        }
        case 'flex': {
            if (text === 'none') Object.assign(out, { 'flex-grow': '0', 'flex-shrink': '0', 'flex-basis': 'auto' });
            else if (text === 'auto') Object.assign(out, { 'flex-grow': '1', 'flex-shrink': '1', 'flex-basis': 'auto' });
            else if (text === 'initial') Object.assign(out, { 'flex-grow': '0', 'flex-shrink': '1', 'flex-basis': 'auto' });
            else {
                const numbers = tokens.filter((t) => /^[\d.]+$/.test(t));
                const basis = tokens.find((t) => !/^[\d.]+$/.test(t));
                out['flex-grow'] = numbers[0] ?? '1';
                out['flex-shrink'] = numbers[1] ?? '1';
                out['flex-basis'] = basis ?? (numbers.length ? '0%' : 'auto');
            }
            break;
        }
        case 'gap': {
            out['row-gap'] = tokens[0];
            out['column-gap'] = tokens[1] ?? tokens[0];
            break;
        }
        case 'overflow': {
            out['overflow-x'] = tokens[0];
            out['overflow-y'] = tokens[1] ?? tokens[0];
            break;
        }
        case 'text-decoration': {
            const lines = tokens.filter((t) => ['underline', 'overline', 'line-through', 'none'].includes(t));
            const colorTokens = tokens.filter((t) => !lines.includes(t) && !['solid', 'double', 'dotted', 'dashed', 'wavy'].includes(t) && !isLengthToken(t));
            out['text-decoration-line'] = lines.length ? lines.join(' ') : 'none';
            if (colorTokens.length) out['text-decoration-color'] = colorTokens.join(' ');
            break;
        }
        case 'list-style': {
            const type = tokens.find((t) => !['inside', 'outside'].includes(t) && !t.startsWith('url('));
            if (type) out['list-style-type'] = type;
            const position = tokens.find((t) => ['inside', 'outside'].includes(t));
            if (position) out['list-style-position'] = position;
            break;
        }
        case 'flex-flow': {
            for (const token of tokens) {
                if (['row', 'row-reverse', 'column', 'column-reverse'].includes(token)) out['flex-direction'] = token;
                else out['flex-wrap'] = token;
            }
            break;
        }
        case 'place-items': {
            out['align-items'] = tokens[0];
            out['justify-items'] = tokens[1] ?? tokens[0];
            break;
        }
        case 'place-content': {
            out['align-content'] = tokens[0];
            out['justify-content'] = tokens[1] ?? tokens[0];
            break;
        }
        case 'grid-column':
        case 'grid-row': {
            const [start, end] = text.split('/').map((s) => s.trim());
            out[`${name}-start`] = start;
            out[`${name}-end`] = end ?? (isGridIdent(start) ? start : 'auto');
            break;
        }
        case 'grid-area': {
            // row-start / column-start / row-end / column-end; a missing
            // part copies a named start, otherwise it is auto
            const [rowStart, colStart, rowEnd, colEnd] = text.split('/').map((s) => s.trim());
            const missing = (from) => (isGridIdent(from) ? from : 'auto');
            out['grid-row-start'] = rowStart;
            out['grid-column-start'] = colStart ?? missing(rowStart);
            out['grid-row-end'] = rowEnd ?? missing(rowStart);
            out['grid-column-end'] = colEnd ?? missing(colStart ?? rowStart);
            break;
        }
        default:
            break;
    }
    return out;
}

/** Combine white-space longhands (Chromium splits white-space) into a keyword. */
function whiteSpaceFrom(specified) {
    if (specified['white-space']) return specified['white-space'];
    const collapse = specified['white-space-collapse'];
    const wrap = specified['text-wrap-mode'] || specified['text-wrap'];
    if (!collapse && !wrap) return null;
    const c = collapse || 'collapse';
    const w = (wrap || 'wrap').split(' ')[0];
    if (c === 'collapse') return w === 'nowrap' ? 'nowrap' : 'normal';
    if (c === 'preserve') return w === 'nowrap' ? 'pre' : 'pre-wrap';
    if (c === 'preserve-breaks') return 'pre-line';
    if (c === 'break-spaces') return 'break-spaces';
    return 'normal';
}

let zeroCanvas = null;
const zeroAdvances = new Map();

/** The advance width of '0' (the ch unit) in a font. */
function zeroAdvance(fontSize, fontFamily, fontWeight, fontStyle) {
    const font = `${fontStyle === 'italic' || fontStyle === 'oblique' ? 'italic ' : ''}${fontWeight || 400} 100px ${fontFamily || 'sans-serif'}`;
    let per100 = zeroAdvances.get(font);
    if (per100 === undefined) {
        try {
            zeroCanvas ??= typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
            const ctx = zeroCanvas.getContext('2d');
            ctx.font = font;
            per100 = ctx.measureText('0').width;
        } catch {
            per100 = 50;
        }
        zeroAdvances.set(font, per100);
    }
    return per100 / 100 * fontSize;
}

function parseFontWeight(value, parentWeight) {
    const text = String(value).trim().toLowerCase();
    if (text === 'normal') return 400;
    if (text === 'bold') return 700;
    if (text === 'bolder') return parentWeight < 350 ? 400 : parentWeight < 550 ? 700 : 900;
    if (text === 'lighter') return parentWeight < 550 ? 100 : parentWeight < 750 ? 400 : 700;
    const n = parseFloat(text);
    return Number.isFinite(n) ? n : 400;
}

/** Parse a grid track list into [{ type: 'px'|'pct'|'fr'|'auto'|'minmax', ... }]. */
export function parseTrackList(value) {
    const text = String(value || '').trim();
    if (!text || text === 'none') return null;
    const tracks = [];
    const push = (token) => {
        const t = token.trim();
        if (!t) return;
        if (t.startsWith('repeat(')) {
            const inner = t.slice(7, -1);
            const [countText, ...rest] = splitTopLevel(inner, ',');
            const body = splitWhitespace(rest.join(',')).filter((b) => !b.startsWith('['));
            const count = /auto-(fill|fit)/.test(countText) ? { auto: countText.trim() } : parseInt(countText, 10);
            if (typeof count === 'object') {
                tracks.push({ type: 'repeat-auto', mode: count.auto, tracks: body.map(parseTrack) });
            } else {
                for (let i = 0; i < count; i++) for (const b of body) tracks.push(parseTrack(b));
            }
            return;
        }
        tracks.push(parseTrack(t));
    };
    // [line names] attach to the track after them (or trail the list);
    // names inside repeat() are dropped
    let names = [];
    for (const token of splitWhitespace(text.replace(/\[([^\]]*)\]/g, (_, list) => ` [${list.trim().split(/\s+/).join(',')}] `))) {
        if (token.startsWith('[')) {
            names.push(...token.slice(1, -1).split(',').filter(Boolean));
            continue;
        }
        const at = tracks.length;
        push(token);
        if (names.length && tracks[at]) tracks[at].lineNames = names;
        names = [];
    }
    if (names.length) tracks.endNames = names;
    return tracks;
}

/** grid-template-areas as { rows, columns, named: Map(name -> { r0, r1, c0, c1 }) }, or null. */
export function parseTemplateAreas(value) {
    const rows = [...String(value || '').matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => (m[1] ?? m[2]).trim().split(/\s+/));
    if (!rows.length) return null;
    const columns = rows[0].length;
    if (rows.some((row) => row.length !== columns)) return null;
    const named = new Map();
    rows.forEach((row, r) => row.forEach((cell, c) => {
        if (/^\.+$/.test(cell)) return;
        const area = named.get(cell);
        if (!area) named.set(cell, { r0: r, r1: r + 1, c0: c, c1: c + 1 });
        else {
            area.r1 = Math.max(area.r1, r + 1);
            area.c1 = Math.max(area.c1, c + 1);
        }
    }));
    return { rows: rows.length, columns, named };
}

function parseTrack(token) {
    const t = token.trim();
    if (/^[\d.]+fr$/.test(t)) return { type: 'fr', value: parseFloat(t) };
    if (t === 'auto' || t === 'min-content' || t === 'max-content') return { type: 'auto', keyword: t };
    if (t.startsWith('minmax(')) {
        const [min, max] = splitTopLevel(t.slice(7, -1), ',');
        return { type: 'minmax', min: parseTrack(min), max: parseTrack(max) };
    }
    if (t.startsWith('fit-content(')) return { type: 'auto', keyword: 'fit-content', limit: parseLength(t.slice(12, -1)) };
    const length = parseLength(t);
    if (length && length !== 'auto') return { type: 'length', length };
    return { type: 'auto', keyword: 'auto' };
}

function isGridIdent(text) {
    return /^-?[a-z_][\w-]*$/i.test(text || '') && text !== 'auto' && text !== 'span';
}

function parseGridLine(value) {
    const text = String(value || 'auto').trim();
    if (text === 'auto') return { auto: true };
    const span = /^span\s+(\d+)$/.exec(text);
    if (span) return { span: parseInt(span[1], 10) };
    if (isGridIdent(text)) return { name: text };
    const n = parseInt(text, 10);
    return Number.isFinite(n) ? { line: n } : { auto: true };
}

/**
 * Stands in for an element's ::before or ::after in the style and layout
 * passes: one stable object per element and side, so styles and boxes made
 * for it are reused like an element's. `host` is the element.
 */
export class PseudoElement {
    constructor(host, which) {
        this.host = host;
        this.pseudo = which;
        this.localName = `::${which}`;
        this.nodeType = 1;
        this.style = null;
        this.namespaceURI = host.namespaceURI;
        this.isConnected = false;
    }

    get parentElement() { return this.host; }
    getAttribute() { return null; }
    hasAttribute() { return false; }
}

const pseudoElements = { before: new WeakMap(), after: new WeakMap() };

/** The PseudoElement for `host`'s ::before or ::after. */
export function pseudoElementOf(host, which) {
    let pseudo = pseudoElements[which].get(host);
    if (!pseudo) {
        pseudo = new PseudoElement(host, which);
        pseudoElements[which].set(host, pseudo);
    }
    return pseudo;
}

/**
 * Generated text from a content value: strings, attr(), quotes. null for
 * none or normal (no box); counters and images give no text.
 */
export function parseContent(value, host) {
    const text = String(value ?? '').trim();
    if (!text || text === 'normal' || text === 'none' || text === 'initial') return null;
    let out = '';
    const unescape = (s) => s.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/\\(.)/g, '$1');
    const token = /"((?:[^"\\]|\\[\s\S])*)"|'((?:[^'\\]|\\[\s\S])*)'|attr\(\s*([\w-]+)[^)]*\)|(open-quote|close-quote)|(no-open-quote|no-close-quote)|counters?\([^)]*\)|url\([^)]*\)|(\/)/gi;
    let match;
    while ((match = token.exec(text))) {
        if (match[6]) break;                       // "/" starts the alternative text
        if (match[1] != null) out += unescape(match[1]);
        else if (match[2] != null) out += unescape(match[2]);
        else if (match[3]) out += host?.getAttribute?.(match[3]) ?? '';
        else if (match[4]) out += match[4].toLowerCase() === 'open-quote' ? '\u201C' : '\u201D';
    }
    return out;
}

// Properties whose values can name a colour
const COLOR_BEARING = /color$|^(background-image|box-shadow|text-shadow|fill|stroke|filter|border-image-source|scrollbar-color)$/;

// Logical properties in horizontal-tb, left-to-right writing: the physical
// property each one sets
const PHYSICAL = (() => {
    const map = {
        'inline-size': 'width', 'block-size': 'height',
        'min-inline-size': 'min-width', 'max-inline-size': 'max-width',
        'min-block-size': 'min-height', 'max-block-size': 'max-height',
        'inset-inline-start': 'left', 'inset-inline-end': 'right',
        'inset-block-start': 'top', 'inset-block-end': 'bottom',
        'overflow-inline': 'overflow-x', 'overflow-block': 'overflow-y',
        'border-start-start-radius': 'border-top-left-radius', 'border-start-end-radius': 'border-top-right-radius',
        'border-end-start-radius': 'border-bottom-left-radius', 'border-end-end-radius': 'border-bottom-right-radius'
    };
    const sides = { 'inline-start': 'left', 'inline-end': 'right', 'block-start': 'top', 'block-end': 'bottom' };
    for (const [logical, physical] of Object.entries(sides)) {
        map[`margin-${logical}`] = `margin-${physical}`;
        map[`padding-${logical}`] = `padding-${physical}`;
        for (const part of ['width', 'style', 'color']) map[`border-${logical}-${part}`] = `border-${physical}-${part}`;
    }
    return map;
})();

/** aspect-ratio as width / height, or null for auto (a natural ratio wins for replaced content). */
function parseAspectRatio(value) {
    const text = String(value || 'auto').replace(/\bauto\b/i, '').trim();
    if (!text) return null;
    const [w, h = '1'] = text.split('/').map((part) => parseFloat(part));
    const ratio = w / h;
    return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
}

/**
 * The translate, rotate and scale properties apply before transform, in that
 * order: one transform list for all four. 3D parts (a z offset, an axis other
 * than z) are left out.
 */
function individualTransforms(translate, rotate, scale, transform) {
    const parts = [];
    const t = splitWhitespace(String(translate || 'none').trim());
    if (t[0] && t[0] !== 'none') parts.push(`translate(${t[0]}, ${t[1] || '0px'})`);
    const r = splitWhitespace(String(rotate || 'none').trim());
    if (r[0] && r[0] !== 'none') {
        const angle = r[r.length - 1];
        const axis = r.slice(0, -1).join(' ').toLowerCase();
        if (!axis || axis === 'z' || axis === '0 0 1') parts.push(`rotate(${angle})`);
    }
    const sc = splitWhitespace(String(scale || 'none').trim())
        .map((v) => (v.endsWith('%') ? String(parseFloat(v) / 100) : v));
    if (sc[0] && sc[0] !== 'none') parts.push(`scale(${sc[0]}, ${sc[1] || sc[0]})`);
    if (!parts.length) return transform;
    if (transform && transform !== 'none') parts.push(transform);
    return parts.join(' ');
}

// Attributes the UA defaults and presentation hints read
const SVG_PRESENTATION = ['fill', 'stroke', 'stroke-width', 'opacity', 'width', 'height'];

function uaAttributes(element) {
    let key = element.hasAttribute?.('hidden') ? 'h' : '';
    if (focusVisible(element)) key += '|fv';
    if (element.localName === 'input') key += `|${element.getAttribute('type') || ''}`;
    if (element.disabled) key += '|d';
    if (element.localName === 'summary') key += `|${summaryDisclosure(element)}`;
    if (element.namespaceURI === 'http://www.w3.org/2000/svg') {
        for (const name of SVG_PRESENTATION) key += `|${element.getAttribute(name) ?? ''}`;
    }
    return key;
}

// The names a readSpecified result holds because the page declares them
const AUTHORED = Symbol('authored');
const FORM_CONTROL = /^(button|input|select|textarea)$/;
const CONTROL_COLOURS = ['color', 'background-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color'];

/** Whether the page is in forced colours (Windows High Contrast). */
function forcedColors() {
    return typeof matchMedia === 'function' && matchMedia('(forced-colors: active)').matches;
}

// Declarations that make a push button author-styled (no native face)
const AUTHOR_FACE = /^(background|border)(?!-collapse$|-spacing$)/;

/** <button> and the input types the browser draws as push buttons. */
function isPushButton(element) {
    if (element.localName === 'button') return true;
    if (element.localName !== 'input') return false;
    return /^(button|submit|reset)$/i.test(element.getAttribute?.('type') || '');
}

/** Whether `element` is the focused element and matches :focus-visible. */
function focusVisible(element) {
    if (element?.nodeType !== 1 || typeof element.matches !== 'function') return false;
    const root = element.getRootNode?.();
    const active = root?.activeElement ?? (typeof document !== 'undefined' ? document.activeElement : null);
    if (active !== element) return false;
    try {
        return element.matches(':focus-visible');
    } catch {
        return false;
    }
}

// Read from the browser for the focus-visible element: its UA :focus-visible
// outline with the page's overrides, the colour scheme and the UA offsets applied
const OUTLINE_LONGHANDS = ['outline-style', 'outline-width', 'outline-color', 'outline-offset'];

// url() arguments and strings, which can hold words that name system colours
const NOT_COLOR_TEXT = /url\([^)]*\)|"[^"]*"|'[^']*'/gi;

/** Property names (kebab-case) a CSS transition or animation changes. */
function animatedNames(animation) {
    if (animation.transitionProperty) return [animation.transitionProperty];
    const names = [];
    try {
        for (const frame of animation.effect?.getKeyframes?.() || []) {
            for (const key of Object.keys(frame)) names.push(key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
        }
    } catch {
        // A keyframe effect that cannot list its frames changes nothing we read
    }
    return names;
}

/** Whether `element`'s used colour scheme is dark (color-scheme, then the preference). */
function usedDarkScheme(element) {
    if (typeof getComputedStyle === 'undefined' || !element?.isConnected) return false;
    const words = String(getComputedStyle(element).colorScheme || 'normal').split(/\s+/);
    if (!words.includes('dark')) return false;
    return !words.includes('light') || (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
}

/**
 * The marker a details element's first summary gets from the UA rules
 * `details > summary:first-of-type { display: list-item; list-style:
 * disclosure-closed inside }` and `details[open] > summary:first-of-type
 * { list-style-type: disclosure-open }`, or '' for any other element.
 */
function summaryDisclosure(element) {
    if (element.localName !== 'summary' || element.parentElement?.localName !== 'details') return '';
    for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        if (sibling.localName === 'summary') return '';
    }
    return element.parentElement.open ? 'disclosure-open' : 'disclosure-closed';
}

// UA defaults with the summary rules over them, per defaults object
const SUMMARY_DEFAULTS = new WeakMap();

/** `ua` (an element's UA defaults) with the summary rules when they apply to `element`. */
function summaryDefaults(element, ua) {
    const type = element.localName === 'summary' ? summaryDisclosure(element) : '';
    if (!type) return ua;
    let pair = SUMMARY_DEFAULTS.get(ua);
    if (!pair) {
        const rule = (listType) => ({ ...ua, display: 'list-item', 'list-style-type': listType, 'list-style-position': 'inside' });
        pair = { 'disclosure-closed': rule('disclosure-closed'), 'disclosure-open': rule('disclosure-open') };
        SUMMARY_DEFAULTS.set(ua, pair);
    }
    return pair[type];
}

// CSSOM and computed style write numbers to six significant digits: a declared
// 10.765625px reads "10.7656px" and lays out a layout unit short. A value
// showing a number that long may have been rounded; the typed OM keeps every
// digit. (var() values are kept as written, so they are exact already.)
const NUMBER = /(?<![\w#.])(?:\d+\.?\d*|\.\d+)/g;
const TYPED_UNITS = { percent: '%', number: '' };

function mayBeRounded(text) {
    if (!text) return false;
    for (const [number] of text.matchAll(NUMBER)) {
        if (number.replace('.', '').replace(/^0+/, '').length >= 6) return true;
    }
    return false;
}

/** A typed OM numeric value as CSS text with every digit, or null. */
function exactNumeric(value) {
    if (typeof CSSNumericValue === 'undefined' || !(value instanceof CSSNumericValue)) return null;
    if (value instanceof CSSUnitValue) return `${value.value}${TYPED_UNITS[value.unit] ?? value.unit}`;
    const list = (values) => {
        const out = [];
        for (const v of values) {
            const text = exactNumeric(v);
            if (text == null) return null;
            out.push(text);
        }
        return out;
    };
    let args = null;
    if (value instanceof CSSMathSum) return (args = list(value.values)) && `(${args.join(' + ')})`;
    if (value instanceof CSSMathProduct) return (args = list(value.values)) && `(${args.join(' * ')})`;
    if (value instanceof CSSMathNegate) return (args = list([value.value])) && `(-1 * ${args[0]})`;
    if (value instanceof CSSMathInvert) return (args = list([value.value])) && `(1 / ${args[0]})`;
    if (value instanceof CSSMathMin || value instanceof CSSMathMax) return (args = list(value.values)) && `${value.operator}(${args.join(', ')})`;
    if (value instanceof CSSMathClamp) return (args = list([value.lower, value.value, value.upper])) && `clamp(${args.join(', ')})`;
    return null;
}

/** `text` (property `name`'s value) with every digit when `typed` holds it as one number. */
function exactValue(typed, name, text) {
    if (!typed || text.includes('var(') || !mayBeRounded(text)) return text;
    try {
        // get() would give only the first item of a list (background layers, transitions)
        const values = typed.getAll(name);
        const exact = values.length === 1 ? exactNumeric(values[0]) : null;
        if (exact != null) return exact.startsWith('(') ? `calc${exact}` : exact;
    } catch {
        // A property the typed OM does not know
    }
    return text;
}

/**
 * A declaration block as read from CSSOM, per priority (0 normal, 1
 * !important): `values` the non-empty declarations as [physical name, value]
 * in order (numbers exact, from `typed`, the block's typed OM map),
 * `custom` the custom properties as [name, trimmed value], `pending` the
 * longhands CSSOM leaves empty while a var() shorthand is pending, and
 * `shorthands` those var() shorthands as [name, raw value].
 */
function digestBlock(style, typed) {
    const out = [
        { values: [], custom: [], pending: [], shorthands: [] },
        { values: [], custom: [], pending: [], shorthands: [] }
    ];
    for (let i = 0; i < style.length; i++) {
        const name = style[i];
        const part = out[style.getPropertyPriority(name) === 'important' ? 1 : 0];
        if (name.startsWith('--')) {
            part.custom.push([name, style.getPropertyValue(name).trim()]);
            continue;
        }
        const value = style.getPropertyValue(name);
        if (value !== '') part.values.push([PHYSICAL[name] || name, exactValue(typed, name, value)]);
        else part.pending.push(name);
    }
    for (let p = 0; p < 2; p++) {
        if (!out[p].pending.length) continue;
        for (const shorthand of SHORTHANDS) {
            const raw = style.getPropertyValue(shorthand);
            if (!raw || !raw.includes('var(')) continue;
            if ((style.getPropertyPriority(shorthand) === 'important') !== (p === 1)) continue;
            out[p].shorthands.push([shorthand, raw]);
        }
    }
    return out;
}

// Longhands of a var() shorthand once its vars are resolved, by shorthand and value
const expanded = new Map();
const EXPANDED_LIMIT = 2048;

function expandResolved(shorthand, value) {
    const key = `${shorthand}:${value}`;
    let longhands = expanded.get(key);
    if (!longhands) {
        longhands = Object.entries(expandShorthand(shorthand, value));
        if (expanded.size >= EXPANDED_LIMIT) expanded.clear();
        expanded.set(key, longhands);
    }
    return longhands;
}

/** Whether two computed values are the same: plain data compared deeply, anything else by identity. */
function sameValue(a, b) {
    if (Object.is(a, b)) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a)) {
        if (!Array.isArray(b) || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!sameValue(a[i], b[i])) return false;
        return true;
    }
    if (a instanceof Map) {
        if (!(b instanceof Map) || a.size !== b.size) return false;
        for (const [key, value] of a) if (!b.has(key) || !sameValue(value, b.get(key))) return false;
        return true;
    }
    const proto = Object.getPrototypeOf(a);
    if ((proto !== Object.prototype && proto !== null) || Object.getPrototypeOf(b) !== proto) return false;
    return sameFields(a, b, null);
}

function sameFields(a, b, skip) {
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const key of keys) {
        if (key === skip) continue;
        if (!Object.prototype.hasOwnProperty.call(b, key) || !sameValue(a[key], b[key])) return false;
    }
    return true;
}

// ── Container query units ─────────────────────────────────────────────────

const VERTICAL_WRITING = /^(vertical|sideways)/;

/** The parent in the flat tree (a slot, or a shadow root's host), as query containers are found. */
function flatParent(node) {
    if (node.assignedSlot) return node.assignedSlot;
    if (node.parentElement) return node.parentElement;
    const parent = node.parentNode;
    return parent?.nodeType === 11 ? parent.host ?? null : null;
}

/** Whether `axis` (width, height, inline, block) is horizontal for `element` (cqi and cqb follow its writing mode). */
function isHorizontalAxis(element, axis) {
    if (axis === 'width' || axis === 'height') return axis === 'width';
    const self = element instanceof PseudoElement ? element.host : element;
    const vertical = typeof getComputedStyle !== 'undefined' && self?.isConnected
        && VERTICAL_WRITING.test(getComputedStyle(self).writingMode || '');
    return (axis === 'inline') !== Boolean(vertical);
}

/**
 * The nearest query container of `element` on `axis`: { node, size } with
 * its content-box size in that axis, as the live page lays it out, rounded
 * to the layout unit the browser holds it in (getComputedStyle keeps six
 * digits); null without one. A size container answers both axes, an
 * inline-size one only its own inline axis; container-type values without
 * either (scroll-state) are not size containers. Only ancestors count, but
 * a pseudo-element's own element is one of its ancestors.
 */
function queryContainer(element, axis, zoom) {
    if (typeof getComputedStyle === 'undefined') return null;
    const pseudo = element instanceof PseudoElement;
    const self = pseudo ? element.host : element;
    if (!self?.isConnected) return null;
    const horizontal = isHorizontalAxis(element, axis);
    for (let node = pseudo ? self : flatParent(self); node; node = flatParent(node)) {
        const cs = getComputedStyle(node);
        const type = String(cs.containerType || 'normal');
        if (type === 'normal') continue;
        const words = type.split(/\s+/);
        const size = words.includes('size');
        if (!size && !words.includes('inline-size')) continue;
        if (!size && VERTICAL_WRITING.test(cs.writingMode || '') === horizontal) continue;
        const px = (name) => parseFloat(cs[name]) || 0;
        let length = parseFloat(horizontal ? cs.width : cs.height);
        if (!Number.isFinite(length)) length = 0;
        if (cs.boxSizing === 'border-box') {
            length -= horizontal
                ? px('paddingLeft') + px('paddingRight') + px('borderLeftWidth') + px('borderRightWidth')
                : px('paddingTop') + px('paddingBottom') + px('borderTopWidth') + px('borderBottomWidth');
        }
        return { node, size: Math.max(0, roundUnit(length, zoom || 1)) };
    }
    return null;
}

/** Whether two computed styles of one element hold the same values. */
function sameValues(a, b) {
    return a === b || (a.element === b.element && sameFields(a, b, 'element'));
}

function sameInputs(a, b) {
    return sameOwnInputs(a, b) && sameExtra(a.extra, b.extra);
}

/** sameInputs without the ::selection and scrollbar part matches. */
function sameOwnInputs(a, b) {
    if (a.generation !== b.generation || a.inheritedFrom !== b.inheritedFrom || a.styleAttribute !== b.styleAttribute
        || a.attributes !== b.attributes || a.rules !== b.rules || a.viewport !== b.viewport
        || a.layers.length !== b.layers.length) return false;
    for (let i = 0; i < a.layers.length; i++) {
        if (a.layers[i].style !== b.layers[i].style || a.layers[i].important !== b.layers[i].important) return false;
    }
    return true;
}

// ── Highlights, scrollbar parts and other fields ──────────────────────────

const NO_EXTRA = Object.freeze({ selection: Object.freeze([]), scrollbar: Object.freeze([]) });

/** Whether two elements matched the same ::selection and scrollbar part rules. */
function sameExtra(a, b) {
    if (a === b) return true;
    if (a.selection.length !== b.selection.length || a.scrollbar.length !== b.scrollbar.length) return false;
    for (let i = 0; i < a.selection.length; i++) if (a.selection[i] !== b.selection[i]) return false;
    for (let i = 0; i < a.scrollbar.length; i++) {
        const x = a.scrollbar[i];
        const y = b.scrollbar[i];
        if (x.style !== y.style || x.part !== y.part || x.states !== y.states) return false;
    }
    return true;
}

// image-rendering values Chrome takes (smooth, high-quality, optimizeSpeed are invalid there)
const IMAGE_RENDERING = new Set(['auto', 'pixelated', 'crisp-edges', '-webkit-optimize-contrast']);

// font-variant-numeric keywords by group, in the order Chrome serializes them
const NUMERIC_GROUPS = [
    ['lining-nums', 'oldstyle-nums'], ['proportional-nums', 'tabular-nums'],
    ['diagonal-fractions', 'stacked-fractions'], ['ordinal'], ['slashed-zero']
];

/**
 * font-variant-numeric as Chrome computes it: 'normal', or one keyword per
 * group in group order ("slashed-zero tabular-nums lining-nums" is
 * "lining-nums tabular-nums slashed-zero"); null when invalid (two keywords
 * of one group, a repeat, an unknown word).
 */
export function normalizeFontVariantNumeric(value) {
    const words = splitWhitespace(String(value ?? '').toLowerCase());
    if (!words.length) return null;
    if (words.length === 1 && words[0] === 'normal') return 'normal';
    const picked = NUMERIC_GROUPS.map(() => null);
    for (const word of words) {
        const group = NUMERIC_GROUPS.findIndex((keywords) => keywords.includes(word));
        if (group < 0 || picked[group]) return null;
        picked[group] = word;
    }
    return picked.filter(Boolean).join(' ');
}

/**
 * font-feature-settings as Chrome computes it: 'normal', or each tag once
 * (the last setting wins), sorted, with value 1 (and `on`) left out and `off`
 * written 0: `'tnum' 1, 'liga' 0, 'ss01' on` is `"liga" 0, "ss01", "tnum"`.
 * Tags keep their case. Null when invalid (a tag not of four printable
 * ASCII characters, a value that is not a whole number).
 */
export function normalizeFontFeatureSettings(value) {
    const text = String(value ?? '').trim();
    if (text.toLowerCase() === 'normal') return 'normal';
    const features = new Map();
    for (const part of splitTopLevel(text, ',')) {
        const match = /^(["'])([\x20-\x7e]{4})\1(?:\s+(on|off|\d+))?$/i.exec(part.trim());
        if (!match) return null;
        const setting = (match[3] || 'on').toLowerCase();
        features.delete(match[2]);
        features.set(match[2], setting === 'on' ? 1 : setting === 'off' ? 0 : parseInt(setting, 10));
    }
    if (!features.size) return null;
    return [...features].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([tag, setting]) => (setting === 1 ? `"${tag}"` : `"${tag}" ${setting}`)).join(', ');
}

/** -webkit-line-clamp as a positive whole number, or null (none; 0, negative and fractions are invalid). */
function parseLineClamp(value) {
    const text = String(value ?? '').trim();
    return /^\+?\d+$/.test(text) && parseInt(text, 10) > 0 ? parseInt(text, 10) : null;
}

/**
 * The colour of a ::selection declaration as text from declaration blocks
 * `blocks` (normal order): the !important one if any, else the last.
 * A var() shorthand leaves its longhands empty in CSSOM: `shorthand` is read
 * then and expanded once its vars resolve.
 */
function highlightDeclaration(blocks, name, shorthand, lookup) {
    let value = null;
    let important = false;
    for (const style of blocks) {
        let text = style.getPropertyValue(name);
        let priority = style.getPropertyPriority(name);
        if (!text && shorthand) {
            const raw = style.getPropertyValue(shorthand);
            if (raw && raw.includes('var(')) {
                const resolved = resolveVars(raw, lookup);
                text = resolved == null ? '' : expandShorthand(shorthand, resolved)[name] || '';
                priority = style.getPropertyPriority(shorthand);
            }
        }
        if (!text) continue;
        if (priority === 'important') {
            value = text;
            important = true;
        } else if (!important) value = text;
    }
    if (value != null && value.includes('var(')) value = resolveVars(value, lookup);
    return value == null ? null : String(value).trim();
}

/**
 * What an element paints selected text with, from its ::selection blocks
 * (Chrome 155's highlight inheritance, measured in pixels): an element no
 * ::selection rule matches takes its parent's highlight whole (null at the
 * top: the browser's default, rgba(0, 65, 198, 0.8) behind white text);
 * one with rules takes their values, and what they leave out from its
 * parent's highlight, the background included. `color` null paints the
 * text in its own fill colour (an unset or currentcolor highlight colour);
 * a background left out is transparent, not the default. Custom properties
 * come from the blocks, then the element (`lookup`).
 */
function highlightOf(blocks, parent, lookup, ownColor) {
    if (!blocks?.length) return parent ?? null;
    const custom = new Map();
    for (const style of blocks) {
        for (let i = 0; i < style.length; i++) {
            if (style[i].startsWith('--')) custom.set(style[i], style.getPropertyValue(style[i]).trim());
        }
    }
    const resolve = custom.size ? (name) => (custom.has(name) ? custom.get(name) : lookup(name)) : lookup;
    const inherited = (key) => (parent ? parent[key] : (key === 'color' ? null : [...TRANSPARENT]));
    const colorText = highlightDeclaration(blocks, 'color', null, resolve);
    let color;
    const colorWord = colorText?.toLowerCase();
    if (colorText == null || colorWord === 'inherit' || colorWord === 'unset') color = inherited('color');
    else if (colorWord === 'initial' || colorWord === 'currentcolor') color = null;
    else color = parseColor(colorText) ?? inherited('color');
    const backgroundText = highlightDeclaration(blocks, 'background-color', 'background', resolve);
    const backgroundWord = backgroundText?.toLowerCase();
    let background;
    if (backgroundText == null || backgroundWord === 'inherit' || backgroundWord === 'unset') background = inherited('background');
    else if (backgroundWord === 'initial') background = [...TRANSPARENT];
    else background = parseColor(backgroundText, color ?? ownColor) ?? inherited('background');
    return { color, background: background ?? [...TRANSPARENT] };
}

// Scrollbar pseudo-classes that always hold for a scrollbar Plauna paints
const ALWAYS_STATES = new Set(['enabled']);

/** Whether a scrollbar part rule's `states` hold in `state` ({ vertical, horizontal, hover, active }). */
function scrollbarStatesHold(states, state) {
    for (const name of states) {
        if (!ALWAYS_STATES.has(name) && !state[name]) return false;
    }
    return true;
}

const SCROLLBAR_SET = ['scrollbar', 'thumb', 'track', 'trackPiece', 'button'];
const PART_PSEUDO = {
    scrollbar: '-webkit-scrollbar', thumb: '-webkit-scrollbar-thumb', track: '-webkit-scrollbar-track',
    trackPiece: '-webkit-scrollbar-track-piece', button: '-webkit-scrollbar-button',
    corner: '-webkit-scrollbar-corner', resizer: '-webkit-resizer'
};
const scrollbarPseudos = new Map();

/** The stable stand-in for `host`'s scrollbar `part` in the style pass. */
function scrollbarPseudoOf(host, part) {
    let byHost = scrollbarPseudos.get(part);
    if (!byHost) scrollbarPseudos.set(part, (byHost = new WeakMap()));
    let pseudo = byHost.get(host);
    if (!pseudo) byHost.set(host, (pseudo = new PseudoElement(host, PART_PSEUDO[part])));
    return pseudo;
}

/**
 * A scrollbar's thickness from its ::-webkit-scrollbar style (`axis` width
 * for the vertical bar, height for the horizontal one), in CSS px before
 * device-pixel flooring: 0 under display: none, a percentage counts 0, min
 * and max sizes apply, padding, border and margin do not; 'auto' for the
 * native size. Chrome lays the bar out at floor(px * dsf) device pixels, so
 * layout takes floor(px * dsf) / dsf (7.5px is 7.2 CSS px at 1.25x).
 */
function scrollbarThickness(style, axis) {
    if (!style) return 'auto';
    if (style.display === 'none') return 0;
    const px = (length) => (length && typeof length === 'object' ? (length.px ?? 0) : null);
    let size = px(style[axis]);
    if (size == null) return 'auto';
    const min = px(style[axis === 'width' ? 'minWidth' : 'minHeight']);
    const max = px(style[axis === 'width' ? 'maxWidth' : 'maxHeight']);
    if (max != null) size = Math.min(size, max);
    if (min != null) size = Math.max(size, min);
    return Math.max(0, size);
}

/** Whether a computed style makes its element a scroll container (it can have scrollbars). */
function scrolls(style) {
    const scroller = (value) => value !== 'visible' && value !== 'clip';
    return scroller(style.overflowX) || scroller(style.overflowY);
}

export class StyleResolver {
    /**
     * The font size rem lengths resolve against: the option when given,
     * otherwise the document root's, read once a style generation (the OS
     * sets its own root size; 16px is only the browser default)
     */
    get rootFontSize() {
        if (this.rootFontOption) return this.rootFontOption;
        if (this.rootFontGeneration !== this.generation) {
            this.rootFontGeneration = this.generation;
            const root = typeof document !== 'undefined' ? document.documentElement : null;
            this.rootFontCached = (root && parseFloat(getComputedStyle(root).fontSize)) || 16;
        }
        return this.rootFontCached;
    }

    /**
     * @param {Object} options
     * @param {UserAgentStyles} [options.ua]
     * @param {(name:string)=>string|undefined} [options.variables] root custom properties
     * @param {()=>{width:number,height:number}} [options.viewport]
     * @param {number} [options.rootFontSize]
     * @param {StyleRules|null} [options.rules] author style rules; null for inline styles only
     */
    constructor(options = {}) {
        this.ua = options.ua || userAgentStyles;
        this.rules = options.rules === undefined ? styleRules : options.rules;
        this.variables = options.variables || (() => undefined);
        this.viewport = options.viewport || (() => ({
            width: typeof window !== 'undefined' ? window.innerWidth : 1280,
            height: typeof window !== 'undefined' ? window.innerHeight : 720
        }));
        this.rootFontOption = options.rootFontSize || null;
        this.rootFontGeneration = -1;
        this.rootFontCached = 16;
        // Layout zoom (LayoutUnits.layoutZoom): border widths snap in its pixels
        this.zoom = options.zoom || 1;
        this.defaultBoxSizing = options.defaultBoxSizing || null;
        this.memo = new WeakMap();
        this.generation = 0;
        this.rootInput = null;
        this.rootKey = null;
        this.rootStyle = null;
        // Styles shared between elements with the same inputs (sharedStyle)
        this.shared = new Map();
        this.sharedStamp = null;
        this.sharedLimit = options.sharedLimit ?? 4096;
        this.valueIds = new WeakMap();
        this.blockIds = new WeakMap();
        this.nextId = 0;
        // Whether the last computeStyle used a value read from the browser's
        // computed style (names readSpecified looked up there: liveNames)
        this.readLive = false;
        this.liveNames = null;
        // A name read live was mid-transition (watchLiveAnimations): the
        // style is not kept, and onLiveSettled(element) asks for a restyle
        this.liveMoving = false;
        // Animation -> elements waiting for it to end (onLiveSettled)
        this.watched = new WeakMap();
        // Running animations per element for the current task (animationsOf)
        this.animationCache = null;
        this.onLiveSettled = options.onLiveSettled ?? null;
        // Declaration blocks read from CSSOM (digestBlock): rule blocks while
        // the rules and generation stay, inline styles by style attribute
        this.ruleDigests = new WeakMap();
        this.inlineDigests = new Map();
        this.inlineDigestLimit = 4096;
        // Whether a style attribute text shows a number CSSOM may have rounded
        this.roundedTexts = new Map();
        // Other trees' rules and UA tables refreshed in this pass (rulesOf, uaFor)
        this.passTrees = new Set();
        this.passDefaults = new Set();
    }

    /**
     * The rules `element` is cascaded with: its own tree's (the document's,
     * or its shadow root's) when the resolver uses a tree's shared rules,
     * refreshed once a pass; rules given to the resolver otherwise.
     */
    rulesOf(element) {
        const rules = this.rules;
        if (!rules || !isTreeRules(rules)) return rules;
        const node = element instanceof PseudoElement ? element.host : element;
        const root = node?.getRootNode?.();
        if (root?.nodeType !== 9 && root?.nodeType !== 11) return rules;
        return this.treeRules(root);
    }

    /** Tree `root`'s shared rules, refreshed once a pass. */
    treeRules(root) {
        const rules = rulesFor(root);
        if (rules !== this.rules && !this.passTrees.has(rules)) {
            this.passTrees.add(rules);
            rules.refresh();
        }
        return rules;
    }

    /**
     * UA defaults for `element`: its own tree's table when the resolver uses
     * a tree's (a nested shadow tree's is calibrated in that tree, with its
     * own sheets, once a pass at most), the given table otherwise.
     */
    uaFor(element) {
        const ua = this.ua;
        if (!isTreeDefaults(ua)) return ua;
        const node = element instanceof PseudoElement ? element.host : element;
        const root = node?.getRootNode?.();
        if (root?.nodeType !== 11) return ua;
        const table = userAgentStylesFor(root);
        if (table !== ua && !this.passDefaults.has(table)) {
            this.passDefaults.add(table);
            table.calibrate(root);
        }
        return table;
    }

    /**
     * Rules of the trees inside `element`'s that style it, outermost first:
     * the ::slotted() rules of each slot it is assigned to (the slot it sits
     * in, then any slot that slot is assigned to), then its own shadow
     * tree's :host rules. Only with a tree's shared rules.
     */
    innerContexts(element) {
        if (!isTreeRules(this.rules)) return null;
        let out = null;
        for (let slot = element.assignedSlot; slot; slot = slot.assignedSlot) {
            const root = slot.getRootNode();
            if (root?.nodeType !== 11) break;
            const styles = this.treeRules(root).matchSlotted(element, slot);
            if (styles.length) (out ??= []).push(styles);
        }
        const shadow = element.shadowRoot;
        if (shadow) {
            const styles = this.treeRules(shadow).matchHost(element);
            if (styles.length) (out ??= []).push(styles);
        }
        return out;
    }

    /**
     * The ::selection and scrollbar part rules that match `element` in its
     * tree, which its selection and webkitScrollbar values come from (and
     * which its memo and sharing keys hold). An element whose last style
     * cannot scroll keeps its last scrollbar matches while its own inputs
     * hold: its overflow is the same, so those parts never reach its values.
     */
    pseudoInputs(element, rules, memo = null, inputs = null) {
        if (!rules || (!rules.selectionCount && !rules.scrollbarCount)) return NO_EXTRA;
        const selection = rules.selectionCount ? rules.matchPseudo(element, 'selection') : NO_EXTRA.selection;
        let scrollbar = NO_EXTRA.scrollbar;
        if (rules.scrollbarCount) {
            const kept = memo && !memo.moving && !scrolls(memo.style) && inputs && sameOwnInputs(memo.inputs, inputs);
            scrollbar = kept ? memo.inputs.extra.scrollbar : rules.matchScrollbar(element);
        }
        return selection.length || scrollbar.length ? { selection, scrollbar } : NO_EXTRA;
    }

    /**
     * `element`'s style attribute as the key of its inline declarations: the
     * text, plus the exact numbers when it shows one CSSOM may have rounded
     * (two elements, or one before and after a change, can both read
     * "left: 33.3333%" and differ in the digits behind it).
     */
    styleKey(element) {
        const text = element.getAttribute?.('style') ?? '';
        if (!text) return text;
        let rounded = this.roundedTexts.get(text);
        if (rounded === undefined) {
            rounded = mayBeRounded(text);
            if (this.roundedTexts.size >= this.inlineDigestLimit) this.roundedTexts.clear();
            this.roundedTexts.set(text, rounded);
        }
        const typed = rounded ? element.attributeStyleMap : null;
        if (!typed) return text;
        let key = text;
        const style = element.style;
        for (let i = 0; i < style.length; i++) {
            const name = style[i];
            const value = style.getPropertyValue(name);
            const exact = exactValue(typed, name, value);
            if (exact !== value) key += `\n${name}: ${exact}`;
        }
        return key;
    }

    /**
     * The digest of declaration block `style` in `element`'s cascade.
     * `styleText` is the element's styleKey (read when not given).
     */
    digest(style, element, styleText) {
        if (style === element.style) {
            const text = styleText ?? this.styleKey(element);
            let digest = this.inlineDigests.get(text);
            if (!digest) {
                digest = digestBlock(style, element.attributeStyleMap);
                if (this.inlineDigests.size >= this.inlineDigestLimit) this.inlineDigests.clear();
                this.inlineDigests.set(text, digest);
            }
            return digest;
        }
        const signature = this.rules?.signature ?? null;
        let entry = this.ruleDigests.get(style);
        if (!entry || entry.generation !== this.generation || entry.signature !== signature) {
            entry = { generation: this.generation, signature, digest: digestBlock(style, style.parentRule?.styleMap) };
            this.ruleDigests.set(style, entry);
        }
        return entry.digest;
    }

    /** Forget reused styles (theme variables or other outside inputs changed). */
    invalidate() {
        this.generation++;
    }

    /**
     * The size container query units on `axis` (width, height, inline or
     * block) are percentages of for `element`: the content box of its
     * nearest query container on that axis, else the small viewport. Noted
     * in containerReads (the style is redone when the size moves) and in the
     * rules' containerElements (a resize restyles what lies in a container).
     */
    queryContainerSize(element, axis) {
        const found = queryContainer(element, axis, this.zoom);
        (this.containerReads ??= []).push({ element, axis, node: found?.node ?? null, size: found?.size ?? null });
        if (found) {
            this.rules?.containerElements?.add(found.node);
            return found.size;
        }
        const vp = this.viewport();
        return isHorizontalAxis(element, axis) ? vp.width : vp.height;
    }

    /** Whether the query containers a memoized style read are where and the size they were. */
    containersHold(element, containers) {
        if (!containers) return true;
        for (const read of containers) {
            const found = queryContainer(read.element, read.axis, this.zoom);
            if ((found?.node ?? null) !== read.node || (found?.size ?? null) !== read.size) return false;
        }
        return true;
    }

    /** Start a layout pass: pick up style sheet changes once, not per element. */
    beginPass() {
        this.rules?.refresh();
        // Other trees' rules and defaults are refreshed when first used in the pass
        this.passTrees = new Set();
        this.passDefaults = new Set();
    }

    /** The same root style object while the host's inherited values are the same. */
    stableRoot(rootInherited) {
        if (!rootInherited || rootInherited === ROOT_DEFAULTS) return rootInherited;
        if (rootInherited === this.rootInput) return this.rootStyle;
        const { custom, ...values } = rootInherited;
        const key = JSON.stringify(values) + JSON.stringify([...(custom || [])]);
        this.rootInput = rootInherited;
        if (key !== this.rootKey) {
            this.rootKey = key;
            this.rootStyle = rootInherited;
        }
        return this.rootStyle;
    }

    /**
     * Declaration blocks that apply to `element`, in cascade order: normal
     * declarations before !important ones, author rules before inline style
     * within each. Rules of inner trees (::slotted, :host; innerContexts)
     * sit below the element's own tree for normal declarations, the deepest
     * lowest, and above everything for !important ones, the deepest highest.
     */
    cascade(element) {
        // ::before / ::after take only their own rules; they have no inline style.
        // (Not `element.pseudo`: Chrome elements have a native pseudo() method.)
        const generated = element instanceof PseudoElement;
        const own = this.rulesOf(element);
        const rules = !own ? []
            : generated ? own.matchPseudo(element.host, element.pseudo)
                : own.match(element);
        const inline = element.style && element.style.length ? element.style : null;
        const inner = generated ? null : this.innerContexts(element);
        const layers = [];
        if (inner) for (let i = inner.length - 1; i >= 0; i--) for (const style of inner[i]) layers.push({ style, important: false });
        for (const style of rules) layers.push({ style, important: false });
        if (inline) layers.push({ style: inline, important: false });
        for (const style of rules) layers.push({ style, important: true });
        if (inline) layers.push({ style: inline, important: true });
        if (inner) for (const styles of inner) for (const style of styles) layers.push({ style, important: true });
        return layers;
    }

    /** Specified declarations (kebab-case) for the element, after the cascade. */
    readSpecified(element, customLookup, layers = this.cascade(element), styleText) {
        const specified = {};
        const unresolved = new Set();
        for (const { style, important } of layers) {
            const part = this.digest(style, element, styleText)[important ? 1 : 0];
            // A logical property sets its physical one; the later declaration wins
            for (const [key, value] of part.values) {
                specified[key] = value;
                unresolved.delete(key);
            }
            if (!part.pending.length) continue;
            // Longhands of a var() shorthand stay empty in CSSOM; expand it here
            const open = new Set(part.pending);
            for (const [shorthand, raw] of part.shorthands) {
                const resolved = resolveVars(raw, customLookup);
                if (resolved == null) continue;
                for (const [name, value] of expandResolved(shorthand, resolved)) {
                    if (!open.has(name)) continue;
                    specified[name] = value;
                    open.delete(name);
                    unresolved.delete(name);
                }
            }
            for (const name of open) unresolved.add(PHYSICAL[name] || name);
        }
        // A system colour follows the colour scheme and forced colours: take
        // the value the browser resolved for this element
        for (const [name, value] of Object.entries(specified)) {
            if (!COLOR_BEARING.test(name)) continue;
            let text = String(value);
            if (text.includes('var(')) text = resolveVars(text, customLookup) ?? text;
            if (SYSTEM_COLOR.test(text.replace(NOT_COLOR_TEXT, ''))) unresolved.add(name);
        }
        // What the page itself declares (read live or not), before the UA values read live below
        const authored = new Set([...Object.keys(specified), ...unresolved]);
        if (focusVisible(element)) for (const name of OUTLINE_LONGHANDS) unresolved.add(name);
        // A form control's UA colours are system colours (ButtonText,
        // GrayText, Field...): disabled, in a dark scheme or in forced colours
        // they are not the calibrated defaults, so the browser's are read
        if (FORM_CONTROL.test(element.localName || '') && (element.disabled || usedDarkScheme(element) || forcedColors())) {
            for (const name of CONTROL_COLOURS) if (!(name in specified)) unresolved.add(name);
        }
        // A later longhand can hide the var() shorthand from CSSOM; the
        // browser still resolved it, so read what is left from computed style
        if (unresolved.size && element.isConnected && typeof getComputedStyle !== 'undefined') {
            this.liveNames = unresolved;
            const computed = getComputedStyle(element);
            let typed;
            for (const name of unresolved) {
                let value = computed.getPropertyValue(name);
                if (value && mayBeRounded(value)) value = exactValue(typed ??= element.computedStyleMap?.(), name, value);
                if (value) specified[name] = value;
            }
            this.watchLiveAnimations(element, unresolved);
        }
        // SVG presentation attributes
        if (element.namespaceURI === 'http://www.w3.org/2000/svg') {
            for (const attr of ['fill', 'stroke', 'stroke-width', 'opacity', 'width', 'height']) {
                const value = element.getAttribute(attr);
                if (value != null && !(attr in specified)) specified[attr] = /^[\d.]+$/.test(value) && (attr === 'width' || attr === 'height') ? `${value}px` : value;
            }
        }
        specified[AUTHORED] = authored;
        return specified;
    }

    /**
     * A transition or animation on a name read live gives the value it has
     * now, not the one it ends on (the read itself can start a transition
     * at its first frame): the style is not kept (liveMoving), and
     * onLiveSettled(element) asks for a restyle once the animation ends.
     */
    watchLiveAnimations(element, names) {
        // What a value read live depends on moves it too: a colour may be
        // currentcolor, which follows an animated color, the element's own or
        // one it inherits; a var() may follow an animated custom property
        const colours = [...names].some((name) => COLOR_BEARING.test(name));
        for (let node = element, own = true; node?.nodeType === 1; node = node.parentElement, own = false) {
            for (const animation of this.animationsOf(node)) {
                const touches = animatedNames(animation).some((name) => (own && names.has(name)) || name.startsWith('--') || (colours && name === 'color'));
                if (!touches) continue;
                this.liveMoving = true;
                let waiting = this.watched.get(animation);
                if (!waiting) this.watched.set(animation, waiting = new Set());
                if (waiting.has(element)) continue;
                waiting.add(element);
                const settle = () => this.onLiveSettled?.(element);
                animation.finished.then(settle, settle);
            }
            // Only color (and custom properties) inherit among what a live colour follows
            if (!colours) break;
        }
    }

    /** `node`'s running animations, read once per task (a layout pass asks for many descendants). */
    animationsOf(node) {
        if (!this.animationCache) {
            this.animationCache = new Map();
            queueMicrotask(() => { this.animationCache = null; });
        }
        let list = this.animationCache.get(node);
        if (!list) {
            try {
                list = (node.getAnimations?.() || []).filter((animation) => animation.playState !== 'finished');
            } catch {
                list = [];
            }
            this.animationCache.set(node, list);
        }
        return list;
    }

    /**
     * Compute the style of `element` given its parent's computed style
     * (null for the scene root, which inherits from `rootInherited`).
     */
    /**
     * Style of `element`'s ::before or ::after (`which`) given the element's
     * computed style, or null when no rule styles it.
     */
    computePseudo(element, which, elementStyle) {
        if (element.nodeType !== 1 || !this.rulesOf(element)?.pseudoCount) return null;
        const pseudo = pseudoElementOf(element, which);
        const layers = this.cascade(pseudo);
        if (!layers.length) return null;
        const style = this.compute(pseudo, elementStyle, null, layers);
        // attr() reads the element's attributes, which the reused style does not track
        const content = parseContent(style.contentValue, element);
        return content === style.content ? style : { ...style, content };
    }

    compute(element, parent, rootInherited = null, layers = this.cascade(element)) {
        const inheritedFrom = parent || this.stableRoot(rootInherited) || ROOT_DEFAULTS;
        const vp = this.viewport();
        const own = this.rulesOf(element);
        const base = this.rules?.signature ?? null;
        const inputs = {
            generation: this.generation,
            inheritedFrom,
            styleAttribute: this.styleKey(element),
            attributes: uaAttributes(element),
            // An element of a nested tree also follows its own tree's sheets
            rules: own && own !== this.rules ? `${base}|${this.tableId(own)}:${own.signature}` : base,
            viewport: `${vp.width}x${vp.height}@${this.zoom}`,
            layers,
            extra: NO_EXTRA
        };
        const memo = this.memo.get(element);
        if (!(element instanceof PseudoElement)) inputs.extra = this.pseudoInputs(element, own, memo, inputs);
        if (memo && !memo.moving && sameInputs(memo.inputs, inputs) && this.containersHold(element, memo.containers)) return memo.style;
        this.liveMoving = false;
        this.containerReads = null;
        let style = this.sharedStyle(element, inputs, vp);
        // The query containers container units read (with their sizes then)
        const containers = this.containerReads;
        this.containerReads = null;
        // Inputs that changed no value (a page transition's view-transition-name)
        // keep the style object, so the styles and boxes below it are kept too
        if (memo && sameValues(memo.style, style)) style = memo.style;
        // A value read mid-transition is not reused (the next restyle reads
        // again), but it stays the element's last style (lastStyle)
        this.memo.set(element, { inputs, style, moving: this.liveMoving, containers });
        return style;
    }

    /** The style last computed for `element`, or null. */
    lastStyle(element) {
        return this.memo.get(element)?.style ?? null;
    }

    /** A stable id for an object the sharing key names (a declaration block, a rules or UA table). */
    tableId(object) {
        let id = this.blockIds.get(object);
        if (id === undefined) {
            id = ++this.nextId;
            this.blockIds.set(object, id);
        }
        return id;
    }

    /** Id of the computed values a style object holds (copies made by sharedStyle share it). */
    valueId(style) {
        let id = this.valueIds.get(style);
        if (id === undefined) {
            id = ++this.nextId;
            this.valueIds.set(style, id);
        }
        return id;
    }

    /**
     * Compute a style, or take the values of an element computed with the
     * same inputs: a parent style holding the same values, the same tag,
     * namespace and attributes UA defaults read, the same matched rules and
     * the same style attribute (so the same inline declarations), under the
     * same generation, rules and viewport. The element gets a copy of those
     * values with its own `element`, so no two elements share a style object.
     * Styles that read the browser's computed style (an unresolved var()
     * shorthand) and generated content are not shared.
     */
    sharedStyle(element, inputs, vp) {
        if (element instanceof PseudoElement) return this.computeStyle(element, inputs.inheritedFrom, inputs.layers, vp);
        // The scene tree's rules: an element of a nested tree keys its own (inputs.rules)
        const stamp = `${inputs.generation}|${this.rules?.signature ?? null}|${inputs.viewport}`;
        if (stamp !== this.sharedStamp) {
            this.shared.clear();
            this.sharedStamp = stamp;
        }
        const svg = element.namespaceURI === 'http://www.w3.org/2000/svg' ? 'svg' : '';
        let key = `${this.valueId(inputs.inheritedFrom)}|${element.localName}|${svg}|${inputs.attributes.length}:${inputs.attributes}|`;
        for (const { style, important } of inputs.layers) {
            if (style === element.style) {
                key += important ? 's!,' : 's,';
                continue;
            }
            key += important ? `${this.tableId(style)}!,` : `${this.tableId(style)},`;
        }
        key += `|${inputs.styleAttribute}`;
        // The tree (rules and UA defaults) and the highlight and scrollbar rules
        key += `|${inputs.rules}|${this.tableId(this.uaFor(element))}`;
        if (inputs.extra !== NO_EXTRA) {
            key += '|h';
            for (const style of inputs.extra.selection) key += `${this.tableId(style)},`;
            for (const { style, part, states } of inputs.extra.scrollbar) key += `${this.tableId(style)}:${part}:${states.join(':')},`;
        }
        const entry = this.shared.get(key);
        if (entry) {
            // Least recently used entries leave first
            this.shared.delete(key);
            this.shared.set(key, entry);
            const copy = { ...entry.values, element };
            this.valueIds.set(copy, entry.id);
            return copy;
        }
        this.readLive = false;
        const style = this.computeStyle(element, inputs.inheritedFrom, inputs.layers, vp, inputs.styleAttribute, inputs.extra);
        // Container units depend on where the element sits: its values are its own
        if (this.readLive || this.containerReads) return style;
        const id = ++this.nextId;
        this.valueIds.set(style, id);
        // The entry keeps the values without the element, so removed elements are not kept alive
        this.shared.set(key, { id, values: { ...style, element: null } });
        if (this.shared.size > this.sharedLimit) this.shared.delete(this.shared.keys().next().value);
        return style;
    }

    computeStyle(element, inheritedFrom, layers, vp, styleText, extra = NO_EXTRA) {
        const custom = new Map(inheritedFrom.custom || []);
        // Element custom properties first, so var() inside them can see the parent's
        for (const { style, important } of layers) {
            for (const [name, value] of this.digest(style, element, styleText)[important ? 1 : 0].custom) custom.set(name, value);
        }
        const customLookup = (name) => {
            if (custom.has(name)) return custom.get(name);
            return this.variables(name);
        };
        let specified = this.readSpecified(element, customLookup, layers, styleText);
        const live = this.liveNames;
        if (live) {
            // Values read from the browser's computed style belong to this
            // element alone: note whether any of them is used. SVG presentation
            // attributes already tested which of them were set.
            this.liveNames = null;
            if (element.namespaceURI === 'http://www.w3.org/2000/svg') this.readLive = true;
            else {
                specified = new Proxy(specified, {
                    get: (target, name) => {
                        if (live.has(name)) this.readLive = true;
                        return target[name];
                    }
                });
            }
        }
        const ua = summaryDefaults(element, this.uaFor(element).get(element));
        const isSvg = element.namespaceURI === 'http://www.w3.org/2000/svg';
        const tag = element.localName || 'div';

        const raw = (name) => {
            let value = specified[name];
            if (value == null && name === 'white-space') value = whiteSpaceFrom(specified);
            if (value == null) value = ua[name];
            if (value == null || value === 'unset') {
                return INHERITED.has(name) ? { inherit: true } : { initial: true };
            }
            const text = String(value).trim();
            if (text === 'inherit') return { inherit: true };
            if (text === 'initial') return { initial: true };
            if (text.includes('var(')) {
                const resolved = resolveVars(text, customLookup);
                if (resolved == null) return INHERITED.has(name) ? { inherit: true } : { initial: true };
                return { value: resolved.trim() };
            }
            return { value: text };
        };
        const get = (name) => {
            const r = raw(name);
            if (r.inherit) return { inherit: true, value: null };
            if (r.initial) return { value: INITIAL[name] ?? '', initial: true };
            return r;
        };

        const cs = { element, tag, isSvg, custom };
        if (element instanceof PseudoElement) {
            cs.contentValue = get('content').value;
            cs.content = parseContent(cs.contentValue, element.host);
        }
        const parentFontSize = inheritedFrom.fontSize ?? 16;
        // Container query units: the nearest query container's size, read live
        const containerSize = (axis) => this.queryContainerSize(element, axis);

        // Font size first; em lengths depend on it
        const fs = get('font-size');
        if (fs.inherit) cs.fontSize = parentFontSize;
        else {
            const text = fs.value.toLowerCase();
            if (FONT_SIZE_KEYWORDS[text]) cs.fontSize = FONT_SIZE_KEYWORDS[text];
            else if (text === 'smaller') cs.fontSize = parentFontSize / 1.2;
            else if (text === 'larger') cs.fontSize = parentFontSize * 1.2;
            else {
                const length = parseLength(text);
                cs.fontSize = resolveLength(length, {
                    percentBase: parentFontSize, fontSize: parentFontSize, rootFontSize: this.rootFontSize, vw: vp.width, vh: vp.height, containerSize
                }) ?? parentFontSize;
            }
        }
        const lengthCtx = {
            fontSize: cs.fontSize, rootFontSize: this.rootFontSize, vw: vp.width, vh: vp.height, containerSize,
            // ch: measured only when a length uses it, in this element's font
            chWidth: () => zeroAdvance(
                cs.fontSize,
                inheritOr('font-family', 'fontFamily', (v) => v),
                inheritOr('font-weight', 'fontWeight', (v) => parseFontWeight(v, inheritedFrom.fontWeight ?? 400)),
                keyword('font-style') || 'normal'
            )
        };
        // Parse a length now; em/rem/vw fold to px, percentages stay for layout
        const length = (value) => {
            const parsed = parseLength(value);
            if (parsed == null || parsed === 'auto') return parsed;
            if (typeof parsed !== 'object') return parsed;
            const out = {};
            for (const [key, v] of Object.entries(parsed)) {
                if (key === 'pct') out.pct = v;
                else if (key === 'min' || key === 'max' || key === 'clamp') out[key] = v.map((arg) => length(serializeLength(arg)) || { px: 0 });
                else {
                    const px = resolveLength({ [key]: v }, lengthCtx);
                    out.px = (out.px || 0) + (px ?? 0);
                }
            }
            return out;
        };
        const inheritOr = (name, fallback, parse) => {
            const r = get(name);
            if (r.inherit) return inheritedFrom[fallback];
            return parse(r.value);
        };

        // Colour before anything that can use currentcolor
        cs.color = inheritOr('color', 'color', (v) => parseColor(v, inheritedFrom.color) || inheritedFrom.color || [0, 0, 0, 1]);
        const color = (name) => {
            const r = get(name);
            if (r.inherit) return inheritedFrom[camel(name)] || [...TRANSPARENT];
            return parseColor(r.value, cs.color) || (name === 'background-color' ? [...TRANSPARENT] : [...cs.color]);
        };
        const keyword = (name) => {
            const r = get(name);
            if (r.inherit) return inheritedFrom[camel(name)];
            return String(r.value).toLowerCase();
        };
        const number = (name, fallback = 0) => {
            const r = get(name);
            if (r.inherit) return inheritedFrom[camel(name)] ?? fallback;
            const n = parseFloat(r.value);
            return Number.isFinite(n) ? n : fallback;
        };

        // Display
        let display = keyword('display') || 'inline';
        if (element.hasAttribute?.('hidden') && specified.display == null) display = 'none';
        if (isSvg && tag !== 'svg') display = 'svg-child';
        cs.display = display;

        cs.position = keyword('position');
        for (const side of SIDES) cs[side] = length(get(side).value) ?? 'auto';
        const z = get('z-index').value;
        cs.zIndex = z === 'auto' || z == null ? 'auto' : parseInt(z, 10) || 0;
        cs.boxSizing = keyword('box-sizing');
        if (this.defaultBoxSizing && specified['box-sizing'] == null && !ua['box-sizing']) cs.boxSizing = this.defaultBoxSizing;

        for (const prop of ['width', 'height', 'min-width', 'min-height']) {
            const value = get(prop).value;
            const lower = String(value).toLowerCase();
            cs[camel(prop)] = ['auto', 'fit-content', 'max-content', 'min-content', ''].includes(lower) ? (lower === '' ? 'auto' : lower) : (length(value) ?? 'auto');
        }
        for (const prop of ['max-width', 'max-height']) {
            const value = get(prop).value;
            cs[camel(prop)] = !value || value === 'none' ? 'none' : (length(value) ?? 'none');
        }
        cs.margin = SIDES.map((side) => length(get(`margin-${side}`).value) ?? { px: 0 });
        cs.padding = SIDES.map((side) => {
            const l = length(get(`padding-${side}`).value);
            return l && l !== 'auto' ? l : { px: 0 };
        });
        cs.borderStyle = SIDES.map((side) => keyword(`border-${side}-style`) || 'none');
        cs.borderWidth = SIDES.map((side, i) => {
            if (cs.borderStyle[i] === 'none' || cs.borderStyle[i] === 'hidden') return 0;
            const value = get(`border-${side}-width`).value;
            const px = BORDER_WIDTH_KEYWORDS[value] ?? resolveLength(length(value), lengthCtx) ?? 0;
            return snapBorderWidth(px, this.zoom);
        });
        cs.borderColor = SIDES.map((side) => color(`border-${side}-color`));
        cs.borderRadius = CORNERS.map((corner, i) => {
            const r = get(`border-${corner}-radius`);
            // inherit takes the parent's computed radius (a percentage stays one)
            if (r.inherit) return inheritedFrom.borderRadius?.[i] || [{ px: 0 }, { px: 0 }];
            const value = r.value || '0px';
            const [h, v] = splitWhitespace(value);
            return [length(h) || { px: 0 }, length(v ?? h) || { px: 0 }];
        });

        cs.backgroundColor = color('background-color');
        let bgImage = get('background-image').value;
        // Gradient lengths in font or viewport units become px, as the computed
        // value has them (a stop at 36rem is a stop at 36 root ems)
        if (bgImage && /gradient\(/i.test(bgImage) && /\d(r?em|vw|vh|vmin|vmax|pt|cq(?:w|h|i|b|min|max))\b/i.test(bgImage)) {
            bgImage = bgImage.replace(/(^|[\s,(])(-?(?:\d+\.?\d*|\.\d+))(rem|em|vw|vh|vmin|vmax|pt|cqw|cqh|cqi|cqb|cqmin|cqmax)(?=[\s,)]|$)/gi, (match, lead, number, unit) => {
                const value = Number(number);
                const lower = unit.toLowerCase();
                const px = lower.startsWith('cq') ? resolveLength({ [lower]: value }, lengthCtx)
                    : lower === 'rem' ? value * this.rootFontSize
                        : lower === 'em' ? value * cs.fontSize
                            : lower === 'pt' ? value * 4 / 3
                                : value / 100 * (lower === 'vw' ? vp.width : lower === 'vh' ? vp.height
                                    : lower === 'vmin' ? Math.min(vp.width, vp.height) : Math.max(vp.width, vp.height));
                return `${lead}${px}px`;
            });
        }
        // Layers top first: linear, radial and conic gradients and url() images
        cs.backgroundImage = bgImage && bgImage !== 'none' && bgImage !== 'initial' ? parseBackgroundLayers(bgImage, cs.color) : [];
        cs.backgroundClip = keyword('background-clip');
        cs.backgroundOrigin = keyword('background-origin');
        cs.backgroundSize = String(get('background-size').value || 'auto');
        cs.backgroundPositionX = String(get('background-position-x').value || specified['background-position']?.split(' ')[0] || '0%');
        cs.backgroundPositionY = String(get('background-position-y').value || specified['background-position']?.split(' ')[1] || '0%');
        cs.backgroundRepeat = String(get('background-repeat').value
            || [specified['background-repeat-x'], specified['background-repeat-y']].filter(Boolean).join(' ') || 'repeat');
        cs.boxShadow = parseBoxShadow(get('box-shadow').value, cs.color, lengthCtx);
        const filter = get('filter').value;
        cs.dropShadows = filter && filter !== 'none' ? parseDropShadowFilter(filter, cs.color, lengthCtx) : [];
        cs.colorFilter = filter && filter !== 'none' ? parseColorFilter(filter) : null;
        cs.blurFilter = filter && filter !== 'none' ? parseBlurFilter(filter, lengthCtx) : 0;
        const backdrop = get('backdrop-filter').value;
        cs.backdropBlur = backdrop && backdrop !== 'none' ? parseBlurFilter(backdrop, lengthCtx) : 0;
        cs.backdropColor = backdrop && backdrop !== 'none' ? parseColorFilter(backdrop) : null;
        // As written: any value but none makes a stacking context, identity filters too
        cs.filter = filter || 'none';
        cs.backdropFilter = backdrop || 'none';
        cs.opacity = Math.max(0, Math.min(1, number('opacity', 1)));
        cs.visibility = keyword('visibility') || 'visible';
        cs.overflowX = keyword('overflow-x') || 'visible';
        cs.overflowY = keyword('overflow-y') || 'visible';
        if (cs.overflowX !== 'visible' && cs.overflowY === 'visible') cs.overflowY = 'auto';
        if (cs.overflowY !== 'visible' && cs.overflowX === 'visible') cs.overflowX = 'auto';
        // Whether an inline <svg> shows a drawing past its box: the UA hides it
        // (svg:not(:root) { overflow: hidden }) unless a rule says otherwise.
        // Paint only: layout keeps treating the replaced box as it did
        const svgFlow = element.localName === 'svg' ? raw('overflow-x') : null;
        cs.svgOverflow = svgFlow ? (svgFlow.value ? String(svgFlow.value).toLowerCase() : 'hidden') : null;

        cs.flexDirection = keyword('flex-direction');
        cs.flexWrap = keyword('flex-wrap');
        cs.justifyContent = keyword('justify-content');
        cs.alignItems = keyword('align-items');
        cs.alignSelf = keyword('align-self');
        cs.alignContent = keyword('align-content');
        cs.flexGrow = number('flex-grow', 0);
        cs.flexShrink = number('flex-shrink', 1);
        const basis = get('flex-basis').value;
        cs.flexBasis = basis === 'auto' || basis === 'content' || !basis ? (basis || 'auto') : (length(basis) ?? 'auto');
        cs.order = number('order', 0);
        cs.rowGap = get('row-gap').value === 'normal' ? { px: 0 } : (length(get('row-gap').value) || { px: 0 });
        cs.columnGap = get('column-gap').value === 'normal' ? { px: 0 } : (length(get('column-gap').value) || { px: 0 });

        cs.gridTemplateColumns = parseTrackList(get('grid-template-columns').value);
        cs.gridTemplateRows = parseTrackList(get('grid-template-rows').value);
        cs.gridTemplateAreas = parseTemplateAreas(get('grid-template-areas').value);
        cs.gridAutoFlow = keyword('grid-auto-flow');
        cs.gridAutoRows = parseTrackList(get('grid-auto-rows').value) || [{ type: 'auto', keyword: 'auto' }];
        cs.gridAutoColumns = parseTrackList(get('grid-auto-columns').value) || [{ type: 'auto', keyword: 'auto' }];
        cs.justifyItems = keyword('justify-items');
        cs.justifySelf = keyword('justify-self');
        cs.gridColumnStart = parseGridLine(get('grid-column-start').value);
        cs.gridColumnEnd = parseGridLine(get('grid-column-end').value);
        cs.gridRowStart = parseGridLine(get('grid-row-start').value);
        cs.gridRowEnd = parseGridLine(get('grid-row-end').value);

        cs.fontFamily = inheritOr('font-family', 'fontFamily', (v) => v);
        cs.fontWeight = inheritOr('font-weight', 'fontWeight', (v) => parseFontWeight(v, inheritedFrom.fontWeight ?? 400));
        cs.fontStyle = keyword('font-style') || 'normal';
        cs.lineHeight = inheritOr('line-height', 'lineHeight', (v) => {
            const text = String(v).toLowerCase();
            if (text === 'normal') return { normal: true };
            if (/^[\d.]+$/.test(text)) return { number: parseFloat(text) };
            const l = parseLength(text);
            if (l && l !== 'auto' && 'pct' in l) return { px: l.pct / 100 * cs.fontSize };
            const px = resolveLength(length(text), lengthCtx);
            return px == null ? { normal: true } : { px };
        });
        // A number line-height inherits as the number; px inherit as px
        cs.letterSpacing = inheritOr('letter-spacing', 'letterSpacing', (v) => v === 'normal' ? 0 : (resolveLength(length(v), lengthCtx) ?? 0));
        cs.fontKerning = inheritOr('font-kerning', 'fontKerning', (v) => String(v).toLowerCase()) || 'auto';
        // Inherited so a scheme change gives descendants a new parent style
        // (system colours and the focus ring follow it)
        cs.colorScheme = inheritOr('color-scheme', 'colorScheme', (v) => String(v).trim().toLowerCase()) || 'normal';
        cs.wordSpacing = inheritOr('word-spacing', 'wordSpacing', (v) => v === 'normal' ? 0 : (resolveLength(length(v), lengthCtx) ?? 0));
        cs.textAlign = keyword('text-align') || 'start';
        cs.textTransform = keyword('text-transform') || 'none';
        cs.textDecorationLine = keyword('text-decoration-line') || 'none';
        cs.textDecorationColor = color('text-decoration-color');
        cs.textOverflow = keyword('text-overflow') || 'clip';
        cs.whiteSpace = keyword('white-space') || 'normal';
        cs.overflowWrap = (specified['word-wrap'] || keyword('overflow-wrap') || 'normal').toLowerCase();
        cs.wordBreak = keyword('word-break') || 'normal';
        const vaRead = get('vertical-align');
        if (vaRead.inherit) {
            cs.verticalAlign = inheritedFrom.verticalAlign ?? 'baseline';
        } else {
            const va = vaRead.value || 'baseline';
            cs.verticalAlign = /^[-\d.]/.test(va) ? { px: resolveLength(length(va), { ...lengthCtx, percentBase: cs.fontSize }) ?? 0 } : va.toLowerCase();
        }
        cs.textIndent = resolveLength(length(get('text-indent').value || '0px'), lengthCtx) ?? 0;
        cs.listStyleType = keyword('list-style-type') || 'disc';
        cs.listStylePosition = keyword('list-style-position') || 'outside';
        cs.cursor = keyword('cursor') || 'auto';
        cs.pointerEvents = keyword('pointer-events') || 'auto';
        cs.userSelect = keyword('user-select') || 'auto';
        // Read by form controls only: the browser draws them natively unless 'none'
        cs.appearance = keyword('appearance') || 'auto';
        // A push button the page gives no background or border keeps the
        // native theme's face (Blink's IsControlStyled): DisplayList paints it
        cs.nativeFace = cs.appearance !== 'none' && isPushButton(element)
            && ![...(specified[AUTHORED] || Object.keys(specified))].some((name) => AUTHOR_FACE.test(name));
        // A checkbox or radio the browser draws natively keeps no padding or
        // border (Blink resets both); its width, height and min sizes still apply
        if (cs.appearance !== 'none' && element.localName === 'input' && /^(checkbox|radio)$/i.test(element.getAttribute?.('type') || '')) {
            cs.padding = [{ px: 0 }, { px: 0 }, { px: 0 }, { px: 0 }];
            cs.borderWidth = [0, 0, 0, 0];
        }
        cs.aspectRatio = parseAspectRatio(get('aspect-ratio').value);
        cs.transform = individualTransforms(get('translate').value, get('rotate').value, get('scale').value, get('transform').value || 'none');
        cs.transformOrigin = get('transform-origin').value || '50% 50%';
        // Read for stacking contexts (DisplayList createsContext)
        cs.isolation = keyword('isolation') || 'auto';
        cs.mixBlendMode = keyword('mix-blend-mode') || 'normal';
        cs.willChange = keyword('will-change') || 'auto';
        cs.contain = keyword('contain') || 'none';
        cs.contentVisibility = keyword('content-visibility') || 'visible';
        cs.clipPath = keyword('clip-path') || 'none';
        cs.maskImage = keyword('mask-image') || 'none';
        cs.perspective = keyword('perspective') || 'none';
        cs.transformStyle = keyword('transform-style') || 'flat';
        cs.viewTransitionName = keyword('view-transition-name') || 'none';
        cs.offsetPath = keyword('offset-path') || 'none';
        cs.boxReflect = keyword('-webkit-box-reflect') || 'none';
        cs.outlineStyle = keyword('outline-style') || 'none';
        const ow = get('outline-width').value;
        cs.outlineWidth = cs.outlineStyle === 'none' ? 0 : snapBorderWidth(BORDER_WIDTH_KEYWORDS[ow] ?? resolveLength(length(ow), lengthCtx) ?? 0, this.zoom);
        cs.outlineColor = color('outline-color');
        // Snapped like a border width, keeping its sign, as the browser computes it
        const outlineOffset = resolveLength(length(get('outline-offset').value || '0px'), lengthCtx) ?? 0;
        cs.outlineOffset = Math.sign(outlineOffset) * snapBorderWidth(Math.abs(outlineOffset), this.zoom);
        // A focus ring's contrast ring is dark in a dark colour scheme
        if (cs.outlineStyle === 'auto') cs.focusRingDark = usedDarkScheme(element);
        cs.fill = inheritOr('fill', 'fill', (v) => (v === 'none' ? null : parseColor(v, cs.color)));
        cs.stroke = inheritOr('stroke', 'stroke', (v) => (v === 'none' ? null : parseColor(v, cs.color)));
        cs.strokeWidth = inheritOr('stroke-width', 'strokeWidth', (v) => parseFloat(v) || 1);
        cs.objectFit = keyword('object-fit') || 'fill';
        cs.borderCollapse = keyword('border-collapse') || 'separate';
        // CSSOM stores an author's border-spacing as its two -webkit- longhands
        const spacing = ['-webkit-border-horizontal-spacing', '-webkit-border-vertical-spacing'].map((name) => specified[name]);
        if (spacing.some((value) => value != null)) {
            const parent = inheritedFrom.borderSpacing ?? [0, 0];
            cs.borderSpacing = spacing.map((value, i) => {
                const text = value == null ? 'inherit' : String(value).trim();
                if (text === 'inherit' || text === 'unset') return parent[i];
                if (text === 'initial') return 0;
                const resolved = text.includes('var(') ? resolveVars(text, customLookup) : text;
                return resolved == null ? parent[i] : resolveLength(length(resolved), lengthCtx) ?? 0;
            });
        } else {
            cs.borderSpacing = inheritOr('border-spacing', 'borderSpacing', (v) => {
                const parts = splitWhitespace(v).map((p) => resolveLength(length(p), lengthCtx) ?? 0);
                return [parts[0] ?? 0, parts[1] ?? parts[0] ?? 0];
            });
        }
        cs.tableLayout = keyword('table-layout') || 'auto';
        cs.textShadow = get('text-shadow').value === 'none' ? [] : parseBoxShadow(get('text-shadow').value, cs.color, lengthCtx);
        // -webkit-line-clamp (not inherited) clamps only a -webkit-box or
        // -webkit-inline-box with -webkit-box-orient vertical (block-axis is
        // vertical); Chrome then computes display flow-root (inline-block for
        // the inline box, flow-root again once blockified). Elsewhere null
        const clamp = parseLineClamp(get('-webkit-line-clamp').value);
        const orient = keyword('-webkit-box-orient');
        cs.lineClamp = null;
        if (clamp != null && (orient === 'vertical' || orient === 'block-axis')
            && (cs.display === '-webkit-box' || cs.display === '-webkit-inline-box')) {
            cs.lineClamp = clamp;
            const blockified = cs.position === 'absolute' || cs.position === 'fixed';
            cs.display = cs.display === '-webkit-inline-box' && !blockified ? 'inline-block' : 'flow-root';
        }
        // Scrollbar fields (CSS Scrollbars). scrollbar-width (auto, thin,
        // none) and scrollbar-gutter (auto, stable, stable both-edges) are not
        // inherited; scrollbar-color is: null for auto, else { thumb, track }
        const width = keyword('scrollbar-width');
        cs.scrollbarWidth = width === 'thin' || width === 'none' ? width : 'auto';
        const gutter = splitWhitespace(keyword('scrollbar-gutter') || 'auto');
        cs.scrollbarGutter = gutter.includes('stable') ? (gutter.includes('both-edges') ? 'stable both-edges' : 'stable') : 'auto';
        // currentcolor in an inherited colour property inherits as the keyword
        // (Chrome: a child resolves it with its own colour), kept by name here
        const parentCurrent = String(inheritedFrom.currentColorKeywords || '').split(' ');
        const current = [];
        const scrollbarColor = get('scrollbar-color');
        let thumbTrack = null;
        if (!scrollbarColor.inherit) {
            const text = String(scrollbarColor.value).trim();
            if (text.toLowerCase() === 'auto') thumbTrack = 'auto';
            else {
                const parts = splitWhitespace(text);
                const colours = parts.length === 2 ? parts.map((part) => parseColor(part, cs.color)) : [];
                if (colours.length === 2 && colours[0] && colours[1]) {
                    thumbTrack = { thumb: colours[0], track: colours[1] };
                    parts.forEach((part, i) => { if (part.toLowerCase() === 'currentcolor') current.push(i ? 'track' : 'thumb'); });
                }
            }
        }
        if (thumbTrack === 'auto') cs.scrollbarColor = null;
        else if (thumbTrack) cs.scrollbarColor = thumbTrack;
        else {
            // Inherited (or invalid once its var() resolved: unset)
            const parent = inheritedFrom.scrollbarColor ?? null;
            cs.scrollbarColor = parent && {
                thumb: parentCurrent.includes('thumb') ? [...cs.color] : parent.thumb,
                track: parentCurrent.includes('track') ? [...cs.color] : parent.track
            };
            for (const key of ['thumb', 'track']) if (parent && parentCurrent.includes(key)) current.push(key);
        }
        // accent-color (inherited): null for auto
        const accent = get('accent-color');
        const accentText = accent.inherit ? null : String(accent.value).trim().toLowerCase();
        const accentColor = accentText && accentText !== 'auto' ? parseColor(accent.value, cs.color) : null;
        if (accentText === 'auto') cs.accentColor = null;
        else if (accentColor) {
            cs.accentColor = accentColor;
            if (accentText === 'currentcolor') current.push('accent');
        } else if (parentCurrent.includes('accent')) {
            cs.accentColor = [...cs.color];
            current.push('accent');
        } else cs.accentColor = inheritedFrom.accentColor ?? null;
        cs.currentColorKeywords = current.join(' ');
        // image-rendering (inherited): auto, pixelated, crisp-edges or
        // -webkit-optimize-contrast (Chrome paints that one smoothly, as auto
        // when scaling up, with a lower-quality filter when scaling down)
        const rendering = keyword('image-rendering');
        cs.imageRendering = IMAGE_RENDERING.has(rendering) ? rendering : (inheritedFrom.imageRendering ?? 'auto');
        // -webkit-text-fill-color (inherited): null for currentcolor, its
        // initial value, which inherits as the keyword (the text's own colour)
        const fill = get('-webkit-text-fill-color');
        const fillText = fill.inherit ? null : String(fill.value).trim();
        if (fillText && fillText.toLowerCase() === 'currentcolor') cs.webkitTextFillColor = null;
        else cs.webkitTextFillColor = (fillText && parseColor(fillText, cs.color)) || (inheritedFrom.webkitTextFillColor ?? null);
        // Numeric figures and OpenType features (inherited; the UA font
        // shorthand on form controls sets both back to normal), as Chrome
        // writes their computed values
        const numeric = get('font-variant-numeric');
        cs.fontVariantNumeric = (!numeric.inherit && normalizeFontVariantNumeric(numeric.value)) || (inheritedFrom.fontVariantNumeric ?? 'normal');
        const features = get('font-feature-settings');
        cs.fontFeatureSettings = (!features.inherit && normalizeFontFeatureSettings(features.value)) || (inheritedFrom.fontFeatureSettings ?? 'normal');
        // CSSOM expands the transition shorthand into one comma list per longhand
        cs.transitions = specified.transition ? transitionsOf(specified.transition)
            : specified['transition-property'] ? transitionsOf(null, [specified['transition-property'], specified['transition-duration'] || '0s',
                specified['transition-timing-function'] || 'ease', specified['transition-delay'] || '0s'])
            : [];
        cs.animationName = (specified['animation-name'] || '').trim() || (specified.animation ? splitWhitespace(specified.animation).find((t) => /^[a-z_][\w-]*$/i.test(t) && !['ease', 'linear', 'infinite', 'alternate', 'forwards', 'backwards', 'both', 'normal', 'reverse', 'ease-in', 'ease-out', 'ease-in-out', 'running', 'paused'].includes(t)) : '') || 'none';
        // CSSOM expands the animation shorthand; rebuild it from the longhands
        cs.animation = specified.animation || (specified['animation-name'] && specified['animation-name'] !== 'none'
            ? [specified['animation-name'], specified['animation-duration'] || '0s', specified['animation-timing-function'] || 'ease',
                specified['animation-delay'] || '0s', specified['animation-iteration-count'] || '1', specified['animation-direction'] || 'normal',
                specified['animation-play-state'] === 'paused' ? 'paused' : ''].join(' ').trim()
            : '');
        cs.animationDuration = specified['animation-duration'] || '';
        cs.direction = keyword('direction') || 'ltr';
        if (cs.textAlign === 'start') cs.textAlign = cs.direction === 'rtl' ? 'right' : 'left';
        if (cs.textAlign === 'end') cs.textAlign = cs.direction === 'rtl' ? 'left' : 'right';
        if (cs.textAlign === '-webkit-center') cs.textAlign = 'center';
        // caret-color auto (or currentcolor) is the element's own text colour,
        // inherited too: null, so a transparent caret stays transparent
        cs.caretColor = inheritOr('caret-color', 'caretColor', (v) => {
            const text = String(v).trim().toLowerCase();
            return text === 'auto' || text === 'currentcolor' ? null : parseColor(v, cs.color);
        }) ?? null;
        // A text field's placeholder colour, as the browser computes it (its
        // ::placeholder default or page rules; that pseudo-element is not in
        // the cascade read here)
        cs.placeholderColor = null;
        if ((element.localName === 'input' || element.localName === 'textarea') && element.isConnected && typeof getComputedStyle !== 'undefined') {
            const placeholder = getComputedStyle(element, '::placeholder');
            const parsed = parseColor(placeholder.color, cs.color);
            const opacity = parseFloat(placeholder.opacity);
            if (parsed) cs.placeholderColor = [parsed[0], parsed[1], parsed[2], parsed[3] * (Number.isFinite(opacity) ? opacity : 1)];
        }
        // ::selection: { color, background } or null (highlightOf)
        cs.selection = highlightOf(extra.selection, inheritedFrom.selection ?? null, customLookup, cs.color);
        cs.webkitScrollbar = this.scrollbarStyles(element, cs, extra.scrollbar, vp);
        return cs;
    }

    /**
     * The ::-webkit-scrollbar part styles scroll container `element` (style
     * `cs`) uses, or null: no ::-webkit-scrollbar rule without a scrollbar
     * state matches it, it does not scroll, or scrollbar-width or
     * scrollbar-color is set (inherited scrollbar-color too: Chrome then
     * draws standard scrollbars and ignores these rules, as measured).
     *
     * { width, height, display, scrollbar, thumb, track, trackPiece, button,
     * corner, resizer, horizontal, hover, active }: width is the vertical
     * bar's thickness, height the horizontal bar's (scrollbarThickness: CSS
     * px before device-pixel flooring, 0 or 'auto'; layout takes
     * floor(px * dsf) / dsf); each part is the part's computed style (inheriting
     * from the element, `element` null) or null when no rule styles it
     * (Chrome then paints nothing for it). The top-level parts are the
     * vertical bar's (corner and resizer have no orientation); `horizontal`
     * holds the horizontal bar's, and `hover` / `active` ({ vertical,
     * horizontal }) the parts with :hover / :active rules applied, null when
     * no rule names that state. Button states (:start, :increment...) and
     * :window-inactive never match; :enabled always does.
     */
    scrollbarStyles(element, cs, entries, vp) {
        if (!entries?.length || element instanceof PseudoElement) return null;
        if (cs.scrollbarWidth !== 'auto' || cs.scrollbarColor || !scrolls(cs)) return null;
        // Chrome switches to custom bars only when a ::-webkit-scrollbar rule
        // with no state matches (matched against the element, a state never
        // holds: :horizontal, :enabled, :hover and :not() alone leave native
        // bars, as measured); the state rules apply once it has switched
        if (!entries.some((entry) => entry.part === 'scrollbar' && !entry.states.length)) return null;
        const vertical = { vertical: true };
        const horizontal = { horizontal: true };
        // A part whose rules are the same in two states (no :horizontal or
        // :hover rule for it) is one style object in both
        const computed = new Map();
        const part = (name, state) => {
            const blocks = [];
            for (const entry of entries) if (entry.part === name && scrollbarStatesHold(entry.states, state)) blocks.push(entry.style);
            if (!blocks.length) return null;
            const key = `${name}|${blocks.map((style) => this.tableId(style)).join(',')}`;
            let style = computed.get(key);
            if (!style) {
                const layers = [...blocks.map((block) => ({ style: block, important: false })), ...blocks.map((block) => ({ style: block, important: true }))];
                style = { ...this.computeStyle(scrollbarPseudoOf(element, name), cs, layers, vp), element: null };
                computed.set(key, style);
            }
            return style;
        };
        const set = (state) => {
            const out = {};
            for (const name of SCROLLBAR_SET) out[name] = part(name, state);
            return out;
        };
        const variant = (key) => (entries.some((entry) => entry.states.includes(key))
            ? { vertical: set({ ...vertical, [key]: true }), horizontal: set({ ...horizontal, [key]: true }) }
            : null);
        const down = set(vertical);
        const across = set(horizontal);
        return {
            width: scrollbarThickness(down.scrollbar, 'width'),
            height: scrollbarThickness(across.scrollbar, 'height'),
            display: down.scrollbar?.display ?? 'inline',
            ...down,
            corner: part('corner', {}),
            resizer: part('resizer', {}),
            horizontal: across,
            hover: variant('hover'),
            active: variant('active')
        };
    }
}

const camelNames = new Map();

function camel(name) {
    let out = camelNames.get(name);
    if (out === undefined) {
        out = name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        camelNames.set(name, out);
    }
    return out;
}

// Parsed transition lists by text; each style gets its own copies
const transitionLists = new Map();
const TRANSITION_LIMIT = 1024;

/**
 * Transitions of a `transition` value, or of its `longhands` as CSSOM lists
 * them: [property, duration, timing function, delay].
 */
function transitionsOf(text, longhands) {
    const key = longhands ? longhands.join('\n') : text;
    let list = transitionLists.get(key);
    if (!list) {
        list = parseTransitions(longhands ? pairTransitionLonghands(longhands) : text);
        if (transitionLists.size >= TRANSITION_LIMIT) transitionLists.clear();
        transitionLists.set(key, list);
    }
    return list.map((transition) => ({ ...transition }));
}

/**
 * The longhand lists as one transition list, item by item: transition-property
 * sets the count, a shorter list repeats and a longer one is cut.
 */
function pairTransitionLonghands([property, ...others]) {
    const lists = others.map((value) => splitTopLevel(value, ','));
    return splitTopLevel(property, ',')
        .map((name, i) => [name, ...lists.map((list) => list[i % list.length])].join(' '))
        .join(', ');
}

function serializeLength(length) {
    if (!length || typeof length !== 'object') return '0px';
    const parts = Object.entries(length).filter(([key]) => !['min', 'max', 'clamp'].includes(key))
        .map(([key, value]) => key === 'pct' ? `${value}%` : key === 'number' ? `${value}` : `${value}${key}`);
    return parts.length > 1 ? `calc(${parts.join(' + ')})` : (parts[0] || '0px');
}

// Inherited defaults for a scene root that has no parent style
export const ROOT_DEFAULTS = Object.freeze({
    color: [0, 0, 0, 1],
    fontSize: 16,
    fontFamily: 'Times New Roman',
    fontWeight: 400,
    fontStyle: 'normal',
    lineHeight: { normal: true },
    letterSpacing: 0,
    wordSpacing: 0,
    textAlign: 'left',
    textTransform: 'none',
    whiteSpace: 'normal',
    visibility: 'visible',
    cursor: 'auto',
    listStyleType: 'disc',
    listStylePosition: 'outside',
    overflowWrap: 'normal',
    wordBreak: 'normal',
    pointerEvents: 'auto',
    fill: [0, 0, 0, 1],
    stroke: null,
    strokeWidth: 1,
    direction: 'ltr',
    borderCollapse: 'separate',
    borderSpacing: [0, 0],
    userSelect: 'auto',
    fontKerning: 'auto',
    colorScheme: 'normal',
    caretColor: null,
    scrollbarColor: null,
    accentColor: null,
    currentColorKeywords: '',
    imageRendering: 'auto',
    webkitTextFillColor: null,
    fontVariantNumeric: 'normal',
    fontFeatureSettings: 'normal',
    selection: null,
    custom: new Map()
});

/**
 * Inherited style of a host element in the page, read from the browser once,
 * so a GPU scene inherits the same font and colour its DOM twin would.
 */
export function inheritedStyleFromHost(host) {
    if (typeof getComputedStyle === 'undefined' || !host?.isConnected) return ROOT_DEFAULTS;
    const computed = getComputedStyle(host);
    const fontSize = parseFloat(exactPx(host.computedStyleMap?.(), 'font-size', computed.fontSize)) || 16;
    // Computed style reports a number line-height (1.5) in px; a probe with a
    // different font size tells a multiplier from a length
    let lineHeight = computed.lineHeight === 'normal' ? { normal: true } : { px: parseFloat(computed.lineHeight) };
    if (!lineHeight.normal) {
        // Probe beside the host (not inside, so an observed scene does not
        // change) unless the host sets line-height itself
        const parent = host.style?.lineHeight || !host.parentElement ? host : host.parentElement;
        const probeSize = fontSize * 4 + 7;
        const probe = document.createElement('div');
        probe.setAttribute('aria-hidden', 'true');
        probe.style.cssText = `position:absolute;visibility:hidden;font-size:${probeSize}px;`;
        parent.appendChild(probe);
        const probed = parseFloat(getComputedStyle(probe).lineHeight);
        probe.remove();
        if (Number.isFinite(probed) && Math.abs(probed - parseFloat(computed.lineHeight)) > 0.01) {
            lineHeight = { number: probed / probeSize };
        }
    }
    return {
        ...ROOT_DEFAULTS,
        color: parseColor(computed.color) || [0, 0, 0, 1],
        fontSize,
        fontFamily: computed.fontFamily,
        fontWeight: parseFontWeight(computed.fontWeight, 400),
        fontStyle: computed.fontStyle,
        lineHeight,
        letterSpacing: computed.letterSpacing === 'normal' ? 0 : parseFloat(computed.letterSpacing) || 0,
        wordSpacing: computed.wordSpacing === 'normal' ? 0 : parseFloat(computed.wordSpacing) || 0,
        fontKerning: computed.fontKerning || 'auto',
        colorScheme: computed.colorScheme || 'normal',
        // caret-color auto resolves to the colour; anything else is the page's own caret colour
        caretColor: !computed.caretColor || computed.caretColor === computed.color ? null : parseColor(computed.caretColor),
        textAlign: ['start', 'left', '-webkit-auto'].includes(computed.textAlign) ? 'left' : computed.textAlign,
        textTransform: computed.textTransform,
        whiteSpace: computed.whiteSpace,
        visibility: computed.visibility,
        cursor: computed.cursor,
        direction: computed.direction,
        // Inherited fields as the host computes them (a currentcolor there
        // arrives resolved: computed style does not tell it apart)
        scrollbarColor: thumbAndTrack(computed.scrollbarColor),
        accentColor: computed.accentColor && computed.accentColor !== 'auto' ? parseColor(computed.accentColor) : null,
        imageRendering: IMAGE_RENDERING.has(computed.imageRendering) ? computed.imageRendering : 'auto',
        webkitTextFillColor: !computed.webkitTextFillColor || computed.webkitTextFillColor === computed.color
            ? null : parseColor(computed.webkitTextFillColor),
        fontVariantNumeric: normalizeFontVariantNumeric(computed.fontVariantNumeric) || 'normal',
        fontFeatureSettings: normalizeFontFeatureSettings(computed.fontFeatureSettings) || 'normal',
        selection: hostHighlight(host),
        custom: new Map()
    };
}

/** A computed scrollbar-color as { thumb, track }, or null for auto. */
function thumbAndTrack(value) {
    const parts = splitWhitespace(String(value || 'auto'));
    if (parts.length !== 2) return null;
    const thumb = parseColor(parts[0]);
    const track = parseColor(parts[1]);
    return thumb && track ? { thumb, track } : null;
}

/**
 * The highlight `host`'s descendants inherit (highlightOf): the ::selection
 * rules of each element from the top of its flat tree down to it, each in
 * its own tree's rules, with var() read from that element.
 */
function hostHighlight(host) {
    const chain = [];
    for (let node = host; node?.nodeType === 1; node = flatParent(node)) chain.push(node);
    let highlight = null;
    const refreshed = new Set();
    for (let i = chain.length - 1; i >= 0; i--) {
        const node = chain[i];
        const rules = rulesFor(node.getRootNode());
        if (!refreshed.has(rules)) {
            refreshed.add(rules);
            rules.refresh();
        }
        if (!rules.selectionCount) continue;
        const blocks = rules.matchPseudo(node, 'selection');
        if (!blocks.length) continue;
        const computed = getComputedStyle(node);
        const lookup = (name) => computed.getPropertyValue(name).trim() || undefined;
        highlight = highlightOf(blocks, highlight, lookup, parseColor(computed.color) || [0, 0, 0, 1]);
    }
    return highlight;
}
