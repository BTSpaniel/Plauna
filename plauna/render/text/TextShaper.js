// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * TextShaper - text measurement for Plauna's layout pass.
 *
 * Measures with the browser's own font engine through a 2D canvas, using the
 * same font strings CSS uses, so text widths match DOM text. Normal line
 * heights and baselines come from a one-time probe per font face when a
 * document is available (the canvas cannot report a font's line gap), and
 * from font bounding boxes otherwise.
 *
 * Under a layout zoom (display scaling, browser zoom: see LayoutUnits) the
 * browser sets text at the scaled font size and rounds ascent, descent and
 * half-leading in device pixels, so measurements are taken at that size and
 * rounded there; results stay in CSS px.
 *
 * OpenType features (font-variant-numeric: tabular-nums and the other
 * numeric keywords, font-feature-settings) have no canvas setting, but a
 * canvas honours the font-feature-settings descriptor of a FontFace. Text
 * that asks for features is set in a FontFace over the same installed face
 * (local()) with those features (featureFamily), so it measures and draws
 * with the glyphs and advances DOM text uses. Kerning is the canvas's own
 * setting (canvasKerning), which a descriptor does not override.
 */

import { roundUnit, percentUnit, cssZoomOf } from '../layout/LayoutUnits.js';

const MEASURE_LIMIT = 20000;
const EMOJI = /\p{Extended_Pictographic}/u;
const EMOJI_ALL = /\p{Extended_Pictographic}/gu;
// Input types drawn as a push button around their label
export const BUTTON_INPUTS = new Set(['button', 'submit', 'reset']);

function createCanvasContext() {
    if (typeof OffscreenCanvas !== 'undefined') {
        return new OffscreenCanvas(8, 8).getContext('2d');
    }
    if (typeof document !== 'undefined') {
        return document.createElement('canvas').getContext('2d');
    }
    return null;
}

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/** Split text into grapheme clusters. */
export function graphemes(text) {
    if (!segmenter) return Array.from(text);
    return Array.from(segmenter.segment(text), (s) => s.segment);
}

export function applyTextTransform(text, transform) {
    switch (transform) {
        case 'uppercase': return text.toUpperCase();
        case 'lowercase': return text.toLowerCase();
        case 'capitalize': return text.replace(/(^|[\s (\-"'])(\p{L})/gu, (m, pre, ch) => pre + ch.toUpperCase());
        default: return text;
    }
}

/**
 * The browser's default label for a push-button input type ('' for none),
 * localized as the browser shows it. A submit button without a value submits
 * its default label, so form data reports it. Nothing reports a reset
 * button's: it is taken to be "Reset" only when the browser lays its default
 * label out exactly as it lays out that text (the same advance, and the same
 * number of characters under letter-spacing), so another locale's label is
 * never painted as a wrong word. Null without a document.
 */
function defaultButtonLabel(type) {
    if (typeof document === 'undefined' || !document.body) return null;
    if (type === 'submit') {
        const form = document.createElement('form');
        const probe = document.createElement('input');
        probe.type = 'submit';
        probe.name = 'label';
        form.appendChild(probe);
        try {
            return String(new FormData(form, probe).get('label') ?? '');
        } catch {
            return '';
        }
    }
    if (type !== 'reset') return '';
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;white-space:nowrap;';
    const probes = [0, 16].flatMap((spacing) => [null, 'Reset'].map((value) => {
        const probe = document.createElement('input');
        probe.type = 'reset';
        if (value != null) probe.setAttribute('value', value);
        probe.tabIndex = -1;
        probe.style.cssText = 'width:auto !important;min-width:0 !important;padding:0 !important;border:0 !important;'
            + `font:100px serif;letter-spacing:${spacing}px;word-spacing:0;text-transform:none;`;
        return probe;
    }));
    host.append(...probes);
    document.body.appendChild(host);
    const [plain, text, spacedPlain, spacedText] = probes.map((probe) => probe.getBoundingClientRect().width);
    host.remove();
    return plain === text && spacedPlain === spacedText ? 'Reset' : '';
}

/**
 * The canvas fontKerning for a style. The page kerns with font-kerning auto,
 * but a canvas with 'auto' ignores a font's legacy kern table (Arial, Times):
 * 'normal' measures and draws text as the page lays it out. A "kern" in
 * font-feature-settings wins over font-kerning on the page, and over a
 * FontFace's descriptor in a canvas (measured), so it is applied here.
 */
export function canvasKerning(style) {
    const settings = style?.fontFeatureSettings;
    if (settings && settings !== 'normal') {
        let kern = null;
        for (const [, value] of String(settings).matchAll(/"kern"(?:\s+(\d+))?/g)) kern = value ?? '1';
        if (kern != null) return kern === '0' ? 'none' : 'normal';
    }
    return style?.fontKerning === 'none' ? 'none' : 'normal';
}

// font-variant-numeric keywords and the OpenType feature each turns on
const NUMERIC_FEATURES = {
    'lining-nums': 'lnum', 'oldstyle-nums': 'onum', 'proportional-nums': 'pnum', 'tabular-nums': 'tnum',
    'diagonal-fractions': 'frac', 'stacked-fractions': 'afrc', ordinal: 'ordn', 'slashed-zero': 'zero'
};

/**
 * The OpenType features a style asks for beyond the font's defaults, as a
 * font-feature-settings descriptor ('"tnum" 1, "zero" 1'), or '' for none:
 * font-variant-numeric's features, then font-feature-settings (computed
 * values, as StyleResolver writes them), which wins where both set a
 * feature, as the page applies them. "kern" is left to canvasKerning: a
 * canvas's fontKerning wins over the descriptor. Known gap: a canvas turns
 * ligatures off under letter-spacing whatever the descriptor says, where the
 * page sets them when font-feature-settings asks ("liga" with letter-spacing).
 */
export function fontFeatures(style) {
    const numeric = style?.fontVariantNumeric;
    const settings = style?.fontFeatureSettings;
    const hasNumeric = Boolean(numeric) && numeric !== 'normal';
    const hasSettings = Boolean(settings) && settings !== 'normal';
    if (!hasNumeric && !hasSettings) return '';
    const features = new Map();
    if (hasNumeric) {
        for (const word of String(numeric).split(/\s+/)) {
            if (NUMERIC_FEATURES[word]) features.set(NUMERIC_FEATURES[word], 1);
        }
    }
    if (hasSettings) {
        for (const [, tag, value] of String(settings).matchAll(/"([\x20-\x21\x23-\x7e]{4})"(?:\s+(\d+))?/g)) {
            features.delete(tag);
            if (tag !== 'kern') features.set(tag, value == null ? 1 : parseInt(value, 10));
        }
    }
    return [...features].map(([tag, value]) => `"${tag}" ${value}`).join(', ');
}

// Generic families (and the system-font aliases Chrome may take) and the
// installed families they can stand for, tried in order: the one that sets
// text exactly as the generic does is the face the generic gave
const SYSTEM_UI = ['Segoe UI', 'Segoe UI Variable Text', 'Segoe UI Variable Display', 'Yu Gothic UI', 'Microsoft YaHei UI',
    'Microsoft JhengHei UI', 'Malgun Gothic', 'Meiryo UI', 'Tahoma', 'Ubuntu', 'Cantarell', 'Noto Sans', 'DejaVu Sans',
    'Roboto', 'Helvetica Neue', 'Arial'];
const GENERIC_FAMILIES = {
    'system-ui': SYSTEM_UI, '-apple-system': SYSTEM_UI, blinkmacsystemfont: SYSTEM_UI, 'ui-sans-serif': SYSTEM_UI, 'ui-rounded': SYSTEM_UI,
    'sans-serif': ['Arial', 'Helvetica', 'Liberation Sans', 'Arimo', 'DejaVu Sans', 'Noto Sans', 'Roboto'],
    serif: ['Times New Roman', 'Times', 'Liberation Serif', 'Tinos', 'DejaVu Serif', 'Noto Serif'],
    'ui-serif': ['Times New Roman', 'Times', 'Liberation Serif', 'Tinos', 'DejaVu Serif', 'Noto Serif'],
    monospace: ['Consolas', 'Courier New', 'Liberation Mono', 'Cousine', 'DejaVu Sans Mono', 'Noto Sans Mono', 'Menlo', 'Courier'],
    'ui-monospace': ['Consolas', 'Courier New', 'Liberation Mono', 'Cousine', 'DejaVu Sans Mono', 'Noto Sans Mono', 'Menlo', 'Courier'],
    cursive: ['Comic Sans MS', 'Comic Neue'],
    fantasy: ['Impact'],
    math: ['Cambria Math', 'STIX Two Math', 'Latin Modern Math']
};
// A list none of whose families the page has falls back to the browser's
// standard font (Times New Roman by default; ui-sans-serif and ui-monospace
// name nothing on Windows, measured), tried after the list
const DEFAULT_FAMILIES = [...new Set([...GENERIC_FAMILIES.serif, ...GENERIC_FAMILIES['sans-serif']])];

// Weight names in installed faces' full and PostScript names
const WEIGHT_NAMES = [
    [100, ['Thin', 'Hairline']], [200, ['ExtraLight', 'Extra Light', 'UltraLight', 'Ultra Light']], [300, ['Light']],
    [350, ['Semilight', 'SemiLight', 'Semi Light']], [400, ['', 'Regular']], [500, ['Medium']],
    [600, ['Semibold', 'SemiBold', 'Semi Bold', 'Demibold', 'DemiBold', 'Demi Bold']], [700, ['Bold']],
    [800, ['ExtraBold', 'Extra Bold', 'UltraBold', 'Ultra Bold']], [900, ['Black', 'Heavy']], [950, ['ExtraBlack', 'Extra Black', 'UltraBlack']]
];

// Text a FontFace must set exactly as the page's font does to stand for it
const FACE_PROBES = ['Hamburgefonstiv', 'WAVE 0123456789', 'gjpqy .,:;%#$&@!?'];
// Family names of the FontFaces made here: numbered by one counter for the
// realm (Symbol.for), so shapers from two copies of this module (a module
// imported under two URLs) never give two faces one name
const FACE_PREFIX = 'plauna-features-';
const FACE_COUNT = Symbol.for('plauna.textShaper.featureFaces');

function nextFaceFamily() {
    globalThis[FACE_COUNT] = (globalThis[FACE_COUNT] || 0) + 1;
    return `${FACE_PREFIX}${globalThis[FACE_COUNT]}`;
}

/**
 * The page's own font faces (CSS @font-face rules and FontFaces it added,
 * not the ones made here) and their status: one that joins, leaves or
 * finishes loading can change the face the page sets a font in.
 */
function pageFontSet() {
    if (typeof document === 'undefined' || !document.fonts) return '';
    const faces = [];
    document.fonts.forEach((face) => {
        if (!face.family.replace(/^["']/, '').startsWith(FACE_PREFIX)) {
            faces.push([face.family, face.style, face.weight, face.stretch, face.unicodeRange, face.status].join('|'));
        }
    });
    return faces.join('\n');
}

/** The families of a font-family list, each as { name, generic }. */
function familyList(fontFamily) {
    const families = [];
    let token = '';
    let quote = null;
    const push = () => {
        const text = token.trim();
        token = '';
        if (!text) return;
        const quoted = /^(["']).*\1$/s.test(text);
        const name = quoted ? text.slice(1, -1).replace(/\\(.)/g, '$1') : text.replace(/\s+/g, ' ');
        families.push({ name, generic: !quoted && Object.hasOwn(GENERIC_FAMILIES, name.toLowerCase()) ? name.toLowerCase() : null });
    };
    for (const ch of String(fontFamily || '')) {
        if (quote) {
            if (ch === quote) quote = null;
            token += ch;
        } else if (ch === '"' || ch === "'") {
            quote = ch;
            token += ch;
        } else if (ch === ',') {
            push();
        } else {
            token += ch;
        }
    }
    push();
    return families;
}

/**
 * Named weights in the order an installed family's faces are tried for
 * `weight`: the nearest first; of two as near, the heavier from 400 up and
 * the lighter below it. That is the face Chrome takes on Windows (measured,
 * Chrome 156: 'Segoe UI' 500 and 550 Semibold, 650 and 750 Bold, 800 Black;
 * Arial 500 Regular, 550 Bold; Calibri 350 Light), which CSS font matching
 * would not give (500 would take Regular, 750 Black). The order only saves
 * work: a face stands in only once it sets text exactly as the page does.
 */
function weightOrder(weight) {
    return WEIGHT_NAMES.map(([value]) => value)
        .sort((a, b) => Math.abs(a - weight) - Math.abs(b - weight) || (weight < 400 ? a - b : b - a));
}

/**
 * The local() source naming an installed family's face of one weight
 * (`value`, of WEIGHT_NAMES) and style: its full names, then PostScript names.
 */
function localSource(family, value, italic) {
    const names = [];
    const ps = family.replace(/\s+/g, '');
    for (const label of WEIGHT_NAMES.find(([v]) => v === value)[1]) {
        const word = label.replace(/\s+/g, '');
        if (italic) {
            for (const slant of ['Italic', 'Oblique']) names.push(`${family}${label ? ` ${label}` : ''} ${slant}`);
            names.push(`${ps}-${word}Italic`);
        } else if (word) {
            names.push(`${family} ${label}`, `${ps}-${word}`);
        } else {
            names.push(family, ps);
        }
    }
    return [...new Set(names)].map((name) => `local("${name.replace(/["\\]/g, '\\$&')}")`).join(', ');
}

export class TextShaper {
    constructor() {
        this.ctx = createCanvasContext();
        this.widths = new Map();
        this.metrics = new Map();
        this.normalLineHeights = new Map();
        this.fallbackLines = new Map();
        this.controlSizes = new Map();
        this.controlBaselines = new Map();
        this.defaultLabels = new Map();
        this.markerWidths = new Map();
        // Font families for text with OpenType features (featureFamily), the
        // installed face found for each font (faceSources) and the FontFaces
        // over installed faces they use (kept across clear()); the first two
        // hold while the page's own font faces stay as they were (pageFonts)
        this.featureFamilies = new Map();
        this.faceSources = new Map();
        this.featureFaces = new Map();
        this.pageFonts = null;
        this.zoom = 1;
    }

    /** Measure and round at a layout zoom (LayoutUnits.layoutZoom). */
    setZoom(zoom) {
        if (!(zoom > 0) || zoom === this.zoom) return;
        this.zoom = zoom;
        this.clear();
    }

    /** Forget everything measured: a web font finished loading. */
    clear() {
        this.widths.clear();
        this.metrics.clear();
        this.normalLineHeights.clear();
        this.fallbackLines.clear();
        this.controlSizes.clear();
        this.controlBaselines.clear();
        this.markerWidths.clear();
        // A web font that loaded (or a face that joined or left) can change
        // the face the page sets a font in. Otherwise the faces found stand:
        // finding them again adds FontFaces to document.fonts, and each
        // change there restyles the whole document
        if (this.pageFonts !== null && pageFontSet() !== this.pageFonts) {
            this.pageFonts = null;
            this.featureFamilies.clear();
            this.faceSources.clear();
        }
    }

    /**
     * CSS-equivalent canvas font string (at `scale` times the font size).
     * Text with OpenType features names the FontFace that carries them
     * first (featureFamily).
     */
    font(style, scale = 1) {
        const size = Math.max(0, style.fontSize || 16) * scale;
        const family = this.featureFamily(style) || style.fontFamily || 'sans-serif';
        return `${style.fontStyle === 'italic' || style.fontStyle === 'oblique' ? 'italic ' : ''}${style.fontWeight || 400} ${size}px ${family}`;
    }

    /**
     * The canvas font family for text with OpenType features (fontFeatures):
     * a FontFace over the installed face the page sets the text in, with the
     * features as its font-feature-settings descriptor, then the style's own
     * families (for characters that face lacks). Null when the style asks
     * for none, or when no such FontFace sets text exactly as the page's
     * font does without features (a web font, a synthesized slant, a face
     * whose names are not found, an optical-size family such as Segoe UI
     * Variable or Sitka): the text keeps the plain family. A synthesized
     * bold is matched: each face carries its own weight, so the browser
     * synthesizes bold for it as it does for the page's (Impact 700, measured).
     *
     * The face is the first family of the list that is installed, a generic
     * family standing for the installed family that sets text exactly as it
     * does; after the list, the browser's standard font. Each family's faces
     * are tried one weight at a time, nearest weight first (weightOrder), and
     * a FontFace of one without features must measure every probe exactly as
     * the page's font does. Installed faces load at once (Chrome): a
     * FontFace loaded before it joins document.fonts fires no loading events,
     * so nothing is laid out again. One that loads later joins while
     * loading: its loadingdone makes surfaces measure again.
     *
     * Each FontFace that joins or leaves document.fonts restyles the whole
     * document (measured: the next layout takes 16-58 ms at 5000 elements,
     * 64-197 ms at 20000), so the faces found are kept until the page's own
     * faces change (clear()); a font and features asked for the first time
     * still cost one such restyle.
     */
    featureFamily(style) {
        const features = fontFeatures(style);
        if (!features || typeof document === 'undefined' || !document.fonts || typeof FontFace === 'undefined' || !this.ctx) return null;
        const weight = Number(style.fontWeight) || 400;
        const italic = style.fontStyle === 'italic' || style.fontStyle === 'oblique';
        const fontFamily = style.fontFamily || 'sans-serif';
        const key = `${fontFamily}|${weight}|${italic}|${features}`;
        if (this.featureFamilies.has(key)) return this.featureFamilies.get(key);
        this.pageFonts ??= pageFontSet();
        // Checked at the size the text is measured at, which the page's font
        // already has (at least a pixel)
        const size = Math.max(1, (style.fontSize || 16) * this.zoom);
        const result = this.resolveFeatureFamily(fontFamily, weight, italic, features, size);
        // Still loading: asked again once it has
        if (result !== undefined) this.featureFamilies.set(key, result);
        return result ?? null;
    }

    /**
     * featureFamily's work: the family string, null when none serves,
     * undefined while a face loads.
     */
    resolveFeatureFamily(fontFamily, weight, italic, features, size) {
        const key = `${fontFamily}|${weight}|${italic}`;
        let source = this.faceSources.get(key);
        if (source === undefined) {
            source = this.installedFace(fontFamily, weight, italic, size);
            if (source === undefined) return undefined;
            this.faceSources.set(key, source);
        }
        if (!source) return null;
        const featured = this.featureFace(source.src, source.weight, italic, features);
        if (featured.status !== 'loaded') return featured.status === 'error' ? null : undefined;
        return `"${featured.family}", ${fontFamily}`;
    }

    /**
     * The installed face the page sets a font in, as { src, weight } (its
     * local() source and named weight); null when none is found to set text
     * exactly as the page does, undefined while a face loads. The families
     * are tried in list order: a named one none of whose faces is found is
     * not installed (or not nameable), so the next is tried; one that is
     * found is the page's, so one of its faces serves or none does. A
     * generic family takes the first of its installed families that serves;
     * with none, the list goes on, and after it the standard font's.
     */
    installedFace(fontFamily, weight, italic, size) {
        const prefix = `${italic ? 'italic ' : ''}${weight} ${size}px `;
        const original = prefix + fontFamily;
        const order = weightOrder(weight);
        const tried = new Set();
        const lists = familyList(fontFamily).map((family) => (family.generic ? [GENERIC_FAMILIES[family.generic], false] : [[family.name], true]));
        lists.push([DEFAULT_FAMILIES, false]);
        for (const [names, named] of lists) {
            for (const name of names) {
                const folded = name.toLowerCase();
                if (tried.has(folded)) continue;
                tried.add(folded);
                let found = false;
                for (const value of order) {
                    const src = localSource(name, value, italic);
                    const plain = this.featureFace(src, value, italic, '');
                    if (plain.status === 'error') continue;
                    if (plain.status !== 'loaded') return undefined;
                    found = true;
                    // The plain face stands in for the page's font only while it is checked
                    document.fonts.add(plain.face);
                    const same = this.sameFace(`${prefix}"${plain.family}"`, original);
                    document.fonts.delete(plain.face);
                    if (same) return { src, weight: value };
                }
                if (found && named) return null;
            }
        }
        return null;
    }

    /** Whether two canvas fonts set every probe with the same advances, ink bounds and font bounds. */
    sameFace(a, b) {
        const ctx = this.ctx;
        const read = (font) => {
            ctx.font = font;
            if ('fontKerning' in ctx) ctx.fontKerning = 'normal';
            return FACE_PROBES.map((text) => {
                const m = ctx.measureText(text);
                return [m.width, m.actualBoundingBoxLeft, m.actualBoundingBoxRight, m.actualBoundingBoxAscent,
                    m.actualBoundingBoxDescent, m.fontBoundingBoxAscent, m.fontBoundingBoxDescent].join(',');
            }).join('|');
        };
        return read(a) === read(b);
    }

    /**
     * A FontFace over the installed face `src` names, of its named weight
     * (so the browser synthesizes bold for it as it does for the page's) and
     * style, with `features` as its descriptor: { face, family, status }.
     * Loaded before it joins document.fonts when the browser loads it at
     * once (no loading events then); joins while loading otherwise.
     */
    featureFace(src, weight, italic, features) {
        const key = `${src}|${weight}|${italic}|${features}`;
        let record = this.featureFaces.get(key);
        if (!record) {
            // Unique in the document, across shapers and module copies
            const family = nextFaceFamily();
            const face = new FontFace(family, src, { weight: String(weight), style: italic ? 'italic' : 'normal', ...(features ? { featureSettings: features } : {}) });
            record = { face, family, get status() { return face.status; } };
            this.featureFaces.set(key, record);
            face.load().catch(() => {});
            // The plain face joins only while it is checked, unless it is still
            // loading: then it joins now, so its loadingdone reaches the surfaces
            if (features ? face.status !== 'error' : face.status === 'loading') document.fonts.add(face);
        }
        return record;
    }

    /** Width of `text` in px, including letter spacing after each grapheme. */
    measure(text, style) {
        if (!text) return 0;
        const font = this.font(style);
        const spacing = style.letterSpacing || 0;
        const kerning = canvasKerning(style);
        const key = `${font}|${spacing}|${style.wordSpacing || 0}|${kerning}|${text}`;
        const cached = this.widths.get(key);
        if (cached !== undefined) return cached;
        let width = 0;
        if (this.ctx) {
            const zoom = this.zoom;
            this.ctx.font = zoom === 1 ? font : this.font(style, zoom);
            if ('fontKerning' in this.ctx) this.ctx.fontKerning = kerning;
            if ('letterSpacing' in this.ctx) {
                this.ctx.letterSpacing = `${spacing * zoom}px`;
                width = this.ctx.measureText(text).width / zoom;
                this.ctx.letterSpacing = '0px';
            } else {
                width = (this.ctx.measureText(text).width + spacing * zoom * graphemes(text).length) / zoom;
            }
        } else {
            width = text.length * (style.fontSize || 16) * 0.55;
        }
        if (style.wordSpacing) width += style.wordSpacing * (text.match(/ /g)?.length || 0);
        if (this.widths.size > MEASURE_LIMIT) this.widths.clear();
        this.widths.set(key, width);
        return width;
    }

    /**
     * Font metrics: ascent and descent (rounded to layout pixels, as browsers
     * lay text out), x-height, the normal line height and the baseline within
     * a normal line.
     */
    fontMetrics(style) {
        const font = this.font(style);
        const cached = this.metrics.get(font);
        if (cached) return cached;
        const size = style.fontSize || 16;
        let ascent = size * 0.9;
        let descent = size * 0.22;
        let xHeight = size * 0.5;
        const zoom = this.zoom;
        if (this.ctx) {
            this.ctx.font = this.font(style, zoom);
            const m = this.ctx.measureText('Hxg');
            if (Number.isFinite(m.fontBoundingBoxAscent)) {
                ascent = m.fontBoundingBoxAscent / zoom;
                descent = m.fontBoundingBoxDescent / zoom;
            } else if (Number.isFinite(m.actualBoundingBoxAscent)) {
                ascent = m.actualBoundingBoxAscent * 1.1 / zoom;
                descent = m.actualBoundingBoxDescent * 1.2 / zoom;
            }
            const x = this.ctx.measureText('x');
            if (Number.isFinite(x.actualBoundingBoxAscent)) xHeight = x.actualBoundingBoxAscent / zoom;
        }
        ascent = Math.round(ascent * zoom) / zoom;
        descent = Math.round(descent * zoom) / zoom;
        const normal = this.normalLine(style, ascent, descent);
        const result = { ascent, descent, xHeight, normalLineHeight: normal.height, normalBaseline: normal.baseline };
        this.metrics.set(font, result);
        return result;
    }

    // Normal line height and baseline, measured from the page once per font
    // (browsers round line metrics per size, so each size is probed)
    normalLine(style, ascent, descent) {
        const font = this.font(style);
        let probed = this.normalLineHeights.get(font);
        if (probed === undefined) {
            probed = this.probeNormalLine(style);
            this.normalLineHeights.set(font, probed);
        }
        if (probed) return probed;
        return { height: ascent + descent, baseline: ascent };
    }

    probeNormalLine(style) {
        if (typeof document === 'undefined' || !document.body) return null;
        const host = document.createElement('div');
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = `position:absolute;left:-10000px;top:0;visibility:hidden;white-space:nowrap;line-height:normal;letter-spacing:normal;font-style:${style.fontStyle || 'normal'};font-weight:${style.fontWeight || 400};font-size:${style.fontSize || 16}px;font-family:${style.fontFamily};`;
        const marker = document.createElement('span');
        marker.style.cssText = 'display:inline-block;width:1px;height:0;vertical-align:baseline;';
        host.append('Hxg', marker);
        document.body.appendChild(host);
        try {
            const box = host.getBoundingClientRect();
            if (!box.height) return null;
            // Under body zoom (UI scale) rects read zoomed: back to CSS px
            const z = cssZoomOf(host);
            return this.probed(box.height / z, (marker.getBoundingClientRect().top - box.top) / z);
        } finally {
            host.remove();
        }
    }

    /**
     * Inline size of an inside disclosure marker (a summary's triangle):
     * Chrome's LayoutUnit(0.66em) square and its LayoutUnit(0.4em) end
     * margin, read from a probe once per font so display scaling rounds as
     * the browser does.
     */
    insideMarkerWidth(type, style) {
        const key = `${type}|${this.font(style)}`;
        let width = this.markerWidths.get(key);
        if (width === undefined) {
            width = this.probeInsideMarker(type, style);
            this.markerWidths.set(key, width);
        }
        return width;
    }

    probeInsideMarker(type, style) {
        const size = style.fontSize || 16;
        const unit = (v) => Math.floor(v * this.zoom * 64) / 64 / this.zoom;
        const formula = unit(size * 0.66) + unit(size * 0.4);
        if (typeof document === 'undefined' || !document.body) return formula;
        const host = document.createElement('div');
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;white-space:nowrap;';
        const item = document.createElement('div');
        item.style.cssText = `display:list-item;list-style:${type} inside;margin:0;padding:0;border:0;text-indent:0;letter-spacing:normal;word-spacing:normal;font-style:${style.fontStyle || 'normal'};font-weight:${style.fontWeight || 400};font-size:${size}px;font-family:${style.fontFamily};`;
        const text = document.createTextNode('x');
        item.append(text);
        host.append(item);
        document.body.appendChild(host);
        try {
            const range = document.createRange();
            range.selectNodeContents(text);
            const width = (range.getBoundingClientRect().left - item.getBoundingClientRect().left) / cssZoomOf(item);
            return width > 0 ? roundUnit(width, this.zoom) : formula;
        } finally {
            host.remove();
        }
    }

    /**
     * A probed line height and baseline. Element rects are single precision:
     * round them back to the layout units the browser laid them out in.
     */
    probed(height, baseline) {
        return { height: roundUnit(height, this.zoom), baseline: roundUnit(baseline, this.zoom) };
    }

    /**
     * Normal line metrics for text that needs fallback fonts (emoji): the
     * browser grows the line to fit the fallback font, so probe the actual
     * text once per font and character set. Returns null when not needed.
     */
    fallbackLine(style, text) {
        if (!text || !EMOJI.test(text)) return null;
        const chars = [...new Set(text.match(EMOJI_ALL) || [])].sort().join('');
        const key = `${this.font(style)}|${chars}`;
        if (this.fallbackLines.has(key)) return this.fallbackLines.get(key);
        let result = null;
        if (typeof document !== 'undefined' && document.body) {
            const host = document.createElement('div');
            host.setAttribute('aria-hidden', 'true');
            host.style.cssText = `position:absolute;left:-10000px;top:0;visibility:hidden;white-space:nowrap;line-height:normal;font-style:${style.fontStyle || 'normal'};font-weight:${style.fontWeight || 400};font-size:${style.fontSize || 16}px;font-family:${style.fontFamily};`;
            const marker = document.createElement('span');
            marker.style.cssText = 'display:inline-block;width:1px;height:0;vertical-align:baseline;';
            host.append(chars, marker);
            document.body.appendChild(host);
            const box = host.getBoundingClientRect();
            const z = cssZoomOf(host);
            result = this.probed(box.height / z, (marker.getBoundingClientRect().top - box.top) / z);
            host.remove();
        }
        this.fallbackLines.set(key, result);
        return result;
    }

    /**
     * Content size { width, height } of a text-like input (text, number,
     * date, week...), a push-button input or a textarea in its own font.
     * Browsers size fields from the font's average and widest character
     * widths (and, for dates and times, the field layout), buttons from their
     * value or default label ("Submit"), and textareas from cols and rows
     * plus room for a scrollbar, none of which the canvas can report, so the
     * page is probed once per type, sizing attributes, font and line height.
     * A textarea's size includes its scrollbars as the browser reserves them.
     * Null without a document.
     */
    controlSize(element, style) {
        if (typeof document === 'undefined' || !document.body) return null;
        const textarea = element.localName === 'textarea';
        const type = textarea ? 'textarea' : (element.type || element.getAttribute?.('type') || 'text').toLowerCase();
        const button = BUTTON_INPUTS.has(type);
        const sizing = textarea ? ['cols', 'rows', 'wrap'] : button ? ['value'] : ['size', 'min', 'max', 'step'];
        const attributes = sizing.map((name) => [name, element.getAttribute?.(name)]).filter(([, value]) => value != null);
        const lh = style.lineHeight || { normal: true };
        const lineHeight = lh.px != null ? `${lh.px}px` : lh.number != null ? String(lh.number) : 'normal';
        // A label follows its text transform and word spacing; a textarea
        // keeps room for the scrollbars its overflow allows
        const extra = textarea ? `overflow-x:${style.overflowX || 'auto'};overflow-y:${style.overflowY || 'auto'};`
            : button ? `text-transform:${style.textTransform || 'none'};word-spacing:${style.wordSpacing || 0}px;font-kerning:${style.fontKerning || 'auto'};` : '';
        // A label and a date or time field's text follow the numeric features
        const features = `font-variant-numeric:${style.fontVariantNumeric || 'normal'};font-feature-settings:${style.fontFeatureSettings || 'normal'};`;
        const key = `${type}|${attributes.join(';')}|${this.font(style)}|${style.letterSpacing || 0}|${lineHeight}|${extra}|${features}`;
        if (this.controlSizes.has(key)) return this.controlSizes.get(key);
        const probe = document.createElement(textarea ? 'textarea' : 'input');
        if (!textarea) probe.type = type;
        for (const [name, value] of attributes) probe.setAttribute(name, value);
        probe.setAttribute('aria-hidden', 'true');
        probe.tabIndex = -1;
        probe.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;margin:0;'
            + 'box-sizing:content-box !important;width:auto !important;min-width:0 !important;max-width:none !important;'
            + 'height:auto !important;min-height:0 !important;max-height:none !important;padding:0 !important;border:0 !important;'
            + `font-style:${style.fontStyle || 'normal'};font-weight:${style.fontWeight || 400};font-size:${style.fontSize || 16}px;`
            + `font-family:${style.fontFamily};letter-spacing:${style.letterSpacing || 0}px;line-height:${lineHeight};${extra}${features}`;
        document.body.appendChild(probe);
        const rect = probe.getBoundingClientRect();
        const z = cssZoomOf(probe);
        probe.remove();
        const zoom = this.zoom;
        const size = { width: roundUnit(rect.width / z, zoom), height: roundUnit(rect.height / z, zoom) };
        this.controlSizes.set(key, size);
        return size;
    }

    /**
     * The label a push-button input (button, submit, reset) shows: its value
     * attribute, or without one the browser's default label for its type
     * (none for type=button).
     */
    buttonLabel(element) {
        const value = element.getAttribute?.('value');
        if (value != null) return value;
        const type = (element.type || element.getAttribute?.('type') || '').toLowerCase();
        if (!this.defaultLabels.has(type)) {
            const label = defaultButtonLabel(type);
            if (label == null) return '';
            this.defaultLabels.set(type, label);
        }
        return this.defaultLabels.get(type);
    }

    /**
     * Baseline of a laid-out control `box` from its border-box top, for
     * controls whose baseline comes from their shadow tree (a colour input
     * sits on the bottom of its swatch, inside the swatch wrapper's padding,
     * which page CSS can restyle). Probed once per type, appearance, height,
     * vertical padding and border. Null without a document.
     */
    controlBaseline(box) {
        if (typeof document === 'undefined' || !document.body) return null;
        const element = box.element;
        const type = (element.type || element.getAttribute?.('type') || 'text').toLowerCase();
        const appearance = box.style.appearance || 'auto';
        const edges = [box.height, box.padding[0], box.padding[2], box.border[0], box.border[2]];
        const key = `${type}|${appearance}|${edges.join(',')}`;
        if (this.controlBaselines.has(key)) return this.controlBaselines.get(key);
        // Lengths are in layout units; nudge them up so the browser's
        // truncation to its own units lands on the same unit
        const px = (v) => `${v ? v + 1e-4 : 0}px !important`;
        const host = document.createElement('div');
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;white-space:nowrap;';
        const marker = document.createElement('span');
        marker.style.cssText = 'display:inline-block;width:1px;height:0;vertical-align:baseline;';
        const probe = document.createElement('input');
        probe.type = type;
        probe.tabIndex = -1;
        probe.style.cssText = `appearance:${appearance};margin:0;vertical-align:baseline !important;box-sizing:border-box !important;`
            + `height:${px(edges[0])};min-height:0 !important;max-height:none !important;`
            + `padding-top:${px(edges[1])};padding-bottom:${px(edges[2])};border-style:solid !important;`
            + `border-top-width:${px(edges[3])};border-bottom-width:${px(edges[4])};`;
        host.append(marker, probe);
        document.body.appendChild(host);
        const baseline = (marker.getBoundingClientRect().top - probe.getBoundingClientRect().top) / cssZoomOf(probe);
        host.remove();
        const result = roundUnit(baseline, this.zoom);
        this.controlBaselines.set(key, result);
        return result;
    }

    /**
     * Used line height in px for a style, in layout units as the browser
     * computes it: a length or percentage rounds to one, a number is a
     * percentage of the font size rounded to one (single precision, truncated).
     */
    lineHeight(style) {
        const lh = style.lineHeight || { normal: true };
        const zoom = this.zoom;
        if (lh.px != null) return roundUnit(lh.px, zoom);
        if (lh.number != null) return percentUnit(lh.number * 100, roundUnit(style.fontSize || 16, zoom), zoom);
        return this.fontMetrics(style).normalLineHeight;
    }

    /**
     * Where the baseline sits inside a line box of `height` for this style
     * (half-leading around the font's ascent and descent). Browsers give the
     * ascent side the half-leading floored to a whole layout pixel and the
     * descent side the rest, so text sits on the same pixel row as DOM text.
     */
    baselineIn(style, height = this.lineHeight(style)) {
        const metrics = this.fontMetrics(style);
        const lh = style.lineHeight || { normal: true };
        if (lh.normal) return metrics.normalBaseline + (height - metrics.normalLineHeight) / 2;
        const content = metrics.ascent + metrics.descent;
        const zoom = this.zoom;
        return Math.floor((height - content) * zoom / 2 + 1 / 128) / zoom + metrics.ascent;
    }
}

export const textShaper = new TextShaper();
