// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * DisplayList - turns a Plauna layout into GPU painter items, in CSS
 * painting order.
 *
 * For each stacking context: its own background and borders, negative
 * z-index children, in-flow block backgrounds, inline content (text, inline
 * boxes, atomic inlines, flex and grid items), positioned descendants, then
 * positive z-index children; outlines and focus rings last.
 *
 * Also paints what the browser would draw for native controls (text field
 * values, placeholders, carets and selections, checkboxes, radios, ranges,
 * colour swatches, progress bars, meters, selects, push-button labels) and
 * scroll containers (classic bars and ::-webkit-scrollbar parts), cuts holes
 * for native-content wells (setHole), and resolves images and SVG through the
 * Rasterizer. Records the paint order for hit testing.
 *
 * Every paintContext() call (a stacking context, or a box painted as a unit:
 * inline-blocks, flex and grid items, replaced elements) writes contiguous
 * ranges of items, paint order, outline jobs and atlas entries. When nothing
 * in a unit's subtree changed since the last frame (box.changed, see
 * LayoutTree.markChanged) and the view is the same, its ranges are copied
 * from the last frame instead of walking it again.
 */

import { KIND, FLOATS_PER_ITEM, HOLE_PAGE, NEAREST } from './shaders.js';
import { resolveRadii, transformRectBounds } from '../layout/LayoutEngine.js';
import { paintClock, markChanged } from '../layout/LayoutTree.js';
import { invertAffine, linearGradientAngle, multiplyAffine, parseColor, parsePosition, parseTransform, parseTransformOrigin, resolveLength, resolvePositionAxis, splitTopLevel, splitWhitespace } from '../css/CssValues.js';
import { PseudoElement, StyleResolver } from '../css/StyleResolver.js';
import { specificity } from '../css/StyleRules.js';
import { applyTextTransform, graphemes, BUTTON_INPUTS } from '../text/TextShaper.js';
import { ceilUnit, truncUnit } from '../layout/LayoutUnits.js';
import { compositeMatrixFor } from '../LayerAnimations.js';

const SIDE_TOP = 1;
const SIDE_RIGHT = 2;
const SIDE_BOTTOM = 4;
const SIDE_LEFT = 8;
const NO_FILL = 16;
const DASHED = 32;
const DOTTED = 64;
// Border sides that later and earlier items of the same border draw, from
// bits 8 and 12, so the box shader can share the seams between them
const LATER_SIDES_SHIFT = 8;
const EARLIER_SIDES_SHIFT = 12;
// The inner and outer shading of a rounded ridge or groove: the whole border
// inside and outside the item's shape2
const RIDGE_INSIDE = 65536;
const RIDGE_OUTSIDE = 131072;

// Whether the user can scroll `box` now: auto or scroll overflow on an axis
// whose content reaches past its padding box
function canScroll(box) {
    const s = box.style;
    const scrolls = (value) => value === 'auto' || value === 'scroll';
    const wide = box.scrollWidth > box.width - box.border[1] - box.border[3] + 0.01;
    const tall = box.scrollHeight > box.height - box.border[0] - box.border[2] + 0.01;
    return Boolean(box.scroller) && ((scrolls(s.overflowX) && wide) || (scrolls(s.overflowY) && tall));
}

function styleFlag(style) {
    return style === 'dashed' ? DASHED : style === 'dotted' ? DOTTED : 0;
}

// Lighter and darker shades for 3D border styles, as Chrome derives them: the
// brightest channel moves a third of the way, the others scale with it, and
// each channel is cut down to a whole byte. Black lightens to gray 84
const SHADE_SCALE = 255.99998474121094; // the largest float32 below 256
const shadeByte = (v) => Math.min(255, Math.trunc(v * SHADE_SCALE)) / 255;

function lightShade(color) {
    const [r, g, b, a] = color;
    const v = Math.max(r, g, b);
    if (v <= 0) return [84 / 255, 84 / 255, 84 / 255, a];
    const k = Math.min(1, v + 0.33) / v;
    return [shadeByte(r * k), shadeByte(g * k), shadeByte(b * k), a];
}

function darkShade(color) {
    const [r, g, b, a] = color;
    const v = Math.max(r, g, b);
    const k = v <= 0 ? 0 : Math.max(0, (v - 0.33) / v);
    return [shadeByte(r * k), shadeByte(g * k), shadeByte(b * k), a];
}

function luminance([r, g, b]) {
    const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

// One side of a 3D border: the shadowed side darkens and the lit side
// lightens. Colours darker than gray 32 lighten on both (the lit side twice),
// and colours lighter than gray 235 keep their own colour on the lit side
function shade3d(color, shadowed) {
    const lum = luminance(color);
    if (lum < 0.014443844) return shadowed ? lightShade(color) : lightShade(lightShade(color));
    if (shadowed) return darkShade(color);
    return lum > 0.83077 ? color : lightShade(color);
}

// inset shadows its top and left, outset its bottom and right. Ridge paints its
// outer half as outset and its inner half as inset; groove the other way round
function shadeSide(color, style, side, half = 'outer') {
    if (!color) return color;
    let inset = style === 'inset';
    if (style === 'ridge' || style === 'groove') inset = (style === 'groove') === (half === 'outer');
    else if (!inset && style !== 'outset') return color;
    return shade3d(color, (side === 0 || side === 3) === inset);
}

const isRidgeOrGroove = (style) => style === 'ridge' || style === 'groove';

// Dashed and dotted borders on a rounded box, as the browser strokes them: one
// dash pattern runs clockwise round the centreline from the top-left corner's
// end. That centreline is the border box inset by half the width cut down to
// whole device pixels; its length is Skia's measure (each corner a conic cut
// into chords), truncated to whole pixels, and sizes the pattern
const DASH_PATH = 262144;
const CONIC_MAX_T = 0x3fffffff;

// A quarter circle of radius r from (r, 0) to (0, r), as the conic Skia draws
function conicPoint(t, r) {
    const s = 1 - t;
    const a = s * s;
    const b = 2 * Math.SQRT1_2 * t * s;
    const c = t * t;
    const d = a + b + c;
    return [(a + b) / d * r, (b + c) / d * r];
}

// The length SkContourMeasure gives that quarter circle: halves of its
// parameter range are split while their midpoint strays over half a pixel
// from their chord, and the chords are summed
function conicLength(r) {
    if (!(r > 0)) return 0;
    const measure = (mint, minPt, maxt, maxPt) => {
        if (maxt - mint >= 1024) {
            const half = Math.floor((mint + maxt) / 2);
            const halfPt = conicPoint(half / CONIC_MAX_T, r);
            const stray = Math.max(Math.abs(halfPt[0] - (minPt[0] + maxPt[0]) / 2), Math.abs(halfPt[1] - (minPt[1] + maxPt[1]) / 2));
            if (stray > 0.5) return measure(mint, minPt, half, halfPt) + measure(half, halfPt, maxt, maxPt);
        }
        return Math.hypot(maxPt[0] - minPt[0], maxPt[1] - minPt[1]);
    };
    return measure(0, [r, 0], CONIC_MAX_T, [0, r]);
}

/**
 * The dash pattern of a uniform dashed or dotted border on a rounded box, as
 * shader inputs: shape2/radii2 the centreline, extra each corner's measured
 * length, uv (dash, period, half the stroke's width, mode: 1 for round dots,
 * 2 for analytic coverage). In
 * device pixels the browser picks dashes of 3x the width with 2x gaps under
 * 3px (2x and 1x from 3px) and stretches the gap so whole dashes fill the
 * loop; dots up to 3px are squares one width apart; wider dots are round,
 * spaced as dashes of their width are. A loop too short for two dashes is
 * solid (null).
 */
function roundedDashes(shape, radii, width, style, dpr) {
    const inset = Math.floor(width * dpr / 2 + 1e-6) / dpr;
    const rect = [shape[0] + inset, shape[1] + inset, shape[2] - 2 * inset, shape[3] - 2 * inset];
    const corners = radii.map((r) => Math.max(0, r - inset));
    const lengths = corners.map((r) => conicLength(r * dpr) / dpr);
    const straight = 2 * (rect[2] + rect[3]) - 2 * corners.reduce((a, b) => a + b, 0);
    const length = Math.trunc((straight + lengths.reduce((a, b) => a + b, 0)) * dpr + 1e-4);
    const thickness = Math.trunc(width * dpr + 1e-4);
    const dotted = style === 'dotted';
    let dash = thickness;
    let gap = thickness;
    if (!dotted) {
        dash *= thickness >= 3 ? 2 : 3;
        gap *= thickness >= 3 ? 1 : 2;
    }
    const round = dotted && thickness > 3;
    if (!round && length <= dash * 2) return null;
    if (!round && length <= 2 * dash + 2 * gap) {
        // Exactly two dashes, scaled to fit
        const k = length / (2 * dash + 2 * gap);
        dash *= k;
        gap *= k;
    } else if (!dotted || round) {
        // StrokeData::SelectBestDashGap on a closed path: as many gaps as dashes
        const fewer = Math.max(1, Math.floor(length / (dash + gap)));
        const fewerGap = (length - fewer * dash) / fewer;
        const moreGap = (length - (fewer + 1) * dash) / (fewer + 1);
        gap = moreGap <= 0 || Math.abs(fewerGap - gap) < Math.abs(moreGap - gap) ? fewerGap : moreGap;
    }
    // The GPU draws the stroke with eight samples a pixel when its bounds (and
    // a pixel round them) fit 256x256 device pixels; larger loops get Skia's
    // analytic coverage (measured: 310x200 and 1010x60 boxes, 2px, sampled)
    const half = round ? width / 2 : width * 1.1;
    const analytic = ((rect[2] + 2 * half) * dpr + 2) * ((rect[3] + 2 * half) * dpr + 2) > 65536;
    return {
        shape2: rect,
        radii2: corners,
        extra: lengths,
        uv: [dash / dpr, (dash + gap) / dpr, half, (round ? 1 : 0) | (analytic ? 2 : 0)]
    };
}

// A position in device pixels rounded to a whole one, half up as the browser
// rounds. Under display scaling a layout unit is no binary fraction (1/80 px
// at 125%), so an exact half can come out a hair below it: nudge it up
const roundPx = (v) => Math.round(v + 1e-6);

// A form control's active selection as Chrome paints it (measured over four
// backgrounds, light and dark schemes): rgba(0, 65, 198, 0.8), its text white
const SELECTION = [0, 65 / 255, 198 / 255, 0.8];
const SELECTED_TEXT = [1, 1, 1, 1];
// The native theme's push-button face, [fill, border] by state (measured in
// Chrome). A disabled light face is translucent: the one layer that composites
// as the browser's does over any background
const FACE = {
    light: {
        normal: [[239, 239, 239, 1], [118, 118, 118, 1]],
        hover: [[229, 229, 229, 1], [79, 79, 79, 1]],
        active: [[245, 245, 245, 1], [141, 141, 141, 1]],
        disabled: [[216.6, 216.6, 216.6, 113 / 255], [153.4, 153.4, 153.4, 118 / 255]]
    },
    dark: {
        normal: [[107, 107, 107, 1], [107, 107, 107, 1]],
        hover: [[123, 123, 123, 1], [123, 123, 123, 1]],
        active: [[97, 97, 97, 1], [97, 97, 97, 1]],
        disabled: [[54, 54, 54, 1], [54, 54, 54, 1]]
    }
};
const faceColor = ([r, g, b, a]) => [r / 255, g / 255, b / 255, a];

/** Whether `style`'s used colour scheme is dark (color-scheme, then the preference). */
function darkScheme(style) {
    const words = String(style.colorScheme || 'normal').split(/\s+/);
    if (!words.includes('dark')) return false;
    return !words.includes('light') || (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
}

/** The element's state as the native face shows it. */
function faceState(el) {
    const matches = (selector) => {
        try {
            return Boolean(el?.matches?.(selector));
        } catch {
            return false;
        }
    };
    if (el?.disabled || matches(':disabled')) return 'disabled';
    if (matches(':active')) return 'active';
    return matches(':hover') ? 'hover' : 'normal';
}

// ── Native theme ───────────────────────────────────────────────────────────
// The colours Chrome's native theme paints controls in, by state (measured in
// Chrome 155 on white and black pages; translucent ones composite as the
// browser's do over any background). `sliderBorder` is the slider's and
// progress bar's ring, `lighten` the extra layer under a disabled check box
const TRANSLUCENT_GRAY = 'rgba(118,118,118,0.302)';
const THEME = {
    light: {
        border: { normal: '#767676', hover: '#4f4f4f', active: '#8d8d8d', disabled: TRANSLUCENT_GRAY },
        accent: { normal: '#0075ff', hover: '#005cc8', active: '#3793ff', disabled: TRANSLUCENT_GRAY },
        background: { normal: '#ffffff', hover: '#ffffff', active: '#ffffff', disabled: 'rgba(255,255,255,0.6)' },
        fill: { normal: '#efefef', hover: '#e5e5e5', active: '#f5f5f5', disabled: 'rgba(239,239,239,0.302)' },
        slider: { normal: '#0075ff', hover: '#005cc8', active: '#3793ff', disabled: '#cbcbcb' },
        sliderBorder: { normal: 'rgba(118,118,118,0.5)', hover: 'rgba(79,79,79,0.5)', active: 'rgba(141,141,141,0.5)', disabled: TRANSLUCENT_GRAY },
        lighten: 'rgba(169,169,169,0.2)',
        meterBar: '#efefef', meterBorder: 'rgba(118,118,118,0.3)', meterValues: ['#107c10', '#ffb900', '#d83b01']
    },
    dark: {
        border: { normal: '#858585', hover: '#acacac', active: '#6e6e6e', disabled: '#626262' },
        accent: { normal: '#99c8ff', hover: '#d1e6ff', active: '#61a9ff', disabled: '#757575' },
        background: { normal: '#3b3b3b', hover: '#3b3b3b', active: '#3b3b3b', disabled: '#3b3b3b' },
        fill: { normal: '#3b3b3b', hover: '#3b3b3b', active: '#3b3b3b', disabled: '#363636' },
        slider: { normal: '#99c8ff', hover: '#d1e6ff', active: '#61a9ff', disabled: '#757575' },
        sliderBorder: { normal: '#858585', hover: '#acacac', active: '#6e6e6e', disabled: '#626262' },
        lighten: 'rgba(0,0,0,0.2)',
        meterBar: '#3b3b3b', meterBorder: '#858585', meterValues: ['#74b374', '#f2c812', '#e98f6d']
    }
};

// Classic (Fluent) scrollbars: [track and corner, thumb and arrows, hot thumb and arrows]
const BAR_COLORS = {
    light: ['#fcfcfc', '#8b8b8b', '#636363'],
    dark: ['#2c2c2c', '#9f9f9f', '#d1d1d1']
};

const cssColor = ([r, g, b, a = 1]) => `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;

const contrastOf = (a, b) => {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

/** color_utils::SkColorToHSL. */
function toHsl([r, g, b]) {
    const hi = Math.max(r, g, b);
    const lo = Math.min(r, g, b);
    const delta = hi - lo;
    const l = (hi + lo) / 2;
    if (!delta) return [0, 0, l];
    const s = l < 0.5 ? delta / (hi + lo) : delta / (2 - hi - lo);
    const ir = ((hi - r) / 6 + delta / 2) / delta;
    const ig = ((hi - g) / 6 + delta / 2) / delta;
    const ib = ((hi - b) / 6 + delta / 2) / delta;
    let h = r === hi ? ib - ig : g === hi ? 1 / 3 + ir - ib : 2 / 3 + ig - ir;
    if (h < 0) h += 1;
    if (h > 1) h -= 1;
    return [h, s, l];
}

/** color_utils::HSLToSkColor: bytes as the theme rounds them, in 0..1. */
function fromHsl([h, s, l]) {
    const byte = (v) => Math.round(v * 255) / 255;
    if (!s) return [byte(l), byte(l), byte(l)];
    const t2 = l < 0.5 ? l * (1 + s) : l + s - s * l;
    const t1 = 2 * l - t2;
    const hue = (x) => {
        const v = x < 0 ? x + 1 : x > 1 ? x - 1 : x;
        if (v * 6 < 1) return t1 + (t2 - t1) * v * 6;
        if (v * 2 < 1) return t2;
        if (v * 3 < 2) return t1 + (t2 - t1) * (2 / 3 - v) * 6;
        return t1;
    };
    return [byte(hue(h + 1 / 3)), byte(hue(h)), byte(hue(h - 1 / 3))];
}

/** An accent-color as the theme uses it: opaque over the scheme's canvas (white, #121212), in bytes/255. */
function opaqueAccent(accent, dark) {
    if (!accent) return null;
    const a8 = Math.round((accent[3] ?? 1) * 255);
    const base = dark ? 18 : 255;
    return [0, 1, 2].map((i) => Math.round((Math.round(accent[i] * 255) * a8 + base * (255 - a8)) / 255) / 255);
}

const CHECK_BACKGROUNDS = { light: [1, 1, 1], dark: [59 / 255, 59 / 255, 59 / 255] };
const FILL_BACKGROUNDS = { light: [239 / 255, 239 / 255, 239 / 255], dark: [59 / 255, 59 / 255, 59 / 255] };

/**
 * The scheme a control with `accent` paints in: where the accent does not
 * show against the scheme's own background (a contrast under 3, and better
 * against the other scheme's), the other scheme (measured, as Blink's
 * GetColorSchemeForAccentColor).
 */
function schemeForAccent(accent, dark, backgrounds) {
    if (!accent) return dark;
    const own = contrastOf(accent, dark ? backgrounds.dark : backgrounds.light);
    const other = contrastOf(accent, dark ? backgrounds.light : backgrounds.dark);
    return own < 3 && own < other ? !dark : dark;
}

/**
 * The accent's colour in `state` (dark: the scheme used): hover and press
 * shift its HSL lightness by 0.11, down and up, the other way round in a
 * dark scheme. Disabled, or with no accent, the theme's own.
 */
function accentColor(accent, state, dark, palette) {
    if (!accent || state === 'disabled') return palette[state];
    if (state === 'normal') return cssColor(accent);
    const [h, s, l] = toHsl(accent);
    const by = (state === 'active' ? 0.11 : -0.11) * (dark ? -1 : 1);
    return cssColor(fromHsl([h, s, Math.max(0, Math.min(1, l + by))]));
}

/** color_utils::BlendForMinContrast toward what contrasts most with `bg` (white or #202124). */
function blendForContrast(fg, bg, ratio) {
    if (contrastOf(fg, bg) >= ratio) return fg;
    const target = luminance(bg) < 0.211 ? [1, 1, 1] : [32 / 255, 33 / 255, 36 / 255];
    const mix = (alpha) => fg.map((v, i) => Math.round((target[i] * alpha + v * (255 - alpha)) / 255 * 255) / 255);
    let low = 0;
    let high = 255;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (contrastOf(mix(mid), bg) >= ratio) high = mid;
        else low = mid + 1;
    }
    return mix(low);
}

/**
 * A scrollbar-color thumb when hovered or pressed: moved a contrast of 1.8
 * away from itself, then to a contrast of 3 with an opaque track (fitted to
 * Chrome's bars over eleven colour pairs; its alpha drops).
 */
function hotThumb(thumb, track) {
    const opaqueThumb = thumb.slice(0, 3);
    const hot = blendForContrast(opaqueThumb, opaqueThumb, 1.8);
    return track && track[3] >= 0.999 ? blendForContrast(hot, track.slice(0, 3), 3) : hot;
}

// The icon font Chrome draws Fluent scrollbar arrows from, where it is installed
const ARROW_GLYPHS = { up: '\uEDDB', down: '\uEDDC', left: '\uEDD9', right: '\uEDDA' };
const ARROW_FONT = 'Segoe Fluent Icons';
let arrowFontInstalled = null;

function hasArrowFont() {
    if (arrowFontInstalled !== null) return arrowFontInstalled;
    arrowFontInstalled = false;
    try {
        const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
        const c = canvas.getContext('2d');
        c.font = `100px "${ARROW_FONT}", monospace`;
        const icon = c.measureText(ARROW_GLYPHS.up).width;
        c.font = '100px monospace';
        arrowFontInstalled = icon !== c.measureText(ARROW_GLYPHS.up).width;
    } catch {
        arrowFontInstalled = false;
    }
    return arrowFontInstalled;
}

// ── Where the pointer is ───────────────────────────────────────────────────
// Scrollbar parts and slider thumbs are no elements: only the pointer's place
// tells which one is hot. Builders with such parts painted are told as it moves
const pointer = { x: NaN, y: NaN, buttons: 0, target: null, listening: false, watchers: new Set() };

function onPointer(event) {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.buttons = event.buttons;
    pointer.target = event.composedPath?.()[0] ?? event.target;
    for (const ref of pointer.watchers) {
        const builder = ref.deref();
        if (!builder) pointer.watchers.delete(ref);
        else builder.pointerMoved(event);
    }
}

// An element's hot and pressed scrollbar part or slider thumb (boxes come and go with layout)
const partStates = new WeakMap();

function partState(el) {
    let state = partStates.get(el);
    if (!state) partStates.set(el, (state = { hot: null, pressed: null }));
    return state;
}

function watchPointer(builder) {
    if (typeof window === 'undefined') return;
    if (!pointer.listening) {
        pointer.listening = true;
        const options = { capture: true, passive: true };
        for (const type of ['pointermove', 'pointerdown', 'pointerup', 'pointercancel']) window.addEventListener(type, onPointer, options);
    }
    builder.pointerRef ??= new WeakRef(builder);
    pointer.watchers.add(builder.pointerRef);
}

// ── Pseudo-element parts of native controls ────────────────────────────────
// ::-webkit-slider-*, ::-webkit-progress-* and ::-webkit-meter-* rules, which
// the style pass skips. Each is { part, states, base, specificity, order, block }
const CONTROL_PART = /::-webkit-(slider-thumb|slider-runnable-track|progress-bar|progress-value|meter-bar|meter-optimum-value|meter-suboptimum-value|meter-even-less-good-value)((?::[\w-]+)*)\s*$/i;
const partSheets = new WeakMap();
let partOrder = 0;

function collectPartRules(rules, out, conditions) {
    for (const rule of rules) {
        if (rule.selectorText != null) {
            for (const selector of splitTopLevel(rule.selectorText, ',')) {
                const match = CONTROL_PART.exec(selector);
                if (!match) continue;
                const states = match[2] ? match[2].slice(1).split(':').map((state) => state.toLowerCase()) : [];
                const base = selector.slice(0, match.index).trim();
                out.push({
                    part: match[1].toLowerCase(), states, base: !base || /[\s>+~]$/.test(base) ? `${base}*` : base,
                    specificity: specificity(selector), order: partOrder++, block: rule.style, conditions
                });
            }
        } else if (rule.cssRules) {
            const media = rule.media?.mediaText;
            const supports = rule.constructor?.name === 'CSSSupportsRule' ? rule.conditionText : null;
            collectPartRules(rule.cssRules, out, media || supports ? [...conditions, { media, supports }] : conditions);
        }
    }
}

function partRulesOfSheet(sheet) {
    let rules;
    try {
        rules = sheet.cssRules;
    } catch {
        return [];
    }
    if (!rules) return [];
    const text = sheet.ownerNode?.textContent?.length ?? 0;
    let cached = partSheets.get(sheet);
    if (!cached || cached.count !== rules.length || cached.text !== text) {
        const list = [];
        collectPartRules(rules, list, []);
        cached = { count: rules.length, text, list };
        partSheets.set(sheet, cached);
    }
    return cached.list;
}

const conditionHolds = ({ media, supports }) => {
    if (media && !matchMedia(media).matches) return false;
    return !supports || CSS.supports(supports);
};

/** The rules of `part`s that hold for `el`, lowest priority first. */
function controlPartRules(el) {
    const root = el.getRootNode?.();
    if (!root) return [];
    const found = [];
    for (const sheet of [...(root.styleSheets || []), ...(root.adoptedStyleSheets || [])]) {
        for (const entry of partRulesOfSheet(sheet)) {
            if (entry.conditions.length && !entry.conditions.every(conditionHolds)) continue;
            let holds = false;
            try {
                holds = el.matches(entry.base);
            } catch {
                holds = false;
            }
            if (holds) found.push(entry);
        }
    }
    return found.sort((a, b) => a.specificity - b.specificity || a.order - b.order);
}

/** A control the native theme paints whatever its author background and border. */
function themedControl(box) {
    const el = box.element;
    if (!el || box.style.appearance === 'none') return false;
    const tag = el.localName;
    if (tag === 'input') return el.type === 'checkbox' || el.type === 'radio' || el.type === 'range';
    return tag === 'meter' || (tag === 'progress' && !box.style.backgroundImage?.some((layer) => layer.type !== 'none'));
}

const NOT_TEXT_FIELDS = new Set(['checkbox', 'radio', 'range', 'file', 'image', 'hidden', 'color', ...BUTTON_INPUTS]);

// The page's own declarations for an element, in cascade order: the shared
// rule index the surfaces style with (StyleResolver.cascade), which their
// layout passes keep fresh. Computed values cannot tell an author's
// `background: #fff` from the UA's; which declaration won can
let pageCascade = null;

function pageLayers(el) {
    pageCascade ??= new StyleResolver();
    try {
        return pageCascade.cascade(el);
    } catch {
        return [];
    }
}

/**
 * The page's declaration of longhand `name` that wins in `layers`, or null
 * when the page declares none: { value, style } (the value is empty when a
 * shorthand with var() set it; `style` is the block that holds it).
 */
function pageDeclaration(layers, name) {
    let found = null;
    for (const { style, important } of layers) {
        if ((style.getPropertyPriority(name) === 'important') !== important) continue;
        for (let i = 0; i < style.length; i++) {
            if (style[i] === name) {
                found = { value: style.getPropertyValue(name), style };
                break;
            }
        }
    }
    return found;
}

/** `text` with each var() replaced by `el`'s computed custom property (or the fallback). */
function substituteVars(text, el) {
    let computed = null;
    for (let i = 0; i < 4 && text.includes('var('); i++) {
        text = text.replace(/var\(\s*(--[\w-]+)\s*(?:,([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (_, name, fallback) => {
            computed ??= getComputedStyle(el);
            const value = computed.getPropertyValue(name).trim();
            return value || (fallback ?? '').trim();
        });
    }
    return text;
}

const CURRENT_COLOR_WORDS = new Set(['currentcolor', 'initial', 'unset', 'revert', 'revert-layer']);

/**
 * Whether `el`'s text-decoration-color is the current colour: not declared
 * (its initial value), currentcolor, or a var() that gives it. Computed style
 * shows only the colour it resolves to, so the page's declarations decide.
 */
function decorationFollowsText(el) {
    if (!el || el.nodeType !== 1) return true;
    const found = pageDeclaration(pageLayers(el), 'text-decoration-color');
    if (!found) return true;
    // Set by the shorthand: a colour among its words, else the current colour
    const shorthand = !found.value;
    const text = substituteVars(shorthand ? found.style.getPropertyValue('text-decoration') : found.value, el).trim().toLowerCase();
    if (text === 'inherit') return decorationFollowsText(el.parentElement);
    if (!shorthand) return CURRENT_COLOR_WORDS.has(text);
    const words = splitWhitespace(text);
    if (words.some((word) => CURRENT_COLOR_WORDS.has(word))) return true;
    return !words.some((word) => typeof CSS !== 'undefined' && CSS.supports('color', word));
}

// Author declarations that make a text field's face CSS's (Blink's
// HasAuthorBackground / HasAuthorBorder, measured in Chrome 155): every
// background and border longhand, radius and border-image included, but not
// background-repeat or background-blend-mode
const AUTHOR_FIELD_FACE = /^(background|border)(?!-repeat|-blend-mode|-collapse$|-spacing$)/;

/**
 * Whether the page itself sets `el`'s background or border: a declaration of
 * any value counts, the UA's own included, except `revert` (back to the UA's).
 */
function authorFace(el) {
    const winners = new Map();
    for (const { style, important } of pageLayers(el)) {
        for (let i = 0; i < style.length; i++) {
            const name = style[i];
            if (!AUTHOR_FIELD_FACE.test(name) || (style.getPropertyPriority(name) === 'important') !== important) continue;
            winners.set(name, style.getPropertyValue(name));
        }
    }
    for (const value of winners.values()) if (value.trim().toLowerCase() !== 'revert') return true;
    return false;
}

/**
 * A text field the native theme paints (LayoutTheme::IsControlStyled): no
 * author declaration sets its background or border, whatever the values,
 * and it has no box shadow.
 */
function themedField(box) {
    const el = box.element;
    const s = box.style;
    const tag = el?.localName;
    if (!el || s.appearance === 'none' || (tag !== 'textarea' && tag !== 'input')) return false;
    if (tag === 'input' && NOT_TEXT_FIELDS.has((el.getAttribute('type') || 'text').toLowerCase())) return false;
    if (s.boxShadow?.length) return false;
    return !authorFace(el);
}

/**
 * Device px per DIP, which the native theme sizes scrollbar parts by
 * (Chrome's scale from DIP): the page's devicePixelRatio, of which a
 * surface's paint scale `d` is a multiple by its CSS zoom. Measured with
 * body zoom 1.25: the bars keep their unzoomed arrows, thumbs and thickness.
 */
function themeScale(d) {
    const ratio = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 0;
    return ratio || d;
}

/** Whether `style` samples images nearest-neighbour (image-rendering pixelated, crisp-edges). */
const pixelated = (style) => style.imageRendering === 'pixelated' || style.imageRendering === 'crisp-edges';

// What the UA sheet gives the parts of a control with appearance: none
const UA_PARTS = {
    'progress-bar': 'background-color:gray',
    'progress-value': 'background-color:green',
    'meter-bar': 'background:linear-gradient(to bottom,#ddd,#eee 20%,#ccc 45%,#ccc 55%,#ddd)',
    'meter-optimum-value': 'background:linear-gradient(to bottom,#ad7,#cea 20%,#7a3 45%,#7a3 55%,#ad7)',
    'meter-suboptimum-value': 'background:linear-gradient(to bottom,#fe7,#ffc 20%,#db3 45%,#db3 55%,#fe7)',
    'meter-even-less-good-value': 'background:linear-gradient(to bottom,#f77,#fcc 20%,#d44 45%,#d44 55%,#f77)'
};
const uaBlocks = new Map();

function uaPartBlock(text) {
    if (!text) return null;
    let block = uaBlocks.get(text);
    if (block === undefined) {
        try {
            const sheet = new CSSStyleSheet();
            sheet.insertRule(`x{${text}}`);
            block = sheet.cssRules[0].style;
        } catch {
            block = null;
        }
        uaBlocks.set(text, block);
    }
    return block;
}

// Computes part styles from their rules (no rules or UA sheet of its own)
let partResolver = null;
const partPseudos = new WeakMap();

function partPseudoOf(el, part) {
    let byPart = partPseudos.get(el);
    if (!byPart) partPseudos.set(el, (byPart = new Map()));
    let pseudo = byPart.get(part);
    if (!pseudo) byPart.set(part, (pseudo = new PseudoElement(el, `-webkit-${part}`)));
    return pseudo;
}

/**
 * The computed style of `el`'s `part` from `rules` (controlPartRules) in
 * `state` ({ hover, active }), inheriting from its style: null when no rule
 * styles it and the UA sheet gives it nothing.
 */
function controlPartStyle(el, part, rules, inherited, state = {}, uaText = null) {
    const blocks = [];
    for (const entry of rules) {
        if (entry.part === part && entry.states.every((name) => state[name])) blocks.push(entry.block);
    }
    const ua = uaPartBlock(uaText);
    if (!blocks.length && !ua) return null;
    partResolver ??= new StyleResolver({ rules: null });
    const layers = [...(ua ? [{ style: ua, important: false }] : []), ...blocks.map((style) => ({ style, important: false })), ...blocks.map((style) => ({ style, important: true }))];
    return { ...partResolver.computeStyle(partPseudoOf(el, part), inherited, layers, partResolver.viewport()), element: null };
}

/**
 * The native theme's focus ring radius (device px) for an unstyled control at
 * zoom `z`, or null: floor(2z) for buttons, text fields and checkboxes, half
 * the size for a radio. A control whose border the page restyled has none.
 */
function nativeRingRadius(box, z) {
    const el = box.element;
    const tag = el?.localName;
    const sides = box.style.borderStyle || [];
    let part = null;
    if (tag === 'button') part = 'button';
    else if (tag === 'textarea') part = 'textfield';
    else if (tag === 'input') {
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        if (type === 'checkbox' || type === 'radio') part = type;
        else if (BUTTON_INPUTS.has(type) || type === 'color') part = 'button';
        else if (!['range', 'file', 'image', 'hidden'].includes(type)) part = 'textfield';
    }
    // Only with the UA border: solid for a textarea and a colour well, inset
    // for the other text fields, outset for buttons
    const solid = tag === 'textarea' || (tag === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'color');
    const ua = solid ? 'solid' : part === 'button' ? 'outset' : 'inset';
    if ((part === 'button' || part === 'textfield') && !sides.every((side) => side === ua)) return null;
    if (part === 'radio') return Math.max(box.width, box.height) * z / 2;
    return part ? Math.max(1, Math.floor(2 * z + 1e-4)) : null;
}

function isPositioned(box) {
    return box.style.position && box.style.position !== 'static';
}

/** z-index applies only to positioned boxes and flex or grid items. */
function zApplies(box) {
    return isPositioned(box) || Boolean(box.flexItem || box.gridItem);
}

function zIndexOf(box) {
    const z = box.style.zIndex;
    return z === 'auto' || z == null || !zApplies(box) ? 'auto' : z;
}

const nonInitial = (value, initial) => Boolean(value) && value !== initial;

// will-change names that make a stacking context (z-index only where it applies)
const WILL_CHANGE_CONTEXT = new Set([
    'opacity', 'transform', '-webkit-transform', 'translate', 'rotate', 'scale', 'transform-style', '-webkit-transform-style',
    'perspective', '-webkit-perspective', 'offset', 'offset-path', 'offset-position', 'mask', '-webkit-mask', 'mask-image',
    '-webkit-mask-image', '-webkit-mask-box-image', '-webkit-mask-box-image-source', 'clip-path', '-webkit-clip-path',
    '-webkit-box-reflect', 'filter', '-webkit-filter', 'backdrop-filter', 'position', 'mix-blend-mode', 'isolation', 'contain',
    'view-transition-name'
]);

function willChangeContext(box) {
    const value = box.style.willChange;
    if (!value || value === 'auto') return false;
    for (const part of value.split(',')) {
        const name = part.trim();
        if (WILL_CHANGE_CONTEXT.has(name) || (name === 'z-index' && zApplies(box))) return true;
    }
    return false;
}

// Containment does not apply to rows, row groups, columns or non-atomic inlines
const UNCONTAINED_DISPLAY = new Set(['table-row', 'table-row-group', 'table-header-group', 'table-footer-group', 'table-column', 'table-column-group']);

function containsLayoutOrPaint(box) {
    const s = box.style;
    if (UNCONTAINED_DISPLAY.has(s.display) || (box.outer === 'inline' && !box.atomic && box.inner === 'flow')) return false;
    if (nonInitial(s.contentVisibility, 'visible')) return true;
    return nonInitial(s.contain, 'none') && /\b(layout|paint|strict|content)\b/.test(s.contain);
}

/** Whether `box` makes a stacking context, as Chrome decides (measured, Chrome 155). */
function createsContext(box) {
    const s = box.style;
    const z = zIndexOf(box);
    return (isPositioned(box) && z !== 'auto') || s.position === 'fixed' || s.position === 'sticky'
        || s.opacity < 1 || (s.transform && s.transform !== 'none')
        || (s.dropShadows && s.dropShadows.length) || s.colorFilter || s.blurFilter > 0 || s.backdropBlur > 0 || s.backdropColor
        || nonInitial(s.filter, 'none') || nonInitial(s.backdropFilter, 'none')
        || s.isolation === 'isolate' || nonInitial(s.mixBlendMode, 'normal') || nonInitial(s.clipPath, 'none') || nonInitial(s.maskImage, 'none')
        || nonInitial(s.perspective, 'none') || s.transformStyle === 'preserve-3d' || nonInitial(s.viewTransitionName, 'none')
        || nonInitial(s.offsetPath, 'none') || nonInitial(s.boxReflect, 'none') || containsLayoutOrPaint(box) || willChangeContext(box)
        || ((box.flexItem || box.gridItem) && z !== 'auto') || Boolean(box.compositor);
}

/**
 * The matrix `box` is painted with: an element the browser composites while
 * a transform animation runs (AnimationController sets box.compositor) is
 * painted as laid out, and its layer is drawn back where the animation puts it.
 */
function paintedMatrix(box) {
    return box.compositor ? box.compositor.base : (box.matrix || null);
}

/** Painted as a unit in the inline phase (inline-blocks, flex and grid items). */
function paintsAtomically(box) {
    return box.atomic || box.flexItem || box.gridItem || box.inner === 'replaced' || box.inner === 'svg';
}

/** How far a box's painting reaches past its border box (shadows, outline). */
function paintReach(style) {
    let reach = Math.max(0, (style.outlineWidth || 0) + Math.max(0, style.outlineOffset || 0));
    for (const sh of style.boxShadow || []) {
        if (!sh.inset) reach = Math.max(reach, sh.blur * 1.5 + Math.abs(sh.spread || 0) + Math.max(Math.abs(sh.x), Math.abs(sh.y)) + 2);
    }
    for (const sh of style.dropShadows || []) {
        reach = Math.max(reach, sh.blur * 1.5 + Math.max(Math.abs(sh.x), Math.abs(sh.y)) + 2);
    }
    return reach;
}

const MAX_TILES = 400;

// Image item flag: the texture holds premultiplied colour (effect results)
const PREMULTIPLIED = 128;
// Image item flags for an inline SVG or one of an SVG image's shapes, which
// a rounded clip cuts as the browser cuts that shape (shaders.js): not a
// rect over all of the image, or such a rect of one colour
const CLIP_RAMP = 524288;
const CLIP_FILL = 1048576;

const IDENTITY_FILTER = Object.freeze({ m: [1, 0, 0, 0, 1, 0, 0, 0, 1], o: [0, 0, 0], k: 1 });

/** `after` applied to what `before` produced, as one colour filter. */
function composeFilters(after, before) {
    if (!before) return after;
    const a = after.m;
    const b = before.m;
    const m = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
    const o = [0, 1, 2].map((r) => a[r * 3] * before.o[0] + a[r * 3 + 1] * before.o[1] + a[r * 3 + 2] * before.o[2] + after.o[r]);
    return { m, o, k: after.k * before.k };
}

function listItem(list, index, fallback) {
    const items = splitTopLevel(String(list || fallback), ',');
    return (items[index % items.length] || fallback).trim();
}

/** background-repeat for one layer as [repeatX, repeatY]. */
function repeatOf(token) {
    const t = splitWhitespace(token.toLowerCase());
    if (t[0] === 'repeat-x') return [true, false];
    if (t[0] === 'repeat-y') return [false, true];
    const on = (v) => v !== 'no-repeat';
    return [on(t[0] || 'repeat'), on(t[1] || t[0] || 'repeat')];
}

/** True when tiles of a layer with this background-repeat cover its whole area (space leaves gaps). */
function tilesCover(token) {
    const t = splitWhitespace(String(token).toLowerCase());
    const fills = (v) => v === 'repeat' || v === 'round';
    return fills(t[0]) && (t.length < 2 || fills(t[1]));
}

/** The colour a text's glyphs fill with: -webkit-text-fill-color, else color. */
function textFill(style) {
    return style.webkitTextFillColor || style.color;
}

function withAlpha(color, factor) {
    if (!color) return null;
    return [color[0], color[1], color[2], color[3] * factor];
}

function sameColor(a, b) {
    return a && b && Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4 && Math.abs(a[2] - b[2]) < 1e-4 && Math.abs(a[3] - b[3]) < 1e-4;
}

// Form controls whose painted state code can change without a mutation or event
const CONTROL_TAGS = new Set(['input', 'select', 'textarea', 'progress', 'meter']);
// white-space values that keep line breaks
const KEEPS_NEWLINES = new Set(['pre', 'pre-wrap', 'pre-line', 'break-spaces']);

/** The live DOM state a form control paints (checked, value, selected option). */
function controlState(el) {
    let state = `${el.checked}\0${el.indeterminate}\0${el.selectedIndex}\0${el.value}`;
    const tag = el.localName;
    if (tag === 'meter') return `${state}\0${el.min}\0${el.max}\0${el.low}\0${el.high}\0${el.optimum}`;
    if (tag === 'progress') state += `\0${el.max}\0${el.position}`;
    else if (tag === 'input') state += `\0${el.disabled}\0${el.min}\0${el.max}`;
    // A native face follows hover and press whatever the page's rules
    if (tag === 'progress' || (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio' || el.type === 'range'))) {
        state += `\0${el.matches(':hover')}\0${el.matches(':active')}`;
    }
    return state;
}

/** Whether a textarea shows a resize grip. */
function textareaResizes(el) {
    const resize = el.style.resize || getComputedStyle(el).resize;
    return Boolean(resize) && resize !== 'none';
}

/** What a scroller's bars are painted from, besides its style and box. */
function barKey(box) {
    const el = box.element;
    if (el?.localName === 'textarea') return `${el.scrollTop}|${el.scrollLeft}|${el.scrollHeight}|${el.scrollWidth}|${el.clientWidth}|${el.clientHeight}`;
    return `${box.scrollX}|${box.scrollY}|${box.scrollWidth}|${box.scrollHeight}|${box.scrollbarShown}|${el?.scrollHeight}|${el?.clientHeight}|${el?.scrollWidth}|${el?.clientWidth}`;
}

function sameView(a, b) {
    return a === b || (Boolean(a) && Boolean(b) && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);
}

function sameMatrix(a, b) {
    return a === b || (Boolean(a) && Boolean(b) && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
        && a[3] === b[3] && a[4] === b[4] && a[5] === b[5]);
}

/** Signed distance from (px, py) to the rounded rect [x, y, w, h] with radii tl, tr, br, bl, as the shaders measure it. */
function sdRoundRect(px, py, rect, radii) {
    const hx = rect[2] / 2;
    const hy = rect[3] / 2;
    const ox = px - (rect[0] + hx);
    const oy = py - (rect[1] + hy);
    const r = ox > 0 ? (oy < 0 ? radii[1] : radii[2]) : (oy < 0 ? radii[0] : radii[3]);
    const qx = Math.abs(ox) - hx + r;
    const qy = Math.abs(oy) - hy + r;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** True when the rounded rect `inner` (radii tl, tr, br, bl) lies inside `outer` (to 1/100 px). */
function roundRectHolds(outer, outerRadii, inner, innerRadii) {
    const [x, y, w, h] = inner;
    const corners = [[x, y, 1, 1], [x + w, y, -1, 1], [x + w, y + h, -1, -1], [x, y + h, 1, -1]];
    for (let k = 0; k < 4; k++) {
        const r = Math.max(0, Math.min(innerRadii[k] || 0, w / 2, h / 2));
        const [cx, cy, sx, sy] = corners[k];
        for (let i = 0; i <= 24; i++) {
            const a = (i / 24) * Math.PI / 2;
            if (sdRoundRect(cx + sx * (r - r * Math.cos(a)), cy + sy * (r - r * Math.sin(a)), outer, outerRadii) > 0.01) return false;
        }
    }
    return true;
}

/** A matrix that only moves (no scale, rotation, skew or flip; float dust allowed). */
function isTranslation(m) {
    return Math.abs(m[0] - 1) < 1e-9 && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && Math.abs(m[3] - 1) < 1e-9;
}

const NO_SHIFT = Object.freeze([0, 0]);

const IDENTITY_MATRIX = Object.freeze([1, 0, 0, 1, 0, 0]);

const isPowerOfTwo = (v) => Number.isInteger(Math.log2(v));

const NO_MARKS = Object.freeze({ items: 0, order: 0, outlines: 0, entries: 0, commands: 0 });

/**
 * Where a unit paints among its parent's own content (paintContextBody's
 * lists), and whether it holds its positioned descendants (a stacking
 * context) or leaves them to the context around it (a positioned box with
 * z-index auto: 'p').
 */
function placementKey(box) {
    if (box.outer === 'inline' && !box.atomic && box.inner === 'flow') return 'inline';
    const context = createsContext(box);
    if (isPositioned(box) || context) return `z${zIndexOf(box)}${context ? '' : 'p'}`;
    return paintsAtomically(box) ? 'atomic' : 'block';
}

/**
 * The viewport culling tests a unit made: of those that passed, the largest
 * left and top and the smallest right and bottom edge; of those that
 * failed, the bounds of them all.
 */
function noTests() {
    return {
        passed: false, x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity,
        culled: false, fx0: Infinity, fy0: Infinity, fx1: -Infinity, fy1: -Infinity
    };
}

function noteTest(t, culled, x0, y0, x1, y1) {
    if (culled) {
        t.culled = true;
        t.fx0 = Math.min(t.fx0, x0);
        t.fy0 = Math.min(t.fy0, y0);
        t.fx1 = Math.max(t.fx1, x1);
        t.fy1 = Math.max(t.fy1, y1);
    } else {
        t.passed = true;
        t.x0 = Math.max(t.x0, x0);
        t.y0 = Math.max(t.y0, y0);
        t.x1 = Math.min(t.x1, x1);
        t.y1 = Math.min(t.y1, y1);
    }
}

function mergeTests(into, from) {
    if (from.passed) {
        into.passed = true;
        into.x0 = Math.max(into.x0, from.x0);
        into.y0 = Math.max(into.y0, from.y0);
        into.x1 = Math.min(into.x1, from.x1);
        into.y1 = Math.min(into.y1, from.y1);
    }
    if (from.culled) {
        into.culled = true;
        into.fx0 = Math.min(into.fx0, from.fx0);
        into.fy0 = Math.min(into.fy0, from.fy0);
        into.fx1 = Math.max(into.fx1, from.fx1);
        into.fy1 = Math.max(into.fy1, from.fy1);
    }
}

// Native-content wells (setHole): element -> { box }, how many are set, and a
// version every change bumps (a builder then draws its next frame in full)
const holes = { map: new WeakMap(), count: 0, version: 0 };

/**
 * Cut `element`'s box out of the GPU canvas, or stop (options null). Where
 * the element paints, its shadows and border are drawn as usual, its
 * background only under a 'content-box' hole, then the canvas is cleared to
 * transparent inside `options.box` ('border-box', the default, 'padding-box'
 * or 'content-box'), with that box's rounded corners, snapped as the box
 * paints and cut by the clips around the element, so a native element placed
 * below the canvas shows through. Everything painted after it in paint order
 * (its descendants, later siblings, positioned overlays) draws on top of the
 * hole. A hole inside a compositing layer (opacity below 1, a filter, an
 * animated transform) clears that layer only. Holes hold for every surface
 * and builder (also one made again after a device loss); the next frame of
 * each is drawn in full, and the caller asks for it (surface.invalidate(false)).
 */
export function setHole(element, options = {}) {
    if (!element) return;
    if (options) {
        if (!holes.map.has(element)) holes.count++;
        holes.map.set(element, { box: options.box || 'border-box' });
    } else {
        if (!holes.map.has(element)) return;
        holes.map.delete(element);
        holes.count--;
    }
    holes.version++;
}

/** The hole setHole() set on `element` ({ box }), or null. */
export function holeOf(element) {
    return (element && holes.map.get(element)) || null;
}

export class DisplayListBuilder {
    /**
     * @param {GpuPainter} painter
     * @param {Rasterizer} raster
     * @param {TextShaper} shaper
     */
    constructor(painter, raster, shaper) {
        this.painter = painter;
        this.raster = raster;
        this.shaper = shaper;
        // The last frame's ranges, for units that did not change
        this.last = null;
        this.focusedBox = null;
        // Form control box -> the state it was last painted with
        this.controls = new Map();
        // The setHole() version this builder last drew with
        this.holesSeen = holes.version;
        // A scroller's box -> what its bars were last painted from
        this.barBoxes = new Map();
        // A box with hot parts (scrollbar parts, a slider thumb) -> where they
        // are: [name, x, y, width, height] in device px from its snapped corner
        this.hot = new Map();
    }

    /** setHole() (the module function), for callers holding a builder. */
    setHole(element, options = {}) {
        setHole(element, options);
    }

    /**
     * Build items for `layout`. ctx: { dpr, time, focused (Element),
     * viewport {x, y, width, height}, styleOf(element) }. Only what can
     * reach the viewport is emitted; paint order still lists every box.
     */
    build(layout, ctx) {
        this.ctx = ctx;
        const v = ctx.viewport;
        this.cull = v ? { x0: v.x, y0: v.y, x1: v.x + v.width, y1: v.y + v.height } : null;
        // The device pixel grid: the canvas starts on a device pixel at the viewport origin
        this.dpr = ctx.dpr || 1;
        // Layout pixels per CSS px (LayoutUnits): device pixels under display
        // scaling and browser zoom, CSS px under device-scale emulation
        this.layoutPx = layout.zoom ?? this.dpr;
        this.gridX = v ? v.x : 0;
        this.gridY = v ? v.y : 0;
        // Per frame: how each box is painted (paintInfo) and how far each clip moved
        this.paintInfos = new Map();
        this.clipShifts = new Map();
        // A control whose checked, value or selected option was set in code
        // since it was painted is drawn again, not copied
        for (const [box, state] of this.controls) {
            if (layout.boxes.get(box.element) !== box) this.controls.delete(box);
            else if (controlState(box.element) !== state) markChanged(box);
        }
        // A scroller whose position or extent moved draws its bars again
        for (const [box, key] of this.barBoxes) {
            if (layout.boxes.get(box.element) !== box) this.barBoxes.delete(box);
            else if (barKey(box) !== key) markChanged(box);
        }
        for (const box of this.hot.keys()) if (layout.boxes.get(box.element) !== box) this.hot.delete(box);
        // The focused box paints its caret, selection and focus ring every frame
        const focusedBox = ctx.focused ? layout.boxes.get(ctx.focused) || null : null;
        if (focusedBox) markChanged(focusedBox);
        if (this.focusedBox && this.focusedBox !== focusedBox) markChanged(this.focusedBox);
        this.focusedBox = focusedBox;
        this.frame = ++paintClock.frame;
        this.items = this.painter.items;
        this.items.reset();
        this.painter.atlas.beginFrame();
        this.painter.resetFilters();
        this.filter = null;
        const last = this.last;
        // After a scroll, units are copied when the device pixel grid moved by
        // whole device and layout pixels (positions snapped to it then come out
        // exactly the same) and everything they tested is inside both viewports
        const whole = (d) => Number.isInteger(d * this.dpr) && Number.isInteger(d * this.layoutPx);
        const moved = Boolean(last && v && last.viewport) && !sameView(last.viewport, v);
        const shifted = moved && last.layoutPx === this.layoutPx && isPowerOfTwo(this.dpr) && isPowerOfTwo(this.layoutPx)
            && whole(v.x - last.viewport.x) && whole(v.y - last.viewport.y);
        this.reuse = last && last.dpr === ctx.dpr && (sameView(last.viewport, v) || shifted) && this.holesSeen === holes.version ? last : null;
        this.holesSeen = holes.version;
        this.moved = Boolean(this.reuse) && moved;
        this.tests = noTests();
        this.ownTests = noTests();
        this.unit = null;
        this.paintOrder = [];
        this.outlines = [];
        this.entries = [];
        this.units = [];
        this.misses = 0;
        // Last-frame layer commands -> their copies in this frame (copyCommands)
        this.commandCopies = new Map();
        // While a compositor layer's content is painted: the clip set above its root
        this.layerClip = null;
        // The items that draw compositor layers back: { at, root, opacity, place }
        this.composites = [];
        this.paintContext(layout.host, 1);
        for (const job of this.outlines) this.emitOutline(job.box, job.opacity);
        this.keep(ctx);
        this.scheduleMoving();
        return { count: this.items.count, paintOrder: this.paintOrder, composites: this.composites };
    }

    /** Keep this frame's ranges so the next frame can copy units that did not change. */
    keep(ctx) {
        const items = this.items;
        const floats = items.count * FLOATS_PER_ITEM;
        const last = this.last || { data: new Float32Array(0), pages: new Uint16Array(0) };
        if (last.data.length < floats) last.data = new Float32Array(Math.max(floats, last.data.length * 2));
        if (last.pages.length < items.count) last.pages = new Uint16Array(Math.max(items.count, last.pages.length * 2));
        last.data.set(items.data.subarray(0, floats));
        last.pages.set(items.pages.subarray(0, items.count));
        last.frame = this.frame;
        last.dpr = ctx.dpr;
        last.viewport = ctx.viewport ? { ...ctx.viewport } : null;
        last.layoutPx = this.layoutPx;
        last.paintOrder = this.paintOrder;
        last.outlines = this.outlines;
        last.entries = this.entries;
        last.units = this.units;
        last.commands = items.commands;
        this.last = last;
    }

    /** An atlas entry the frame draws with (kept alive while copied); null when not ready. */
    use(entry) {
        if (entry) this.entries.push(entry);
        else this.misses++;
        return entry;
    }

    // ── Painting order ──────────────────────────────────────────────────────

    paintContext(root, opacity) {
        const parent = this.unit;
        if (!parent) {
            this.paintUnit(root, opacity);
            return;
        }
        const start = this.marks(parent.start);
        this.paintUnit(root, opacity);
        // Where the unit lies among its parent's own content (spliceUnit)
        parent.calls.push({ child: root, opacity, key: placementKey(root), start, end: this.marks(parent.start) });
    }

    paintUnit(root, opacity) {
        const own = opacity * (root.isHost ? 1 : root.style.opacity);
        // A layer a paint worker fades is drawn even while it is clear
        if (own <= 0.001 && !root.isHost && !root.compositor?.handedOver) return;
        const items = this.items;
        const cache = root.paintCache;
        if (this.reuse && cache && cache.frame === this.reuse.frame && cache.opacity === opacity && items.filter === -1
            && !(this.moved && cache.clamped)) {
            if (!(root.changed > cache.drawn) && (!this.moved || this.passes(cache))) {
                this.copyUnit(cache);
                mergeTests(this.tests, cache.tests);
                return;
            }
            // Only units inside it changed: its own content is copied around them
            if (!this.moved && cache.calls && this.ownUnchanged(cache)) {
                this.spliceUnit(root, cache);
                return;
            }
        }
        const outerTests = this.tests;
        const outerOwnTests = this.ownTests;
        const outerUnit = this.unit;
        const start = {
            items: items.count, order: this.paintOrder.length, outlines: this.outlines.length, entries: this.entries.length,
            units: this.units.length, commands: items.commands.length, filters: this.painter.filterCount, misses: this.misses,
            filter: items.filter
        };
        const outerFilter = this.filter;
        const outerIndex = this.items.filter;
        const blur = root.isHost ? 0 : root.style.blurFilter || 0;
        const ownFilter = root.isHost ? null : root.style.colorFilter;
        // The browser composites an element whose transform or opacity
        // animates: its content is painted once, into a layer drawn back each
        // frame where the animation puts it. Opacity applies to an element's
        // content as one group, so overlapping items are drawn into a layer
        // first and faded together
        const compositor = !root.isHost && !(blur > 0) && root.compositor ? root.compositor : null;
        const faded = !root.isHost && !(blur > 0) && !compositor && root.style.opacity < 1;
        let contentEnd = 0;
        const draw = (grouped) => {
            this.tests = noTests();
            this.ownTests = noTests();
            this.unit = { start, calls: [], own: [root], walked: [] };
            this.units.push(root);
            // A compositor layer is painted uncut, but not when the clip around it,
            // which does not move with it, lies outside the view
            if (compositor && this.clipOutside(root)) {
                const walk = (box) => {
                    this.paintOrder.push(box);
                    for (const child of box.children) if (!child.isText) walk(child);
                };
                walk(root);
                return null;
            }
            // A colour filter covers the whole stacking context, nested ones inside
            // it. Inside a layer the outer filters apply when it is drawn back.
            if (blur > 0 || ownFilter || (grouped && outerFilter)) {
                const base = blur > 0 || grouped ? null : outerFilter;
                this.filter = ownFilter ? composeFilters(base || IDENTITY_FILTER, ownFilter) : base;
                this.items.filter = this.filter ? this.painter.addFilter(this.filter) : -1;
            }
            const layer = blur > 0 ? this.beginLayer(blur)
                : grouped ? this.openLayer(this.layerKey(root, compositor ? 'compositor' : 'opacity'), compositor ? { compositor: root, opacity } : null)
                    : null;
            const outerCull = this.cull;
            const outerLayerClip = this.layerClip;
            if (compositor) {
                // Painted whole (the animation moves it into view), and not cut by
                // the clip set above it: that clips the layer where it is drawn back
                this.cull = null;
                this.layerClip = root.clip || null;
            }
            this.paintContextBody(root, grouped ? 1 : own);
            contentEnd = items.count;
            this.cull = outerCull;
            this.layerClip = outerLayerClip;
            this.filter = outerFilter;
            this.items.filter = outerIndex;
            if (blur > 0) {
                this.endLayer(layer, root);
                return layer;
            }
            if (!layer) return null;
            const place = compositor ? this.compositePlace(root) : null;
            const fields = compositor ? { alpha: own, matrix: compositeMatrixFor(root.matrix, place), ...this.clipFields(root, root.clip || null) } : { alpha: own };
            if (!this.closeLayer(layer, fields, Boolean(compositor))) return null;
            if (compositor) this.composites.push({ at: items.count - 1, root, opacity, place });
            return layer;
        };
        let layer = draw(Boolean(compositor) || (faded && root.opacityGroup === true));
        if (faded) {
            // Measured: Chrome fades an element's items as one group (the thumbs of
            // a disabled slider hide its track); items that do not overlap fade
            // the same one by one, without a layer
            const overlap = this.itemsOverlap(layer ? layer.at : start.items, contentEnd);
            if (overlap && !layer) {
                this.rollback(start);
                layer = draw(true);
            }
            root.opacityGroup = overlap;
        }
        // Copyable next frame: no colour filter or effect inside but layers,
        // every raster ready. A blurred layer can drop what was drawn into
        // it, so nothing in it is kept.
        const blurred = blur > 0 && layer;
        const copyable = !blurred && start.filter === -1 && this.commandsCopyable(start.commands)
            && this.painter.filterCount === start.filters && this.misses === start.misses;
        if (blurred) for (let k = start.units; k < this.units.length; k++) this.units[k].paintCache = null;
        const unit = this.unit;
        this.unit = outerUnit;
        const tests = this.tests;
        const ownTests = this.ownTests;
        this.tests = outerTests;
        this.ownTests = outerOwnTests;
        mergeTests(outerTests, tests);
        root.paintCache = copyable ? {
            frame: this.frame,
            drawn: this.frame,
            // Its own content: when it was drawn, the boxes it is drawn from, what it tested
            ownDrawn: this.frame,
            own: unit.own,
            walked: unit.walked,
            ownTests,
            calls: unit.calls,
            opacity,
            tests,
            items: start.items, itemCount: items.count - start.items,
            order: start.order, orderCount: this.paintOrder.length - start.order,
            outlines: start.outlines, outlineCount: this.outlines.length - start.outlines,
            entries: start.entries, entryCount: this.entries.length - start.entries,
            units: start.units, unitCount: this.units.length - start.units,
            commands: start.commands, commandCount: items.commands.length - start.commands,
            clamped: this.commandsClamped(start.commands)
        } : null;
    }

    /** True when every command from `from` on is a layer a copied unit can draw again (not a blur or backdrop). */
    commandsCopyable(from) {
        const commands = this.items.commands;
        for (let k = from; k < commands.length; k++) if (!commands[k].copyable) return false;
        return true;
    }

    /** True when a layer from command `from` on was cut to the viewport (copied only for the same view). */
    commandsClamped(from) {
        const commands = this.items.commands;
        for (let k = from; k < commands.length; k++) if (commands[k].clamped) return true;
        return false;
    }

    /**
     * Undo what a unit drew from `start` on (its items, paint order, outline
     * jobs, atlas entries, units and layers), to draw it again another way.
     * Units drawn or copied in it lose their caches: their ranges are gone.
     */
    rollback(start) {
        const items = this.items;
        items.count = start.items;
        items.commands.length = start.commands;
        this.paintOrder.length = start.order;
        this.outlines.length = start.outlines;
        this.entries.length = start.entries;
        for (let k = start.units; k < this.units.length; k++) this.units[k].paintCache = null;
        this.units.length = start.units;
        this.misses = start.misses;
        this.painter.filterCount = start.filters;
        this.composites = this.composites.filter((entry) => entry.at < start.items);
    }

    /**
     * Draw a unit as the last frame did: copy its items, paint order, outline
     * jobs and atlas entries (keeping those alive), and move the ranges of
     * the units inside it to where they are in this frame.
     */
    copyUnit(cache) {
        const last = this.reuse;
        const items = this.items;
        const shift = {
            items: items.count - cache.items, order: this.paintOrder.length - cache.order,
            outlines: this.outlines.length - cache.outlines, entries: this.entries.length - cache.entries,
            units: this.units.length - cache.units, commands: items.commands.length - cache.commands
        };
        if (cache.itemCount) {
            items.ensure(items.count + cache.itemCount);
            items.data.set(last.data.subarray(cache.items * FLOATS_PER_ITEM, (cache.items + cache.itemCount) * FLOATS_PER_ITEM), items.count * FLOATS_PER_ITEM);
            items.pages.set(last.pages.subarray(cache.items, cache.items + cache.itemCount), items.count);
            items.count += cache.itemCount;
        }
        this.copyCommands(cache.commands, cache.commandCount, shift.items);
        for (let k = cache.order, end = k + cache.orderCount; k < end; k++) this.paintOrder.push(last.paintOrder[k]);
        for (let k = cache.outlines, end = k + cache.outlineCount; k < end; k++) this.outlines.push(last.outlines[k]);
        const atlasFrame = this.painter.atlas.frame;
        for (let k = cache.entries, end = k + cache.entryCount; k < end; k++) {
            const entry = last.entries[k];
            entry.lastUsed = atlasFrame;
            this.entries.push(entry);
        }
        // The unit itself comes first in its range
        for (let k = cache.units, end = k + cache.unitCount; k < end; k++) {
            const unit = last.units[k];
            this.units.push(unit);
            const c = unit.paintCache;
            if (!c) continue;
            c.frame = this.frame;
            c.items += shift.items;
            c.order += shift.order;
            c.outlines += shift.outlines;
            c.entries += shift.entries;
            c.units += shift.units;
            c.commands += shift.commands;
        }
    }

    /**
     * Copy last-frame layer commands [from, from + count) into this frame,
     * at items moved by `shift`. Each layer is drawn back from a page of this
     * frame, and a compositor layer where its animation puts it now.
     */
    copyCommands(from, count, shift) {
        if (!count) return;
        const last = this.reuse.commands;
        const items = this.items;
        for (let k = from; k < from + count; k++) {
            const old = last[k];
            const copy = { type: old.type, at: old.at + shift, copyable: true };
            if (old.type === 'layer-begin') {
                Object.assign(copy, { blur: 0, bounds: old.bounds, key: old.key, compositor: old.compositor, opacity: old.opacity, clamped: old.clamped });
                this.commandCopies.set(old, copy);
            } else {
                copy.begin = this.commandCopies.get(old.begin);
                copy.page = items.effectPage();
                items.pages[copy.at] = copy.page;
                if (copy.begin.compositor) this.placeLayer(copy.begin, copy.at);
            }
            items.commands.push(copy);
        }
    }

    /** Where this frame's ranges stand, counted from a unit's `start`. */
    marks(start) {
        return {
            items: this.items.count - start.items, order: this.paintOrder.length - start.order,
            outlines: this.outlines.length - start.outlines, entries: this.entries.length - start.entries,
            commands: this.items.commands.length - start.commands
        };
    }

    /**
     * True when nothing a unit's own content is drawn from changed since it
     * was drawn, and every unit inside it still paints in the same place
     * among that content.
     */
    ownUnchanged(cache) {
        for (const box of cache.own) if (box.selfChanged > cache.ownDrawn) return false;
        for (const call of cache.calls) if (placementKey(call.child) !== call.key) return false;
        // The boxes walked for the positioned descendants it holds: none of
        // them may have become positioned or a stacking context, or stopped
        const walked = cache.walked;
        for (let i = 0; i < walked.length; i += 2) {
            if (walked[i].selfChanged > cache.ownDrawn && placementKey(walked[i]) !== walked[i + 1]) return false;
        }
        return true;
    }

    /**
     * Draw a unit whose own content did not change while units inside it
     * did: its own items, paint order, outline jobs and atlas entries are
     * copied from the last frame, and the units inside are painted (copied,
     * spliced or drawn) between them where they were.
     */
    spliceUnit(root, cache) {
        const items = this.items;
        const start = {
            items: items.count, order: this.paintOrder.length, outlines: this.outlines.length, entries: this.entries.length,
            units: this.units.length, commands: items.commands.length, filters: this.painter.filterCount, misses: this.misses
        };
        const outerTests = this.tests;
        const outerUnit = this.unit;
        this.tests = noTests();
        mergeTests(this.tests, cache.ownTests);
        this.unit = { start, calls: [], own: cache.own, walked: cache.walked };
        this.units.push(root);
        let from = NO_MARKS;
        for (const call of cache.calls) {
            this.copyRange(cache, from, call.start);
            this.paintContext(call.child, call.opacity);
            from = call.end;
        }
        this.copyRange(cache, from, { items: cache.itemCount, order: cache.orderCount, outlines: cache.outlineCount, entries: cache.entryCount, commands: cache.commandCount });
        const unit = this.unit;
        this.unit = outerUnit;
        const tests = this.tests;
        this.tests = outerTests;
        mergeTests(outerTests, tests);
        const copyable = this.commandsCopyable(start.commands) && this.painter.filterCount === start.filters && this.misses === start.misses;
        root.paintCache = copyable ? {
            frame: this.frame,
            drawn: this.frame,
            ownDrawn: cache.ownDrawn,
            own: cache.own,
            walked: cache.walked,
            ownTests: cache.ownTests,
            calls: unit.calls,
            opacity: cache.opacity,
            tests,
            items: start.items, itemCount: items.count - start.items,
            order: start.order, orderCount: this.paintOrder.length - start.order,
            outlines: start.outlines, outlineCount: this.outlines.length - start.outlines,
            entries: start.entries, entryCount: this.entries.length - start.entries,
            units: start.units, unitCount: this.units.length - start.units,
            commands: start.commands, commandCount: items.commands.length - start.commands,
            clamped: this.commandsClamped(start.commands)
        } : null;
    }

    /** Copy a unit's last-frame ranges between marks `from` and `to` (part of its own content). */
    copyRange(cache, from, to) {
        const last = this.reuse;
        const items = this.items;
        const count = to.items - from.items;
        const shift = items.count - (cache.items + from.items);
        if (count > 0) {
            const at = cache.items + from.items;
            items.ensure(items.count + count);
            items.data.set(last.data.subarray(at * FLOATS_PER_ITEM, (at + count) * FLOATS_PER_ITEM), items.count * FLOATS_PER_ITEM);
            items.pages.set(last.pages.subarray(at, at + count), items.count);
            items.count += count;
        }
        this.copyCommands(cache.commands + from.commands, to.commands - from.commands, shift);
        for (let k = cache.order + from.order, end = cache.order + to.order; k < end; k++) this.paintOrder.push(last.paintOrder[k]);
        for (let k = cache.outlines + from.outlines, end = cache.outlines + to.outlines; k < end; k++) this.outlines.push(last.outlines[k]);
        const atlasFrame = this.painter.atlas.frame;
        for (let k = cache.entries + from.entries, end = cache.entries + to.entries; k < end; k++) {
            const entry = last.entries[k];
            entry.lastUsed = atlasFrame;
            this.entries.push(entry);
        }
    }

    /** Start drawing a filter: blur() stacking context into its own layer. */
    beginLayer(blur) {
        const command = { type: 'layer-begin', at: this.items.count, blur, bounds: null };
        this.items.commands.push(command);
        return command;
    }

    /**
     * Close a blurred layer: size it to what was drawn (plus the blur's
     * reach, within the viewport) and draw the blurred result back.
     */
    endLayer(command, root) {
        const items = this.items;
        if (items.count === command.at) {
            items.commands.splice(items.commands.indexOf(command), 1);
            return;
        }
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        const d = items.data;
        for (let i = command.at; i < items.count; i++) {
            const o = i * FLOATS_PER_ITEM;
            const [rx, ry, rw, rh] = [d[o], d[o + 1], d[o + 2], d[o + 3]];
            const [a, b, c, dd, e, f] = [d[o + 44], d[o + 45], d[o + 46], d[o + 47], d[o + 48], d[o + 49]];
            for (const [px, py] of [[rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh]]) {
                const wx = a * px + c * py + e;
                const wy = b * px + dd * py + f;
                x0 = Math.min(x0, wx); y0 = Math.min(y0, wy); x1 = Math.max(x1, wx); y1 = Math.max(y1, wy);
            }
        }
        const reach = Math.ceil(command.blur * 3);
        x0 -= reach; y0 -= reach; x1 += reach; y1 += reach;
        const v = this.ctx.viewport;
        if (v) {
            x0 = Math.max(x0, v.x - reach); y0 = Math.max(y0, v.y - reach);
            x1 = Math.min(x1, v.x + v.width + reach); y1 = Math.min(y1, v.y + v.height + reach);
        }
        x0 = Math.floor(x0); y0 = Math.floor(y0);
        if (x1 - x0 < 1 || y1 - y0 < 1) {
            items.count = command.at;
            items.commands.splice(items.commands.indexOf(command), 1);
            return;
        }
        command.bounds = { x: x0, y: y0, width: Math.ceil(x1 - x0), height: Math.ceil(y1 - y0) };
        const page = items.effectPage();
        items.commands.push({ type: 'layer-end', at: items.count, begin: command, page });
        const clip = root.clip && root.clip.width < 1e8 ? root.clip : null;
        const rect = [x0, y0, command.bounds.width, command.bounds.height];
        items.push({
            kind: KIND.IMAGE, rect, shape: rect, color: [1, 1, 1, 1], uv: [0, 0, 1, 1], page, flags: 15 | PREMULTIPLIED,
            clip: clip ? [clip.x, clip.y, clip.x + clip.width, clip.y + clip.height] : null,
            clipRadii: clip?.radii || null
        });
    }

    // ── Compositing layers ──────────────────────────────────────────────────

    /** A key naming one of `box`'s layers from frame to frame (the painter keeps its texture by it). */
    layerKey(box, kind) {
        box.layerKeys ??= {};
        return box.layerKeys[kind] ??= { kind };
    }

    /**
     * Open a compositing layer: the items drawn until closeLayer() are drawn
     * into an offscreen texture, which one item then draws back as a group.
     * The painter keeps the texture while the layer's items stay the same.
     */
    openLayer(key, extra = null) {
        const command = { type: 'layer-begin', at: this.items.count, blur: 0, bounds: null, key, copyable: true, ...extra };
        this.items.commands.push(command);
        return command;
    }

    /**
     * Close a layer opened by openLayer(): bound it by what was drawn into it,
     * on whole device pixels of the canvas grid, and push the item that draws
     * it back with `fields` (alpha, matrix, clip fields, and a mask as shape
     * and radii). A layer is cut to the viewport, unless `whole` (what a
     * compositor layer holds moves into view). A layer nothing was drawn into
     * is dropped (false).
     */
    closeLayer(command, fields, whole = false) {
        const items = this.items;
        let bounds = this.itemBounds(command.at, items.count);
        if (!bounds) {
            items.commands.splice(items.commands.indexOf(command), 1);
            return false;
        }
        const v = this.ctx.viewport;
        const limit = Math.min(this.painter.device?.limits?.maxTextureDimension2D || 8192, 8192) / this.dpr;
        // Only a layer larger than the view is cut to it (a cut layer's unit is
        // not copied after a scroll); in a compositor layer's content, painted
        // uncut, nothing is
        const large = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]) > (v ? v.width * v.height : Infinity);
        if (v && ((!whole && this.cull && large) || bounds[2] - bounds[0] > limit || bounds[3] - bounds[1] > limit)) {
            // Within the view (a layer too large for a texture: around it)
            const grow = whole ? Math.max(0, (limit - v.width) / 2, (limit - v.height) / 2) : 0;
            const cut = [Math.max(bounds[0], v.x - grow), Math.max(bounds[1], v.y - grow),
                Math.min(bounds[2], v.x + v.width + grow), Math.min(bounds[3], v.y + v.height + grow)];
            if (cut.some((value, i) => value !== bounds[i])) command.clamped = true;
            bounds = cut;
        }
        const d = this.dpr;
        const gx = this.gridX;
        const gy = this.gridY;
        const x0 = gx + Math.floor((bounds[0] - gx) * d + 1e-6) / d;
        const y0 = gy + Math.floor((bounds[1] - gy) * d + 1e-6) / d;
        // At least one device pixel: what lies outside the view is drawn into a pixel no one sees
        const x1 = Math.max(x0 + 1 / d, gx + Math.ceil((bounds[2] - gx) * d - 1e-6) / d);
        const y1 = Math.max(y0 + 1 / d, gy + Math.ceil((bounds[3] - gy) * d - 1e-6) / d);
        command.bounds = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
        const page = items.effectPage();
        items.commands.push({ type: 'layer-end', at: items.count, begin: command, page, copyable: true });
        const rect = [x0, y0, x1 - x0, y1 - y0];
        items.push({
            kind: KIND.IMAGE, rect, shape: fields.shape || rect, radii: fields.radii || null,
            color: [1, 1, 1, fields.alpha ?? 1], uv: [0, 0, 1, 1], page, flags: 15 | PREMULTIPLIED,
            matrix: fields.matrix || null, clip: fields.clip || null, clipRadii: fields.clipRadii || null,
            clip2: fields.clip2 || null, clip2Radii: fields.clip2Radii || null
        });
        return true;
    }

    /**
     * Scene bounds [x0, y0, x1, y1] of items [from, to) as the painter draws
     * them (through their matrices, a device pixel past box and shadow
     * rects, cut by their clips), or null when they cover nothing.
     */
    itemBounds(from, to) {
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        for (let i = from; i < to; i++) {
            const b = this.itemBox(i);
            if (!b) continue;
            if (b[0] < x0) x0 = b[0];
            if (b[1] < y0) y0 = b[1];
            if (b[2] > x1) x1 = b[2];
            if (b[3] > y1) y1 = b[3];
        }
        return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
    }

    /** One item's painted bounds (itemBounds), or null. */
    itemBox(i) {
        const d = this.items.data;
        const o = i * FLOATS_PER_ITEM;
        const kind = Math.round(d[o + 50]);
        const pad = kind === KIND.BOX || kind === KIND.SHADOW || kind === KIND.INSET || kind === KIND.HOLE ? 1 / this.dpr : 0;
        const rx = d[o] - pad;
        const ry = d[o + 1] - pad;
        const rw = d[o + 2] + 2 * pad;
        const rh = d[o + 3] + 2 * pad;
        const a = d[o + 44];
        const b = d[o + 45];
        const c = d[o + 46];
        const dd = d[o + 47];
        const e = d[o + 48];
        const f = d[o + 49];
        const xs = [a * rx + c * ry + e, a * (rx + rw) + c * ry + e, a * rx + c * (ry + rh) + e, a * (rx + rw) + c * (ry + rh) + e];
        const ys = [b * rx + dd * ry + f, b * (rx + rw) + dd * ry + f, b * rx + dd * (ry + rh) + f, b * (rx + rw) + dd * (ry + rh) + f];
        const x0 = Math.max(Math.min(...xs), d[o + 36]);
        const y0 = Math.max(Math.min(...ys), d[o + 37]);
        const x1 = Math.min(Math.max(...xs), d[o + 38]);
        const y1 = Math.min(Math.max(...ys), d[o + 39]);
        return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null;
    }

    /** True when any two of items [from, to) cover a common pixel (by their painted bounds). */
    itemsOverlap(from, to) {
        if (to - from < 2) return false;
        const boxes = [];
        for (let i = from; i < to; i++) {
            const b = this.itemBox(i);
            if (b) boxes.push(b);
        }
        boxes.sort((p, q) => p[0] - q[0]);
        const active = [];
        for (const b of boxes) {
            let n = 0;
            for (const a of active) {
                if (a[2] <= b[0]) continue;
                if (a[1] < b[3] && b[1] < a[3]) return true;
                active[n++] = a;
            }
            active.length = n;
            active.push(b);
        }
        return false;
    }

    /**
     * The matrix a compositor layer is drawn back with: from its content as
     * laid out to where the animation puts it, as the browser composites it
     * (measured). A move shifts the raster, resampling it at fractions of a
     * pixel; any other transform applies from the root's position rounded
     * to the pixel grid (paintInfo), to the raster of it as laid out, whose
     * box edges were snapped to the grid.
     */
    compositeMatrix(root) {
        return compositeMatrixFor(root.matrix, this.compositePlace(root));
    }

    /**
     * What a compositor layer's matrix is drawn back from besides the root's
     * animated matrix (compositeMatrixFor; a paint worker places the layer
     * from it as the animation moves).
     */
    compositePlace(root) {
        const above = root.outOfFlow ? (root.cb || root.parent) : root.parent;
        return {
            base: root.compositor.base,
            outer: above ? this.paintInfo(above).matrix : null,
            absX: root.absX,
            absY: root.absY,
            gridX: this.gridX,
            gridY: this.gridY,
            layoutPx: this.layoutPx,
            dpr: this.dpr
        };
    }

    /**
     * True when the clip around `root` lies outside the view (a culling test
     * of the unit, as offscreen() makes). Without a clip, false.
     */
    clipOutside(root) {
        const cull = this.cull;
        const clip = root.clip;
        if (!cull || !clip || !(clip.width < 1e8)) return false;
        const [sx, sy] = this.clipShift(root, clip);
        const x0 = clip.x + sx;
        const y0 = clip.y + sy;
        const x1 = x0 + clip.width;
        const y1 = y0 + clip.height;
        const culled = x1 <= cull.x0 || y1 <= cull.y0 || x0 >= cull.x1 || y0 >= cull.y1;
        noteTest(this.tests, culled, x0, y0, x1, y1);
        noteTest(this.ownTests, culled, x0, y0, x1, y1);
        return culled;
    }

    /** Draw a copied compositor layer where its animation puts it now (copyCommands). */
    placeLayer(begin, index) {
        const root = begin.compositor;
        const place = this.compositePlace(root);
        const m = compositeMatrixFor(root.matrix, place);
        this.composites.push({ at: index, root, opacity: begin.opacity, place });
        const d = this.items.data;
        const o = index * FLOATS_PER_ITEM;
        d[o + 44] = m[0]; d[o + 45] = m[1]; d[o + 46] = m[2]; d[o + 47] = m[3]; d[o + 48] = m[4]; d[o + 49] = m[5];
        d[o + 15] = begin.opacity * root.style.opacity;
    }

    paintContextBody(root, own) {
        this.emitDecorations(root, own);
        const negative = [];
        const positioned = [];
        const positive = [];
        const blocks = [];
        const inline = [];
        // The boxes this unit's own content is drawn from (spliceUnit)
        const ownBoxes = this.unit.own;
        // A stacking context paints every positioned descendant and stacking
        // context in it that no nearer stacking context holds (CSS 2.1
        // Appendix E, as Chrome's paint layers do): also those inside a
        // positioned box with z-index auto, an inline-block or a flex or grid
        // item. Those paint their own content as a unit and leave these to the
        // context, so a popup's z-index lifts it over later siblings of its
        // wrapper. A unit that is no stacking context paints none of them
        const context = root.isHost || createsContext(root);
        const walked = this.unit.walked;
        const lift = (child, key = placementKey(child)) => {
            const z = zIndexOf(child);
            if (z !== 'auto' && z < 0) negative.push(child);
            else if (z !== 'auto' && z > 0) positive.push(child);
            else positioned.push(child);
            if (key.endsWith('p')) hoist(child);
        };
        // Below a unit that leaves them to this context: its positioned
        // descendants and stacking contexts, in tree order (inline boxes paint
        // with their container, as collect() takes them). The boxes walked are
        // kept with their placement (ownUnchanged)
        const hoist = (box) => {
            for (const child of box.children) {
                if (child.isText) continue;
                const key = placementKey(child);
                walked.push(child, key);
                if (key.charCodeAt(0) === 122 /* z */) lift(child, key);
                else hoist(child);
            }
        };
        const collect = (box) => {
            for (const child of box.children) {
                if (child.isText) continue;
                if (child.outer === 'inline' && !child.atomic && child.inner === 'flow') {
                    // Inline boxes paint with their container's inline content
                    ownBoxes.push(child);
                    collect(child);
                    continue;
                }
                if (isPositioned(child) || createsContext(child)) {
                    if (context) lift(child);
                    // Left to the context: kept with its placement, so the unit is
                    // drawn again when it stops being positioned (ownUnchanged)
                    else walked.push(child, placementKey(child));
                    continue;
                }
                if (paintsAtomically(child)) {
                    inline.push({ atomic: child });
                    if (context) hoist(child);
                    continue;
                }
                blocks.push(child);
                ownBoxes.push(child);
                if (child.runs?.length || child.fragmentsOwner) inline.push({ container: child });
                collect(child);
            }
        };
        if (root.runs?.length) inline.push({ container: root });
        collect(root);
        negative.sort((a, b) => zIndexOf(a) - zIndexOf(b));
        positive.sort((a, b) => zIndexOf(a) - zIndexOf(b));
        for (const box of negative) this.paintContext(box, own);
        for (const box of blocks) this.emitDecorations(box, own);
        this.emitInlineFragments(root, own);
        for (const entry of inline) {
            if (entry.atomic) this.paintContext(entry.atomic, own);
            else {
                if (entry.container !== root) this.emitInlineFragments(entry.container, own);
                this.emitRuns(entry.container, own);
            }
        }
        for (const box of positioned) this.paintContext(box, own);
        for (const box of positive) this.paintContext(box, own);
    }

    // Inline box backgrounds and borders inside an inline formatting context
    emitInlineFragments(container, opacity) {
        const walk = (box) => {
            for (const child of box.children) {
                if (child.isText) continue;
                if (child.outer === 'inline' && !child.atomic && child.inner === 'flow') {
                    if (child.absFragments && child.style.visibility !== 'hidden') {
                        const reach = paintReach(child.style);
                        for (const fragment of child.absFragments) {
                            if (!this.offscreen(child, fragment, reach)) this.emitBoxPaint(child, fragment, opacity, fragment);
                        }
                    }
                    walk(child);
                }
            }
        };
        walk(container);
    }

    /**
     * True when a unit drawn for another viewport draws the same in this one:
     * every culling test it made passed and passes here, or it drew nothing
     * and every test fails here too.
     */
    passes(cache) {
        const cull = this.cull;
        const t = cache.tests;
        // Nothing is culled here (a compositor layer's content): only a unit that culled nothing is whole
        if (!cull) return !t.culled;
        if (!t.culled) return t.x1 > cull.x0 && t.y1 > cull.y0 && t.x0 < cull.x1 && t.y0 < cull.y1;
        return !t.passed && cache.itemCount === 0
            && (t.fx1 <= cull.x0 || t.fy1 <= cull.y0 || t.fx0 >= cull.x1 || t.fy0 >= cull.y1);
    }

    /** True when `rect` (scene px, before the box's transform) cannot reach the viewport. */
    offscreen(box, rect, reach = 0) {
        const cull = this.cull;
        if (!cull) return false;
        let r = reach ? { x: rect.x - reach, y: rect.y - reach, width: rect.width + reach * 2, height: rect.height + reach * 2 } : rect;
        if (box.matrix) r = transformRectBounds(box.matrix, r);
        let x0 = r.x;
        let y0 = r.y;
        let x1 = r.x + r.width;
        let y1 = r.y + r.height;
        const clip = box.clip;
        if (clip && clip.width < 1e8) {
            x0 = Math.max(x0, clip.x);
            y0 = Math.max(y0, clip.y);
            x1 = Math.min(x1, clip.x + clip.width);
            y1 = Math.min(y1, clip.y + clip.height);
        }
        const culled = x1 <= cull.x0 || y1 <= cull.y0 || x0 >= cull.x1 || y0 >= cull.y1;
        // What the unit tested, so it can be copied for a viewport that passes the same tests
        noteTest(this.tests, culled, x0, y0, x1, y1);
        noteTest(this.ownTests, culled, x0, y0, x1, y1);
        return culled;
    }

    /**
     * True when a frame for `viewport` (scene px) culls everything `box`
     * and its subtree in `layout` paint, by offscreen()'s tests: border
     * boxes with their reach and a focus ring's, inline fragments, text runs
     * with their shadows. A compositor layer's content is painted uncut, so
     * nothing in one (or that is one) is out of view.
     */
    outOfView(layout, box, viewport) {
        if (!viewport || layout.order[box.orderIndex] !== box) return false;
        for (let b = box; b; b = b.parent) if (b.compositor) return false;
        const vx1 = viewport.x + viewport.width;
        const vy1 = viewport.y + viewport.height;
        const reaches = (b, rect, reach) => {
            let r = { x: rect.x - reach, y: rect.y - reach, width: rect.width + reach * 2, height: rect.height + reach * 2 };
            if (b.matrix) r = transformRectBounds(b.matrix, r);
            let x0 = r.x;
            let y0 = r.y;
            let x1 = r.x + r.width;
            let y1 = r.y + r.height;
            const clip = b.clip;
            if (clip && clip.width < 1e8) {
                x0 = Math.max(x0, clip.x);
                y0 = Math.max(y0, clip.y);
                x1 = Math.min(x1, clip.x + clip.width);
                y1 = Math.min(y1, clip.y + clip.height);
            }
            return !(x1 <= viewport.x || y1 <= viewport.y || x0 >= vx1 || y0 >= vy1);
        };
        const order = layout.order;
        for (let i = box.orderIndex, end = i + box.orderCount; i < end; i++) {
            const b = order[i];
            const reach = paintReach(b.style);
            if (reaches(b, { x: b.absX, y: b.absY, width: b.width, height: b.height }, reach + 6)) return false;
            for (const fragment of b.absFragments || []) if (reaches(b, fragment, reach)) return false;
            for (const run of b.runs || []) {
                const shadowReach = (run.style?.textShadow || []).reduce((m, sh) => Math.max(m, Math.abs(sh.x) + Math.abs(sh.y) + (sh.blur || 0) * 1.5), 0);
                if (reaches(b, { x: run.absX, y: run.absY, width: run.width, height: run.height }, shadowReach + 2)) return false;
            }
        }
        return true;
    }

    /**
     * backdrop-filter: what is already drawn under the border box, blurred
     * and filtered by the painter, drawn in the box's shape below its own
     * background.
     */
    emitBackdrop(box, rect, opacity) {
        // Under a transform that only moves or scales the box (its own or an
        // ancestor's: a dialog centred with translate(-50%, -50%)), the
        // backdrop is the rect the box covers on screen. A turned box is not
        // given one
        const m = this.paintInfo(box).matrix;
        let screen = rect;
        let scale = 1;
        if (m) {
            if (Math.abs(m[1]) > 1e-9 || Math.abs(m[2]) > 1e-9) return;
            const x0 = m[0] * rect.x + m[4];
            const x1 = m[0] * (rect.x + rect.width) + m[4];
            const y0 = m[3] * rect.y + m[5];
            const y1 = m[3] * (rect.y + rect.height) + m[5];
            screen = { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
            scale = Math.min(Math.abs(m[0]), Math.abs(m[3]));
        }
        const items = this.items;
        const page = items.effectPage();
        // The browser blurs in the box's own space: on screen the radius scales with it
        items.commands.push({
            type: 'backdrop', at: items.count, item: items.count, page,
            rect: screen, blur: (box.style.backdropBlur || 0) * scale, filter: box.style.backdropColor || null
        });
        const shape = [screen.x, screen.y, screen.width, screen.height];
        items.push({
            ...this.common(box), matrix: null, kind: KIND.IMAGE, rect: shape, shape,
            radii: resolveRadii(box, rect.width, rect.height).map((r) => r * scale), color: [1, 1, 1, opacity], uv: [0, 0, 1, 1], page,
            flags: 15 | PREMULTIPLIED
        });
    }

    // ── Box paint ───────────────────────────────────────────────────────────

    common(box) {
        const clip = box.clip || null;
        return { matrix: this.paintInfo(box).matrix, ...this.clipFields(box, clip) };
    }

    /**
     * Item clip fields for layout clip `clip` as `box` paints it: the clip
     * (moved with a transformed subtree, snapped to pixels) and its radii, and
     * the second rounded clip a nested clip keeps (LayoutEngine `rounded`).
     */
    clipFields(box, clip) {
        // In a compositor layer the clip set above its root cuts the layer instead
        if (!clip || clip === this.layerClip) return { clip: null, clipRadii: null };
        const [sx, sy] = this.clipShift(box, clip);
        const rect = (c) => this.snapClip([c.x + sx, c.y + sy, c.x + c.width + sx, c.y + c.height + sy], box);
        const fields = { clip: rect(clip), clipRadii: clip.radii || null };
        if (clip.rounded) {
            fields.clip2 = rect(clip.rounded);
            fields.clip2Radii = clip.rounded.radii;
        }
        return fields;
    }

    /**
     * `common` without the rounded clips that hold the rounded rect `shape`
     * (its radii) whole, as the browser's clip stack drops a clip that a
     * nested one makes redundant. Under a transform the clips stay.
     */
    withoutHoldingClips(common, shape, radii) {
        if (common.matrix) return common;
        const holds = (clip, clipRadii) => Boolean(clip && clipRadii?.some((r) => r > 0))
            && roundRectHolds([clip[0], clip[1], clip[2] - clip[0], clip[3] - clip[1]], clipRadii, shape, radii);
        let out = common;
        if (holds(common.clip, common.clipRadii)) out = { ...out, clip: null, clipRadii: null };
        if (holds(common.clip2, common.clip2Radii)) out = { ...out, clip2: null, clip2Radii: null };
        return out;
    }

    emitDecorations(box, opacity) {
        if (box.isHost || box.anonymous) return;
        this.paintOrder.push(box);
        if (box.style.visibility === 'hidden') return;
        const rect = { x: box.absX, y: box.absY, width: box.width, height: box.height };
        if (box.outer === 'inline' && !box.atomic && box.inner === 'flow') return;
        if (this.offscreen(box, rect, paintReach(box.style) + (box.element === this.ctx.focused ? 6 : 0))) return;
        if (box.style.backdropBlur > 0 || box.style.backdropColor) this.emitBackdrop(box, rect, opacity);
        const hole = holes.count > 0 && box.element ? holes.map.get(box.element) : null;
        // A padding-box hole is cleared first: the border's inner edge then
        // anti-aliases over what shows through, as over a background
        if (hole?.box === 'padding-box') this.emitHole(box, hole.box);
        this.emitBoxPaint(box, rect, opacity, null);
        this.emitReplaced(box, opacity);
        if (hole && hole.box !== 'padding-box') this.emitHole(box, hole.box);
        this.emitScrollbars(box, opacity);
        if (box.style.outlineWidth > 0 || box.style.outlineStyle === 'auto') this.outlines.push({ box, opacity });
    }

    /**
     * Shadows, background colour and images, then borders, for a border box
     * `rect` (a fragment for inline boxes).
     */
    /**
     * A rect with its edges rounded to device pixels, as the browser places
     * boxes. `grid` is where device pixels start (paintInfo().grid).
     */
    /**
     * An overflow clip [x0, y0, x1, y1] with its edges on device pixels, as the
     * browser snaps clip rects: a box at y=454.5 clips its content at a whole
     * row, not half a pixel early. Clips under a transform are left as they are.
     */
    snapClip(rect, box) {
        if (!rect || this.paintInfo(box).matrix || !rect.every((v) => Math.abs(v) < 1e7)) return rect;
        const d = this.dpr;
        const sx = (v) => roundPx((v - this.gridX) * d) / d + this.gridX;
        const sy = (v) => roundPx((v - this.gridY) * d) / d + this.gridY;
        return [sx(rect[0]), sy(rect[1]), sx(rect[2]), sy(rect[3])];
    }

    snapRect(x, y, width, height, grid = [this.gridX, this.gridY]) {
        const d = this.dpr;
        const [gx, gy] = grid;
        const sx = (v) => roundPx((v - gx) * d) / d + gx;
        const sy = (v) => roundPx((v - gy) * d) / d + gy;
        const x0 = sx(x);
        const y0 = sy(y);
        return [x0, y0, sx(x + width) - x0, sy(y + height) - y0];
    }

    /**
     * How the browser paints `box`. A transformed element is painted from
     * its position rounded (half up) to a whole layout pixel (a device pixel
     * under display scaling), with its transform applied from there: under translate(0) or translateY(-1px)
     * it is as crisp as an untransformed one, and a fractional translate
     * blurs it as it does in the DOM. Under translations only, its boxes and
     * baselines snap exactly as if untransformed (the browser carries the
     * rounding's remainder into the contents). Returns { matrix, grid, shift }: the
     * box's matrix moved by those roundings, where device pixels start in
     * its own untransformed coordinates (null under a scale, rotation or
     * skew above it) and the scene shift applied. Layout geometry and hit
     * testing keep the unrounded matrix.
     */
    paintInfo(box) {
        let info = this.paintInfos.get(box);
        if (info) return info;
        const above = box.outOfFlow ? (box.cb || box.parent) : box.parent;
        const outer = above ? this.paintInfo(above) : null;
        const m = paintedMatrix(box);
        if (!m) {
            info = { matrix: null, grid: [this.gridX, this.gridY], shift: NO_SHIFT };
        } else if (outer && sameMatrix(m, paintedMatrix(above))) {
            // Transformed by an ancestor only: painted as it is
            info = outer;
        } else if (isTranslation(m) && (!outer?.matrix || (isTranslation(outer.matrix) && outer.shift === NO_SHIFT))) {
            // Moved only: the browser rounds the paint offset and carries the
            // remainder into the contents, so boxes and baselines snap as if
            // untransformed and the translation applies after (measured: a box
            // at y .75 and 24.5 tall keeps 24 rows, translated or not)
            info = { matrix: m, grid: [this.gridX, this.gridY], shift: NO_SHIFT };
        } else {
            // The box sets its own transform: its painted position is rounded
            const p = outer?.matrix || null;
            let [dx, dy] = outer?.shift || NO_SHIFT;
            let grid = null;
            if (!p || (p[0] === 1 && p[1] === 0 && p[2] === 0 && p[3] === 1)) {
                const d = this.layoutPx;
                const x = box.absX + (p ? p[4] : 0);
                const y = box.absY + (p ? p[5] : 0);
                dx += roundPx((x - this.gridX) * d) / d + this.gridX - x;
                dy += roundPx((y - this.gridY) * d) / d + this.gridY - y;
                grid = [box.absX, box.absY];
            }
            const matrix = dx || dy ? [m[0], m[1], m[2], m[3], m[4] + dx, m[5] + dy] : m;
            info = { matrix, grid, shift: dx || dy ? [dx, dy] : NO_SHIFT };
        }
        this.paintInfos.set(box, info);
        return info;
    }

    /** How far `clip` moved with the transformed element that set it (paintInfo). */
    clipShift(box, clip) {
        if (!clip || !(clip.width < 1e8)) return NO_SHIFT;
        let shift = this.clipShifts.get(clip);
        if (shift) return shift;
        shift = NO_SHIFT;
        // Clips pass down unchanged; the box that set this one clips its children with it
        for (let b = box; b; b = b.outOfFlow ? (b.cb || b.parent) : b.parent) {
            if (b.childClip === clip && b.clip !== clip) {
                shift = this.paintInfo(b).shift;
                break;
            }
        }
        this.clipShifts.set(clip, shift);
        return shift;
    }

    /**
     * Where the canvas's device pixel grid starts in an item's own
     * coordinates: the viewport origin, moved back through a matrix that
     * only translates and flips (text under translate() or rotate(180deg)
     * lands on the same pixel rows as DOM text). Under any other scale,
     * rotation or skew no grid applies: [0, 0].
     */
    textGrid(matrix) {
        if (!matrix) return [this.gridX, this.gridY];
        const [a, b, c, d, e, f] = matrix;
        // rotate(180deg) leaves float dust (1e-16) where the browser has zeros
        const near = (v, w) => Math.abs(v - w) < 1e-9;
        if (!near(b, 0) || !near(c, 0) || !near(Math.abs(a), 1) || !near(Math.abs(d), 1)) return [0, 0];
        return [(this.gridX - e) / Math.sign(a), (this.gridY - f) / Math.sign(d)];
    }

    /** A border width in whole device pixels (at least one), as the browser draws borders. */
    snapBorder(width) {
        if (!(width > 0)) return 0;
        return Math.max(1, Math.floor(width * this.dpr + 1e-4)) / this.dpr;
    }

    emitBoxPaint(box, rect, opacity, fragment) {
        // Boxes sit on whole device pixels, as the browser draws them: a 1px
        // border at a half pixel would paint two dim rows instead of one line.
        // Under a transform the pixels are the element's own (paintInfo)
        const grid = this.paintInfo(box).grid;
        const snap = Boolean(grid);
        // Background images are placed from the unsnapped box (backgroundAreas)
        const raw = rect;
        if (snap) {
            const [x, y, width, height] = this.snapRect(rect.x, rect.y, rect.width, rect.height, grid);
            rect = { ...rect, x, y, width, height };
        }
        // A well's own background lies under what shows through its hole: what
        // a hole clears over it would leave its anti-aliased edge tinted. A
        // content-box hole leaves the padding showing it
        const hole = holes.count > 0 && !fragment && box.element ? holes.map.get(box.element) : null;
        const s = hole && hole.box !== 'content-box' ? { ...box.style, backgroundColor: [0, 0, 0, 0], backgroundImage: [] } : box.style;
        const common = this.common(box);
        const radii = fragment ? [0, 0, 0, 0] : resolveRadii(box, rect.width, rect.height);
        const shape = [rect.x, rect.y, rect.width, rect.height];

        // Outer shadows: the first listed shadow is on top. Under a box whose
        // background colour is opaque, the browser cuts a shadow out a CSS
        // pixel inside the border box (Blink's guard against seams), so the
        // shadow shows under the box's anti-aliased edge (measured: a slider
        // thumb's 1px ring)
        const outer = [...(s.dropShadows || []).map((d) => ({ ...d, drop: true })), ...s.boxShadow.filter((sh) => !sh.inset)];
        const opaqueBox = !fragment && outer.length > 0 && Boolean(s.backgroundColor) && s.backgroundColor[3] >= 0.999
            && listItem(s.backgroundClip, Math.max(1, s.backgroundImage?.length || 0) - 1, 'border-box') === 'border-box';
        const cut = opaqueBox ? [shape[0] + 1, shape[1] + 1, Math.max(0, shape[2] - 2), Math.max(0, shape[3] - 2)] : shape;
        const cutRadii = opaqueBox ? radii.map((r) => Math.max(0, r - 1)) : radii;
        for (let i = outer.length - 1; i >= 0; i--) {
            const sh = outer[i];
            const color = withAlpha(sh.color, opacity);
            if (!color || color[3] <= 0.002) continue;
            const spread = sh.spread || 0;
            const sx = rect.x + sh.x - spread;
            const sy = rect.y + sh.y - spread;
            const sw = Math.max(0, rect.width + spread * 2);
            const shh = Math.max(0, rect.height + spread * 2);
            const pad = sh.blur * 1.5 + 2;
            this.items.push({
                ...common,
                kind: KIND.SHADOW,
                rect: [sx - pad, sy - pad, sw + pad * 2, shh + pad * 2],
                shape: [sx, sy, sw, shh],
                radii: radii.map((r) => (r > 0 ? Math.max(0, r + spread) : 0)),
                color,
                border: [sh.blur, spread, 0, 0],
                shape2: sh.drop ? [0, 0, 0, 0] : cut,
                radii2: cutRadii
            });
        }

        // An unstyled push button: the native theme's face, not its CSS background and border
        if (s.nativeFace && !fragment) {
            this.emitButtonFace(box, shape, opacity, common);
            return;
        }
        // So too a themed check box, radio button, slider, progress bar or meter
        if (themedControl(box)) return;
        if (!fragment && themedField(box)) {
            this.emitFieldFace(box, shape, opacity, common);
            return;
        }

        // Background colour (with the border when all sides share a colour)
        const bg = withAlpha(s.backgroundColor, opacity);
        let widths = fragment
            ? [box.border[0], fragment.last ? box.border[1] : 0, box.border[2], fragment.first ? box.border[3] : 0]
            : (box.border || [0, 0, 0, 0]);
        let borderRect = shape;
        let sideMask = 15;
        const collapsed = box.collapsedBorder;
        if (collapsed) {
            // Collapsed borders: whole lines centred on the grid lines; each
            // cell draws its top and left lines, and right/bottom on the edge
            const half = box.border;
            borderRect = [rect.x - half[3], rect.y - half[0], rect.width + half[1] + half[3], rect.height + half[0] + half[2]];
            widths = collapsed.widths;
            sideMask = SIDE_TOP | SIDE_LEFT | (collapsed.lastColumn ? SIDE_RIGHT : 0) | (collapsed.lastRow ? SIDE_BOTTOM : 0);
        } else if (snap) {
            widths = widths.map((w) => this.snapBorder(w));
        }
        const hasBorder = widths.some((w) => w > 0);
        // Ridge and groove thinner than 2px paint plain, as the browser does
        const cssWidths = collapsed ? collapsed.widths : (box.border || [0, 0, 0, 0]);
        const styles = (s.borderStyle || []).map((style, i) => (isRidgeOrGroove(style) && !(cssWidths[i] >= 2 - 1e-4) ? 'solid' : style));
        const colors = (s.borderColor || []).map((c, i) => withAlpha(shadeSide(c, styles[i], i), opacity));
        // Wider ones paint as two borders of opposite shading. On a square box
        // the line between them rounds half a CSS pixel down the page, so on an
        // odd width the outer half is the wider one on the top and left, the
        // narrower one on the bottom and right. A rounded box paints the inner
        // shading inside a rect inset by the halves cut down to whole pixels,
        // so its outer halves are all the narrower ones
        const split = !collapsed && styles.some((style, i) => isRidgeOrGroove(style) && widths[i] > 0);
        const rounded = radii.some((r) => r > 0);
        const halfOf = (w, i) => {
            const half = !rounded && (i === 0 || i === 3) ? Math.ceil(w / 2 - 1e-4) : Math.floor(w / 2 + 1e-4);
            return Math.min(w, snap && half > 0 ? this.snapBorder(half) : half);
        };
        const outerWidths = split && !rounded ? widths.map((w, i) => (isRidgeOrGroove(styles[i]) ? halfOf(w, i) : w)) : widths;
        const firstSide = widths.findIndex((w) => w > 0);
        const uniform = hasBorder && !collapsed && !split && widths.every((w, i) => w === 0 || (sameColor(colors[i], colors[firstSide]) && styles[i] === styles[firstSide]));
        const borderColor = hasBorder ? colors[widths.findIndex((w) => w > 0)] : null;
        // The border, padding and content boxes, as background-clip and background-origin name them
        const padding = fragment
            ? [box.padding[0], fragment.last ? box.padding[1] : 0, box.padding[2], fragment.first ? box.padding[3] : 0]
            : (box.padding || [0, 0, 0, 0]);
        const contentInset = widths.map((w, i) => w + padding[i]);
        const inset = (by) => [rect.x + by[3], rect.y + by[0], rect.width - by[1] - by[3], rect.height - by[0] - by[2]];
        const boxes = { 'border-box': shape, 'padding-box': inset(widths), 'content-box': inset(contentInset) };
        // The browser clips to the content box on whole device pixels: a rounded
        // box's from its snapped border box, any other's from its unsnapped one
        const contentFrom = rounded ? rect : raw;
        const contentClip = snap && padding.some((v) => v !== 0)
            ? this.snapRect(contentFrom.x + contentInset[3], contentFrom.y + contentInset[0],
                contentFrom.width - contentInset[1] - contentInset[3], contentFrom.height - contentInset[0] - contentInset[2], grid)
            : boxes['content-box'];
        // The colour is clipped as the bottom layer is, as the browser does
        const backgroundClip = listItem(s.backgroundClip, Math.max(1, s.backgroundImage?.length || 0) - 1, 'border-box');
        const bgShape = backgroundClip === 'content-box' ? contentClip : backgroundClip === 'padding-box' ? boxes[backgroundClip] : shape;
        const hasGradient = s.backgroundImage?.some((layer) => layer.type !== 'none');
        const inner = s.boxShadow.filter((sh) => sh.inset);
        const bgVisible = bg && bg[3] > 0.002;
        const borderVisible = hasBorder && uniform && borderColor && borderColor[3] > 0.002;
        // Bleed avoidance, as the browser does it: under an opaque solid border
        // on a rounded box the background shrinks by half the border's width,
        // so its anti-aliased edge does not show as a coloured halo outside it
        const px = 1 / (this.dpr || 1);
        const opaqueBorder = borderVisible && borderColor[3] >= 0.999 && widths.every((w) => w >= px)
            && styles.every((style) => !style || style === 'solid');
        const shrink = opaqueBorder && bgShape === shape && radii.some((r) => r > 0);
        // One item draws fill and border together when nothing paints between
        // them. A shrunk background is its own item, as in the browser: the
        // border's anti-aliased edges then lie over the page, not the fill
        // A box the user can scroll paints its background colour in its
        // scrolling contents, as the browser composites it: over its border,
        // filling the padding box with the inner radii (measured: only while
        // auto or scroll overflow really scrolls)
        const contentsBackground = bgVisible && hasBorder && !fragment && !collapsed && !hasGradient && inner.length === 0
            && bgShape === shape && canScroll(box);
        const paintContentsBackground = () => {
            if (!contentsBackground) return;
            const innerRadii = radii.map((r, i) => Math.max(0, r - Math.max(widths[i], widths[(i + 3) % 4])));
            const pad = boxes['padding-box'];
            this.items.push({ ...common, kind: KIND.BOX, rect: pad, shape: pad, radii: innerRadii, color: bg, flags: 15 });
        };
        const mergeFill = borderVisible && bgVisible && !hasGradient && bgShape === shape && inner.length === 0 && !shrink && !contentsBackground;
        const shrunk = opaqueBorder && radii.some((r) => r > 0) ? inset(widths.map((w) => w / 2)) : null;
        const shrunkRadii = shrunk && radii.map((r, i) => Math.max(0, r - Math.max(widths[i], widths[(i + 3) % 4]) / 2));
        const fillShape = shrink ? shrunk : bgShape;
        const fillInset = bgShape === shape ? null : backgroundClip === 'content-box' ? contentInset : widths;
        const fillRadii = shrink ? shrunkRadii : fillInset ? radii.map((r, i) => Math.max(0, r - Math.max(fillInset[i], fillInset[(i + 3) % 4]))) : radii;
        // The browser clips a box's background layers as one group, so a
        // rounded edge anti-aliases once. Painted one by one, the colour and
        // layers under a gradient that hides them would anti-alias it again
        // and show along it: they are left out (only opaque stops, tiled
        // over both axes, clipped to a box that holds theirs)
        const layers = s.backgroundImage || [];
        const clipRank = (i) => ({ 'content-box': 0, 'padding-box': 1 })[listItem(s.backgroundClip, i, 'border-box')] ?? 2;
        const cover = layers.findIndex((layer, i) => (layer.type === 'linear' || layer.type === 'radial' || layer.type === 'conic')
            && layer.stops.every((stop) => stop.color[3] >= 0.999) && tilesCover(listItem(s.backgroundRepeat, i, 'repeat'))
            && !/(^|\s)-?0(\.0*)?(px|%)?(\s|$)/.test(listItem(s.backgroundSize, i, 'auto')));
        const hidden = (i) => cover >= 0 && i > cover && clipRank(i) <= clipRank(cover);
        // The colour lies under every layer, clipped as the bottom one
        const colourHidden = cover >= 0 && clipRank(Math.max(1, layers.length) - 1) <= clipRank(cover);
        // When the colour and an image both paint, the browser draws them
        // through a clip of the rounded border box, not as anti-aliased
        // shapes, and its clip stack keeps only the inner of two rounded
        // clips that nest: an ancestor's rounded clip that holds the box
        // does not anti-alias its edge again (measured: a gradient fill in
        // its rounded track keeps 0.65 coverage, not 0.65 squared)
        let bgCommon = bgVisible && hasGradient && rounded ? this.withoutHoldingClips(common, shape, radii) : common;
        const backgroundInner = (by) => radii.map((r, i) => Math.max(0, r - Math.max(by[i], by[(i + 3) % 4])));
        const backgroundClipOf = (name) => {
            if (name === 'padding-box') return [boxes['padding-box'], backgroundInner(widths)];
            if (name === 'content-box') return [contentClip, backgroundInner(contentInset)];
            return shrunk ? [shrunk, shrunkRadii] : [shape, radii];
        };
        // Measured: Chrome paints a rounded box's background colour and image
        // layers as one group and anti-aliases its rounded edge once (a
        // translucent gradient over the colour does not let the colour show
        // along the edge). When two or more of them paint in the same rounded
        // clip, they are drawn square into a layer, drawn back in that shape
        const colourPaints = bgVisible && !mergeFill && !contentsBackground && !colourHidden;
        const paintClips = colourPaints ? [[fillShape, fillRadii]] : [];
        for (let i = layers.length - 1; i >= 0 && hasGradient; i--) {
            if (layers[i].type !== 'none' && !hidden(i)) paintClips.push(backgroundClipOf(listItem(s.backgroundClip, i, 'border-box')));
        }
        const sameRounded = (a, b) => a[0].every((v, k) => Math.abs(v - b[0][k]) < 1e-6) && a[1].every((v, k) => Math.abs(v - b[1][k]) < 1e-6);
        const boxMatrix = common.matrix;
        const groupLayer = rounded && !fragment && !collapsed && paintClips.length >= 2 && (!boxMatrix || isTranslation(boxMatrix))
            && paintClips[0][1].some((r) => r > 0) && paintClips.every((c) => sameRounded(c, paintClips[0]))
            ? this.openLayer(this.layerKey(box, 'background')) : null;
        let groupFields = null;
        // A colour filter applies once, when the group is drawn back
        const filterIndex = this.items.filter;
        if (groupLayer) {
            this.items.filter = -1;
            // Inside, square and uncut, a device pixel past the shape that cuts them
            const [clipRect, clipRadii] = paintClips[0];
            const at = boxMatrix ? [boxMatrix[4], boxMatrix[5]] : [0, 0];
            groupFields = {
                ...this.withoutHoldingClips(common, shape, radii),
                alpha: 1, shape: [clipRect[0] + at[0], clipRect[1] + at[1], clipRect[2], clipRect[3]], radii: clipRadii, matrix: null
            };
            bgCommon = { matrix: boxMatrix };
        }
        const square = (rect) => (groupLayer ? [rect[0] - px, rect[1] - px, rect[2] + 2 * px, rect[3] + 2 * px] : rect);
        const squareRadii = (r) => (groupLayer ? [0, 0, 0, 0] : r);
        if (colourPaints) {
            this.items.push({ ...bgCommon, kind: KIND.BOX, rect: square(fillShape), shape: square(fillShape), radii: squareRadii(fillRadii), color: bg, flags: 15 });
        }
        // Background layers (the last listed is painted first), each clipped to
        // its background-clip box and sized and placed in its background-origin box
        if (hasGradient) {
            const clipOf = (name) => {
                const [rect, r] = backgroundClipOf(name);
                return [square(rect), squareRadii(r)];
            };
            // A linear gradient is placed in the browser's terms (backgroundAreas):
            // from the unsnapped border box, the snapped one and the sides whose
            // border hides the background (BorderEdge::ObscuresBackground: present,
            // opaque and not dotted, dashed or double, as no border at all is)
            const placement = {
                raw: [raw.x, raw.y, raw.width, raw.height], shape, widths, padding, disallow: Boolean(collapsed),
                obscures: [0, 1, 2, 3].map((side) => {
                    const style = s.borderStyle?.[side] || 'none';
                    const color = s.borderColor?.[side];
                    const present = !fragment || ((side !== 1 || fragment.last) && (side !== 3 || fragment.first));
                    const double = style === 'double' && widths[side] * this.layoutPx >= 3 - 1e-4;
                    return !collapsed && present && Boolean(color) && color[3] >= 0.999 && !double && !['hidden', 'dotted', 'dashed'].includes(style);
                })
            };
            for (let i = s.backgroundImage.length - 1; i >= 0; i--) {
                const layer = s.backgroundImage[i];
                if (layer.type === 'none' || hidden(i)) continue;
                const [clip, clipRadii] = clipOf(listItem(s.backgroundClip, i, 'border-box'));
                const [ax, ay, aw, ah] = boxes[listItem(s.backgroundOrigin, i, 'padding-box')] || boxes['padding-box'];
                const area = { x: ax, y: ay, width: aw, height: ah };
                if (layer.type === 'linear') this.emitLinearGradient(s, layer, i, clip, clipRadii, opacity, bgCommon, grid, placement);
                else this.emitBackgroundTiles(s, layer, i, area, clip, clipRadii, opacity, bgCommon);
            }
        }
        if (groupLayer) {
            this.items.filter = filterIndex;
            this.closeLayer(groupLayer, groupFields);
        }
        // Inset shadows inside the padding box
        if (inner.length) {
            const pad = [rect.x + widths[3], rect.y + widths[0], rect.width - widths[1] - widths[3], rect.height - widths[0] - widths[2]];
            const innerRadii = radii.map((r, i) => Math.max(0, r - Math.max(widths[i], widths[(i + 3) % 4])));
            for (let i = inner.length - 1; i >= 0; i--) {
                const sh = inner[i];
                const color = withAlpha(sh.color, opacity);
                if (!color || color[3] <= 0.002) continue;
                const spread = sh.spread || 0;
                this.items.push({
                    ...common,
                    kind: KIND.INSET,
                    rect: pad,
                    shape: [pad[0] + sh.x + spread, pad[1] + sh.y + spread, Math.max(0, pad[2] - spread * 2), Math.max(0, pad[3] - spread * 2)],
                    radii: innerRadii.map((r) => Math.max(0, r - spread)),
                    color,
                    border: [sh.blur, spread, 0, 0],
                    shape2: pad,
                    radii2: innerRadii
                });
            }
        }
        // Borders
        // One item per colour and style, each masked to its sides
        const emitSides = (sideRect, sideRadii, sideWidths, sideColors, clip = null, clipFlag = 0) => {
            const groups = new Map();
            sideWidths.forEach((w, i) => {
                if (w <= 0 || !sideColors[i] || sideColors[i][3] <= 0.002) return;
                const side = [SIDE_TOP, SIDE_RIGHT, SIDE_BOTTOM, SIDE_LEFT][i];
                if (!(sideMask & side)) return;
                const key = `${sideColors[i].join(',')}|${styles[i]}`;
                if (!groups.has(key)) groups.set(key, { color: sideColors[i], mask: 0, dash: styleFlag(styles[i]), ridge: clip && isRidgeOrGroove(styles[i]) });
                groups.get(key).mask |= side;
            });
            // Each item also learns which sides the others draw before and
            // after it, so the seams between them anti-alias without letting
            // the background through
            const list = [...groups.values()];
            list.forEach((group, k) => {
                const later = list.slice(k + 1).reduce((m, g) => m | g.mask, 0);
                const earlier = list.slice(0, k).reduce((m, g) => m | g.mask, 0);
                this.items.push({
                    ...common, kind: KIND.BOX, rect: sideRect, shape: sideRect, radii: sideRadii,
                    color: [0, 0, 0, 0], border: sideWidths, borderColor: group.color,
                    flags: group.mask | NO_FILL | group.dash | (later << LATER_SIDES_SHIFT) | (earlier << EARLIER_SIDES_SHIFT) | (group.ridge ? clipFlag : 0),
                    ...(group.ridge && { shape2: clip[0], radii2: clip[1] })
                });
            });
        };
        if (hasBorder) {
            if (borderVisible) {
                // On a rounded box one dash pattern runs round the whole border
                const dashFlag = styleFlag(styles[firstSide]);
                const pathed = dashFlag && rounded && !collapsed && outerWidths.every((w) => w === outerWidths[0]);
                const path = pathed ? roundedDashes(shape, radii, outerWidths[0], styles[firstSide], this.dpr || 1) : null;
                this.items.push({
                    ...common, kind: KIND.BOX, rect: shape, shape, radii,
                    color: mergeFill ? bg : [0, 0, 0, 0], border: outerWidths, borderColor,
                    flags: (mergeFill ? 15 : 15 | NO_FILL) | (pathed && !path ? 0 : dashFlag) | (path ? DASH_PATH : 0),
                    ...path
                });
                paintContentsBackground();
                return;
            }
            const inset = (by) => [[shape[0] + by[3], shape[1] + by[0], shape[2] - by[1] - by[3], shape[3] - by[0] - by[2]],
                radii.map((r, i) => Math.max(0, r - Math.max(by[i], by[(i + 3) % 4])))];
            // A rounded ridge or groove paints its two shadings as the whole
            // border, outside and inside the rect within its outer halves
            const ridgeClip = split && rounded ? inset(widths.map((w, i) => halfOf(w, i))) : null;
            if (!uniform) emitSides(borderRect, collapsed ? [0, 0, 0, 0] : radii, outerWidths, colors, ridgeClip, RIDGE_OUTSIDE);
            if (split) {
                // The inner shading of ridge and groove sides
                const innerColors = (s.borderColor || []).map((c, i) => (isRidgeOrGroove(styles[i]) ? withAlpha(shadeSide(c, styles[i], i, 'inner'), opacity) : null));
                if (rounded) {
                    emitSides(shape, radii, widths, innerColors, ridgeClip, RIDGE_INSIDE);
                } else {
                    // A ring of its own inside the outer halves
                    const [innerRect, innerRadii] = inset(widths.map((w, i) => (isRidgeOrGroove(styles[i]) ? outerWidths[i] : w)));
                    emitSides(innerRect, innerRadii, widths.map((w, i) => (isRidgeOrGroove(styles[i]) ? w - outerWidths[i] : 0)), innerColors);
                }
            }
            paintContentsBackground();
        }
    }

    // ── Text ────────────────────────────────────────────────────────────────

    emitRuns(container, opacity) {
        if (!container.runs) return;
        const dpr = this.ctx.dpr;
        // Text is the container's content: its own overflow clip applies
        const own = container.childClip || container.clip;
        const info = this.paintInfo(container);
        const common = { matrix: info.matrix, ...this.clipFields(container, own) };
        const snap = (v) => roundPx(v * dpr) / dpr;
        for (const run of container.runs) {
            if (!run.text || !run.text.trim()) continue;
            const shadowReach = (run.style.textShadow || []).reduce((m, sh) => Math.max(m, Math.abs(sh.x) + Math.abs(sh.y) + (sh.blur || 0) * 1.5), 0);
            if (this.offscreen(container, { x: run.absX, y: run.absY, width: run.width, height: run.height }, shadowReach + 2)) continue;
            const owner = run.owner || container;
            if (owner.style.visibility === 'hidden' || container.style.visibility === 'hidden') continue;
            const ownerOpacity = run.owner ? this.inlineOpacity(run.owner, container) : 1;
            // Glyphs fill in -webkit-text-fill-color when it is set, and so do
            // decoration lines of the current colour (measured); shadows have
            // their own colours, and still paint under a transparent fill
            const fill = withAlpha(textFill(run.style), opacity * ownerOpacity);
            const fills = Boolean(fill) && fill[3] > 0.002;
            if (run.symbol === 'disclosure-closed' || run.symbol === 'disclosure-open') {
                if (fills) this.emitDisclosure(run, fill, common, info);
                continue;
            }
            // The first listed shadow is on top: drawn last
            for (const shadow of [...(run.style.textShadow || [])].reverse()) {
                const sc = withAlpha(shadow.color, opacity * ownerOpacity);
                if (sc && sc[3] > 0.002) this.emitText(run.text, run.style, run.absX + shadow.x, run.absBaseline + shadow.y, sc, common, snap, info, shadow.blur || 0);
            }
            if (fills) this.emitText(run.text, run.style, run.absX, run.absBaseline, fill, common, snap, info);
            this.emitDecorationLines(run, owner, fill, opacity * ownerOpacity, common);
        }
    }

    /**
     * A summary's disclosure triangle as Chrome paints it
     * (TextFragmentPainter::PaintSymbol): the canonical path, pointing
     * right when closed and down when open, scaled to a square of
     * LayoutUnit(0.66em) whose bottom is the baseline of the marker's text
     * box, that box's top rounded to a whole pixel as text is. The path is
     * not snapped: it starts at the marker's own x.
     */
    emitDisclosure(run, color, common, info) {
        const d = this.dpr;
        const size = Math.floor((run.style.fontSize || 16) * this.layoutPx * 0.66 * 64) / 64 * (d / this.layoutPx);
        if (!(size > 0)) return;
        const [gx, gy] = this.textGrid(common.matrix);
        const shiftX = common.matrix && info?.grid ? info.shift[0] : 0;
        const deviceX = (run.absX - shiftX - gx) * d;
        const bottom = roundPx((run.absBaseline - gy) * d);
        const x0 = Math.floor(deviceX);
        const y0 = Math.floor(bottom - size);
        const px = Math.round((deviceX - x0) * 64) / 64;
        const py = bottom - size - y0;
        const open = run.symbol === 'disclosure-open';
        const points = open ? [[0, 0.07], [0.5, 0.93], [1, 0.07]] : [[0, 0], [0.86, 0.5], [0, 1]];
        const w = Math.ceil(px + size) + 1;
        const h = Math.ceil(py + size) + 1;
        const sprite = this.use(this.raster.sprite(`disclosure-${open ? 'open' : 'closed'}-${size}-${px}-${py}`, w, h, 1, (c) => {
            c.fillStyle = '#ffffff';
            c.beginPath();
            points.forEach(([u, v], i) => (i ? c.lineTo(px + u * size, py + v * size) : c.moveTo(px + u * size, py + v * size)));
            c.closePath();
            c.fill();
        }));
        if (!sprite) return;
        this.items.push({
            ...common, kind: KIND.GLYPHS,
            rect: [gx + shiftX + x0 / d, gy + y0 / d, w / d, h / d],
            color, uv: [sprite.uv.u0, sprite.uv.v0, sprite.uv.u1, sprite.uv.v1], page: sprite.page
        });
    }

    inlineOpacity(owner, container) {
        let o = 1;
        let b = owner;
        while (b && b !== container) {
            o *= b.style.opacity ?? 1;
            b = b.parent;
        }
        return o;
    }

    /** `info` is the paintInfo of the box the text belongs to. */
    emitText(text, style, x, baseline, color, common, snap, info = null, blur = 0) {
        if (!color || color[3] <= 0.002) return;
        // The browser places glyphs from the run's own origin, which can fall
        // inside a device pixel: the raster is drawn from that offset and
        // placed on whole device pixels. A line starts on a layout unit (1/64
        // px), but a word after the first starts at a float sum of advances,
        // and Skia puts each glyph in a quarter-pixel bin from its exact x:
        // the offset keeps Skia's own precision (1/65536 px), or a glyph near
        // a bin edge lands in the next bin.
        // Under a transform text keeps its unrounded x (only boxes move to the
        // element's rounded position), so the paint shift is taken back off
        const [gx, gy] = this.textGrid(common.matrix);
        const shiftX = common.matrix && info?.grid ? info.shift[0] : 0;
        const deviceX = (x - shiftX - gx) * this.dpr;
        let whole = Math.floor(deviceX);
        let phase = Math.round((deviceX - whole) * 65536) / 65536;
        if (phase >= 1) { whole += 1; phase = 0; }
        const entry = this.use(this.raster.text(text, style, this.ctx.dpr, color, phase, blur));
        if (!entry) return;
        const left = whole / this.dpr + gx + entry.offsetX;
        // The baseline is rounded to a layout pixel of the element's own grid
        // (a transformed element's rounded position), then to a device pixel
        // of the canvas, whose grid starts at the viewport origin, not at the scene's
        if (common.matrix && info?.grid) {
            const d = this.layoutPx;
            baseline = roundPx((baseline - info.grid[1]) * d) / d + info.grid[1];
        }
        const top = snap(baseline - gy) + gy + entry.offsetY;
        this.items.push({
            ...common,
            kind: entry.color ? KIND.IMAGE : KIND.GLYPHS,
            rect: [left, top, entry.width, entry.height],
            shape: [left - 1, top - 1, entry.width + 2, entry.height + 2],
            color: entry.color ? [1, 1, 1, color[3]] : color,
            uv: [entry.uv.u0, entry.uv.v0, entry.uv.u1, entry.uv.v1],
            page: entry.page
        });
    }

    /**
     * The run's decoration lines. `fill` is its glyphs' colour (with
     * `factor`, the opacity, applied): a line of the current colour takes it
     * (-webkit-text-fill-color when set, measured), one of its own colour
     * keeps that, even one equal to `color` or under a transparent fill.
     */
    emitDecorationLines(run, owner, fill, factor, common) {
        // text-decoration propagates from the inline box or container that sets it
        let line = run.style.textDecorationLine;
        let decoColor = run.style.textDecorationColor;
        let decorating = owner;
        let b = owner;
        while ((!line || line === 'none') && b) {
            line = b.style?.textDecorationLine;
            decoColor = b.style?.textDecorationColor;
            decorating = b;
            b = b.parent && b.parent.outer === 'inline' ? b.parent : null;
        }
        if (!line || line === 'none') return;
        const size = run.style.fontSize || 16;
        const thickness = Math.max(1, Math.round(size / 15));
        // Only with a fill colour does it matter whether a colour equal to
        // `color` is the current colour or the page's own
        const current = !decoColor || (Boolean(run.style.webkitTextFillColor) && sameColor(decoColor, decorating.style?.color || run.style.color)
            && decorationFollowsText(decorating.element));
        const c = current ? fill : withAlpha(decoColor, factor);
        if (!c || c[3] <= 0.002) return;
        const metrics = this.shaper.fontMetrics(run.style);
        // Lines sit on device pixels of the canvas grid, as the run's glyphs do
        const [, gy] = this.textGrid(common.matrix);
        const d = this.dpr;
        const draw = (y) => this.items.push({ ...common, kind: KIND.BOX, rect: [run.absX, roundPx((y - gy) * d) / d + gy, run.width, thickness], color: c, flags: 15 });
        if (line.includes('underline')) draw(run.absBaseline + Math.max(1, size * 0.1));
        if (line.includes('line-through')) draw(run.absBaseline - metrics.xHeight / 2);
        if (line.includes('overline')) draw(run.absBaseline - metrics.ascent);
    }

    // ── Replaced and native content ─────────────────────────────────────────

    contentRect(box) {
        return {
            x: box.absX + box.border[3] + box.padding[3],
            y: box.absY + box.border[0] + box.padding[0],
            width: Math.max(0, box.width - box.border[1] - box.border[3] - box.padding[1] - box.padding[3]),
            height: Math.max(0, box.height - box.border[0] - box.border[2] - box.padding[0] - box.padding[2])
        };
    }

    emitReplaced(box, opacity) {
        const el = box.element;
        if (!el || (box.inner !== 'replaced' && box.inner !== 'svg')) return;
        const tag = el.localName;
        if (CONTROL_TAGS.has(tag)) this.controls.set(box, controlState(el));
        const content = this.contentRect(box);
        const common = this.common(box);
        const radii = resolveRadii(box);
        // SVG and images paint into their pixel-snapped box, as the browser
        // draws them: at a fractional position the raster would be resampled
        // half a pixel off and blur. Their box cuts them on the same pixels
        const grid = this.paintInfo(box).grid;
        const place = (r) => {
            if (!grid) return r;
            const [x, y, width, height] = this.snapRect(r.x, r.y, r.width, r.height, grid);
            return { x, y, width, height };
        };
        const border = place({ x: box.absX, y: box.absY, width: box.width, height: box.height });
        const shape = [border.x, border.y, border.width, border.height];
        if (tag === 'svg') {
            // A drawing that reaches past the box shows where overflow is visible
            const { rect: at, viewBox } = box.style.svgOverflow === 'visible' ? this.svgReach(el, place(content)) : { rect: place(content), viewBox: null };
            const m = common.matrix;
            if (m && !radii.some((r) => r > 0)) {
                this.emitTransformedSvg(el, at, m, opacity, common, viewBox);
                return;
            }
            const entry = this.use(this.raster.svg(el, at.width, at.height, this.ctx.dpr, this.ctx.styleOf, null, viewBox));
            // An inline SVG's shapes are cut as shapes, not as a rect over the clip
            if (entry) this.pushImage(entry, at, opacity, common, viewBox ? [at.x, at.y, at.width, at.height] : shape, viewBox ? [0, 0, 0, 0] : radii, 15 | CLIP_RAMP);
            return;
        }
        if (tag === 'img') {
            // The image fills its pixel-snapped object-fit rect, drawn at that
            // size (a vector image stays sharp) and cut to the content box
            const at = place(content);
            const fitted = place(this.objectFit(box, content));
            const fit = { x: fitted.x - at.x, y: fitted.y - at.y, width: fitted.width, height: fitted.height };
            // Pixelated: the image's own texels, each device pixel taking the one its centre falls in
            if (pixelated(box.style) && el.naturalWidth > 0 && !/\.svg(\?|#|$)|^data:image\/svg/i.test(el.currentSrc || el.src || '')
                && Math.max(el.naturalWidth, el.naturalHeight) <= this.raster.maxRaster) {
                const texels = this.use(this.raster.image(el, el.naturalWidth, el.naturalHeight, 1));
                if (texels) this.pushImage(texels, fitted, opacity, { ...common, ...this.narrowClip(common, [at.x, at.y, at.x + at.width, at.y + at.height]) }, shape, radii, 15 | NEAREST);
                return;
            }
            // In a rounded clip, or with rounded corners of its own, an SVG image
            // is drawn shape by shape, each cut by the curve, as the browser draws it
            if (radii.some((r) => r > 0) || common.clipRadii?.some((r) => r > 0) || common.clip2) {
                const shapes = this.raster.imageShapes(el, at.width, at.height, this.ctx.dpr, fit);
                if (shapes) {
                    for (const part of shapes) if (this.use(part)) this.pushImage(part, at, opacity, common, shape, radii, 15 | (!part.cover ? CLIP_RAMP : part.solid ? CLIP_FILL : 0));
                    return;
                }
                // Still being made: the whole raster meanwhile, and drawn again when ready
                if (shapes === null) this.misses++;
            }
            const entry = this.use(this.raster.image(el, at.width, at.height, this.ctx.dpr, fit));
            if (entry) this.pushImage(entry, at, opacity, common, shape, radii);
            return;
        }
        // From the cascade: an author rule unthemes a control as inline style does
        const appearance = box.style.appearance || 'auto';
        if (tag === 'input') {
            const type = (el.getAttribute('type') || 'text').toLowerCase();
            if (type === 'checkbox' || type === 'radio') {
                if (appearance !== 'none') this.emitCheck(box, border, type, el, opacity, common);
                return;
            }
            if (type === 'range') {
                this.emitRange(box, border, content, el, opacity, common);
                return;
            }
            if (type === 'color') {
                // Chrome's swatch: 2px in from the content box's sides and 4px
                // from its top and bottom, in a 1px #777 border
                const swatch = parseColor(el.value) || [0, 0, 0, 1];
                const at = place({ x: content.x + 2, y: content.y + 4, width: Math.max(0, content.width - 4), height: Math.max(0, content.height - 8) });
                const rect = [at.x, at.y, at.width, at.height];
                this.items.push({
                    ...common, kind: KIND.BOX, rect, shape: rect, color: withAlpha(swatch, opacity),
                    border: [1, 1, 1, 1], borderColor: withAlpha([119 / 255, 119 / 255, 119 / 255, 1], opacity), flags: 15
                });
                return;
            }
            if (type === 'file') {
                this.emitTextLine(box, content, el.files?.length ? el.files[0].name : 'No file chosen', textFill(box.style), opacity, common, false);
                return;
            }
            if (type === 'hidden') return;
            if (BUTTON_INPUTS.has(type)) {
                this.emitButtonLabel(box, content, el, opacity, common);
                return;
            }
            this.emitTextField(box, content, el, opacity, common);
            return;
        }
        if (tag === 'textarea') {
            this.emitTextField(box, content, el, opacity, common, true);
            return;
        }
        if (tag === 'select') {
            const option = el.options?.[el.selectedIndex];
            const themed = appearance !== 'none';
            // The value starts 4 layout px into the content box (the browser's
            // PopupInternalPaddingStart)
            const inset = themed && box.style.direction !== 'rtl' ? Math.trunc(4 * this.layoutPx) / this.layoutPx : 0;
            const text = option ? option.textContent.trim() : '';
            if (text) {
                // One row as tall as the font's ascent and descent, centred with
                // the halves truncated to layout units, where the layout puts its baseline
                const metrics = this.shaper.fontMetrics(box.style);
                const baseline = content.y + truncUnit((content.height - metrics.ascent - metrics.descent) / 2, this.layoutPx) + metrics.ascent;
                const snap = (v) => roundPx(v * this.ctx.dpr) / this.ctx.dpr;
                this.emitText(text, box.style, content.x + inset, baseline, withAlpha(textFill(box.style), opacity), common, snap, this.paintInfo(box));
            }
            if (themed) this.emitMenuListArrow(box, border, grid, opacity, common);
            return;
        }
        if (tag === 'progress') this.emitProgress(box, border, content, el, opacity, common);
        else if (tag === 'meter') this.emitMeter(box, content, el, opacity, common);
    }

    /**
     * A linear gradient as one item, placed as the browser places a
     * background image (backgroundAreas, backgroundPlace): a tile of the
     * layer's background-size at its background-position, drawn into its
     * snapped dest and clipped to the painting area. When the tile at or
     * before the dest's start covers what the browser draws, it draws that
     * one tile straight, as far as the dest reaches: the far edge
     * anti-aliases where the tile ends between device pixels, and a corner
     * pixel takes the lesser of its two edges' shares, as Skia covers a
     * rect. Otherwise the tile is painted as the browser paints it, from an
     * image of whole device pixels (tileImage), repeated along the axes
     * background-repeat repeats.
     */
    emitLinearGradient(s, layer, index, clip, clipRadii, opacity, common, grid, placement) {
        const repeats = repeatOf(listItem(s.backgroundRepeat, index, 'repeat'));
        const originBox = listItem(s.backgroundOrigin, index, 'padding-box');
        const clipBox = listItem(s.backgroundClip, index, 'border-box');
        const areas = [0, 1].map((i) => this.backgroundAreas(placement, i, originBox, clipBox, grid ? grid[i] : null));
        // A gradient is sized against the snapped positioning area, in layout units
        const size = this.backgroundTile(layer, listItem(s.backgroundSize, index, 'auto'), { width: areas[0].snappedArea, height: areas[1].snappedArea });
        const tile = [size.width, size.height].map((v) => truncUnit(v, this.layoutPx));
        if (!(tile[0] > 0) || !(tile[1] > 0)) return;
        const positions = [
            parsePosition(`${listItem(s.backgroundPositionX, index, '0%')} center`).x,
            parsePosition(`center ${listItem(s.backgroundPositionY, index, '0%')}`).y
        ];
        const places = areas.map((area, i) => this.backgroundPlace(area, tile[i], positions[i], repeats[i], grid ? grid[i] : null));
        // One tile is drawn straight when it holds the dest's start and its unsnapped extent
        const straight = places.every((p, i) => p.origin <= p.dest[0] + 1e-6 && p.origin + tile[i] >= p.dest[0] + p.used - 1e-6);
        const image = straight ? null : this.tileImage(places, tile, common.matrix);
        if (!straight && !image) return;
        // How far past its origin the tile shows along each axis
        const shown = places.map((p, i) => {
            if (image) return repeats[i] ? tile[i] : p.dest[1] - p.origin;
            const end = Math.min(p.dest[1], p.origin + tile[i]);
            // A rect thinner than a device pixel covers w (1 + w) / 2 of it, as Skia draws it
            const w = (end - p.dest[0]) * this.dpr;
            return (grid && w > 0 && w < 1 ? p.dest[0] + w * (1 + w) / 2 / this.dpr : end) - p.origin;
        });
        if (!(shown[0] > 0) || !(shown[1] > 0)) return;
        // The quad covers what is drawn and a pixel for the far edge. The dest
        // starts on a device pixel; unsnapped (under a transform) the tile's
        // own edge anti-aliases
        const quad = places.map((p, i) => {
            const c0 = clip[i];
            const c1 = clip[i] + clip[i + 2];
            if (image && repeats[i]) return grid ? [Math.max(c0, p.dest[0]), Math.min(c1, p.dest[1])] : [c0, c1];
            return [Math.max(c0, grid ? p.dest[0] : p.origin - 1), Math.min(c1, p.origin + shown[i] + 1)];
        });
        const [[x0, x1], [y0, y1]] = quad;
        if (x1 <= x0 || y1 <= y0) return;
        const [tileWidth, tileHeight] = tile;
        // A corner keyword's angle follows the tile's aspect ratio
        const angle = linearGradientAngle(layer, tileWidth, tileHeight) * Math.PI / 180;
        const dir = [Math.sin(angle), -Math.cos(angle)];
        const length = Math.abs(tileWidth * dir[0]) + Math.abs(tileHeight * dir[1]);
        // The strip spans start..start + period of the gradient line (one period of a repeating gradient)
        const strip = this.raster.gradient(layer.stops, length, layer.repeating, layer.space);
        const entry = this.use(strip.entry);
        if (!entry) return;
        const span = Math.max(length * strip.period, 1e-3);
        this.items.push({
            ...common,
            kind: KIND.GRADIENT,
            rect: [x0, y0, x1 - x0, y1 - y0],
            shape: clip,
            radii: clipRadii,
            shape2: [places[0].origin, places[1].origin, tileWidth, tileHeight],
            // The image's repeat step and texels along x and y; zero texels paint the tile straight
            radii2: image ? [...image.period, ...image.texels] : null,
            color: [1, 1, 1, opacity],
            uv: [entry.uv.u0, entry.uv.v0, entry.uv.u1, entry.uv.v1],
            // Only an image repeats; a tile drawn straight is one tile
            border: [image && repeats[0] ? 1 : 0, image && repeats[1] ? 1 : 0, shown[0], shown[1]],
            // A pixel centre on a hard stop takes the later colour, as in Chrome:
            // 1/1000 px along the line keeps float error from splitting such ties.
            // An image's texels sit at small tile offsets, so 1/10000 px is enough
            // there, and a texel that just misses a stop keeps its colour
            extra: [dir[0] / span, dir[1] / span, (0.5 - strip.start) / strip.period + (image ? 1e-4 : 1e-3) / span, layer.repeating ? 1 : 0],
            page: entry.page
        });
    }

    /**
     * One axis (0 x, 1 y) of the boxes the browser places a background
     * layer in (background_image_geometry.cc): the unsnapped border box
     * b0..b1, the positioning area (area) and the dest it draws into, each
     * unsnapped and from the edges the browser snaps it (areaFrom,
     * destFrom). The padding box is snapped as the snapped border box less
     * the border widths, unless the box may not use its border (collapsed
     * table borders); a content box is snapped from the unsnapped one. A
     * border-box dest stops at the inner edge of each side whose border hides
     * the background (opaque and solid, or no border at all), snapped there.
     * `g` is where device pixels start along the axis, null to leave
     * everything unsnapped.
     */
    backgroundAreas(p, i, originBox, clipBox, g) {
        const [start, end] = i ? [0, 2] : [3, 1];
        const b0 = p.raw[i];
        const b1 = b0 + p.raw[i + 2];
        const s0 = p.shape[i];
        const s1 = s0 + p.shape[i + 2];
        const w0 = p.widths[start];
        const w1 = p.widths[end];
        const padding = [b0 + w0, b1 - w1];
        const inner = p.disallow ? padding : [s0 + w0, s1 - w1];
        // With no padding at all the content box is the padding box
        const content = p.padding.some((v) => v !== 0) ? [b0 + w0 + p.padding[start], b1 - w1 - p.padding[end]] : null;
        const boxes = {
            'border-box': [[b0, b1], [b0, b1]],
            'padding-box': [padding, inner],
            'content-box': content ? [content, content] : [padding, inner]
        };
        const [area, areaFrom] = boxes[originBox] || boxes['padding-box'];
        let [dest, destFrom] = boxes[clipBox] || boxes['border-box'];
        if (!boxes[clipBox] || clipBox === 'border-box') {
            const h0 = p.obscures[start];
            const h1 = p.obscures[end];
            dest = [h0 ? b0 + w0 : b0, h1 ? b1 - w1 : b1];
            destFrom = [h0 ? s0 + w0 : b0, h1 ? s1 - w1 : b1];
        }
        const snappedArea = this.snapSpan(areaFrom, g);
        return { b0, b1, area, areaFrom, snappedArea: snappedArea[1] - snappedArea[0], dest, destFrom, snappedDest: this.snapSpan(destFrom, g) };
    }

    /**
     * Where the browser draws a background tile `size` long along one axis
     * of `a` (backgroundAreas), as SetRepeatX / SetNoRepeatX and
     * ComputePhase place it: the tile's origin, the snapped dest it draws
     * into and the dest's unsnapped extent (used), all cut to the border
     * box. The position resolves against the unsnapped positioning area. A
     * tile that does not repeat and starts inside the dest is moved to a
     * whole device pixel and the dest is the tile; one that starts at or
     * before it keeps its unsnapped offset from the snapped dest, which ends
     * where the tile placed from the snapped boxes would. A repeating tile
     * is anchored at the snapped dest at its unsnapped offset: the origin is
     * the tile at or before the dest's start.
     */
    backgroundPlace(a, size, axis, repeats, g) {
        const zoom = this.layoutPx;
        // In layout units, as the browser resolves a position against a free length
        const resolve = (free) => (axis.pct != null ? truncUnit(axis.pct * free, zoom) : 0) + (axis.px ? truncUnit(axis.px, zoom) : 0);
        const offset = a.area[0] - a.dest[0] + resolve(a.area[1] - a.area[0] - size);
        let origin;
        let dest;
        let used;
        if (repeats) {
            let m = offset % size;
            if (Math.abs(m) < 1e-6 || Math.abs(m) > size - 1e-6) m = 0;
            origin = a.snappedDest[0] + (m > 0 ? m - size : m);
            dest = a.snappedDest;
            used = a.dest;
        } else if (offset > 1e-6) {
            origin = this.snapPx(a.dest[0] + offset, g);
            dest = [origin, origin + size];
            used = [a.dest[0] + offset, a.dest[0] + offset + size];
        } else {
            origin = a.snappedDest[0] + offset;
            const snappedOffset = a.areaFrom[0] - a.destFrom[0] + resolve(a.snappedArea - size);
            dest = [a.snappedDest[0], a.snappedDest[0] + size + snappedOffset];
            used = [a.dest[0], a.dest[0] + size + offset];
        }
        const lo = Math.max(dest[0], a.b0);
        return {
            origin,
            dest: this.snapSpan([lo, Math.max(lo, Math.min(dest[1], a.b1))], g),
            used: Math.max(0, Math.min(used[1], a.b1) - Math.max(used[0], a.b0))
        };
    }

    /** A position on a whole device pixel (half up) along an axis whose pixels start at g; unchanged when g is null. */
    snapPx(v, g) {
        return g == null ? v : roundPx((v - g) * this.dpr) / this.dpr + g;
    }

    /**
     * A span v0..v1 on whole device pixels, as the browser snaps a rect
     * (ToPixelSnappedRect): a size that is not 0 stays at least a pixel.
     */
    snapSpan([v0, v1], g) {
        if (g == null) return [v0, v1];
        const a = this.snapPx(v0, g);
        let b = this.snapPx(v1, g);
        if (b === a && Math.abs(v1 - v0) * this.layoutPx > 4 / 64) b = a + Math.sign(v1 - v0) / this.dpr;
        return [a, b];
    }

    /**
     * The image the browser paints a background tile from when one tile
     * does not cover what it draws (DrawTiledBackground): it repeats the
     * image with bilinear sampling, wrapping at the image's edges. The image
     * has ceil(device size) texels along each axis (its area kept to 2048 x
     * 2048), each the gradient at its centre, so where the tile's origin or
     * size falls between device pixels every seam blends and hard stops
     * soften. Its step is the tile, or the snapped dest when the tile is
     * within half a device pixel of it (along an axis that does not repeat
     * the dest is the tile rounded to device pixels, so the tile stretches
     * to it); the images start at the tile's origin, so a stretched step
     * moves the seams after it. Returns { period, texels } per axis, or null
     * when there is no image to draw (under scale(0)).
     */
    tileImage(places, tile, matrix) {
        const scale = [this.dpr * (matrix ? Math.hypot(matrix[0], matrix[1]) : 1), this.dpr * (matrix ? Math.hypot(matrix[2], matrix[3]) : 1)];
        const period = places.map((p, i) => {
            const dest = p.dest[1] - p.dest[0];
            return Math.abs(tile[i] - dest) <= 0.5 / scale[i] ? dest : tile[i];
        });
        // The browser keeps sizes in layout units (1/64 device px): a 33.3px tile repeats every 33.296875px
        const device = period.map((size, i) => Math.floor(size * scale[i] * 64 + 1e-3) / 64);
        if (!(device[0] > 0) || !(device[1] > 0)) return null;
        const shrink = Math.min(1, Math.sqrt(2048 * 2048 / Math.max(1e-6, device[0] * device[1])));
        const texels = device.map((size) => Math.max(1, Math.ceil(size * shrink - 1e-4)));
        return { period: device.map((size, i) => size / scale[i]), texels };
    }

    /**
     * Radial and conic gradients and url() images: tiles of the layer's
     * background-size, placed by background-position from the padding box,
     * repeated per background-repeat and clipped to the painting area.
     */
    emitBackgroundTiles(s, layer, index, area, clip, clipRadii, opacity, common) {
        const tile = this.backgroundTile(layer, listItem(s.backgroundSize, index, 'auto'), area);
        // An image still loading draws nothing yet
        if (!tile) this.misses++;
        if (!tile || tile.width < 0.5 || tile.height < 0.5) return;
        const x = area.x + resolvePositionAxis(parsePosition(`${listItem(s.backgroundPositionX, index, '0%')} center`).x, area.width - tile.width);
        const y = area.y + resolvePositionAxis(parsePosition(`center ${listItem(s.backgroundPositionY, index, '0%')}`).y, area.height - tile.height);
        const [repeatX, repeatY] = repeatOf(listItem(s.backgroundRepeat, index, 'repeat'));
        const [cx, cy, cw, ch] = clip;
        const x0 = repeatX ? x - Math.ceil((x - cx) / tile.width) * tile.width : x;
        const y0 = repeatY ? y - Math.ceil((y - cy) / tile.height) * tile.height : y;
        const x1 = repeatX ? cx + cw : x + 0.5;
        const y1 = repeatY ? cy + ch : y + 0.5;
        if (((x1 - x0) / tile.width) * ((y1 - y0) / tile.height) > MAX_TILES) return;
        // Large tiles rasterize below device resolution so they fit an atlas page
        const dpr = Math.max(0.1, Math.min(this.ctx.dpr, this.painter.atlas.size / Math.max(tile.width, tile.height)));
        // Pixelated: the image's own texels, each device pixel taking the one its centre falls in
        const natural = layer.type === 'url' && pixelated(s) ? this.raster.imageSize(layer.url) : null;
        const texels = natural && Math.max(natural.width, natural.height) <= this.raster.maxRaster;
        const entry = this.use(texels ? this.raster.image(layer.url, natural.width, natural.height, 1) : layer.type === 'url'
            ? this.raster.image(layer.url, tile.width, tile.height, dpr)
            : this.raster.cssGradient(layer, tile.width, tile.height, dpr));
        if (!entry) return;
        const flags = texels ? 15 | NEAREST : 15;
        if (texels && !common.matrix) {
            // On an axis that does not repeat, the tile fills its rect snapped to
            // device pixels; along one that repeats, it keeps its size from the
            // snapped start (measured)
            const placed = this.snapRect(x, y, tile.width, tile.height);
            // Within half a device pixel of its area, the tile fills it
            const near = (a, b) => Math.abs(a - b) * this.dpr <= 0.5 + 1e-4;
            if (near(tile.width, area.width)) placed[2] = area.width;
            if (near(tile.height, area.height)) placed[3] = area.height;
            if (!repeatX && !repeatY) {
                this.pushImage(entry, { x: placed[0], y: placed[1], width: placed[2], height: placed[3] }, opacity, common, clip, clipRadii, flags);
                return;
            }
            const sx = placed[0] - x;
            const sy = placed[1] - y;
            const width = repeatX ? tile.width : placed[2];
            const height = repeatY ? tile.height : placed[3];
            for (let ty = y0 + sy; ty < y1 + sy; ty += height) {
                for (let tx = x0 + sx; tx < x1 + sx; tx += width) {
                    if (tx + width <= cx || ty + height <= cy || tx >= cx + cw || ty >= cy + ch) continue;
                    this.pushImage(entry, { x: tx, y: ty, width, height }, opacity, common, clip, clipRadii, flags);
                }
            }
            return;
        }
        for (let ty = y0; ty < y1; ty += tile.height) {
            for (let tx = x0; tx < x1; tx += tile.width) {
                if (tx + tile.width <= cx || ty + tile.height <= cy || tx >= cx + cw || ty >= cy + ch) continue;
                this.pushImage(entry, { x: tx, y: ty, width: tile.width, height: tile.height }, opacity, common, clip, clipRadii, flags);
            }
        }
    }

    /** One tile's size from a background-size value, or null while an image loads. */
    backgroundTile(layer, sizeValue, area) {
        const natural = layer.type === 'url' ? this.raster.imageSize(layer.url) : null;
        if (layer.type === 'url' && !natural) return null;
        const token = sizeValue.toLowerCase();
        if (token === 'cover' || token === 'contain') {
            if (!natural) return { width: area.width, height: area.height };
            const scale = (token === 'cover' ? Math.max : Math.min)(area.width / natural.width, area.height / natural.height);
            return { width: natural.width * scale, height: natural.height * scale };
        }
        const [w, h = 'auto'] = splitWhitespace(token);
        const length = (value, base) => {
            if (!value || value === 'auto') return null;
            if (value.endsWith('%')) return parseFloat(value) / 100 * base;
            const n = parseFloat(value);
            return Number.isFinite(n) ? n : null;
        };
        let width = length(w, area.width);
        let height = length(h, area.height);
        if (natural) {
            const ratio = natural.width / natural.height;
            if (width == null && height == null) { width = natural.width; height = natural.height; }
            else if (width == null) width = height * ratio;
            else if (height == null) height = width / ratio;
        }
        return { width: width ?? area.width, height: height ?? area.height };
    }

    /**
     * An SVG under a transform, as the browser paints it: the vector drawn
     * through the transform onto the device pixels it covers (sharp under a
     * scale, anti-aliased at its own place under a fractional translate),
     * instead of its raster resampled. The offset into the first pixel is
     * kept to 1/64 of a pixel, so moving SVGs share rasters.
     */
    emitTransformedSvg(el, at, m, opacity, common, viewBox = null) {
        const dpr = this.ctx.dpr;
        // Device pixels of the canvas, from its grid's origin in the scene
        const [gx, gy] = this.textGrid(null);
        const map = (x, y) => [(m[0] * x + m[2] * y + m[4] - gx) * dpr, (m[1] * x + m[3] * y + m[5] - gy) * dpr];
        const corners = [map(at.x, at.y), map(at.x + at.width, at.y), map(at.x, at.y + at.height), map(at.x + at.width, at.y + at.height)];
        const x0 = Math.floor(Math.min(...corners.map((c) => c[0])) + 1e-6);
        const y0 = Math.floor(Math.min(...corners.map((c) => c[1])) + 1e-6);
        const x1 = Math.ceil(Math.max(...corners.map((c) => c[0])) - 1e-6);
        const y1 = Math.ceil(Math.max(...corners.map((c) => c[1])) - 1e-6);
        if (x1 <= x0 || y1 <= y0) return;
        const [ox, oy] = corners[0];
        const phase = (v) => Math.round(v * 64) / 64;
        const matrix = [m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, phase(ox - x0), phase(oy - y0)];
        const entry = this.use(this.raster.svg(el, at.width, at.height, dpr, this.ctx.styleOf, { matrix, width: x1 - x0, height: y1 - y0 }, viewBox));
        if (!entry) return;
        const rect = { x: x0 / dpr + gx, y: y0 / dpr + gy, width: (x1 - x0) / dpr, height: (y1 - y0) / dpr };
        this.pushImage(entry, rect, opacity, { ...common, matrix: null }, [rect.x, rect.y, rect.width, rect.height], [0, 0, 0, 0], 15 | CLIP_RAMP);
    }

    /**
     * An SVG whose overflow shows, as { rect, viewBox }: box `at` grown to
     * the bounds of its drawing (strokes and a pixel of anti-aliasing
     * included), with the viewBox that keeps the drawing in place. The SVG's
     * own viewBox places it uniformly scaled and centred, or stretched under
     * preserveAspectRatio none; other alignments keep the box.
     */
    svgReach(el, at) {
        const none = { rect: at, viewBox: null };
        const align = (el.getAttribute('preserveAspectRatio') || '').trim();
        if (align && !/^(none|xMidYMid(\s+meet)?)$/.test(align)) return none;
        let bbox;
        try {
            bbox = el.getBBox();
        } catch {
            return none;
        }
        if (!bbox || !(bbox.width > 0 || bbox.height > 0)) return none;
        const vb = el.viewBox?.baseVal;
        const fitted = vb && vb.width > 0 && vb.height > 0;
        let sx = fitted ? at.width / vb.width : 1;
        let sy = fitted ? at.height / vb.height : 1;
        let tx = 0;
        let ty = 0;
        if (fitted && align === 'none') {
            tx = -vb.x * sx;
            ty = -vb.y * sy;
        } else if (fitted) {
            const k = Math.min(sx, sy);
            tx = (at.width - vb.width * k) / 2 - vb.x * k;
            ty = (at.height - vb.height * k) / 2 - vb.y * k;
            sx = sy = k;
        }
        let stroke = 0;
        for (const node of el.querySelectorAll('*')) {
            const style = this.ctx.styleOf?.(node);
            if (style?.stroke) stroke = Math.max(stroke, style.strokeWidth || 1);
        }
        const mx = stroke / 2 * sx + 1;
        const my = stroke / 2 * sy + 1;
        const x0 = Math.min(0, Math.floor(bbox.x * sx + tx - mx));
        const y0 = Math.min(0, Math.floor(bbox.y * sy + ty - my));
        const x1 = Math.max(at.width, Math.ceil((bbox.x + bbox.width) * sx + tx + mx));
        const y1 = Math.max(at.height, Math.ceil((bbox.y + bbox.height) * sy + ty + my));
        if (x0 >= 0 && y0 >= 0 && x1 <= at.width && y1 <= at.height) return none;
        const width = x1 - x0;
        const height = y1 - y0;
        return {
            rect: { x: at.x + x0, y: at.y + y0, width, height },
            viewBox: [(x0 - tx) / sx, (y0 - ty) / sy, width / sx, height / sy]
        };
    }

    pushImage(entry, rect, opacity, common, shape, radii, flags = 15) {
        this.items.push({
            ...common, kind: KIND.IMAGE,
            rect: [rect.x, rect.y, rect.width, rect.height],
            shape, radii, color: [1, 1, 1, opacity],
            uv: [entry.uv.u0, entry.uv.v0, entry.uv.u1, entry.uv.v1], page: entry.page, flags
        });
    }

    objectFit(box, content) {
        const el = box.element;
        const fit = box.style.objectFit;
        const nw = el.naturalWidth || content.width;
        const nh = el.naturalHeight || content.height;
        if (!nw || !nh || fit === 'fill') return content;
        const scaleX = content.width / nw;
        const scaleY = content.height / nh;
        const scale = fit === 'cover' ? Math.max(scaleX, scaleY) : fit === 'contain' ? Math.min(scaleX, scaleY) : 1;
        const w = nw * scale;
        const h = nh * scale;
        return { x: content.x + (content.width - w) / 2, y: content.y + (content.height - h) / 2, width: w, height: h };
    }

    /** Where device pixels start for `box`'s native parts (its own corner under a turned transform). */
    deviceGrid(box) {
        return this.paintInfo(box).grid || [box.absX, box.absY];
    }

    /** `rect` ({ x, y, width, height }, snapped) in whole device px from `grid`: [x, y, width, height]. */
    deviceRect(rect, grid) {
        const d = this.dpr;
        const x0 = roundPx((rect.x - grid[0]) * d);
        const y0 = roundPx((rect.y - grid[1]) * d);
        return [x0, y0, roundPx((rect.x + rect.width - grid[0]) * d) - x0, roundPx((rect.y + rect.height - grid[1]) * d) - y0];
    }

    /**
     * A rounded rect or ring of a native face, in scene px: `color` fills it,
     * or with `ring` a border that wide inside it. Rounded rects are drawn by
     * the box shader, whose coverage follows the browser's analytic one.
     */
    pushFace(shape, radius, color, opacity, common, ring = 0) {
        const c = withAlpha(typeof color === 'string' ? parseColor(color) : color, opacity);
        if (!c || c[3] <= 0.002 || !(shape[2] > 0) || !(shape[3] > 0)) return;
        const r = Math.max(0, Math.min(radius, shape[2] / 2, shape[3] / 2));
        const radii = [r, r, r, r];
        if (ring > 0) {
            this.items.push({
                ...common, kind: KIND.BOX, rect: shape, shape, radii,
                color: [0, 0, 0, 0], border: [ring, ring, ring, ring], borderColor: c, flags: 15 | NO_FILL
            });
        } else {
            this.items.push({ ...common, kind: KIND.BOX, rect: shape, shape, radii, color: c, flags: 15 });
        }
    }

    /**
     * A themed check box or radio button, as NativeThemeBase::PaintCheckbox and
     * PaintRadio draw it through Blink's canvas scaled by the zoom, from the
     * rect's size divided by it, truncated: so in scene px, the largest centred
     * square (border-coloured only when too small for more), its background
     * 0.2 px in over a lighten layer when disabled, the accent fill of a set
     * check box or the 1 px ring, then an 8 x 2 dash (of 13), the tick (a path
     * from the same canvas calls) or the dot, 20% in. Its accent decides the
     * scheme only when checked and enabled.
     */
    emitCheck(box, border, type, el, opacity, common) {
        const d = this.dpr;
        const grid = this.deviceGrid(box);
        const [dx, dy, dw, dh] = this.deviceRect(border, grid);
        if (dw <= 0 || dh <= 0) return;
        const state = faceState(el);
        const radio = type === 'radio';
        const checked = Boolean(el.checked);
        const indeterminate = !radio && Boolean(el.indeterminate);
        const ownDark = darkScheme(box.style);
        const accent = opaqueAccent(box.style.accentColor, ownDark);
        const dark = checked && state !== 'disabled' ? schemeForAccent(accent, ownDark, CHECK_BACKGROUNDS) : ownDark;
        const theme = THEME[dark ? 'dark' : 'light'];
        const background = theme.background[state];
        const edge = theme.border[state];
        const fill = accentColor(accent, state, dark, theme.accent);
        // Cut down to whole unzoomed px (measured: 16 device px at 1.25x paint 12 x 1.25)
        const W = Math.trunc(dw / d + 1e-6);
        const H = Math.trunc(dh / d + 1e-6);
        const size = Math.min(W, H);
        const x = grid[0] + dx / d + (W - size) / 2;
        const y = grid[1] + dy / d + (H - size) / 2;
        if (size <= 2) {
            this.pushFace([x, y, size, size], 0, edge, opacity, common);
            return;
        }
        const radius = radio ? Math.max(W, H) / 2 : 2;
        const inset = (by) => [x + by, y + by, size - 2 * by, size - 2 * by];
        if (state === 'disabled') this.pushFace(inset(0), radius, theme.lighten, opacity, common);
        this.pushFace(inset(0.2), radius, background, opacity, common);
        if (!radio && (checked || indeterminate)) this.pushFace(inset(0), radius, fill, opacity, common);
        // A stroke of 1 px on a rect 0.5 px in: outside it the radius is 0.5 px more
        else this.pushFace(inset(0), radius + 0.5, checked ? fill : edge, opacity, common, 1);
        if (radio) {
            if (checked) this.pushFace(inset(size * 0.2), radius, fill, opacity, common);
        } else if (indeterminate) {
            const ix = size * 2.5 / 13;
            const iy = size * 5.5 / 13;
            this.pushFace([x + ix, y + iy, size - 2 * ix, size - 2 * iy], radius, background, opacity, common);
        } else if (checked) {
            // The tick: a stroked path, as a mask placed on whole device pixels
            const ox = Math.floor((x - grid[0]) * d + 1e-6);
            const oy = Math.floor((y - grid[1]) * d + 1e-6);
            const px = (x - grid[0]) * d - ox;
            const py = (y - grid[1]) * d - oy;
            const side = Math.ceil(size * d + px + 1);
            const tick = this.use(this.raster.sprite(`face-tick-${size}-${d}-${px.toFixed(3)}-${py.toFixed(3)}`, side, side, 1, (c) => {
                c.translate(px, py);
                c.scale(d, d);
                c.strokeStyle = '#ffffff';
                c.lineWidth = size * 0.16;
                c.miterLimit = 4;
                c.beginPath();
                c.moveTo(size * 0.2, size * 0.5);
                c.lineTo(size * 0.4, size * 0.7);
                c.lineTo(size * 0.8, size * 0.2);
                c.stroke();
            }));
            if (tick) {
                this.items.push({
                    ...common, kind: KIND.GLYPHS,
                    rect: [grid[0] + ox / d, grid[1] + oy / d, side / d, side / d],
                    color: withAlpha(parseColor(background), opacity), uv: [tick.uv.u0, tick.uv.v0, tick.uv.u1, tick.uv.v1], page: tick.page
                });
            }
        }
    }

    /**
     * A range input. Themed (NativeThemeBase::PaintSliderTrack, PaintSliderThumb;
     * Blink paints these in device px, not through a scaled canvas): a pill
     * 8 zoomed px tall, a pixel in at its ends, filled in the slider colour up
     * to the thumb and the fill colour after it, under a ring of one zoomed px;
     * the thumb a circle of 16 zoomed px, centred, its place in the content box
     * truncated to layout units. Its ::-webkit-slider-runnable-track and
     * ::-webkit-slider-thumb rules restyle those parts, painted as CSS boxes.
     */
    emitRange(box, border, content, el, opacity, common) {
        const input = box.style;
        const inputThemed = input.appearance !== 'none';
        const rules = controlPartRules(el);
        const state = faceState(el);
        const lo = Number.isFinite(parseFloat(el.min)) ? parseFloat(el.min) : 0;
        const hi = Number.isFinite(parseFloat(el.max)) ? parseFloat(el.max) : 100;
        const value = parseFloat(el.value);
        const fraction = hi > lo && Number.isFinite(value) ? Math.max(0, Math.min(1, (value - lo) / (hi - lo))) : 0;
        const z = this.layoutPx;
        const grid = this.deviceGrid(box);
        const rtl = input.direction === 'rtl';
        // The thumb: hot where the pointer is over it, pressed while the input is
        const parts = partState(el);
        const lastHot = parts.hot === 'thumb';
        // Pressed only from a press on it: pressed on the track, it jumps under the pointer, hot
        const pressed = state === 'active' && parts.pressed === 'thumb';
        const thumbStyle = rules.length ? controlPartStyle(el, 'slider-thumb', rules, input, { hover: lastHot, active: pressed }) : null;
        // A themed slider keeps its themed thumb, whatever the thumb's rules
        const thumbThemed = inputThemed || !thumbStyle || thumbStyle.appearance !== 'none';
        const trackStyle = rules.length ? controlPartStyle(el, 'slider-runnable-track', rules, input, {}) : null;
        const partLength = (value, base, auto) => {
            if (value == null || value === 'auto' || typeof value !== 'object') return auto;
            return resolveLength(value, { percentBase: base }) ?? auto;
        };
        // The thumb's size and margins
        const thumbW = thumbThemed ? 16 : partLength(thumbStyle.width, content.width, content.width);
        const thumbH = thumbThemed ? 16 : partLength(thumbStyle.height, content.height, 0);
        const margin = thumbThemed ? [0, 0, 0, 0] : (thumbStyle.margin || []).map((m) => partLength(m, content.width, 0));
        // The track (the container centres it, a flex item filling the width)
        const trackBorder = trackStyle?.borderWidth || [0, 0, 0, 0];
        const trackPadding = trackStyle ? (trackStyle.padding || []).map((m) => partLength(m, content.width, 0)) : [0, 0, 0, 0];
        const autoTrack = thumbH + margin[0] + margin[2] + trackBorder[0] + trackBorder[2] + trackPadding[0] + trackPadding[2];
        const trackH = trackStyle ? partLength(trackStyle.height, content.height, autoTrack) : autoTrack;
        const trackY = content.y + truncUnit((content.height - trackH) / 2, z);
        const innerX = content.x + trackBorder[3] + trackPadding[3];
        const innerW = content.width - trackBorder[1] - trackBorder[3] - trackPadding[1] - trackPadding[3];
        const offset = truncUnit(fraction * Math.max(0, innerW - thumbW - margin[1] - margin[3]), z);
        const thumb = {
            x: rtl ? innerX + innerW - thumbW - margin[1] - offset : innerX + margin[3] + offset,
            y: trackY + trackBorder[0] + trackPadding[0] + margin[0],
            width: thumbW,
            height: thumbH
        };
        // The themed track
        const [bx, by, bw, bh] = this.deviceRect(border, grid);
        const [tx, ty, tw, th] = this.deviceRect(thumb, grid);
        if (inputThemed) {
            const ownDark = darkScheme(input);
            const accent = opaqueAccent(input.accentColor, ownDark);
            const dark = state !== 'disabled' ? schemeForAccent(accent, ownDark, FILL_BACKGROUNDS) : ownDark;
            const theme = THEME[dark ? 'dark' : 'light'];
            const split = thumbW > 0 ? Math.round(tx + tw / 2) : bx;
            this.emitNativeTrack({
                grid, x: bx, y: by, w: bw, h: bh, inset: 1, thickness: Math.round(8 * this.dpr),
                fill: theme.fill[state], value: accentColor(accent, state, dark, theme.slider), ring: theme.sliderBorder[state],
                from: rtl ? split : bx, to: rtl ? bx + bw : split
            }, opacity, common);
        }
        if (trackStyle) {
            const part = this.partBox(box, 'track', trackStyle, { x: content.x, y: trackY, width: content.width, height: trackH });
            this.emitPart(part, opacity);
        }
        // The thumb
        if (thumbThemed) {
            const ownDark = darkScheme(input);
            const accent = opaqueAccent(input.accentColor, ownDark);
            const dark = state !== 'disabled' ? schemeForAccent(accent, ownDark, FILL_BACKGROUNDS) : ownDark;
            const theme = THEME[dark ? 'dark' : 'light'];
            const thumbState = state === 'disabled' ? 'disabled' : pressed ? 'active' : lastHot ? 'hover' : 'normal';
            const color = accentColor(accent, thumbState, dark, theme.slider);
            // A circle half a device pixel inside its rect
            this.pushFace(this.sceneRect(tx + 0.5, ty + 0.5, tw - 1, th - 1, grid), Math.max(tw, th) / 2 / this.dpr, color, opacity, common);
        } else if (thumbW > 0 && thumbH > 0) {
            // Its own transform (a hover scale, say), from its own corner
            let matrix = box.matrix || null;
            if (thumbStyle.transform && thumbStyle.transform !== 'none') {
                const m = parseTransform(thumbStyle.transform, thumbW, thumbH, { fontSize: thumbStyle.fontSize, rootFontSize: 16, vw: 0, vh: 0 });
                if (m) {
                    const [ox, oy] = parseTransformOrigin(thumbStyle.transformOrigin, thumbW, thumbH);
                    const local = multiplyAffine(multiplyAffine([1, 0, 0, 1, thumb.x + ox, thumb.y + oy], m), [1, 0, 0, 1, -thumb.x - ox, -thumb.y - oy]);
                    matrix = matrix ? multiplyAffine(matrix, local) : local;
                }
            }
            this.emitPart(this.partBox(box, 'thumb', thumbStyle, thumb, box.clip, matrix), opacity);
        }
        // The pointer decides which of these is hot
        if (state !== 'disabled' && thumbW > 0 && thumbH > 0) {
            this.hot.set(box, [['thumb', tx - bx, ty - by, tw, th]]);
            watchPointer(this);
            const hot = this.partAt(box, this.hot.get(box));
            if (state !== 'active') parts.pressed = null;
            if ((hot === 'thumb') !== lastHot) {
                parts.hot = hot;
                markChanged(box);
                this.paintAgain = true;
            }
        } else {
            this.hot.delete(box);
            parts.hot = null;
        }
    }

    /**
     * A progress bar. Themed (NativeThemeBase::PaintProgressBar, in device px):
     * a pill half the bar's height on its middle row in the fill colour, the
     * value a rect in the accent cut by the pill, the ring of one zoomed px
     * over both; indeterminate, a rounded fifth of the track sweeping across
     * and back. With appearance: none, its ::-webkit-progress-bar and
     * ::-webkit-progress-value parts as CSS boxes.
     */
    emitProgress(box, border, content, el, opacity, common) {
        const position = typeof el.position === 'number' ? el.position : -1;
        if (box.style.appearance === 'none') {
            const rules = controlPartRules(el);
            const bar = controlPartStyle(el, 'progress-bar', rules, box.style, {}, UA_PARTS['progress-bar']);
            this.emitPart(this.partBox(box, 'bar', bar, content), opacity);
            if (position > 0) {
                const value = controlPartStyle(el, 'progress-value', rules, box.style, {}, UA_PARTS['progress-value']);
                const width = content.width * position;
                const x = box.style.direction === 'rtl' ? content.x + content.width - width : content.x;
                this.emitPart(this.partBox(box, 'value', value, { x, y: content.y, width, height: content.height }), opacity);
            }
            return;
        }
        const d = this.dpr;
        const grid = this.deviceGrid(box);
        const [x, y, w, h] = this.deviceRect(border, grid);
        if (w <= 0 || h <= 0) return;
        const state = faceState(el);
        const ownDark = darkScheme(box.style);
        const accent = opaqueAccent(box.style.accentColor, ownDark);
        const dark = schemeForAccent(accent, ownDark, FILL_BACKGROUNDS);
        const theme = THEME[dark ? 'dark' : 'light'];
        const fill = theme.fill[state];
        const slider = accentColor(accent, state, dark, theme.slider);
        const ring = theme.sliderBorder[state];
        const rtl = box.style.direction === 'rtl';
        const track = { grid, x, y, w, h, inset: 0, thickness: h * 0.5, fill, value: slider, ring, clipped: true };
        if (position >= 0) {
            // Whole device px, at least two of any
            const whole = Math.trunc(w * position);
            const length = whole > 0 ? Math.max(2, whole) : 0;
            track.from = rtl ? x + w - length : x;
            track.to = rtl ? x + w : x + length;
            this.emitNativeTrack(track, opacity, common);
            return;
        }
        // Indeterminate: a rounded block a fifth of the track long, swept across and back in two seconds
        const block = Math.trunc(w / 5);
        const movable = w - block;
        const phase = ((this.ctx.time || 0) / 2000) % 1;
        const at = Math.trunc((phase < 0.5 ? phase * 2 : (1 - phase) * 2) * movable);
        track.from = x;
        track.to = x;
        this.emitNativeTrack(track, opacity, common, movable > 0 ? { x: x + at, w: block } : null);
        this.movingBoxes ??= new Set();
        this.movingBoxes.add(box);
    }

    /** Device px from `grid` to a scene rect. */
    sceneRect(x, y, w, h, grid) {
        const d = this.dpr;
        return [grid[0] + x / d, grid[1] + y / d, w / d, h / d];
    }

    /**
     * A slider's or progress bar's track (NativeThemeBase::PaintSliderTrack,
     * PaintProgressBar), in device px: a pill `thickness` tall on the rect's
     * middle row, `inset` in at its ends, in the fill colour, the value's colour
     * over it between `from` and `to` (or in `block`, a rounded piece of it),
     * then the ring of one zoomed px.
     */
    emitNativeTrack(t, opacity, common, block = null) {
        const d = this.dpr;
        const { grid } = t;
        const y0 = Math.max(0, t.h / 2 - t.thickness / 2);
        const y1 = Math.min(t.h, t.h / 2 + t.thickness / 2);
        const pill = this.sceneRect(t.x + t.inset, t.y + y0, t.w - 2 * t.inset, y1 - y0, grid);
        const radius = Math.min(40 / d, pill[2] / 2, pill[3] / 2);
        const line = Math.max(1, Math.floor(this.layoutPx + 1e-4)) / this.layoutPx;
        const cut = (from, to) => ({ ...common, ...this.narrowClip(common, [grid[0] + from / d, pill[1] - 1, grid[0] + to / d, pill[1] + pill[3] + 1]) });
        this.pushFace(pill, radius, t.fill, opacity, common);
        // A progress bar's value and ring are cut by the pill, with its edges'
        // anti-aliasing (the browser clips to it and draws a rect and a stroke)
        const clipped = t.clipped && !common.clip2;
        const inPill = clipped ? { ...common, clip2: [pill[0], pill[1], pill[0] + pill[2], pill[1] + pill[3]], clip2Radii: [radius, radius, radius, radius] } : common;
        if (t.to > t.from) {
            if (clipped) this.pushFace([grid[0] + t.from / d, pill[1], (t.to - t.from) / d, pill[3]], 0, t.value, opacity, inPill);
            // A slider's is the pill cut by a rect of the value: its edges anti-alias twice between pixels
            else if (!common.clip2) this.pushFace(pill, radius, t.value, opacity, { ...common, clip2: [grid[0] + t.from / d, pill[1], grid[0] + t.to / d, pill[1] + pill[3]], clip2Radii: [0, 0, 0, 0] });
            else this.pushFace(pill, radius, t.value, opacity, cut(t.from, t.to));
        }
        if (block) this.pushFace(this.sceneRect(block.x, t.y + y0, block.w, y1 - y0, grid), radius, t.value, opacity, common);
        this.pushFace(pill, radius, t.ring, opacity, inPill, line);
    }

    /**
     * A meter: UA-sheet boxes (::-webkit-meter-bar half the element's height
     * and centred, themed a rounded box with a thin border, its value part in
     * the region's colour inside it, cut by its inner radii). With appearance:
     * none, the UA's gradients. Author rules restyle the parts.
     */
    emitMeter(box, content, el, opacity, common) {
        const themed = box.style.appearance !== 'none';
        const rules = controlPartRules(el);
        const theme = THEME[darkScheme(box.style) ? 'dark' : 'light'];
        const min = el.min;
        const max = el.max;
        const value = el.value;
        const low = el.low;
        const high = el.high;
        const optimum = el.optimum;
        let region;
        if (optimum < low) region = value <= low ? 0 : value <= high ? 1 : 2;
        else if (high < optimum) region = high <= value ? 0 : low <= value ? 1 : 2;
        else region = low <= value && value <= high ? 0 : 1;
        const valuePart = ['meter-optimum-value', 'meter-suboptimum-value', 'meter-even-less-good-value'][region];
        const barText = themed ? `background:${theme.meterBar};border:1px solid ${theme.meterBorder};border-radius:20px` : UA_PARTS['meter-bar'];
        const valueText = themed ? `background:${theme.meterValues[region]}` : UA_PARTS[valuePart];
        const barStyle = controlPartStyle(el, 'meter-bar', rules, box.style, {}, barText);
        const valueStyle = controlPartStyle(el, valuePart, rules, box.style, {}, valueText);
        const barHeight = content.height / 2;
        const barRect = { x: content.x, y: content.y + (content.height - barHeight) / 2, width: content.width, height: barHeight };
        const bar = this.partBox(box, 'bar', barStyle, barRect);
        this.emitPart(bar, opacity);
        const b = bar.border.map((w) => this.snapBorder(w));
        const inner = { x: barRect.x + b[3], y: barRect.y + b[0], width: barRect.width - b[1] - b[3], height: barRect.height - b[0] - b[2] };
        const ratio = max > min ? Math.max(0, Math.min(1, (value - min) / (max - min))) : 0;
        if (ratio <= 0 || !(inner.width > 0)) return;
        const width = inner.width * ratio;
        const rtl = box.style.direction === 'rtl';
        const rect = { x: rtl ? inner.x + inner.width - width : inner.x, y: inner.y, width, height: inner.height };
        // The bar's rounded inner edge cuts the value
        const radii = resolveRadii(bar, barRect.width, barRect.height).map((r, i) => Math.max(0, r - Math.max(b[i], b[(i + 3) % 4])));
        this.emitPart(this.partBox(box, 'value', valueStyle, rect, this.partClip(box.clip, inner, radii)), opacity);
    }

    /** A clip for a part: `rect` with `radii` inside the layout clip `outer`. */
    partClip(outer, rect, radii) {
        if (!outer || !(outer.width < 1e8)) return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, radii };
        const x = Math.max(outer.x, rect.x);
        const y = Math.max(outer.y, rect.y);
        const inside = x === rect.x && y === rect.y && Math.min(outer.x + outer.width, rect.x + rect.width) === rect.x + rect.width
            && Math.min(outer.y + outer.height, rect.y + rect.height) === rect.y + rect.height;
        return {
            x, y,
            width: Math.max(0, Math.min(outer.x + outer.width, rect.x + rect.width) - x),
            height: Math.max(0, Math.min(outer.y + outer.height, rect.y + rect.height) - y),
            radii: inside ? radii : [0, 0, 0, 0]
        };
    }

    /**
     * A box standing in for a pseudo-element part of `owner` (a scrollbar part,
     * a slider's track or thumb, a progress or meter part), so it paints as any
     * CSS box does. One per owner and key from frame to frame.
     */
    partBox(owner, key, style, rect, clip = owner.clip, matrix = owner.matrix) {
        owner.partBoxes ??= new Map();
        let part = owner.partBoxes.get(key);
        if (!part) owner.partBoxes.set(key, (part = { parent: owner, cb: null, outOfFlow: false, scroller: false, element: null }));
        part.style = style;
        part.absX = rect.x;
        part.absY = rect.y;
        part.width = rect.width;
        part.height = rect.height;
        part.border = [...(style.borderWidth || [0, 0, 0, 0])];
        part.padding = (style.padding || [0, 0, 0, 0]).map((p) => (typeof p === 'number' ? p : resolveLength(p, { percentBase: rect.width }) ?? 0));
        part.clip = clip;
        part.childClip = clip;
        part.matrix = matrix || null;
        part.compositor = matrix === owner.matrix ? owner.compositor || null : null;
        return part;
    }

    emitPart(part, opacity) {
        if (!part.style || part.style.display === 'none' || !(part.width > 0) || !(part.height > 0)) return;
        this.emitBoxPaint(part, { x: part.absX, y: part.absY, width: part.width, height: part.height }, opacity * (part.style.opacity ?? 1), null);
    }

    // ── Scrollbars ──────────────────────────────────────────────────────────

    /**
     * What `box`'s bars are: [vertical, horizontal] shown, or null. A textarea
     * (the browser lays out its text, not Plauna) reads them from its element:
     * a bar is shown when its room shows in the client size.
     */
    barsShown(box) {
        const el = box.element;
        if (el?.localName !== 'textarea') return box.scrollbarShown || null;
        const across = el.offsetWidth - el.clientWidth - box.border[1] - box.border[3] > 0.75;
        const down = el.offsetHeight - el.clientHeight - box.border[0] - box.border[2] > 0.75;
        return across || down ? [across, down] : null;
    }

    /**
     * A native or custom bar's thickness in device px for a textarea, which
     * layout gives no room: a ::-webkit-scrollbar length zooms as any CSS
     * length, the native theme's follows only the device scale (themeScale).
     */
    fieldBarThickness(style, axis) {
        const custom = style.webkitScrollbar;
        const size = custom ? (axis ? custom.height : custom.width) : 'auto';
        if (size !== 'auto' && size != null) return Math.floor(size * this.dpr + 1e-6);
        return Math.round((style.scrollbarWidth === 'thin' ? 10 : 15) * themeScale(this.dpr));
    }

    /**
     * The bars of a scroll container, at the scroll position, as Chrome's
     * theme paints them over its snapped border box inside the borders: native
     * (Fluent: scrollbar_theme_fluent, native_theme_fluent) or the
     * ::-webkit-scrollbar parts as CSS boxes (CustomScrollbarTheme). The
     * scene's own bars lie under the canvas, invisible and interactive.
     */
    emitScrollbars(box, opacity) {
        const shown = this.barsShown(box);
        if (!shown) {
            this.barBoxes.delete(box);
            if (!this.isRangeBox(box)) this.hot.delete(box);
            return;
        }
        const s = box.style;
        const d = this.dpr;
        const grid = this.deviceGrid(box);
        const [x0, y0, W, H] = this.deviceRect({ x: box.absX, y: box.absY, width: box.width, height: box.height }, grid);
        const [bt, br, bb, bl] = box.border.map((w) => (w > 0 ? Math.max(1, Math.floor(w * d + 1e-4)) : 0));
        const rtl = s.direction === 'rtl';
        const field = box.element?.localName === 'textarea';
        const room = box.scrollbar || [0, 0, 0];
        const tv = !shown[0] ? 0 : field ? this.fieldBarThickness(s, 0) : Math.round((rtl ? room[2] : room[0]) * d);
        const th = !shown[1] ? 0 : field ? this.fieldBarThickness(s, 1) : Math.round(room[1] * d);
        if (tv <= 0 && th <= 0) return;
        const el = box.element;
        // A textarea with a grip keeps the corner for it, with one bar too
        const grip = field && textareaResizes(el);
        const cornerH = th || (grip && tv ? tv : 0);
        const cornerW = tv || (grip && th ? th : 0);
        // The visible size a bar scales its thumb by: for native bars the
        // snapped client size (the compositor places their thumbs from the
        // container's bounds), for ::-webkit-scrollbar ones, which the page
        // places, the client size from the unsnapped border box, rounded
        // (VisibleContentRect). Measured at 1.25x on a 150px box: 187 device
        // px beside a native track, 177 beside a custom 176 px track
        const vertical = tv > 0 ? {
            axis: 0, x: rtl ? bl : W - br - tv, y: bt, w: tv, h: H - bt - bb - cornerH, thickness: tv,
            visible: H - bt - bb - th, pageVisible: Math.max(0, roundPx(box.height * d - bt - bb - th)),
            total: field ? Math.round(el.scrollHeight * d) : Math.round(box.scrollHeight * d),
            position: (field ? el.scrollTop : box.scrollY) * d, enabled: el ? el.scrollHeight > el.clientHeight : true
        } : null;
        const horizontal = th > 0 ? {
            axis: 1, x: bl + (rtl ? tv : 0), y: H - bb - th, w: W - bl - br - cornerW, h: th, thickness: th,
            visible: W - bl - br - tv, pageVisible: Math.max(0, roundPx(box.width * d - bl - br - tv)),
            total: field || rtl ? Math.round(el.scrollWidth * d) : Math.round(box.scrollWidth * d),
            position: (field ? el.scrollLeft : box.scrollX) * d, enabled: el ? el.scrollWidth > el.clientWidth : true
        } : null;
        // Right to left, scrollLeft runs from 0 down to minus the scroll range
        // (from the unsnapped client size); the bar's position from its left end
        if (horizontal && rtl) horizontal.position += horizontal.total - horizontal.pageVisible;
        const corner = (cornerH && cornerW) ? { x: tv ? (rtl ? bl : W - br - tv) : W - br - cornerW, y: th ? H - bb - th : H - bb - cornerH, w: cornerW, h: cornerH } : null;
        const custom = s.webkitScrollbar;
        const parts = [];
        const common = this.common(box);
        const state = partState(el);
        const lastHot = state.hot;
        const lastPressed = state.pressed;
        const ctx = { box, grid, x0, y0, opacity, common, lastHot, lastPressed, parts, d, scale: themeScale(d) };
        if (custom) {
            if (vertical) this.emitCustomBar(vertical, custom, ctx);
            if (horizontal) this.emitCustomBar(horizontal, custom, ctx);
            if (corner) this.emitCustomCorner(corner, custom, ctx);
        } else {
            const dark = darkScheme(s);
            const colors = BAR_COLORS[dark ? 'dark' : 'light'];
            const thumb = s.scrollbarColor?.thumb || null;
            const track = s.scrollbarColor?.track || null;
            const inks = {
                track: track ? withAlpha(track, 1) : parseColor(colors[0]),
                thumb: thumb || parseColor(colors[1]),
                hot: thumb ? [...hotThumb(thumb, track), 1] : parseColor(colors[2])
            };
            if (vertical) this.emitNativeBar(vertical, inks, s, ctx);
            if (horizontal) this.emitNativeBar(horizontal, inks, s, ctx);
            if (corner) this.pushBarBox(corner.x, corner.y, corner.w, corner.h, inks.track, ctx);
        }
        if (grip) this.emitResizer(box, opacity, common);
        // The pointer decides which of these is hot
        if (parts.length) {
            this.hot.set(box, parts);
            watchPointer(this);
            const hot = this.partAt(box, parts);
            if (hot !== lastHot) {
                state.hot = hot;
                markChanged(box);
                this.paintAgain = true;
            }
        } else {
            this.hot.delete(box);
        }
        this.barBoxes.set(box, barKey(box));
    }

    /** A rect of a bar in `color`, in device px from the box's corner. */
    pushBarBox(x, y, w, h, color, ctx, radius = 0) {
        const c = withAlpha(color, ctx.opacity);
        if (!c || c[3] <= 0.002 || w <= 0 || h <= 0) return;
        const d = ctx.d;
        const rect = [ctx.grid[0] + (ctx.x0 + x) / d, ctx.grid[1] + (ctx.y0 + y) / d, w / d, h / d];
        const r = radius / d;
        this.items.push({ ...ctx.common, kind: KIND.BOX, rect, shape: rect, radii: [r, r, r, r], color: c, flags: 15 });
    }

    /**
     * One native bar (scrollbar_theme_fluent, NativeThemeFluent), in device
     * px: a track filling the frame; arrow buttons round(18 x proportion x
     * scale) long at its ends, halved when they do not fit; each arrow a glyph
     * of the icon font, ceil(9 x button length / 18) px (8 pressed), centred and
     * a round(scale) px towards the end it points at; the thumb across the
     * track round(9 x proportion x scale) px wide, less one when its margins
     * would be odd, its length the visible share of the track (17 x proportion
     * x scale at least) and its place the scroll position's share, truncated.
     * The scale is the device scale: CSS zoom does not size the theme's parts.
     */
    emitNativeBar(bar, inks, style, ctx) {
        const { axis, x, y, w, h, thickness } = bar;
        const scale = ctx.scale;
        const proportion = style.scrollbarWidth === 'thin' ? 2 / 3 : 1;
        const length = axis ? w : h;
        this.pushBarBox(x, y, w, h, inks.track, ctx);
        const desired = Math.round(18 * proportion * scale);
        const button = length < 2 * desired ? Math.trunc(length / 2) : desired;
        const trackLength = length <= 2 * button ? 0 : length - 2 * button;
        const maxScroll = bar.total - bar.visible;
        const at = maxScroll > 0 && bar.enabled ? Math.max(0, Math.min(maxScroll, bar.position)) : 0;
        const prefix = axis ? 'h' : 'v';
        // The arrows: disabled at their end of the range, where nothing is hot
        const arrow = (name, glyph, enabled, bx, by) => {
            const bw = axis ? button : thickness;
            const bh = axis ? thickness : button;
            if (bw <= 0 || bh <= 0) return;
            const id = prefix + name;
            if (enabled) ctx.parts.push([id, bx, by, bw, bh]);
            const pressed = enabled && ctx.lastPressed === id;
            const hot = enabled && (pressed || ctx.lastHot === id);
            this.pushBarArrow(glyph, bx, by, bw, bh, pressed, hot ? inks.hot : inks.thumb, ctx);
        };
        const enabled = bar.enabled && maxScroll > 0;
        if (axis) {
            arrow('back', 'left', enabled && at > 0, x, y);
            arrow('forward', 'right', enabled && at < maxScroll, x + w - button, y);
        } else {
            arrow('back', 'up', enabled && at > 0, x, y);
            arrow('forward', 'down', enabled && at < maxScroll, x, y + h - button);
        }
        if (!enabled || trackLength <= 0) return;
        // The thumb
        const least = Math.trunc(17 * proportion * scale);
        const thumbLength = Math.min(trackLength, Math.max(least, Math.round(bar.visible / bar.total * trackLength)));
        let place = at * (trackLength - thumbLength) / maxScroll;
        place = place > 0 && place < 1 ? 1 : Math.trunc(place);
        const wanted = Math.round(9 * proportion * scale);
        const across = wanted - ((thickness - wanted) % 2);
        const off = Math.trunc((thickness - across) / 2);
        const id = `${prefix}thumb`;
        const rect = axis
            ? [x + button + place, y + off, thumbLength, across]
            : [x + off, y + button + place, across, thumbLength];
        ctx.parts.push([id, ...(axis ? [x + button + place, y, thumbLength, thickness] : [x, y + button + place, thickness, thumbLength])]);
        const hot = ctx.lastHot === id || ctx.lastPressed === id;
        this.pushBarBox(rect[0], rect[1], rect[2], rect[3], hot ? inks.hot : inks.thumb, ctx, Math.min(rect[2], rect[3]) / 2);
    }

    /** One arrow button's glyph, at device (x, y) from the box's corner in a button bw x bh. */
    pushBarArrow(direction, x, y, bw, bh, pressed, ink, ctx) {
        const scale = Math.max(bw, bh) / 18;
        const side = Math.ceil((pressed ? 8 : 9) * scale - 1e-6);
        const towards = direction === 'up' || direction === 'left' ? -1 : 1;
        const shift = towards * Math.round(scale);
        const across = direction === 'left' || direction === 'right';
        // A square of that side, centred and no larger than the button: the
        // font's size its width, the baseline its bottom
        const aw = Math.min(bw, side);
        const ah = Math.min(bh, side);
        const ax = (bw - aw) / 2 + (across ? shift : 0);
        const ay = (bh - ah) / 2 + (across ? 0 : shift);
        const color = cssColor([ink[0], ink[1], ink[2], 1]);
        const key = `bar-arrow-${direction}-${bw}x${bh}-${aw}x${ah}-${color}`;
        const sprite = this.use(this.raster.sprite(key, bw, bh, 1, (c) => {
            c.fillStyle = color;
            if (hasArrowFont()) {
                c.font = `${aw}px "${ARROW_FONT}"`;
                c.textBaseline = 'alphabetic';
                c.fillText(ARROW_GLYPHS[direction], ax, ay + ah);
                return;
            }
            // No icon font: the theme's triangle
            const points = {
                up: [[0.5, 0.2], [1, 0.8], [0, 0.8]], down: [[0, 0.2], [1, 0.2], [0.5, 0.8]],
                left: [[0.2, 0.5], [0.8, 0], [0.8, 1]], right: [[0.2, 0], [0.8, 0.5], [0.2, 1]]
            }[direction];
            c.beginPath();
            points.forEach(([u, v], i) => (i ? c.lineTo(ax + u * aw, ay + v * ah) : c.moveTo(ax + u * aw, ay + v * ah)));
            c.closePath();
            c.fill();
        }));
        if (!sprite) return;
        const d = ctx.d;
        this.items.push({
            ...ctx.common, kind: KIND.GLYPHS,
            rect: [ctx.grid[0] + (ctx.x0 + x) / d, ctx.grid[1] + (ctx.y0 + y) / d, bw / d, bh / d],
            color: withAlpha(ink, ctx.opacity), uv: [sprite.uv.u0, sprite.uv.v0, sprite.uv.u1, sprite.uv.v1], page: sprite.page
        });
    }

    /**
     * One bar with ::-webkit-scrollbar parts (CustomScrollbarTheme), in order:
     * the bar's background, buttons (one at each end, as a rule with no button
     * states gives), the track, the two track pieces, split at the thumb's
     * middle, and the thumb. A part no rule styles paints nothing.
     *
     * The pointer finds parts as Blink's ScrollbarTheme::HitTest does, only
     * on a bar that can scroll: the thumb, the track pieces (wherever they
     * are styled or not), the buttons, else the bar itself. :hover and
     * :active (SelectorChecker::CheckScrollbarPseudoClass) hold for the bar
     * when any of its parts has the state, for the track when a piece or the
     * thumb has it, and for any other part when it has it itself.
     */
    emitCustomBar(bar, custom, ctx) {
        const { axis, x, y, w, h } = bar;
        const prefix = axis ? 'h' : 'v';
        const base = axis ? custom.horizontal : custom;
        const hover = custom.hover?.[axis ? 'horizontal' : 'vertical'] || null;
        const active = custom.active?.[axis ? 'horizontal' : 'vertical'] || null;
        // A bar that cannot scroll has no part under the pointer
        const live = bar.enabled && bar.total - (bar.pageVisible ?? bar.visible) > 0;
        const holds = (part, id) => {
            if (!part?.startsWith(prefix)) return false;
            if (id === 'bar') return true;
            const name = part.slice(prefix.length);
            if (id === 'track') return name === 'thumb' || name === 'trackPieceBack' || name === 'trackPieceForward';
            return name === id;
        };
        const style = (name, id) => (holds(ctx.lastPressed, id) && active?.[name]) || (holds(ctx.lastHot, id) && hover?.[name]) || base[name];
        const paint = (name, id, px, py, pw, ph, key = id) => {
            const part = style(name, id);
            if (!part || pw <= 0 || ph <= 0) return;
            const d = ctx.d;
            const rect = { x: ctx.grid[0] + (ctx.x0 + px) / d, y: ctx.grid[1] + (ctx.y0 + py) / d, width: pw / d, height: ph / d };
            this.emitPart(this.partBox(ctx.box, `${prefix}${key}`, part, rect, ctx.box.clip), ctx.opacity);
        };
        const d = ctx.d;
        const length = axis ? w : h;
        // A part's length along the bar (LayoutCustomScrollbarPart::ComputeSize,
        // measured at 1x to 2x): a fixed or percent (of the bar's length)
        // width or height truncated to device px, else `auto`; then held
        // between its min and max lengths. Nothing with display: none
        const sizeOf = (partStyle, field, auto) => {
            const value = partStyle?.[field];
            if (value == null || typeof value !== 'object') return auto;
            const px = resolveLength(value, { percentBase: length / d });
            return px == null ? auto : Math.trunc(Math.round(px * d * 64) / 64 + 1e-6);
        };
        const lengthOf = (partStyle, auto) => {
            if (!partStyle || partStyle.display === 'none') return 0;
            const [size, min, max] = axis ? ['width', 'minWidth', 'maxWidth'] : ['height', 'minHeight', 'maxHeight'];
            const used = sizeOf(partStyle, size, auto);
            return Math.max(sizeOf(partStyle, min, 0), Math.min(sizeOf(partStyle, max, used), used));
        };
        // Its margins along the bar: rounded to device px, a percentage none
        // (ComputeMargin resolves them against nothing)
        const marginOf = (partStyle, i) => {
            const value = partStyle?.margin?.[i];
            if (!value || typeof value !== 'object') return 0;
            const px = resolveLength(value, { percentBase: 0 }) ?? 0;
            return Math.floor(Math.round(px * d * 64) / 64 + 0.5 + 1e-6);
        };
        const [startSide, endSide] = axis ? [3, 1] : [0, 2];
        const buttonStyle = base.button;
        // A button with no length is the native bar's thickness long (device
        // scale only: CSS zoom does not size it)
        const buttonSize = buttonStyle ? lengthOf(buttonStyle, Math.round(15 * ctx.scale + 1e-6)) : 0;
        // Buttons that do not fit are not drawn, and the track then fills the bar
        const buttons = 2 * buttonSize <= length;
        const ends = buttons ? buttonSize : 0;
        paint('scrollbar', 'bar', x, y, w, h);
        for (let i = 0; i < 2 && buttons && buttonSize > 0; i++) {
            const offset = i ? length - buttonSize : 0;
            const id = i ? 'forward' : 'back';
            if (axis) paint('button', id, x + offset, y, buttonSize, h, `button${i}`);
            else paint('button', id, x, y + offset, w, buttonSize, `button${i}`);
            if (live) ctx.parts.push(axis ? [prefix + id, x + offset, y, buttonSize, h] : [prefix + id, x, y + offset, w, buttonSize]);
        }
        // Rules for the bar, track or pieces in a state: the pointer finds
        // the pieces and the bar too (after the thumb and buttons)
        const whole = live && (hover || active) ? [prefix + 'bar', x, y, w, h] : null;
        const place = (start, size) => (axis ? [x + start, y, size, h] : [x, y + start, w, size]);
        // The track lies between the buttons, inside its own margins
        // (CustomScrollbar::TrackRect), painted there
        const trackStyle = base.track;
        const trackStart = ends + (buttons ? marginOf(trackStyle, startSide) : 0);
        const trackLength = length - ends - (buttons ? marginOf(trackStyle, endSide) : 0) - trackStart;
        if (trackLength <= 0) {
            if (whole) ctx.parts.push(whole);
            return;
        }
        paint('track', 'track', ...place(trackStart, trackLength));
        // Track pieces give their margins to the track the thumb moves in
        // (ConstrainTrackRectToTrackPieces)
        const piece = base.trackPiece;
        const startMargin = marginOf(piece, startSide);
        const usable = trackLength - startMargin - marginOf(piece, endSide);
        const visible = bar.pageVisible ?? bar.visible;
        const maxScroll = bar.total - visible;
        const enabled = bar.enabled && maxScroll > 0 && usable > 0;
        const at = enabled ? Math.max(0, Math.min(maxScroll, bar.position)) : 0;
        const thumbStyle = base.thumb;
        // Its least length: its own length, the native bar's least (17 px
        // scaled, truncated) when that is auto, held by its min and max
        const least = thumbStyle ? lengthOf(thumbStyle, Math.trunc(17 * ctx.scale + 1e-6)) : 0;
        const thumbLength = enabled ? Math.min(usable, Math.max(least, Math.round(visible / bar.total * usable))) : 0;
        let thumbAt = enabled && maxScroll > 0 ? at * (usable - thumbLength) / maxScroll : 0;
        thumbAt = thumbAt > 0 && thumbAt < 1 ? 1 : Math.trunc(thumbAt);
        const back = thumbAt + Math.trunc(thumbLength / 2);
        if (usable > 0 && piece) {
            paint('trackPiece', 'trackPieceBack', ...place(trackStart + startMargin, enabled ? back : usable));
            if (enabled) paint('trackPiece', 'trackPieceForward', ...place(trackStart + startMargin + back, usable - back));
        }
        if (thumbLength > 0 && thumbStyle) {
            const rect = place(trackStart + startMargin + thumbAt, thumbLength);
            paint('thumb', 'thumb', ...rect);
            ctx.parts.push([`${prefix}thumb`, ...rect]);
        }
        if (!whole) return;
        // The pieces split the track at the thumb's middle (SplitTrack)
        if (enabled) {
            ctx.parts.push([`${prefix}trackPieceBack`, ...place(trackStart + startMargin, back)]);
            ctx.parts.push([`${prefix}trackPieceForward`, ...place(trackStart + startMargin + back, usable - back)]);
        }
        ctx.parts.push(whole);
    }

    /** The corner between two custom bars: its ::-webkit-scrollbar-corner rule, or the native one. */
    emitCustomCorner(corner, custom, ctx) {
        if (custom.corner) {
            const d = ctx.d;
            const rect = { x: ctx.grid[0] + (ctx.x0 + corner.x) / d, y: ctx.grid[1] + (ctx.y0 + corner.y) / d, width: corner.w / d, height: corner.h / d };
            this.emitPart(this.partBox(ctx.box, 'corner', custom.corner, rect, ctx.box.clip), ctx.opacity);
            return;
        }
        this.pushBarBox(corner.x, corner.y, corner.w, corner.h, parseColor('#ffffff'), ctx);
    }

    isRangeBox(box) {
        return box.element?.localName === 'input' && box.element.type === 'range';
    }

    /**
     * The hot part of `box`'s `parts` under the pointer, or null: only when
     * its last event hit the element, in device px from its snapped corner.
     */
    partAt(box, parts) {
        const el = box.element;
        if (!Number.isFinite(pointer.x) || pointer.target !== el) return null;
        const rect = el.getBoundingClientRect();
        if (!(rect.width > 0) || !(rect.height > 0)) return null;
        const px = (pointer.x - rect.left) * (box.width / rect.width) * this.dpr;
        const py = (pointer.y - rect.top) * (box.height / rect.height) * this.dpr;
        for (const [name, x, y, w, h] of parts) {
            if (px >= x && py >= y && px < x + w && py < y + h) return name;
        }
        return null;
    }

    /** The pointer moved, or was pressed or let go: mark what changed state, and ask for a frame. */
    pointerMoved(event) {
        let changed = false;
        for (const [box, parts] of this.hot) {
            if (!box.element?.isConnected) {
                this.hot.delete(box);
                continue;
            }
            const hot = this.partAt(box, parts);
            const state = partState(box.element);
            let pressed = state.pressed;
            if (event.type === 'pointerdown') pressed = hot;
            else if (event.type === 'pointerup' || event.type === 'pointercancel' || event.buttons === 0) pressed = null;
            if (hot !== state.hot || pressed !== state.pressed) {
                state.hot = hot;
                state.pressed = pressed;
                markChanged(box);
                changed = true;
            }
        }
        if (changed) this.raster.onReady?.();
    }

    /**
     * Another frame when one is owed: a part went hot or cold where the box
     * moved under the pointer, or an indeterminate progress bar is painted.
     */
    scheduleMoving() {
        const moving = this.movingBoxes;
        if ((!moving?.size && !this.paintAgain) || this.movingScheduled) return;
        this.paintAgain = false;
        this.movingScheduled = true;
        const next = () => {
            this.movingScheduled = false;
            if (moving) {
                for (const box of moving) {
                    if (box.element?.isConnected) markChanged(box);
                    moving.delete(box);
                }
            }
            this.raster.onReady?.();
        };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(next);
        else setTimeout(next, 16);
    }

    /**
     * A drop-down's arrow as Chrome's theme draws it (SetupMenuListArrow,
     * NativeThemeBase::PaintMenuList), in whole device pixels of the snapped
     * border box: an open "v" 8 layout px wide and half as tall, stroked
     * 2px in the text colour, centred in the 15 layout px arrow box inside
     * the border at the inline end, on the box's middle row (each step
     * truncated, as the theme's integers are).
     */
    emitMenuListArrow(box, border, grid, opacity, common) {
        const d = this.dpr;
        const z = this.layoutPx;
        const [gx, gy] = grid || [0, 0];
        const x0 = Math.round((border.x - gx) * d);
        const y0 = Math.round((border.y - gy) * d);
        const width = Math.round(border.width * d);
        const height = Math.round(border.height * d);
        const arrowBox = 15 * z;
        const size = 8 * z;
        const ax = Math.trunc(box.style.direction === 'rtl'
            ? x0 + Math.floor(box.border[3] * d) + (arrowBox - size) / 2
            : x0 + width - Math.floor(box.border[1] * d) - (arrowBox + size) / 2);
        const w = Math.trunc(size);
        const h = Math.floor(w / 2);
        const ay = y0 + Math.trunc(height / 2) - Math.trunc(h / 2);
        // Room for the stroke's half width and the miter below the point
        const pad = 3;
        const sprite = this.use(this.raster.sprite(`menulist-arrow-${w}x${h}`, w + pad * 2, h + pad * 2, 1, (c) => {
            c.strokeStyle = '#ffffff';
            c.lineWidth = 2;
            c.beginPath();
            c.moveTo(pad, pad);
            c.lineTo(pad + Math.trunc(w / 2), pad + h);
            c.lineTo(pad + w, pad);
            c.stroke();
        }));
        if (!sprite) return;
        this.items.push({
            ...common, kind: KIND.GLYPHS,
            rect: [gx + (ax - pad) / d, gy + (ay - pad) / d, (w + pad * 2) / d, (h + pad * 2) / d],
            color: withAlpha(box.style.color, opacity), uv: [sprite.uv.u0, sprite.uv.v0, sprite.uv.u1, sprite.uv.v1], page: sprite.page
        });
    }

    /** One line of text centred vertically in the content box. */
    emitTextLine(box, content, text, color, opacity, common, clipToContent = true) {
        if (!text) return;
        const style = box.style;
        const metrics = this.shaper.fontMetrics(style);
        const lineHeight = this.shaper.lineHeight(style);
        const top = content.y + (content.height - lineHeight) / 2;
        const baseline = top + this.shaper.baselineIn(style, lineHeight);
        const c = withAlpha(color, opacity);
        const narrowed = clipToContent ? this.narrowClip(common, [content.x, content.y, content.x + content.width, content.y + content.height]) : null;
        const snap = (v) => roundPx(v * this.ctx.dpr) / this.ctx.dpr;
        this.emitText(text, style, content.x, baseline, c, { ...common, ...narrowed }, snap, this.paintInfo(box));
        void metrics;
    }

    /** Clip `a` (scene space) narrowed to rect `b` [x0, y0, x1, y1], given in the coordinates `matrix` maps to the scene. */
    intersectClip(a, b, matrix = null) {
        if (matrix) {
            const r = transformRectBounds(matrix, { x: b[0], y: b[1], width: b[2] - b[0], height: b[3] - b[1] });
            b = [r.x, r.y, r.x + r.width, r.y + r.height];
        }
        if (!a) return b;
        return [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
    }

    /**
     * `common`'s clip narrowed to rect `b` (as intersectClip), with its radii:
     * a corner keeps the clip's radius only where both its edges are still the
     * clip's own, so a field inside a rounded panel is not cut by its corners
     */
    narrowClip(common, b) {
        const a = common.clip;
        const clip = this.intersectClip(a, b, common.matrix);
        if (!a || !common.clipRadii) return { clip, clipRadii: null };
        const kept = (i) => Math.abs(clip[i] - a[i]) < 1e-6;
        // Clip edges: 0 left, 1 top, 2 right, 3 bottom; radii tl, tr, br, bl
        const edges = [[0, 1], [2, 1], [2, 3], [0, 3]];
        return { clip, clipRadii: common.clipRadii.map((r, i) => (kept(edges[i][0]) && kept(edges[i][1]) ? r : 0)) };
    }

    /**
     * A push-button input's label (TextShaper.buttonLabel) as the browser sets
     * it: text-transformed, one line per line break white-space keeps (the UA
     * sets pre), each line placed by text-align (the UA's center) and the
     * lines centred in the content box, offsets truncated to layout units.
     * Lines wider or taller than the box start at its top left.
     */
    emitButtonLabel(box, content, el, opacity, common) {
        const style = box.style;
        // A carriage return draws nothing
        const label = applyTextTransform(this.shaper.buttonLabel(el).replace(/\r/g, ''), style.textTransform);
        if (!label.trim()) return;
        const lines = KEEPS_NEWLINES.has(style.whiteSpace) ? label.split('\n') : [label.replace(/\n/g, ' ')];
        const zoom = this.layoutPx;
        const lineHeight = this.shaper.lineHeight(style);
        const free = content.height - lines.length * lineHeight;
        const top = content.y + (free > 0 ? truncUnit(free / 2, zoom) : 0);
        // The label paints in the padding box
        const pad = [box.absX + box.border[3], box.absY + box.border[0], box.absX + box.width - box.border[1], box.absY + box.height - box.border[2]];
        const narrowed = this.narrowClip(common, pad);
        const snap = (v) => roundPx(v * this.ctx.dpr) / this.ctx.dpr;
        const color = withAlpha(textFill(style), opacity);
        const info = this.paintInfo(box);
        lines.forEach((line, i) => {
            if (!line.trim()) return;
            const space = content.width - ceilUnit(this.shaper.measure(line, style), zoom);
            const offset = space <= 0 ? 0 : style.textAlign === 'center' ? truncUnit(space / 2, zoom) : style.textAlign === 'right' ? space : 0;
            const baseline = top + i * lineHeight + this.shaper.baselineIn(style, lineHeight);
            this.emitText(line, style, content.x + offset, baseline, color, { ...common, ...narrowed }, snap, info);
        });
    }

    /** Value or placeholder of an input/textarea, with caret and selection when focused. */
    emitTextField(box, content, el, opacity, common, multiline = false) {
        const style = box.style;
        const type = (el.getAttribute('type') || 'text').toLowerCase();
        let value = el.value ?? '';
        if (type === 'password') value = '•'.repeat(graphemes(value).length);
        const placeholder = !value && el.getAttribute('placeholder');
        const text = value || placeholder || '';
        const color = placeholder ? style.webkitTextFillColor || style.placeholderColor || withAlpha(style.color, 0.55) : textFill(style);
        // Text paints in the padding box (descenders may enter the padding);
        // a single-line field's text is cut at its content box across, as the
        // browser's inner editor cuts it
        // A textarea's text keeps out of its bars
        const bars = multiline ? this.barsShown(box) : null;
        const barAcross = bars?.[0] ? this.fieldBarThickness(style, 0) / this.dpr : 0;
        const barDown = bars?.[1] ? this.fieldBarThickness(style, 1) / this.dpr : 0;
        // (on device pixels, inside the snapped border box and whole-pixel borders)
        const fieldGrid = this.paintInfo(box).grid;
        const [fx, fy, fw, fh] = fieldGrid ? this.snapRect(box.absX, box.absY, box.width, box.height, fieldGrid) : [box.absX, box.absY, box.width, box.height];
        const [ft, fr, fb, fl] = fieldGrid ? box.border.map((w) => this.snapBorder(w)) : box.border;
        const pad = multiline
            ? [fx + fl, fy + ft, fx + fw - fr - barAcross, fy + fh - fb - barDown]
            : [content.x, fy + ft, content.x + content.width, fy + fh - fb];
        const { clip, clipRadii } = this.narrowClip(common, pad);
        const focused = el === this.ctx.focused;
        const scrollX = el.scrollLeft || 0;
        const scrollY = el.scrollTop || 0;
        const lineHeight = this.shaper.lineHeight(style);
        const snap = (v) => roundPx(v * this.ctx.dpr) / this.ctx.dpr;
        const c = withAlpha(color, opacity);
        const lines = multiline ? this.wrapLines(text, style, content.width - barAcross) : [{ text, start: 0 }];
        // ::selection: its background (the default blue), its colour, or white
        // for the default highlight and the text's own fill for one with no colour
        const selection = style.selection;
        const selectionFill = selection ? selection.background : SELECTION;
        const selectedText = selection ? selection.color || textFill(style) : SELECTED_TEXT;
        const top0 = multiline ? content.y : content.y + (content.height - lineHeight) / 2;
        // Selection highlight under the text
        const start = focused && typeof el.selectionStart === 'number' ? el.selectionStart : null;
        const end = focused && typeof el.selectionEnd === 'number' ? el.selectionEnd : null;
        const alignOffset = (line) => {
            const free = content.width - this.shaper.measure(line.text, style);
            if (free <= 0 || multiline) return 0;
            return style.textAlign === 'center' ? free / 2 : style.textAlign === 'right' ? free : 0;
        };
        const xAt = (line, index) => alignOffset(line) + this.shaper.measure(line.text.slice(0, Math.max(0, index - line.start)), style);
        lines.forEach((line, i) => {
            const top = top0 + i * lineHeight - scrollY;
            let band = null;
            if (start != null && end != null && end > start && value) {
                const a = Math.max(start, line.start);
                const b = Math.min(end, line.start + line.text.length);
                if (b > a) {
                    band = [content.x - scrollX + xAt(line, a), content.x - scrollX + xAt(line, b)];
                    this.items.push({ ...common, clip, clipRadii, kind: KIND.BOX, rect: [band[0], top, band[1] - band[0], lineHeight], color: withAlpha(selectionFill, opacity), flags: 15 });
                }
            }
            if (line.text) {
                const baseline = top + this.shaper.baselineIn(style, lineHeight);
                const x = content.x - scrollX + alignOffset(line);
                const at = { ...common, clip, clipRadii };
                // A turned field's clips are bounding boxes, which cannot cut at the selection
                const m = common.matrix;
                const turned = m && (Math.abs(m[1]) > 1e-9 || Math.abs(m[2]) > 1e-9);
                if (!band || turned) this.emitText(line.text, style, x, baseline, c, at, snap, this.paintInfo(box));
                else {
                    // The selected part in white, cut at the selection's edges as the browser cuts it
                    const parts = [[pad[0], band[0], c], [band[0], band[1], withAlpha(selectedText, opacity)], [band[1], pad[2], c]];
                    for (const [from, to, colour] of parts) {
                        const left = Math.max(from, pad[0]);
                        const right = Math.min(to, pad[2]);
                        if (right - left <= 0) continue;
                        this.emitText(line.text, style, x, baseline, colour, { ...at, ...this.narrowClip(at, [left, pad[1], right, pad[3]]) }, snap, this.paintInfo(box));
                    }
                }
            }
        });
        // Textarea resize grip (with bars, over them: emitScrollbars)
        if (multiline && !bars && textareaResizes(el)) this.emitResizer(box, opacity, common);
        // Caret
        if (focused && start != null && start === end && this.ctx.caretVisible) {
            let lineIndex = 0;
            for (let i = 0; i < lines.length; i++) if (start >= lines[i].start) lineIndex = i;
            const line = value ? lines[lineIndex] : { text: '', start: 0 };
            const x = content.x - scrollX + (value ? xAt(line, start) : 0);
            const top = top0 + lineIndex * lineHeight - scrollY;
            const caretColor = style.caretColor ?? style.color;
            const [gx] = this.textGrid(common.matrix);
            this.items.push({ ...common, clip, clipRadii, kind: KIND.BOX, rect: [snap(x - gx) + gx, top + 1, Math.max(1, 1 / this.ctx.dpr), lineHeight - 2], color: withAlpha(caretColor, opacity), flags: 15 });
        }
    }

    /**
     * A resizable box's grip, as the browser draws it: in the corner square a
     * scrollbar would take (15px), ending a pixel inside the padding box, a
     * long and a short 45° stroke in black at 60%, then again in white at 60%
     * a pixel lower, unsmoothed and not cut by the corner's radius.
     */
    emitResizer(box, opacity, common) {
        const dpr = this.dpr || 1;
        const grid = this.paintInfo(box).grid;
        const [bx, by, bw, bh] = grid ? this.snapRect(box.absX, box.absY, box.width, box.height, grid) : [box.absX, box.absY, box.width, box.height];
        const pad = [bx + box.border[3], by + box.border[0], bx + bw - box.border[1], by + bh - box.border[2]];
        // In device pixels, from the corner square's top left, at the device
        // scale: CSS zoom does not size the grip (measured with body zoom 1.25)
        const scale = themeScale(dpr);
        const e = Math.ceil(scale - 1e-6);
        const size = Math.round(15 * scale);
        const half = Math.floor(size / 2);
        const quarter = Math.trunc(size * 3 / 4);
        // Each stroke as (x0, y0, x1, y1); the light ones start a pixel lower
        // and end a pixel further right. Measured at 2x, the strokes' upper
        // ends reach half a device pixel further along them
        const o = (e - 1) / 2;
        const strokes = (shift) => [half, quarter].map((at) => [size - e + o, at - o + shift, at + shift, size - e]);
        const draw = (lines) => (g) => {
            g.setTransform(1, 0, 0, 1, 0, 0);
            g.fillStyle = '#ffffff';
            for (let j = 0; j < size; j++) {
                for (let i = 0; i < size; i++) {
                    const x = i + 0.5;
                    const y = j + 0.5;
                    const on = lines.some(([x0, y0, x1, y1]) => {
                        const dx = x1 - x0;
                        const dy = y1 - y0;
                        const len = Math.hypot(dx, dy);
                        const along = ((x - x0) * dx + (y - y0) * dy) / len;
                        const across = Math.abs((x - x0) * dy - (y - y0) * dx) / len;
                        return along >= 0 && along <= len && across <= e / 2;
                    });
                    if (on) g.fillRect(i, j, 1, 1);
                }
            }
        };
        // Measured at 1x, 1.25x, 1.5x and 2x: the square ends floor(scale) device
        // pixels above the padding box's bottom and left of its right edge, one
        // more there above 1x
        // In device px of the canvas grid (which starts at the viewport origin,
        // or the box's rounded place under a transform), so the unsmoothed
        // strokes land on whole pixels
        const [gx, gy] = grid || [this.gridX, this.gridY];
        const whole = Math.floor(scale + 1e-6);
        const sx = roundPx((pad[2] - gx) * dpr) - whole - (scale > 1 ? 1 : 0) - size;
        const sy = roundPx((pad[3] - gy) * dpr) - whole - size;
        for (const [name, lines, color] of [['dark', strokes(0), [0, 0, 0, 0.6]], ['light', strokes(e), [1, 1, 1, 0.6]]]) {
            // Sized in device px: size / dpr x dpr can ceil to a texel more, which resamples the grip
            const sprite = this.use(this.raster.sprite(`resizer-${name}-${size}`, size, size, 1, draw(lines)));
            if (!sprite) continue;
            this.items.push({
                ...common, kind: KIND.GLYPHS,
                rect: [gx + sx / dpr, gy + sy / dpr, size / dpr, size / dpr],
                color: withAlpha(color, opacity), uv: [sprite.uv.u0, sprite.uv.v0, sprite.uv.u1, sprite.uv.v1], page: sprite.page
            });
        }
    }

    wrapLines(text, style, width) {
        const out = [];
        let offset = 0;
        for (const paragraph of text.split('\n')) {
            let line = '';
            let lineStart = offset;
            for (const word of paragraph.match(/\S+\s*|\s+/g) || ['']) {
                if (line && this.shaper.measure((line + word).trimEnd(), style) > width) {
                    out.push({ text: line, start: lineStart });
                    lineStart += line.length;
                    line = '';
                }
                line += word;
            }
            out.push({ text: line, start: lineStart });
            offset += paragraph.length + 1;
        }
        return out;
    }

    // ── Outlines and focus ──────────────────────────────────────────────────

    /**
     * outline-style auto as Chrome paints it (OutlinePainter::PaintFocusRing,
     * measured): two strokes 2W/3 device px wide, W = floor(3 x zoom). The
     * contrast ring (white, #101010 in a dark scheme) comes first, centred
     * ceil(W/3) beyond the main ring; the main ring, in the outline colour, is
     * centred on the snapped border box outset by the outline offset, less a
     * device pixel when every border is at least that wide. Both share the
     * corner radii: border-radius plus the offset, never under W; unstyled
     * native controls take the theme's radius.
     */
    /**
     * The native push-button face over the snapped border box: a rounded
     * rect, outer radius floor(2 x zoom) + half the border, with a border of max(1, floor(zoom))
     * device px inside it (Blink NativeThemeBase::PaintButton), in the
     * theme's colours for the element's state and colour scheme.
     */
    emitButtonFace(box, shape, opacity, common) {
        const z = this.layoutPx;
        const [fill, edge] = FACE[darkScheme(box.style) ? 'dark' : 'light'][faceState(box.element)];
        // In device px at the real scale: a border of max(1, floor(zoom)),
        // stroked on a radius of floor(2 x zoom) half the border in, so the
        // outline's radius is that plus half the border (measured coverage:
        // 2.5 at 1x and 1.25x, 3.5 at 1.5x, 5 at 2x)
        const border = Math.max(1, Math.floor(z + 1e-4));
        const radius = (Math.floor(2 * z + 1e-4) + border / 2) / z;
        // A border in the fill's colour (the dark faces) is not stroked: the
        // fill alone keeps the edge's single anti-aliasing (measured)
        const width = sameColor(fill, edge) ? 0 : border / z;
        this.items.push({
            ...common, kind: KIND.BOX, rect: shape, shape, radii: [radius, radius, radius, radius],
            color: withAlpha(faceColor(fill), opacity), border: [width, width, width, width],
            borderColor: withAlpha(faceColor(edge), opacity), flags: 15
        });
    }

    /**
     * A themed text field (NativeThemeBase::PaintTextField) over the snapped
     * border box: its background, under a ring of max(1, floor(zoom)) device
     * px in the border colour for its state and scheme, with an outer radius
     * of floor(2 x zoom) + half the ring. Its corners are not anti-aliased: a
     * pixel is in by where its centre falls (measured to the pixel at 1x, 1.25x,
     * 1.5x, 2x). A dark disabled field's background is opaque.
     */
    emitFieldFace(box, shape, opacity, common) {
        const d = this.dpr;
        const grid = this.deviceGrid(box);
        const [x, y, w, h] = this.deviceRect({ x: shape[0], y: shape[1], width: shape[2], height: shape[3] }, grid);
        if (w <= 0 || h <= 0) return;
        const state = faceState(box.element);
        const theme = THEME[darkScheme(box.style) ? 'dark' : 'light'];
        const fill = theme === THEME.dark && state === 'disabled' ? parseColor(theme.background.disabled) : box.style.backgroundColor;
        const edge = parseColor(theme.border[state === 'active' ? 'hover' : state]);
        const b = Math.max(1, Math.floor(d + 1e-4));
        const R = Math.floor(2 * d + 1e-4) + b / 2;
        const size = Math.min(Math.ceil(R), Math.trunc(w / 2), Math.trunc(h / 2));
        const fillCss = cssColor(fill);
        const edgeCss = cssColor(edge);
        const box_ = (rx, ry, rw, rh, color) => this.pushFace(this.sceneRect(x + rx, y + ry, rw, rh, grid), 0, color, opacity, common);
        // The ring's straight sides and what they hold
        box_(size, 0, w - 2 * size, b, edge);
        box_(size, h - b, w - 2 * size, b, edge);
        box_(0, size, b, h - 2 * size, edge);
        box_(w - b, size, b, h - 2 * size, edge);
        box_(size, b, w - 2 * size, h - 2 * b, fill);
        box_(b, size, size - b, h - 2 * size, fill);
        box_(w - size, size, size - b, h - 2 * size, fill);
        // The corners, a pixel in or out by its centre
        const entry = this.use(this.raster.sprite(`field-corner-${size}-${R}-${b}-${fillCss}-${edgeCss}`, size, size, 1, (c) => {
            for (let j = 0; j < size; j++) {
                for (let i = 0; i < size; i++) {
                    const reach = Math.hypot(Math.max(R - i - 0.5, 0), Math.max(R - j - 0.5, 0));
                    if (reach > R) continue;
                    c.fillStyle = fillCss;
                    c.fillRect(i, j, 1, 1);
                    if (reach > R - b) {
                        c.fillStyle = edgeCss;
                        c.fillRect(i, j, 1, 1);
                    }
                }
            }
        }));
        if (!entry) return;
        const { u0, v0, u1, v1 } = entry.uv;
        for (const [cx, cy, uv] of [
            [0, 0, [u0, v0, u1, v1]], [w - size, 0, [u1, v0, u0, v1]],
            [0, h - size, [u0, v1, u1, v0]], [w - size, h - size, [u1, v1, u0, v0]]
        ]) {
            const rect = this.sceneRect(x + cx, y + cy, size, size, grid);
            this.items.push({ ...common, kind: KIND.IMAGE, rect, shape: rect, radii: [0, 0, 0, 0], color: [1, 1, 1, opacity], uv, page: entry.page, flags: 15 });
        }
    }

    /**
     * A native-content well's hole (setHole): the canvas cleared inside the
     * box's `which` box, snapped as the box paints and with its inner radii.
     */
    emitHole(box, which = 'border-box') {
        const grid = this.paintInfo(box).grid;
        const [x, y, width, height] = grid ? this.snapRect(box.absX, box.absY, box.width, box.height, grid) : [box.absX, box.absY, box.width, box.height];
        const widths = grid ? box.border.map((w) => this.snapBorder(w)) : box.border;
        // A padding-box hole is cleared to the border's middle: under the border
        // nothing of what was below may show through its anti-aliased inner edge
        const by = which === 'content-box' ? widths.map((w, i) => w + box.padding[i]) : which === 'padding-box' ? widths.map((w) => w / 2) : [0, 0, 0, 0];
        let shape = [x + by[3], y + by[0], Math.max(0, width - by[1] - by[3]), Math.max(0, height - by[0] - by[2])];
        if (!(shape[2] > 0) || !(shape[3] > 0)) return;
        // On device pixels, as the browser clips to a content box
        if (grid && which === 'content-box') shape = this.snapRect(...shape, grid);
        const radii = resolveRadii(box, width, height).map((r, i) => Math.max(0, r - Math.max(by[i], by[(i + 3) % 4])));
        this.items.push({ ...this.common(box), kind: KIND.HOLE, rect: shape, shape, radii, color: [0, 0, 0, 1], page: HOLE_PAGE, flags: 15 });
    }

    emitFocusRing(box, opacity) {
        const s = box.style;
        const color = withAlpha(s.outlineColor, opacity);
        if (!color) return;
        const common = this.common(box);
        // In layout pixels (device pixels at the real scale), as the browser paints it
        const z = this.layoutPx;
        const W = z >= 1 ? Math.max(1, Math.floor(3 * z + 1e-4)) : 3;
        const stroke = W * 2 / 3;
        const beyond = Math.ceil(W / 3 - 1e-6);
        const outset = Math.round((s.outlineOffset || 0) * z);
        const inside = Math.max(1, Math.floor(z + 1e-4));
        const minBorder = Math.min(...box.border) * z;
        const grid = this.paintInfo(box).grid;
        const [x, y, w, h] = grid ? this.snapRect(box.absX, box.absY, box.width, box.height, grid) : [box.absX, box.absY, box.width, box.height];
        const off = outset - (minBorder >= inside - 1e-4 ? inside : 0);
        // A themed radio button's 50% radius is the UA sheet's (!important, no
        // author's): its ring takes the theme's radius, half its size, not
        // grown by the offset (measured at 1x and 2x, 13 and 24 px)
        const el = box.element;
        const themedRadio = s.appearance !== 'none' && el?.localName === 'input' && (el.getAttribute('type') || '').toLowerCase() === 'radio';
        const author = themedRadio ? [0, 0, 0, 0] : resolveRadii(box);
        const native = author.some((r) => r > 0) || s.appearance === 'none' ? null : nativeRingRadius(box, z);
        const radii = author.some((r) => r > 0)
            ? author.map((r) => Math.max(r > 0 ? r * z + outset : 0, W))
            : [native ?? W, native ?? W, native ?? W, native ?? W];
        const ring = (centre, ringColor) => {
            // A negative offset can empty the rect a ring is stroked along: that ring is not drawn (measured)
            if (Math.round(w * z) + 2 * centre <= 0 || Math.round(h * z) + 2 * centre <= 0) return;
            const e = (centre + stroke / 2) / z;
            const rect = [x - e, y - e, w + 2 * e, h + 2 * e];
            const width = stroke / z;
            const most = Math.min(rect[2], rect[3]) / 2;
            this.items.push({
                ...common, kind: KIND.BOX, rect, shape: rect, radii: radii.map((r) => Math.min((r + stroke / 2) / z, most)),
                color: [0, 0, 0, 0], border: [width, width, width, width], borderColor: ringColor, flags: 15 | NO_FILL
            });
        };
        ring(off + beyond, withAlpha(s.focusRingDark ? [16 / 255, 16 / 255, 16 / 255, 1] : [1, 1, 1, 1], opacity));
        ring(off, color);
    }

    emitOutline(box, opacity) {
        const s = box.style;
        // outline-style auto (the UA :focus-visible outline): the browser's focus ring
        if (s.outlineStyle === 'auto') {
            this.emitFocusRing(box, opacity);
            return;
        }
        const common = this.common(box);
        let width = s.outlineWidth;
        const color = s.outlineColor;
        const offset = s.outlineOffset || 0;
        if (!width || !color) return;
        const grid = this.paintInfo(box).grid;
        if (grid) width = this.snapBorder(width);
        const radii = resolveRadii(box).map((r) => (r > 0 ? r + offset + width : 0));
        let rect = [box.absX - offset - width, box.absY - offset - width, box.width + (offset + width) * 2, box.height + (offset + width) * 2];
        if (grid) rect = this.snapRect(...rect, grid);
        this.items.push({
            ...common, kind: KIND.BOX, rect, shape: rect, radii,
            color: [0, 0, 0, 0], border: [width, width, width, width], borderColor: withAlpha(color, opacity), flags: 15 | NO_FILL
        });
    }
}
