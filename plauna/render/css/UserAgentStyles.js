// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Default element styles for Plauna's own style pass.
 *
 * Widgets style themselves inline, but native elements (button, input,
 * headings, lists, tables) still carry the browser's defaults. GPU mode needs
 * those to lay elements out the way the DOM does.
 *
 * A static table holds Chromium's defaults. When a document is available,
 * calibrate() reads the real defaults (browser plus page CSS for bare
 * elements) from probe elements, so GPU layout matches DOM layout on the page
 * it runs in. Only values the element's own rules set are kept; inherited
 * values stay inherited. Sizes depend on the layout zoom (LayoutUnits), so
 * the table is read again when it changes.
 */

import { layoutZoom, roundUnit, cssZoomOf } from '../layout/LayoutUnits.js';

// Properties that inherit by default
export const INHERITED = new Set([
    'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing',
    'word-spacing', 'text-align', 'text-transform', 'white-space', 'visibility', 'cursor',
    'list-style-type', 'list-style-position', 'overflow-wrap', 'word-break', 'pointer-events',
    'fill', 'stroke', 'stroke-width', 'direction', 'border-collapse', 'border-spacing', 'user-select',
    'text-indent', 'caret-color', 'font-kerning', 'color-scheme',
    'scrollbar-color', 'accent-color', 'image-rendering', '-webkit-text-fill-color', 'font-variant-numeric',
    'font-feature-settings'
]);

const BLOCK_TAGS = ['div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'nav', 'header', 'footer',
    'section', 'article', 'aside', 'main', 'form', 'fieldset', 'figure', 'figcaption', 'blockquote',
    'details', 'summary', 'dl', 'dd', 'dt', 'pre', 'hr', 'legend', 'menu', 'dialog', 'address'];

const BASE = {
    // Chromium defaults; calibrate() replaces them with measured values.
    li: { display: 'list-item' },
    ul: { 'margin-top': '1em', 'margin-bottom': '1em', 'padding-left': '40px', 'list-style-type': 'disc' },
    ol: { 'margin-top': '1em', 'margin-bottom': '1em', 'padding-left': '40px', 'list-style-type': 'decimal' },
    menu: { 'margin-top': '1em', 'margin-bottom': '1em', 'padding-left': '40px', 'list-style-type': 'disc' },
    p: { 'margin-top': '1em', 'margin-bottom': '1em' },
    blockquote: { 'margin-top': '1em', 'margin-bottom': '1em', 'margin-left': '40px', 'margin-right': '40px' },
    h1: { 'font-size': '2em', 'font-weight': '700', 'margin-top': '0.67em', 'margin-bottom': '0.67em' },
    h2: { 'font-size': '1.5em', 'font-weight': '700', 'margin-top': '0.83em', 'margin-bottom': '0.83em' },
    h3: { 'font-size': '1.17em', 'font-weight': '700', 'margin-top': '1em', 'margin-bottom': '1em' },
    h4: { 'font-weight': '700', 'margin-top': '1.33em', 'margin-bottom': '1.33em' },
    h5: { 'font-size': '0.83em', 'font-weight': '700', 'margin-top': '1.67em', 'margin-bottom': '1.67em' },
    h6: { 'font-size': '0.67em', 'font-weight': '700', 'margin-top': '2.33em', 'margin-bottom': '2.33em' },
    pre: { 'font-family': 'monospace', 'white-space': 'pre', 'margin-top': '1em', 'margin-bottom': '1em' },
    code: { 'font-family': 'monospace' },
    kbd: { 'font-family': 'monospace' },
    strong: { 'font-weight': '700' },
    b: { 'font-weight': '700' },
    em: { 'font-style': 'italic' },
    i: { 'font-style': 'italic' },
    small: { 'font-size': 'smaller' },
    sub: { 'vertical-align': 'sub', 'font-size': 'smaller' },
    sup: { 'vertical-align': 'super', 'font-size': 'smaller' },
    a: { color: '#0000ee', 'text-decoration-line': 'underline', cursor: 'pointer' },
    u: { 'text-decoration-line': 'underline' },
    hr: {
        'margin-top': '8px', 'margin-bottom': '8px', 'border-top-width': '1px', 'border-bottom-width': '1px',
        'border-left-width': '1px', 'border-right-width': '1px', 'border-top-style': 'inset',
        'border-bottom-style': 'inset', 'border-left-style': 'inset', 'border-right-style': 'inset',
        'border-top-color': 'gray', 'border-bottom-color': 'gray', 'border-left-color': 'gray', 'border-right-color': 'gray'
    },
    table: { display: 'table', 'border-collapse': 'separate', 'border-spacing': '2px', 'box-sizing': 'border-box' },
    thead: { display: 'table-header-group', 'vertical-align': 'middle' },
    tbody: { display: 'table-row-group', 'vertical-align': 'middle' },
    tfoot: { display: 'table-footer-group', 'vertical-align': 'middle' },
    tr: { display: 'table-row', 'vertical-align': 'inherit' },
    td: { display: 'table-cell', 'vertical-align': 'inherit', 'padding-top': '1px', 'padding-bottom': '1px', 'padding-left': '1px', 'padding-right': '1px' },
    th: { display: 'table-cell', 'vertical-align': 'inherit', 'font-weight': '700', 'text-align': 'center', 'padding-top': '1px', 'padding-bottom': '1px', 'padding-left': '1px', 'padding-right': '1px' },
    caption: { display: 'table-caption', 'text-align': 'center' },
    button: {
        display: 'inline-block', 'box-sizing': 'border-box', 'text-align': 'center', cursor: 'default',
        'font-size': '13.3333px', 'font-family': 'Arial', 'font-weight': '400', 'line-height': 'normal',
        'padding-top': '1px', 'padding-bottom': '1px', 'padding-left': '6px', 'padding-right': '6px',
        'border-top-width': '2px', 'border-bottom-width': '2px', 'border-left-width': '2px', 'border-right-width': '2px',
        'border-top-style': 'outset', 'border-bottom-style': 'outset', 'border-left-style': 'outset', 'border-right-style': 'outset',
        'border-top-color': 'rgb(118, 118, 118)', 'border-bottom-color': 'rgb(118, 118, 118)',
        'border-left-color': 'rgb(118, 118, 118)', 'border-right-color': 'rgb(118, 118, 118)',
        'background-color': 'rgb(239, 239, 239)', color: 'rgb(0, 0, 0)', 'letter-spacing': 'normal',
        'white-space': 'normal'
    },
    'input:text': {
        display: 'inline-block', 'font-size': '13.3333px', 'font-family': 'Arial', 'line-height': 'normal',
        'padding-top': '1px', 'padding-bottom': '1px', 'padding-left': '2px', 'padding-right': '2px',
        'border-top-width': '2px', 'border-bottom-width': '2px', 'border-left-width': '2px', 'border-right-width': '2px',
        'border-top-style': 'inset', 'border-bottom-style': 'inset', 'border-left-style': 'inset', 'border-right-style': 'inset',
        'border-top-color': 'rgb(118, 118, 118)', 'border-bottom-color': 'rgb(118, 118, 118)',
        'border-left-color': 'rgb(118, 118, 118)', 'border-right-color': 'rgb(118, 118, 118)',
        'background-color': 'rgb(255, 255, 255)', color: 'rgb(0, 0, 0)', cursor: 'text', 'white-space': 'pre',
        'intrinsic-width': '153px', 'intrinsic-height': '21px'
    },
    'input:checkbox': {
        display: 'inline-block', 'box-sizing': 'border-box', 'intrinsic-width': '13px', 'intrinsic-height': '13px',
        'margin-top': '3px', 'margin-bottom': '3px', 'margin-left': '4px', 'margin-right': '3px', cursor: 'default'
    },
    'input:radio': {
        display: 'inline-block', 'box-sizing': 'border-box', 'intrinsic-width': '13px', 'intrinsic-height': '13px',
        'margin-top': '3px', 'margin-bottom': '0px', 'margin-left': '5px', 'margin-right': '3px', cursor: 'default'
    },
    'input:range': {
        display: 'inline-block', 'box-sizing': 'border-box', 'intrinsic-width': '129px', 'intrinsic-height': '16px',
        'margin-top': '2px', 'margin-bottom': '2px', 'margin-left': '2px', 'margin-right': '2px', cursor: 'default'
    },
    'input:color': {
        display: 'inline-block', 'box-sizing': 'border-box', 'intrinsic-width': '50px', 'intrinsic-height': '27px',
        'padding-top': '1px', 'padding-bottom': '1px', 'padding-left': '2px', 'padding-right': '2px',
        'border-top-width': '1px', 'border-bottom-width': '1px', 'border-left-width': '1px', 'border-right-width': '1px',
        'border-top-style': 'solid', 'border-bottom-style': 'solid', 'border-left-style': 'solid', 'border-right-style': 'solid',
        'border-top-color': 'rgb(118, 118, 118)', 'border-bottom-color': 'rgb(118, 118, 118)',
        'border-left-color': 'rgb(118, 118, 118)', 'border-right-color': 'rgb(118, 118, 118)',
        'background-color': 'rgb(239, 239, 239)'
    },
    'input:hidden': { display: 'none' },
    textarea: {
        display: 'inline-block', 'font-size': '13.3333px', 'font-family': 'monospace', 'line-height': 'normal',
        'padding-top': '2px', 'padding-bottom': '2px', 'padding-left': '2px', 'padding-right': '2px',
        'border-top-width': '1px', 'border-bottom-width': '1px', 'border-left-width': '1px', 'border-right-width': '1px',
        'border-top-style': 'solid', 'border-bottom-style': 'solid', 'border-left-style': 'solid', 'border-right-style': 'solid',
        'border-top-color': 'rgb(118, 118, 118)', 'border-bottom-color': 'rgb(118, 118, 118)',
        'border-left-color': 'rgb(118, 118, 118)', 'border-right-color': 'rgb(118, 118, 118)',
        'background-color': 'rgb(255, 255, 255)', color: 'rgb(0, 0, 0)', cursor: 'text', 'white-space': 'pre-wrap',
        'overflow-wrap': 'break-word', 'vertical-align': 'text-bottom', 'overflow-y': 'auto', 'overflow-x': 'auto'
    },
    select: {
        'select-extra-width': '24px', 'select-extra-height': '2px',
        display: 'inline-block', 'box-sizing': 'border-box', 'font-size': '13.3333px', 'font-family': 'Arial',
        'border-top-width': '1px', 'border-bottom-width': '1px', 'border-left-width': '1px', 'border-right-width': '1px',
        'border-top-style': 'solid', 'border-bottom-style': 'solid', 'border-left-style': 'solid', 'border-right-style': 'solid',
        'background-color': 'rgb(255, 255, 255)', color: 'rgb(0, 0, 0)', cursor: 'default'
    },
    img: { display: 'inline' },
    svg: { display: 'inline' },
    option: { display: 'block' },
    datalist: { display: 'none' },
    template: { display: 'none' },
    script: { display: 'none' },
    style: { display: 'none' },
    head: { display: 'none' },
    title: { display: 'none' },
    source: { display: 'none' },
    br: { display: 'inline' },
    progress: { display: 'inline-block', 'intrinsic-width': '160px', 'intrinsic-height': '16px', 'box-sizing': 'border-box', 'vertical-align': '-0.2em' },
    meter: { display: 'inline-block', 'intrinsic-width': '80px', 'intrinsic-height': '16px', 'box-sizing': 'border-box', 'vertical-align': '-0.2em' },
    label: { cursor: 'default' },
    canvas: { display: 'inline' },
    video: { display: 'inline' },
    iframe: { display: 'inline' },
    audio: { display: 'none' }
};
for (const tag of BLOCK_TAGS) {
    BASE[tag] = { display: 'block', ...(BASE[tag] || {}) };
}
// Text-like input types share the text field defaults
for (const type of ['search', 'email', 'password', 'url', 'tel', 'number', 'date', 'time', 'datetime-local', 'month', 'week']) {
    BASE[`input:${type}`] = { ...BASE['input:text'] };
}
BASE['input:file'] = { display: 'inline-block', 'font-size': '13.3333px', 'font-family': 'Arial', 'intrinsic-width': '253px', 'intrinsic-height': '21px' };
BASE['input:button'] = BASE['input:submit'] = BASE['input:reset'] = { ...BASE.button };

// The UA's `font: -webkit-small-control` on form controls sets these back to
// their initial values, so controls do not inherit them (measured, Chrome
// 155: an input under tabular-nums computes normal). Probes cannot see a
// reset to the value the parent has, so calibrate() keeps them
const CONTROL_FONT_RESET = { 'font-variant-numeric': 'normal', 'font-feature-settings': 'normal', 'font-kerning': 'auto' };
for (const [key, entry] of Object.entries(BASE)) {
    if (key === 'button' || key === 'textarea' || key === 'select' || key.startsWith('input:')) Object.assign(entry, CONTROL_FONT_RESET);
}

// Properties calibrate() reads from probe elements
const PROBED = [
    'display', 'box-sizing', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'background-color', 'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
    'letter-spacing', 'text-align', 'text-transform', 'white-space', 'cursor', 'list-style-type',
    'text-decoration-line', 'vertical-align', 'overflow-x', 'overflow-y', 'border-spacing', 'border-collapse',
    'overflow-wrap'
];

// Elements whose intrinsic size the probe also records
const SIZED = new Set(['input:text', 'input:checkbox', 'input:radio', 'input:range', 'input:color',
    'input:file', 'input:search', 'input:email', 'input:password', 'input:number', 'input:date', 'input:time',
    'input:url', 'input:tel', 'textarea', 'select', 'progress', 'meter']);

export class UserAgentStyles {
    constructor() {
        this.table = new Map(Object.entries(BASE));
        this.calibrated = false;
    }

    /** Key for an element: tag, or input:type for inputs. */
    keyFor(element) {
        const tag = element.localName || element.tagName?.toLowerCase() || 'div';
        if (tag === 'input') {
            const type = (element.getAttribute?.('type') || 'text').toLowerCase();
            return `input:${type}`;
        }
        return tag;
    }

    /** Default declarations (kebab-case) for an element, or an empty object. */
    get(element) {
        const key = this.keyFor(element);
        return this.table.get(key) || (key.startsWith('input:') ? this.table.get('input:text') : null) || EMPTY;
    }

    /**
     * Read real defaults from probe elements placed in `host` (so page CSS for
     * bare elements applies, as it would in DOM mode). Safe to call more than once.
     */
    calibrate(host) {
        if (typeof document === 'undefined' || !host?.isConnected) return false;
        const zoom = layoutZoom();
        if (this.calibrated && this.zoom === zoom) return false;
        const probe = document.createElement('div');
        probe.setAttribute('aria-hidden', 'true');
        probe.style.cssText = 'position:absolute;left:-10000px;top:0;width:1000px;visibility:hidden;contain:layout style;';
        host.appendChild(probe);
        // The same elements at another font size: lengths that scale with it
        // are em-based (1em paragraph margins) and stay so, px ones stay px
        const scaled = probe.cloneNode();
        scaled.style.fontSize = `${Math.round(parseFloat(getComputedStyle(probe).fontSize) * 1.5) + 1}px`;
        host.appendChild(scaled);
        try {
            const parentStyle = getComputedStyle(probe);
            const keys = new Set([...this.table.keys(), ...BLOCK_TAGS, 'span', 'label', 'a', 'button']);
            for (const key of keys) {
                const [tag, type] = key.split(':');
                if (['head', 'title', 'script', 'style', 'template', 'source', 'audio'].includes(tag)) continue;
                const element = placeProbe(probe, tag, type);
                if (!element) continue;
                const computed = getComputedStyle(element);
                const typed = element.computedStyleMap?.();
                const contextStyle = getComputedStyle(element.parentElement);
                const other = placeProbe(scaled, tag, type);
                const otherStyle = getComputedStyle(other);
                const otherContext = getComputedStyle(other.parentElement);
                const entry = {};
                for (const property of PROBED) {
                    const value = computed.getPropertyValue(property);
                    if (!value) continue;
                    // A border colour only matters where the element's rules draw a border;
                    // otherwise it is just currentcolor and must follow the element's colour
                    const side = /^border-(top|right|bottom|left)-color$/.exec(property);
                    if (side && computed.getPropertyValue(`border-${side[1]}-style`) === 'none') continue;
                    if (INHERITED.has(property)) {
                        // Keep only what the element's own rules change. A unitless
                        // line-height is inherited as a number, so its px value follows
                        // the element's font size without any rule setting it
                        if (property === 'line-height' && sameLineHeightRatio(computed, contextStyle)) continue;
                        if (value !== contextStyle.getPropertyValue(property)) entry[property] = value;
                    } else if (value !== INITIAL[property]) {
                        entry[property] = value;
                    }
                    if (entry[property] === value && SCALABLE.has(property)) {
                        entry[property] = scaledLength(property, value, otherStyle.getPropertyValue(property),
                            property === 'font-size' ? [contextStyle, otherContext] : [computed, otherStyle]);
                    }
                    if (entry[property] === value && value.endsWith('px')) entry[property] = exactPx(typed, property, value);
                }
                if (SIZED.has(key)) {
                    const rect = element.getBoundingClientRect();
                    // Intrinsic size, read by the layout pass; not a declared width
                    // (rects read under body zoom, the UI scale, are zoomed: back to CSS px)
                    const z = cssZoomOf(element);
                    entry['intrinsic-width'] = `${roundUnit(rect.width / z, zoom)}px`;
                    entry['intrinsic-height'] = `${roundUnit(rect.height / z, zoom)}px`;
                }
                // Probes read used values; keep keyword defaults the table relies on
                const base = BASE[key] || {};
                for (const keep of ['display', 'list-style-type', 'white-space', ...Object.keys(CONTROL_FONT_RESET)]) {
                    if (base[keep] && !entry[keep]) entry[keep] = base[keep];
                }
                this.table.set(key, entry);
            }
            // A select is as wide as its widest option, rounded up to a whole
            // layout pixel at the scaled font size, plus the arrow area
            const select = document.createElement('select');
            const option = document.createElement('option');
            option.textContent = 'MMMMMMMMMM';
            select.appendChild(option);
            probe.appendChild(select);
            const computed = getComputedStyle(select);
            const ctx = document.createElement('canvas').getContext('2d');
            ctx.font = `${computed.fontStyle} ${computed.fontWeight} ${parseFloat(computed.fontSize) * zoom}px ${computed.fontFamily}`;
            const textWidth = Math.ceil(ctx.measureText(option.textContent).width - 1e-6) / zoom;
            const z = cssZoomOf(select);
            const zoomed = select.getBoundingClientRect();
            const rect = { width: zoomed.width / z, height: zoomed.height / z };
            const px = (name) => parseFloat(computed.getPropertyValue(name)) || 0;
            const pbW = px('padding-left') + px('padding-right') + px('border-left-width') + px('border-right-width');
            const pbH = px('padding-top') + px('padding-bottom') + px('border-top-width') + px('border-bottom-width');
            // and as tall as its font's ascent and descent (no line gap)
            const metrics = ctx.measureText('M');
            const fontHeight = (Math.round(metrics.fontBoundingBoxAscent) + Math.round(metrics.fontBoundingBoxDescent)) / zoom;
            const entry = this.table.get('select') || {};
            entry['select-extra-width'] = `${Math.max(0, roundUnit(rect.width - pbW - textWidth, zoom))}px`;
            entry['select-extra-height'] = `${Math.max(0, roundUnit(rect.height - pbH - fontHeight, zoom))}px`;
            this.table.set('select', entry);
            void parentStyle;
            this.calibrated = true;
            this.zoom = zoom;
        } finally {
            probe.remove();
            scaled.remove();
        }
        return true;
    }
}

const EMPTY = Object.freeze({});

/** Create a probe element for `tag` (and input type) in `container`, inside any wrapper it needs. */
function placeProbe(container, tag, type) {
    let element;
    try {
        element = document.createElement(tag);
    } catch {
        return null;
    }
    if (type) element.setAttribute('type', type);
    if (tag === 'li') {
        const list = document.createElement('ul');
        list.appendChild(element);
        container.appendChild(list);
    } else if (['td', 'th'].includes(tag)) {
        const table = document.createElement('table');
        table.innerHTML = '<tbody><tr></tr></tbody>';
        table.querySelector('tr').appendChild(element);
        container.appendChild(table);
    } else if (tag === 'tr') {
        const table = document.createElement('table');
        const body = document.createElement('tbody');
        body.appendChild(element);
        table.appendChild(body);
        container.appendChild(table);
    } else if (['thead', 'tbody', 'tfoot', 'caption'].includes(tag)) {
        const table = document.createElement('table');
        table.appendChild(element);
        container.appendChild(table);
    } else {
        container.appendChild(element);
    }
    return element;
}

// Probed lengths that UA or page rules may set in em
const SCALABLE = new Set([
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'font-size', 'line-height', 'letter-spacing', 'vertical-align'
]);

/**
 * A probed length as the rule that set it: `value` was read at one font
 * size, `other` at another. A length that scales with the reference font
 * size (the parent's for font-size, the element's own otherwise) is returned
 * in em (line-height as a number); one that does not stays as read.
 */
function scaledLength(property, value, other, [style, otherStyle]) {
    const a = /^(-?[\d.]+)px$/.exec(value);
    const b = /^(-?[\d.]+)px$/.exec(other);
    if (!a || !b) return value;
    const pa = parseFloat(a[1]);
    const pb = parseFloat(b[1]);
    if (Math.abs(pa - pb) < 0.01) return value;
    const fa = parseFloat(style.fontSize);
    const fb = parseFloat(otherStyle.fontSize);
    if (!fa || !fb || Math.abs(fa - fb) < 0.01) return value;
    const ra = pa / fa;
    const rb = pb / fb;
    if (Math.abs(ra - rb) > 0.002 * Math.max(1, Math.abs(ra))) return value;
    const ratio = +((ra + rb) / 2).toFixed(4);
    return property === 'line-height' ? String(ratio) : `${ratio}em`;
}

/**
 * A px length at full precision: computed style strings keep six digits
 * (13.3333px for the 13.333333px of form controls), the typed OM keeps all.
 */
export function exactPx(typed, property, value) {
    try {
        const length = typed?.get(property);
        if (length?.unit === 'px' && Math.abs(length.value - parseFloat(value)) < 1e-3) return `${length.value}px`;
    } catch {
        // Not a property the typed OM knows
    }
    return value;
}

/** True when two computed styles have the same line-height to font-size ratio. */
function sameLineHeightRatio(style, parent) {
    const lineHeight = parseFloat(style.lineHeight);
    const parentLineHeight = parseFloat(parent.lineHeight);
    const fontSize = parseFloat(style.fontSize);
    const parentFontSize = parseFloat(parent.fontSize);
    if (!Number.isFinite(lineHeight) || !Number.isFinite(parentLineHeight) || !fontSize || !parentFontSize) return false;
    return Math.abs(lineHeight / fontSize - parentLineHeight / parentFontSize) < 0.002;
}

// Initial values (as getComputedStyle reports them) for non-inherited probed properties
const INITIAL = {
    display: 'inline', 'box-sizing': 'content-box',
    'margin-top': '0px', 'margin-right': '0px', 'margin-bottom': '0px', 'margin-left': '0px',
    'padding-top': '0px', 'padding-right': '0px', 'padding-bottom': '0px', 'padding-left': '0px',
    'border-top-width': '0px', 'border-right-width': '0px', 'border-bottom-width': '0px', 'border-left-width': '0px',
    'border-top-style': 'none', 'border-right-style': 'none', 'border-bottom-style': 'none', 'border-left-style': 'none',
    'border-top-left-radius': '0px', 'border-top-right-radius': '0px', 'border-bottom-right-radius': '0px', 'border-bottom-left-radius': '0px',
    'background-color': 'rgba(0, 0, 0, 0)', 'text-decoration-line': 'none', 'vertical-align': 'baseline',
    'overflow-x': 'visible', 'overflow-y': 'visible'
};

export const userAgentStyles = new UserAgentStyles();

const scopedDefaults = new WeakMap();

/**
 * UA defaults for elements in tree `root`: the shared table, or one of a
 * shadow root's own, calibrated with that root's style sheets.
 */
export function userAgentStylesFor(root) {
    if (typeof ShadowRoot === 'undefined' || !(root instanceof ShadowRoot)) return userAgentStyles;
    let defaults = scopedDefaults.get(root);
    if (!defaults) {
        scopedDefaults.set(root, (defaults = new UserAgentStyles()));
        treeDefaults.add(defaults);
    }
    return defaults;
}

const treeDefaults = new WeakSet();

/**
 * Whether `defaults` are a tree's shared table (userAgentStylesFor), so
 * elements of other trees take their own tree's; a table a caller built
 * itself stays as given.
 */
export function isTreeDefaults(defaults) {
    return defaults === userAgentStyles || treeDefaults.has(defaults);
}
