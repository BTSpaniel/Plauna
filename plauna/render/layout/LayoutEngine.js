// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * LayoutEngine - Plauna's own layout pass.
 *
 * Lays out an element tree without the browser's layout: block flow with
 * margin collapsing, inline formatting (InlineLayout), flexbox (FlexLayout),
 * grid (GridLayout), tables (TableLayout), replaced elements, relative,
 * sticky, absolute and fixed positioning, overflow, scrollbars and scrolling,
 * transforms, -webkit-line-clamp. It walks the flat tree (LayoutTree).
 * Boxes come from LayoutTree, styles from StyleResolver, text metrics from
 * TextShaper. GPU mode paints the result; tests compare it with the DOM.
 *
 * Coordinates: during layout box.x / box.y are the border-box origin relative
 * to the parent box's border box (for absolutely positioned boxes, relative
 * to the containing block). finalize() adds absX / absY in scene pixels.
 *
 * Units are CSS px, rounded as the browser rounds in its layout units
 * (LayoutUnits): lengths and halves truncate to 1/64 of a layout pixel, text
 * widths round up to one, text metrics and border widths to whole layout
 * pixels. Under display scaling or browser zoom a layout pixel is a device
 * pixel: the zoom of the pass is options.zoom, else layoutZoom().
 */

import { resolveLength, hasPercent, parseTransform, parseTransformOrigin, multiplyAffine, applyAffine } from '../css/CssValues.js';
import { StyleResolver, inheritedStyleFromHost, ROOT_DEFAULTS } from '../css/StyleResolver.js';
import { userAgentStyles } from '../css/UserAgentStyles.js';
import { textShaper, BUTTON_INPUTS } from '../text/TextShaper.js';
import { buildTree, anonymousStyle, LayoutBox, paintClock, normalizeChildren, flatParent } from './LayoutTree.js';
import { layoutInline, intrinsicInline, clampLineEllipsis } from './InlineLayout.js';
import { layoutFlex, intrinsicFlex } from './FlexLayout.js';
import { layoutGrid, intrinsicGrid } from './GridLayout.js';
import { layoutTable, intrinsicTable } from './TableLayout.js';
import { layoutZoom, truncUnit, ceilUnit, roundUnit, percentUnit } from './LayoutUnits.js';

class MarginSet {
    constructor() { this.pos = 0; this.neg = 0; }
    add(value) {
        if (value > 0) this.pos = Math.max(this.pos, value);
        else if (value < 0) this.neg = Math.min(this.neg, value);
        return this;
    }
    merge(other) {
        if (other) { this.add(other.pos); this.add(other.neg); }
        return this;
    }
    get value() { return this.pos + this.neg; }
}

const INFINITE_CLIP = Object.freeze({ x: -1e9, y: -1e9, width: 2e9, height: 2e9 });
const NO_OFFSET = Object.freeze([0, 0]);
const NO_BARS = Object.freeze([0, 0, 0]);
const NO_BOXES = Object.freeze([]);
// Inputs whose size is a fixed default (the UA table's) rather than their font's
const NATIVE_SIZED_INPUTS = new Set(['checkbox', 'radio', 'range', 'color', 'file', 'image']);
// white-space values that keep line breaks
const KEEPS_NEWLINES = new Set(['pre', 'pre-wrap', 'pre-line', 'break-spaces']);

/**
 * Remove from `boxes` the entries of last layout's boxes that this pass did
 * not keep (rebuilt elements already point at their new box). Kept subtrees
 * hang below rebuilt boxes, so the walk stops at them.
 */
function dropReplaced(lastHost, boxes, pass) {
    const walk = (box) => {
        for (const child of box.children) {
            if (child.isText || child.adopted === pass) continue;
            if (child.element && boxes.get(child.element) === child) boxes.delete(child.element);
            walk(child);
        }
    };
    walk(lastHost);
}

function sameMatrix(a, b) {
    return a === b || (Boolean(a) && Boolean(b) && a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
        && a[3] === b[3] && a[4] === b[4] && a[5] === b[5]);
}

function sameClip(a, b) {
    if (a === b) return true;
    if (!a || !b || a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height) return false;
    const ra = a.radii;
    const rb = b.radii;
    const sameRadii = ra === rb || (Boolean(ra) && Boolean(rb) && ra[0] === rb[0] && ra[1] === rb[1] && ra[2] === rb[2] && ra[3] === rb[3]);
    return sameRadii && sameClip(a.rounded || null, b.rounded || null);
}

/**
 * The corners of rounded clip `rounded` that still shape what clip `clip`
 * (inside it) shows: not the ones `clip` rounds the same way at the same
 * place, nor arcs that lie outside it. Null when none is left.
 */
function roundedCorners(rounded, clip) {
    const near = (u, v) => Math.abs(u - v) < 1e-3;
    const radii = rounded.radii.map((v, i) => {
        if (!(v > 0)) return 0;
        const left = i === 0 || i === 3;
        const top = i < 2;
        const x = left ? rounded.x : rounded.x + rounded.width;
        const y = top ? rounded.y : rounded.y + rounded.height;
        const same = near(x, left ? clip.x : clip.x + clip.width) && near(y, top ? clip.y : clip.y + clip.height);
        if (same && (clip.radii?.[i] || 0) >= v - 1e-6) return 0;
        const x0 = left ? x : x - v;
        const y0 = top ? y : y - v;
        const overlaps = x0 < clip.x + clip.width && x0 + v > clip.x && y0 < clip.y + clip.height && y0 + v > clip.y;
        return overlaps ? v : 0;
    });
    return radii.some((v) => v > 0) ? { ...rounded, radii } : null;
}

function intersect(a, b) {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const r = Math.min(a.x + a.width, b.x + b.width);
    const btm = Math.min(a.y + a.height, b.y + b.height);
    return { x, y, width: Math.max(0, r - x), height: Math.max(0, btm - y) };
}

function isScrollContainer(style) {
    return style.overflowX !== 'visible' || style.overflowY !== 'visible';
}

/** Whether an overflow value makes a scroll container on its axis (clip clips but does not scroll). */
const scrollsOn = (value) => value === 'hidden' || value === 'auto' || value === 'scroll';

/** Whether `style` makes a scroll container: the boxes sticky positioning sticks within. */
function isScroller(style) {
    return scrollsOn(style.overflowX) || scrollsOn(style.overflowY);
}

// will-change names that make a containing block for fixed (and absolute) descendants
const WILL_CHANGE_FIXED = new Set(['transform', 'translate', 'rotate', 'scale', 'perspective', 'filter', 'backdrop-filter', 'contain']);
const CONTAIN_BLOCK = /\b(layout|paint|strict|content)\b/;

/**
 * Whether `style` makes its box the containing block of position: fixed
 * descendants, and so of absolute ones too, as Chrome 155 does (measured):
 * a transform (translate, rotate and scale included), perspective, filter
 * or backdrop-filter other than none, transform-style: preserve-3d,
 * will-change naming one of those or contain, contain: layout, paint,
 * strict or content, and content-visibility: auto. Opacity, clip-path,
 * mask, isolation, mix-blend-mode, overflow, zoom, contain: size, style or
 * inline-size, container-type and will-change: opacity do not.
 */
function containsFixed(style) {
    if (style.transform && style.transform !== 'none') return true;
    if (style.perspective && style.perspective !== 'none') return true;
    if (style.filter && style.filter !== 'none') return true;
    if (style.backdropFilter && style.backdropFilter !== 'none') return true;
    if (style.transformStyle === 'preserve-3d' || style.contentVisibility === 'auto') return true;
    if (style.contain && style.contain !== 'none' && CONTAIN_BLOCK.test(style.contain)) return true;
    const willChange = style.willChange;
    if (willChange && willChange !== 'auto') {
        for (const name of willChange.split(',')) if (WILL_CHANGE_FIXED.has(name.trim())) return true;
    }
    return false;
}

// will-change names that make a non-atomic inline box a containing block
const WILL_CHANGE_INLINE = new Set(['filter', 'backdrop-filter']);

/**
 * containsFixed for a non-atomic inline box (Chrome 155, measured): only
 * filter, backdrop-filter and will-change naming either apply to it.
 * Transforms, perspective, preserve-3d, contain and content-visibility do
 * not, so they leave its positioned descendants to the next containing block.
 */
function inlineContainsFixed(style) {
    if (style.filter && style.filter !== 'none') return true;
    if (style.backdropFilter && style.backdropFilter !== 'none') return true;
    const willChange = style.willChange;
    if (willChange && willChange !== 'auto') {
        for (const name of willChange.split(',')) if (WILL_CHANGE_INLINE.has(name.trim())) return true;
    }
    return false;
}

/** will-change: position makes a containing block for absolute descendants only, an inline box's too (measured). */
function containsAbsolute(style) {
    const willChange = style.willChange;
    return Boolean(willChange && willChange !== 'auto' && willChange.split(',').some((name) => name.trim() === 'position'));
}

/**
 * The room a probe's scrollbars take, in its CSS px: exact, from a child
 * pinned to all four edges, which fills the padding box (offsetWidth and
 * clientWidth round 15.2px at 125% to 15). The probe sits in a shadow root
 * of its own, so page rules (a theme's `*::-webkit-scrollbar`) never reach it.
 */
function probeRoom(css) {
    if (typeof document === 'undefined' || !document.body) return 0;
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden';
    const root = typeof host.attachShadow === 'function' ? host.attachShadow({ mode: 'open' }) : host;
    const probe = document.createElement('div');
    probe.style.cssText = `position:absolute;left:0;top:0;width:100px;height:100px;margin:0;border:0;padding:0;box-sizing:content-box;${css}`;
    const pin = document.createElement('div');
    pin.style.cssText = 'position:absolute;inset:0';
    probe.appendChild(pin);
    root.appendChild(probe);
    document.body.appendChild(host);
    const room = (probe.getBoundingClientRect().width - pin.getBoundingClientRect().width) / (probe.currentCSSZoom || 1);
    host.remove();
    return Math.max(0, room);
}

/** Measure the browser's classic scrollbar width (0 for overlay or hidden scrollbars). */
export function probeScrollbarWidth() {
    return probeRoom('overflow:scroll');
}

/**
 * The room the browser gives scrollbars, in CSS px, or null without a
 * document: `auto` and `thin` for shown bars (scrollbar-width auto and thin;
 * 0 when scrollbars are hidden or laid over content), `gutter` and
 * `thinGutter` for a stable scrollbar-gutter, which Chrome keeps reserving
 * with hidden scrollbars too (measured with --hide-scrollbars: 15px, and a
 * ::-webkit-scrollbar width, while every bar takes 0).
 */
export function probeScrollbarMetrics() {
    if (typeof document === 'undefined' || !document.body) return null;
    return {
        auto: probeRoom('overflow:scroll'),
        thin: probeRoom('overflow:scroll;scrollbar-width:thin'),
        gutter: probeRoom('overflow:hidden;scrollbar-gutter:stable'),
        thinGutter: probeRoom('overflow:hidden;scrollbar-gutter:stable;scrollbar-width:thin')
    };
}

// Probed scrollbar room per layout zoom (display scaling, browser and body zoom)
const scrollbarProbes = new Map();

// Requests whose sizes a box keeps (an item gets up to four per pass)
const SIZE_MEMO = 4;

function sameRequest(entry, cbWidth, cbHeight, opts) {
    return entry.width === cbWidth && entry.height === cbHeight
        && entry.forcedWidth === opts.forcedWidth && entry.forcedHeight === opts.forcedHeight
        && entry.availableWidth === opts.availableWidth && entry.shrinkToFit === Boolean(opts.shrinkToFit)
        && entry.autoHeight === Boolean(opts.autoHeight);
}

/** What a parent reads from a child after laying it out. */
function sizeOf(box) {
    return {
        width: box.width, height: box.height, baseline: box.baseline, lastBaseline: box.lastBaseline,
        escapedTop: box.escapedTop, escapedBottom: box.escapedBottom, contentUsedHeight: box.contentUsedHeight,
        autoBars: box.autoBars, scrollbar: box.scrollbar, scrollbarShown: box.scrollbarShown,
        overflowExtent: box.overflowExtent, scrollExtent: box.scrollExtent
    };
}

function restoreSize(box, size) {
    box.width = size.width;
    box.height = size.height;
    box.baseline = size.baseline;
    box.lastBaseline = size.lastBaseline;
    box.escapedTop = size.escapedTop;
    box.escapedBottom = size.escapedBottom;
    box.contentUsedHeight = size.contentUsedHeight;
    // Scrollbars shown because content overflowed belong to the size too
    box.autoBars = size.autoBars;
    if (size.scrollbar) box.scrollbar = size.scrollbar;
    box.scrollbarShown = size.scrollbarShown;
    box.overflowExtent = size.overflowExtent;
    box.scrollExtent = size.scrollExtent;
}

export class LayoutEngine {
    constructor(options = {}) {
        this.shaper = options.shaper || textShaper;
        this.ua = options.ua || userAgentStyles;
        this.resolver = options.resolver || new StyleResolver({ ua: this.ua, variables: options.variables });
        // The classic scrollbar's width (0: scrollbars take no room); thin
        // bars and stable gutters come from options.scrollbarMetrics
        // ({ thin, gutter, thinGutter }) or are probed (scrollbarRoom)
        this.scrollbarWidth = options.scrollbarWidth ?? 0;
        this.scrollbarMetrics = options.scrollbarMetrics || null;
        this.scrollOffsets = options.scrollOffsets || (() => null);
        // The viewport in scene coordinates ({ x, y, width, height }), which a
        // sticky box with no scroll container above it in the scene sticks
        // within; without it such a box stays where it is
        this.stickyViewport = options.stickyViewport || null;
        this.images = options.images || null;
        this.hostCollapsesMargins = options.hostCollapsesMargins ?? true;
        // Sizing grid tracks ('grid') or table columns ('table'), which do not
        // count overflow: auto bars not shown yet (trackContribution), and the
        // bars of this kind (by element) the last layout showed
        this.barsUnseen = null;
        this.barChoices = 0;
        this.shownBars = new WeakSet();
    }

    // ── Entry ───────────────────────────────────────────────────────────────

    /**
     * Lay out `rootElement` inside a host of `width` px (and `height` px when
     * the host height is fixed). `rootInherited` is the inherited style at the
     * host (inheritedStyleFromHost(host) in a page).
     */
    layout(rootElement, options = {}) {
        // Text and borders round in the browser's layout pixels
        const zoom = options.zoom ?? layoutZoom();
        // A host width read from the page is a layout unit up to float error
        const width = roundUnit(options.width ?? 800, zoom);
        const rezoomed = zoom !== this.zoom;
        this.zoom = zoom;
        this.shaper.setZoom?.(zoom);
        this.resolver.zoom = zoom;
        this.bars = this.scrollbarRoom(zoom);
        // The same root and host style objects while the host's inherited
        // values are the same, so the resolver can reuse unchanged subtrees
        const rootInherited = this.resolver.stableRoot?.(options.rootInherited || ROOT_DEFAULTS) || options.rootInherited || ROOT_DEFAULTS;
        this.resolver.beginPass?.();
        // Incremental: keep boxes of untouched elements from options.previous
        // (the boxes of this engine's last layout, a map it updates in place);
        // options.dirty lists changed elements ('all' rebuilds everything),
        // options.subtrees elements whose whole subtree must be rebuilt
        const rebuild = new Set();
        const previous = options.previous && options.dirty !== 'all' && options.previous === this.lastBoxes && !rezoomed ? options.previous : null;
        if (previous) {
            for (const element of options.dirty || []) {
                // Up the flat tree: through slots and shadow roots to their hosts
                for (let el = element; el && !rebuild.has(el); el = flatParent(el)) {
                    rebuild.add(el);
                    if (el === options.contentOf) break;
                }
            }
        }
        this.pass = (this.pass || 0) + 1;
        this.barsUnseen = null;
        const ctx = { resolver: this.resolver, rootInherited, boxes: previous || new Map(), previous, rebuild, subtrees: options.subtrees || null, pass: this.pass };
        // A pass that throws leaves the map half updated: the next one starts over
        const lastHost = this.lastHost;
        this.lastBoxes = null;
        this.lastHost = null;
        this.sizedBoxes = [];
        this.viewport = { width, height: options.height ?? (typeof window !== 'undefined' ? window.innerHeight : 720) };
        if (this.hostStyleFor !== rootInherited) {
            this.hostStyle = anonymousStyle({ ...rootInherited }, 'block');
            this.hostStyle.custom = rootInherited.custom || new Map();
            this.hostStyleFor = rootInherited;
        }
        const hostStyle = this.hostStyle;
        const host = new LayoutBox(null, hostStyle, null);
        host.anonymous = true;
        host.isHost = true;
        host.positionedRoot = true;
        // contentOf: lay out the children of a container element (a render
        // surface's scene) instead of a single root element
        let roots = [];
        if (options.contentOf) {
            // (A scene that hosts a shadow root shows that tree)
            for (const child of (options.contentOf.shadowRoot ?? options.contentOf).childNodes) {
                if (child.nodeType === 1) {
                    const built = buildTree(child, host, hostStyle, ctx);
                    if (Array.isArray(built)) roots.push(...built);
                    else if (built) roots.push(built);
                } else if (child.nodeType === 3 && child.data) {
                    roots.push({ isText: true, node: child, text: child.data, parent: host });
                }
            }
        } else {
            const root = rootElement ? buildTree(rootElement, host, hostStyle, ctx) : null;
            roots = Array.isArray(root) ? root : root ? [root] : [];
        }
        for (const r of roots) { r.parent = host; host.children.push(r); }
        if (previous) dropReplaced(lastHost, ctx.boxes, this.pass);
        const inline = roots.some((r) => r.isText || (r.outer === 'inline' && !r.outOfFlow));
        const block = roots.some((r) => !r.isText && !r.outOfFlow && r.outer !== 'inline');
        if (inline && block) {
            // Inline content beside blocks goes into anonymous blocks, as in any block container
            host.inner = 'flow';
            normalizeChildren(host);
        } else {
            host.establishesInline = inline && roots.every((r) => r.isText || r.outer === 'inline' || r.outOfFlow);
        }
        this.collectAbsolutes(host);
        host.width = width;
        host.x = 0;
        host.y = 0;
        const contentHeight = this.layoutInner(host, width, options.height ?? null);
        host.height = options.height ?? contentHeight;
        this.layoutAbsolutes(host);
        if (host.lines) this.layoutInlineAbsolutes(host);
        this.finishSized();
        const order = this.finalize(host, Boolean(previous));
        // Scene bounds: everything painted, including overflow and transforms
        const painted = host.bounds;
        const minX = painted ? Math.min(0, painted[0]) : 0;
        const minY = painted ? Math.min(0, painted[1]) : 0;
        const maxX = painted ? Math.max(host.width, painted[2]) : host.width;
        const maxY = painted ? Math.max(host.height, painted[3]) : host.height;
        const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
        for (const box of this.scrollers) {
            if (!box.element) continue;
            if (box.autoBars?.[0]) this.shownBars.add(box.element);
            else this.shownBars.delete(box.element);
        }
        this.lastBoxes = ctx.boxes;
        this.lastHost = host;
        return { host, root: roots.find((r) => !r.isText) || null, boxes: ctx.boxes, width: host.width, height: host.height, bounds, order, zoom };
    }

    /**
     * Absolutely positioned boxes join their containing block's list. The
     * lists inside a kept subtree still hold; only its boxes positioned
     * against a box above it (`escapes`, recorded when it was built) join
     * again.
     */
    collectAbsolutes(host) {
        const pass = this.pass;
        const join = (box, positioned, fixedCb) => {
            const cb = box.style.position === 'fixed' ? fixedCb : positioned;
            box.cb = cb;
            cb.absolutes.push(box);
        };
        // `positioned` / `fixedCb`: containing blocks above `box`. Returns the
        // out-of-flow boxes in its subtree (itself included) that join one of them
        const walk = (box, positioned, fixedCb) => {
            if (box.adopted === pass) {
                for (const escaped of box.escapes) join(escaped, positioned, fixedCb);
                return box.escapes;
            }
            if (box.absolutes.length) box.absolutes = [];
            let escapes = NO_BOXES;
            if (box.outOfFlow) {
                join(box, positioned, fixedCb);
                escapes = [box];
            }
            const inlineBox = box.outer === 'inline' && !box.atomic && !box.outOfFlow && !box.isHost;
            const fixedBlock = inlineBox ? inlineContainsFixed(box.style) : containsFixed(box.style);
            const nextPositioned = box.isPositioned || fixedBlock || containsAbsolute(box.style) ? box : positioned;
            const nextFixed = fixedBlock ? box : fixedCb;
            for (const child of box.children) {
                if (child.isText) continue;
                for (const escaped of walk(child, nextPositioned, nextFixed)) {
                    if (escaped.cb === box) continue;
                    if (escapes === NO_BOXES) escapes = [];
                    escapes.push(escaped);
                }
            }
            box.escapes = escapes;
            return escapes;
        };
        walk(host, host, host);
    }

    // ── Edges and sizes ─────────────────────────────────────────────────────

    len(length, base, fallback = null) {
        if (length == null || length === 'auto') return fallback;
        // A percentage (alone or with px, as calc() leaves it) resolves in single precision
        if (base != null && length.pct != null && Object.keys(length).every((key) => key === 'pct' || key === 'px')) {
            return percentUnit(length.pct, base, this.zoom, length.px ?? null);
        }
        const value = resolveLength(length, { percentBase: base });
        return value == null ? fallback : truncUnit(value, this.zoom);
    }

    /** `px` as a layout unit (truncated to 1/64 of a layout pixel). */
    unit(px) {
        return truncUnit(px, this.zoom);
    }

    /** `px` rounded up to a layout unit (shaped text widths). */
    ceilUnit(px) {
        return ceilUnit(px, this.zoom);
    }

    /** `px` rounded to the nearest layout unit (flexible length shares). */
    roundUnit(px) {
        return roundUnit(px, this.zoom);
    }

    /** Resolve margin, border and padding to px (percentages against cbWidth). */
    resolveEdges(box, cbWidth) {
        const s = box.style;
        box.marginAuto = s.margin.map((m) => m === 'auto');
        box.margin = s.margin.map((m) => (m === 'auto' ? 0 : this.len(m, cbWidth, 0)));
        // Collapsed table borders: the table pass sets half-widths for cells
        box.border = box.borderOverride ? [...box.borderOverride] : [...s.borderWidth];
        box.padding = s.padding.map((p) => Math.max(0, this.len(p, cbWidth, 0)));
        box.scrollbar = this.scrollbarInsets(box);
    }

    // ── Scrollbars ──────────────────────────────────────────────────────────

    /**
     * The room scrollbars take in this pass (CSS px, on layout units):
     * { auto, thin } for shown bars, 0 when they take none; { gutter,
     * thinGutter } for a stable gutter. `scrollbarWidth` is the classic bar;
     * the rest come from `scrollbarMetrics` or a probe of the page. A surface
     * that probed the classic width (scrollbarProbed) probes it again at a
     * new zoom.
     */
    scrollbarRoom(zoom) {
        if (this.scrollbarProbed && this.scrollbarZoom != null && this.scrollbarZoom !== zoom) this.scrollbarWidth = probeScrollbarWidth();
        if (this.scrollbarProbed) this.scrollbarZoom = zoom;
        const auto = roundUnit(this.scrollbarWidth || 0, zoom);
        if (this.bars?.zoom === zoom && this.bars.classic === this.scrollbarWidth) return this.bars;
        let probed = this.scrollbarMetrics;
        if (!probed) {
            probed = scrollbarProbes.get(zoom);
            if (probed === undefined) {
                probed = probeScrollbarMetrics();
                if (probed) scrollbarProbes.set(zoom, probed);
            }
        }
        const unit = (value) => roundUnit(value ?? auto, zoom);
        return {
            zoom,
            classic: this.scrollbarWidth,
            auto,
            thin: auto ? unit(probed?.thin) : 0,
            gutter: unit(probed?.gutter),
            thinGutter: unit(probed?.thinGutter)
        };
    }

    /** A ::-webkit-scrollbar thickness as Chrome lays it out: floored to whole device pixels. */
    devicePixels(px) {
        const zoom = this.zoom || 1;
        return Math.max(0, Math.floor(px * zoom + 1e-6) / zoom);
    }

    /**
     * The room a shown scrollbar of `style` takes: `axis` 0 is the vertical
     * bar's width, 1 the horizontal bar's height (Chrome, measured at 100% to
     * 200%): 0 for scrollbar-width: none and for hidden or overlay
     * scrollbars, the ::-webkit-scrollbar width or height where those rules
     * apply (0 under display: none), else the thin or the classic bar.
     */
    barThickness(style, axis) {
        const bars = this.bars;
        if (!bars?.auto || style.scrollbarWidth === 'none') return 0;
        const custom = style.webkitScrollbar;
        const size = custom ? (axis ? custom.height : custom.width) : 'auto';
        if (size !== 'auto' && size != null) return this.devicePixels(size);
        return style.scrollbarWidth === 'thin' ? bars.thin : bars.auto;
    }

    /** The room a stable scrollbar-gutter of `style` reserves, even with no bar shown. */
    gutterThickness(style) {
        if (style.scrollbarWidth === 'none') return 0;
        const custom = style.webkitScrollbar;
        if (custom && custom.width !== 'auto' && custom.width != null) return this.devicePixels(custom.width);
        return style.scrollbarWidth === 'thin' ? this.bars.thinGutter : this.bars.gutter;
    }

    /**
     * The room `box`'s scrollbars take: [right, bottom, left] (the vertical
     * bar on the right, the horizontal bar at the bottom, a both-edges gutter
     * on the left; mirrored for direction: rtl). Chrome takes it out of the
     * content box, between border and padding: overflow scroll always shows
     * a bar, overflow auto when content overflows (box.autoBars, decided by
     * layoutBoxNow), and scrollbar-gutter: stable reserves the vertical bar's
     * room on a scroll container (overflow hidden, auto or scroll on the
     * block axis), both-edges on the other side too. A right-to-left box has
     * its vertical bar on the left. Of a table's boxes only cells show bars
     * (measured). Sets box.scrollbarShown ([vertical, horizontal] bars shown,
     * or null) for the painter.
     */
    scrollbarInsets(box) {
        const s = box.style;
        box.scrollbarShown = null;
        if (!this.bars || !isScroller(s) || box.inner === 'table' || box.inner === 'table-row' || box.inner === 'table-row-group') return [0, 0, 0];
        const auto = box.autoBars;
        const vertical = s.overflowY === 'scroll' || Boolean(auto?.[0]);
        const horizontal = s.overflowX === 'scroll' || Boolean(auto?.[1]);
        let end = vertical ? this.barThickness(s, 0) : 0;
        let start = 0;
        if (s.scrollbarGutter && s.scrollbarGutter !== 'auto' && scrollsOn(s.overflowY)) {
            const gutter = this.gutterThickness(s);
            end = Math.max(end, gutter);
            if (s.scrollbarGutter === 'stable both-edges') start = gutter;
        }
        if (vertical || horizontal) box.scrollbarShown = [vertical, horizontal];
        if (s.direction === 'rtl') [end, start] = [start, end];
        return [end, horizontal ? this.barThickness(s, 1) : 0, start];
    }

    /** Border and padding widths, the room sizes in CSS lengths add to the content box. */
    bpWidth(box) {
        return box.border[1] + box.border[3] + box.padding[1] + box.padding[3];
    }

    bpHeight(box) {
        return box.border[0] + box.border[2] + box.padding[0] + box.padding[2];
    }

    /** Border, padding and scrollbar widths: the border box less the room content is laid out in. */
    pbWidth(box) {
        return box.border[1] + box.border[3] + box.padding[1] + box.padding[3] + box.scrollbar[0] + (box.scrollbar[2] || 0);
    }

    pbHeight(box) {
        return box.border[0] + box.border[2] + box.padding[0] + box.padding[2] + box.scrollbar[1];
    }

    /** Specified width as a border-box size, or null when auto/indefinite. */
    specifiedWidth(box, cbWidth) {
        const w = box.style.width;
        if (w === 'auto' || w == null) return null;
        if (w === 'min-content' || w === 'max-content' || w === 'fit-content') {
            const intrinsic = this.intrinsic(box);
            if (w === 'min-content') return intrinsic.min;
            if (w === 'max-content') return intrinsic.max;
            return cbWidth == null ? intrinsic.max : Math.min(intrinsic.max, Math.max(intrinsic.min, cbWidth - box.margin[1] - box.margin[3]));
        }
        const px = this.len(w, cbWidth);
        if (px == null) return null;
        // Scrollbars come out of the content box: a width is the border box less border and padding
        return box.style.boxSizing === 'border-box' ? Math.max(px, this.bpWidth(box)) : px + this.bpWidth(box);
    }

    specifiedHeight(box, cbHeight) {
        const h = box.style.height;
        if (h === 'auto' || h == null || typeof h === 'string') return null;
        const px = this.len(h, cbHeight);
        if (px == null) return null;
        return box.style.boxSizing === 'border-box' ? Math.max(px, this.bpHeight(box)) : px + this.bpHeight(box);
    }

    /** Border-box height for a border-box width through aspect-ratio (box-sizing aware). */
    ratioHeight(box, width) {
        const ratio = box.style.aspectRatio;
        if (box.style.boxSizing === 'border-box') return width / ratio;
        return Math.max(0, width - this.bpWidth(box)) / ratio + this.bpHeight(box);
    }

    /** Border-box width for a border-box height through aspect-ratio. */
    ratioWidth(box, height) {
        const ratio = box.style.aspectRatio;
        if (box.style.boxSizing === 'border-box') return height * ratio;
        return Math.max(0, height - this.bpHeight(box)) * ratio + this.bpWidth(box);
    }

    clampWidth(box, width, cbWidth) {
        const s = box.style;
        const toBorder = (px) => (s.boxSizing === 'border-box' ? px : px + this.bpWidth(box));
        if (s.maxWidth !== 'none') {
            const max = this.len(s.maxWidth, cbWidth);
            if (max != null) width = Math.min(width, toBorder(max));
        }
        if (s.minWidth !== 'auto' && typeof s.minWidth === 'object') {
            const min = this.len(s.minWidth, cbWidth);
            if (min != null) width = Math.max(width, toBorder(min));
        }
        return Math.max(width, this.bpWidth(box));
    }

    /** `box`'s min-height and max-height as content-box heights ({ min, max }, either null), or null. */
    innerHeightBounds(box, cbHeight) {
        const s = box.style;
        const bp = this.bpHeight(box);
        const pb = this.pbHeight(box);
        const inner = (value) => {
            const px = this.len(value, cbHeight);
            return px == null ? null : Math.max(0, (s.boxSizing === 'border-box' ? Math.max(px, bp) : px + bp) - pb);
        };
        const min = s.minHeight !== 'auto' && typeof s.minHeight === 'object' ? inner(s.minHeight) : null;
        const max = s.maxHeight !== 'none' ? inner(s.maxHeight) : null;
        return min || max != null ? { min: min || null, max } : null;
    }

    clampHeight(box, height, cbHeight) {
        const s = box.style;
        const toBorder = (px) => (s.boxSizing === 'border-box' ? px : px + this.bpHeight(box));
        if (s.maxHeight !== 'none') {
            const max = this.len(s.maxHeight, cbHeight);
            if (max != null) height = Math.min(height, toBorder(max));
        }
        if (s.minHeight !== 'auto' && typeof s.minHeight === 'object') {
            const min = this.len(s.minHeight, cbHeight);
            if (min != null) height = Math.max(height, toBorder(min));
        }
        return Math.max(height, this.bpHeight(box));
    }

    // ── Replaced elements ───────────────────────────────────────────────────

    /** Natural size of a replaced element: { width, height, ratio } (content box). */
    naturalSize(box) {
        const el = box.element;
        const tag = el?.localName;
        // (An element in a nested shadow tree takes that tree's UA table)
        const ua = (this.resolver.uaFor?.(el) ?? this.ua).get(el);
        const uaSize = (prop) => {
            const v = ua[prop];
            return v ? parseFloat(v) : null;
        };
        if (tag === 'img') {
            const image = this.images?.get(el.currentSrc || el.src);
            const w = el.naturalWidth || image?.width || parseFloat(el.getAttribute('width')) || 0;
            const h = el.naturalHeight || image?.height || parseFloat(el.getAttribute('height')) || 0;
            return { width: w, height: h, ratio: w && h ? w / h : null };
        }
        if (tag === 'svg') {
            const attrW = parseFloat(el.getAttribute('width'));
            const attrH = parseFloat(el.getAttribute('height'));
            const vb = (el.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
            const ratio = vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? vb[2] / vb[3] : (attrW && attrH ? attrW / attrH : null);
            return { width: Number.isFinite(attrW) ? attrW : 300, height: Number.isFinite(attrH) ? attrH : 150, ratio };
        }
        if (tag === 'canvas' || tag === 'video' || tag === 'iframe') {
            const w = parseFloat(el.getAttribute('width')) || (tag === 'video' ? el.videoWidth : 0) || 300;
            const h = parseFloat(el.getAttribute('height')) || (tag === 'video' ? el.videoHeight : 0) || 150;
            return { width: w, height: h, ratio: w / h };
        }
        if (tag === 'select') {
            // An unthemed drop-down has no arrow area: only its widest option and one row
            const themed = box.style.appearance !== 'none';
            const extraW = themed ? parseFloat(ua['select-extra-width']) || 24 : 0;
            const extraH = themed ? parseFloat(ua['select-extra-height']) || 2 : 0;
            let widest = 0;
            for (const option of el.querySelectorAll('option')) {
                widest = Math.max(widest, this.shaper.measure(option.textContent.trim(), box.style));
            }
            const rows = el.multiple || el.size > 1 ? Math.max(el.size || 4, 1) : 1;
            // As the browser sizes a drop-down: the widest option rounded up to
            // a whole layout pixel, one row as tall as the font's ascent and descent
            const zoom = this.zoom || 1;
            const metrics = this.shaper.fontMetrics(box.style);
            const height = rows > 1 ? rows * this.shaper.lineHeight(box.style) : metrics.ascent + metrics.descent;
            return { width: Math.ceil(widest * zoom - 1e-6) / zoom + extraW, height: height + extraH, ratio: null };
        }
        if (tag === 'textarea') {
            // cols x average character width plus a scrollbar's room by rows x
            // line height, as the browser sizes it (probed); the scrollbars
            // this layout reserves itself come off
            const probed = this.shaper.controlSize?.(el, box.style);
            if (probed) {
                // The probe keeps a classic bar's room: on the width unless
                // overflow-y clips, on the height under overflow-x: scroll.
                // Chrome takes that room from the theme, so scrollbar-width
                // changes it and ::-webkit-scrollbar does not (measured)
                const s = box.style;
                const bars = this.bars;
                const own = s.scrollbarWidth === 'none' ? 0 : s.scrollbarWidth === 'thin' ? bars?.thin ?? 0 : bars?.auto ?? 0;
                const change = (bars?.auto ?? 0) - own;
                const clipsY = s.overflowY === 'hidden' || s.overflowY === 'clip';
                const [right, bottom, left] = box.scrollbar || NO_BARS;
                return {
                    width: Math.max(0, probed.width - (clipsY ? 0 : change) - right - (left || 0)),
                    height: Math.max(0, probed.height - (s.overflowX === 'scroll' ? change : 0) - bottom),
                    ratio: null
                };
            }
            const rows = parseInt(el.getAttribute('rows'), 10) || 2;
            const cols = parseInt(el.getAttribute('cols'), 10) || 20;
            return { width: cols * this.shaper.measure('0', box.style), height: rows * this.shaper.lineHeight(box.style), ratio: null };
        }
        const type = tag === 'input' ? (el.getAttribute('type') || 'text').toLowerCase() : tag;
        // A text field or push button is as large as its own font (and label) makes it
        if (tag === 'input' && !NATIVE_SIZED_INPUTS.has(type)) {
            const probed = this.shaper.controlSize?.(el, box.style);
            if (probed) return { width: probed.width, height: probed.height, ratio: null };
        }
        // An unthemed checkbox or radio has no size of its own: only its padding and border show
        if (tag === 'input' && (type === 'checkbox' || type === 'radio') && box.style.appearance === 'none') {
            return { width: 0, height: 0, ratio: null };
        }
        // Form controls: the UA table holds the default border-box size; take
        // off the default padding and border to get the content size
        const w = uaSize('intrinsic-width');
        const h = uaSize('intrinsic-height');
        if (w != null && h != null) {
            const px = (key) => parseFloat(ua[key]) || 0;
            const uaPbW = px('padding-left') + px('padding-right') + px('border-left-width') + px('border-right-width');
            const uaPbH = px('padding-top') + px('padding-bottom') + px('border-top-width') + px('border-bottom-width');
            const textLike = tag === 'select' || (tag === 'input' && !NATIVE_SIZED_INPUTS.has(type) && !BUTTON_INPUTS.has(type));
            return {
                width: Math.max(0, w - uaPbW),
                height: textLike ? this.shaper.lineHeight(box.style) : Math.max(0, h - uaPbH),
                ratio: null
            };
        }
        if (tag === 'textarea') {
            const rows = parseInt(el.getAttribute('rows'), 10) || 2;
            const cols = parseInt(el.getAttribute('cols'), 10) || 20;
            const lineHeight = this.shaper.lineHeight(box.style);
            const charWidth = this.shaper.measure('0', box.style);
            return { width: cols * charWidth, height: rows * lineHeight, ratio: null };
        }
        return { width: 0, height: 0, ratio: null };
    }

    replacedSize(box, cbWidth, cbHeight) {
        const natural = this.naturalSize(box);
        let width = this.specifiedWidth(box, cbWidth);
        let height = this.specifiedHeight(box, cbHeight);
        const pbw = this.pbWidth(box);
        const pbh = this.pbHeight(box);
        if (width == null && height == null) {
            width = natural.width + pbw;
            height = natural.height + pbh;
        } else if (width == null) {
            width = natural.ratio ? (height - pbh) * natural.ratio + pbw : natural.width + pbw;
        } else if (height == null) {
            height = natural.ratio ? (width - pbw) / natural.ratio + pbh : natural.height + pbh;
        }
        return { width: this.clampWidth(box, width, cbWidth), height: this.clampHeight(box, height, cbHeight) };
    }

    // ── Generic box layout ──────────────────────────────────────────────────

    /**
     * Size and lay out a box. `cb` is { width, height } of the containing
     * block's content box (height null when indefinite). Options:
     * forcedWidth / forcedHeight (border box), shrinkToFit, availableWidth.
     *
     * Flex and grid lay an item out more than once (measure, size, stretch);
     * a box already laid out with the same inputs keeps its result (in this
     * pass, or from an earlier one when the box was kept), so nested
     * containers do not multiply the work at every level.
     *
     * Because an item gets several different requests per pass, one key
     * would miss on every pass. The sizes of the last few requests are kept
     * too: a request matching one of them takes that size without laying the
     * subtree out (the subtree still matches `layoutKey`, the last real
     * layout). A later request for `layoutKey` restores its size; a box whose
     * last request in the pass was such a reuse is laid out for real by
     * finishSized(), so the final tree always matches the final sizes.
     */
    layoutBox(box, cb, opts = {}) {
        if (box.heightFromCb === undefined) {
            const s = box.style;
            box.heightFromCb = hasPercent(s.height) || hasPercent(s.minHeight) || hasPercent(s.maxHeight);
        }
        const cbHeight = box.heightFromCb ? cb.height : null;
        const key = box.layoutKey;
        if (key && sameRequest(key, cb.width, cbHeight, opts)) {
            if (box.sized) {
                restoreSize(box, key.size);
                box.sized = null;
                this.touch(box);
            }
            return box;
        }
        const memo = key && box.sizeMemo?.find((entry) => sameRequest(entry, cb.width, cbHeight, opts));
        if (memo) {
            this.touch(box);
            this.resolveEdges(box, cb.width);
            restoreSize(box, memo.size);
            if (!box.sized) this.sizedBoxes?.push(box);
            box.sized = memo;
            return box;
        }
        this.layoutBoxNow(box, cb, opts);
        const entry = {
            width: cb.width, height: cbHeight, forcedWidth: opts.forcedWidth, forcedHeight: opts.forcedHeight,
            availableWidth: opts.availableWidth, shrinkToFit: Boolean(opts.shrinkToFit), autoHeight: Boolean(opts.autoHeight),
            cb: { width: cb.width, height: cb.height }, opts: { ...opts }, size: sizeOf(box)
        };
        box.layoutKey = entry;
        box.sized = null;
        const kept = (box.sizeMemo || []).filter((e) => !sameRequest(e, entry.width, entry.height, entry));
        box.sizeMemo = [entry, ...kept].slice(0, SIZE_MEMO);
        return box;
    }

    /**
     * Note that this pass changed `box`'s layout (its size, edges, content or
     * the position of what it contains). finalize() walks every marked box
     * and its ancestors again; other kept subtrees keep their coordinates.
     */
    touch(box) {
        const pass = this.pass;
        box.touchedPass = pass;
        for (let b = box; b && b.dirtyPass !== pass; b = b.parent) b.dirtyPass = pass;
    }

    /** Lay out for real the boxes whose last request this pass reused a size. */
    finishSized() {
        // Fixing a box can reuse sizes below it, which appends to the list
        for (let i = 0; i < this.sizedBoxes.length; i++) {
            const box = this.sizedBoxes[i];
            const entry = box.sized;
            if (!entry) continue;
            box.sized = null;
            this.layoutBoxNow(box, entry.cb, entry.opts);
            entry.size = sizeOf(box);
            box.layoutKey = entry;
        }
        this.sizedBoxes = [];
    }

    layoutBoxNow(box, cb, opts) {
        this.touch(box);
        // Auto scrollbars are decided afresh by each real layout
        box.autoBars = null;
        this.resolveEdges(box, cb.width);
        // Lines of a -webkit-line-clamp container count only within its own
        // block formatting context: a box that starts another hides them
        const outerClamp = this.lineClamp;
        if (outerClamp && this.establishesBfc(box)) {
            // An in-flow block past the clamped line means the clamp cuts
            // something, a formatting context root or a replaced box too:
            // flow-root, overflow, flex, grid, table, hr, canvas (measured)
            if (outerClamp.at && box.outer === 'block' && !box.outOfFlow) (outerClamp.root || outerClamp).more = true;
            this.lineClamp = null;
        }
        const replaced = box.inner === 'replaced' || box.inner === 'svg';
        let width;
        if (opts.forcedWidth != null) {
            width = opts.forcedWidth;
        } else if (replaced) {
            width = this.replacedSize(box, cb.width, cb.height).width;
        } else {
            const specified = this.specifiedWidth(box, cb.width);
            // aspect-ratio: an auto width follows a definite height
            const ratioFrom = specified == null && box.style.aspectRatio
                ? opts.forcedHeight ?? this.specifiedHeight(box, cb.height) : null;
            if (specified != null) {
                width = this.clampWidth(box, specified, cb.width);
            } else if (ratioFrom != null) {
                width = this.clampWidth(box, this.ratioWidth(box, this.clampHeight(box, ratioFrom, cb.height)), cb.width);
            } else {
                const available = (opts.availableWidth ?? cb.width ?? 0) - box.margin[1] - box.margin[3];
                if (opts.shrinkToFit || box.inner === 'table') {
                    const intrinsic = this.intrinsic(box);
                    width = Math.min(Math.max(intrinsic.min, available), intrinsic.max);
                } else {
                    width = available;
                }
                width = this.clampWidth(box, width, cb.width);
            }
        }
        box.width = Math.max(0, width);
        let forcedHeight = opts.forcedHeight ?? null;
        if (forcedHeight == null && replaced) forcedHeight = this.replacedSize(box, cb.width, cb.height).height;
        // autoHeight measures content as if height were auto (flex automatic minimums)
        const specifiedHeight = forcedHeight ?? (opts.autoHeight ? null : this.specifiedHeight(box, cb.height));
        const definiteHeight = specifiedHeight != null ? this.clampHeight(box, specifiedHeight, cb.height) : null;
        // aspect-ratio: an auto height follows the width; content may still
        // make it taller while overflow is visible (the automatic minimum)
        const ratioHeight = definiteHeight == null && box.style.aspectRatio && !replaced
            ? this.clampHeight(box, this.ratioHeight(box, box.width), cb.height) : null;
        const sizedHeight = definiteHeight ?? ratioHeight;
        let innerHeight = sizedHeight != null ? Math.max(0, sizedHeight - this.pbHeight(box)) : null;
        // A grid sized by its rows still fills a definite min-height and stops
        // at a max-height (css-grid 12.6-12.8): its rows are sized again there
        if (innerHeight == null && box.inner === 'grid' && !opts.autoHeight) {
            const bounds = this.innerHeightBounds(box, cb.height);
            if (bounds) opts = { ...opts, heightBounds: bounds };
        }

        const layoutContent = () => {
            if (replaced) return 0;
            if (box.style.lineClamp) {
                const clamp = this.beginLineClamp(box);
                const height = this.layoutInner(box, box.contentWidthWithScrollbar(), innerHeight, opts);
                // Nothing in flow after the clamped line: the clamp cuts
                // nothing, and the blocks that hold the line keep their
                // natural heights, end margins included (measured)
                if (clamp.at && !clamp.more && clamp.at.container !== box) {
                    this.lineClamp = null;
                    this.forgetLayouts(box);
                    return this.layoutInner(box, box.contentWidthWithScrollbar(), innerHeight, opts);
                }
                return this.endLineClamp(box, clamp, height);
            }
            const outer = this.lineClamp;
            if (!outer) return this.layoutInner(box, box.contentWidthWithScrollbar(), innerHeight, opts);
            // In a line-clamp container (Chrome 155, measured): a block that
            // holds the clamped line ends there too, and a block past it is
            // clamped at its own first line. Any in-flow block past the line,
            // even an empty one, means the clamp cuts something
            const reached = Boolean(outer.at);
            const nested = reached ? { limit: 1, count: 0, at: null, more: false, root: outer.root || outer } : null;
            if (nested) {
                nested.root.more = true;
                this.lineClamp = nested;
            }
            const height = this.layoutInner(box, box.contentWidthWithScrollbar(), innerHeight, opts);
            this.lineClamp = outer;
            const at = nested ? nested.at : outer.at;
            return (nested || !reached) && at ? this.clampedHeight(box, at) : height;
        };
        const grows = box.style.overflowX === 'visible' && box.style.overflowY === 'visible';
        let contentHeight = layoutContent();
        const settle = () => {
            box.height = definiteHeight != null ? definiteHeight
                : ratioHeight != null ? (grows ? Math.max(ratioHeight, this.clampHeight(box, contentHeight + this.pbHeight(box), cb.height)) : ratioHeight)
                    : opts.autoHeight ? contentHeight + this.pbHeight(box)
                        : this.clampHeight(box, contentHeight + this.pbHeight(box), cb.height);
            box.contentUsedHeight = contentHeight;
            // A button centres its content in whatever height it gets (height, min-height, stretch)
            if (box.isButton && box.inner === 'flow') this.centerButtonContent(box, contentHeight);
            this.layoutAbsolutes(box);
            if (box.lines) this.layoutInlineAbsolutes(box);
        };
        settle();
        // overflow: auto shows a scrollbar where content overflows the
        // padding box, and lays the content out again in the room left; a bar
        // shown stays for the rest of the layout (a horizontal bar can make
        // content overflow vertically, and the other way round). An item
        // whose container measures its height (box.barsOnce: a row flex
        // container of auto height, a content-sized grid row) decides once: a
        // bar that makes its content overflow the other way adds no second
        // bar (measured)
        const s = box.style;
        if (!replaced && this.bars.auto && (s.overflowX === 'auto' || s.overflowY === 'auto')) {
            const rounds = box.barsOnce ? 1 : 2;
            for (let round = 0; round < rounds; round++) {
                const extent = this.scrollExtent(box, contentHeight);
                const clientWidth = box.width - this.pbWidth(box) + box.padding[1] + box.padding[3];
                const clientHeight = box.height - this.pbHeight(box) + box.padding[0] + box.padding[2];
                // (A table cell grows to its content: its height never overflows)
                const vertical = s.overflowY === 'auto' && !box.autoBars?.[0] && !box.tableCell && this.barThickness(s, 0) > 0
                    && this.overflows(extent.height, clientHeight);
                const horizontal = s.overflowX === 'auto' && !box.autoBars?.[1] && this.barThickness(s, 1) > 0
                    && this.overflows(extent.width, clientWidth);
                if (!vertical && !horizontal) break;
                const before = box.scrollbar;
                box.autoBars = [vertical || Boolean(box.autoBars?.[0]), horizontal || Boolean(box.autoBars?.[1])];
                box.scrollbar = this.scrollbarInsets(box);
                // A stable gutter may already hold the bar's room
                if (box.scrollbar.every((v, i) => v === before[i])) break;
                innerHeight = sizedHeight != null ? Math.max(0, sizedHeight - this.pbHeight(box)) : null;
                contentHeight = layoutContent();
                settle();
            }
        }
        box.scrollExtent = isScrollContainer(s) && !replaced ? this.scrollExtent(box, contentHeight) : null;
        box.overflowExtent = replaced ? null : this.ownOverflow(box);
        this.lineClamp = outerClamp;
        return box;
    }

    /** Whether a scrollable overflow size passes a client size, in whole layout pixels as Chrome snaps them (half up). */
    overflows(scroll, client) {
        const units = (this.zoom || 1) * 64;
        const snap = (px) => Math.floor((Math.round(px * units) + 32) / 64);
        return snap(scroll) > snap(client);
    }

    /**
     * `child`'s border box placed at (x, y) in its parent's coordinates,
     * through its own transform: { x, y, width, height }, or null untransformed.
     */
    transformedBounds(child, x, y) {
        const s = child.style;
        if (!s.transform || s.transform === 'none') return null;
        const view = this.viewport || { width: 0, height: 0 };
        const m = parseTransform(s.transform, child.width, child.height, { fontSize: s.fontSize, rootFontSize: 16, vw: view.width, vh: view.height });
        if (!m) return null;
        const [tx, ty] = parseTransformOrigin(s.transformOrigin, child.width, child.height);
        const local = multiplyAffine(multiplyAffine([1, 0, 0, 1, x + tx, y + ty], m), [1, 0, 0, 1, -x - tx, -y - ty]);
        return transformRectBounds(local, { x, y, width: child.width, height: child.height });
    }

    /**
     * How far `child`'s subtree reaches from (`left`, `top`) in its parent's
     * coordinates: [right, bottom] of its border box and of what overflows it,
     * relative offset and transform applied, as scrollable overflow counts it.
     */
    reachOf(child, left, top) {
        const [rx, ry] = child.style.position === 'relative' ? this.relativeOffset(child) : NO_OFFSET;
        const x = child.x + rx;
        const y = child.y + ry;
        const ext = child.overflowExtent;
        const t = this.transformedBounds(child, x, y);
        if (t) {
            const sx = t.width / (child.width || 1);
            const sy = t.height / (child.height || 1);
            return [t.x - left + (ext ? ext[0] * sx : t.width), t.y - top + (ext ? ext[1] * sy : t.height)];
        }
        return [x - left + (ext ? ext[0] : child.width), y - top + (ext ? ext[1] : child.height)];
    }

    /**
     * The scrollable overflow of scroll container `box` from its padding
     * box's top left: { width, height }, as Chrome measures it: the margin
     * boxes of its in-flow children (relative offsets applied) and its lines,
     * plus its end padding; and the border boxes in their subtrees and of its
     * absolutely positioned boxes (margins not counted, transforms applied).
     * Never less than the padding box inside the scrollbars.
     */
    scrollExtent(box, contentHeight) {
        const left = box.border[3] + (box.scrollbar[2] || 0);
        const top = box.border[0];
        const ox = box.contentX;
        const oy = box.contentY;
        let inRight = 0;
        let inBottom = contentHeight;
        let right = 0;
        let bottom = 0;
        if (box.lines) for (const line of box.lines) inRight = Math.max(inRight, line.width);
        for (const child of box.children) {
            if (child.isText || child.outOfFlow || (child.outer === 'inline' && !child.atomic)) continue;
            if (!child.atomic) {
                const [rx, ry] = child.style.position === 'relative' ? this.relativeOffset(child) : NO_OFFSET;
                inRight = Math.max(inRight, child.x + rx - ox + child.width + child.margin[1]);
                inBottom = Math.max(inBottom, child.y + ry - oy + child.height + child.margin[2]);
            }
            const [r, b] = this.reachOf(child, left, top);
            right = Math.max(right, r);
            bottom = Math.max(bottom, b);
        }
        for (const abs of box.absolutes) {
            const [r, b] = this.reachOf(abs, left, top);
            right = Math.max(right, r);
            bottom = Math.max(bottom, b);
        }
        const clientWidth = box.width - this.pbWidth(box) + box.padding[1] + box.padding[3];
        const clientHeight = box.height - this.pbHeight(box) + box.padding[0] + box.padding[2];
        return {
            width: Math.max(clientWidth, box.padding[3] + inRight + box.padding[1], right),
            height: Math.max(clientHeight, box.padding[0] + inBottom + box.padding[2], bottom)
        };
    }

    /**
     * How far the content of a box that does not clip reaches past its
     * border box ([right, bottom] in its own coordinates), or null: its
     * lines, its children's border boxes and what overflows them, and its
     * absolutely positioned boxes. A box that clips keeps its overflow.
     */
    ownOverflow(box) {
        if (isScrollContainer(box.style) || box.isHost) return null;
        let right = box.width;
        let bottom = box.height;
        if (box.lines?.length) {
            const ox = box.contentX;
            for (const line of box.lines) right = Math.max(right, ox + line.width);
            const last = box.lines[box.lines.length - 1];
            bottom = Math.max(bottom, last.top + last.height);
        }
        for (const child of box.children) {
            if (child.isText || child.outOfFlow || (child.outer === 'inline' && !child.atomic)) continue;
            const [r, b] = this.reachOf(child, 0, 0);
            right = Math.max(right, r);
            bottom = Math.max(bottom, b);
        }
        for (const abs of box.absolutes) {
            const [r, b] = this.reachOf(abs, 0, 0);
            right = Math.max(right, r);
            bottom = Math.max(bottom, b);
        }
        return right > box.width + 1e-3 || bottom > box.height + 1e-3 ? [right, bottom] : null;
    }

    // ── -webkit-line-clamp ──────────────────────────────────────────────────

    /**
     * Start laying out line-clamp container `box`: the lines laid out in
     * its block formatting context from here on are counted (InlineLayout
     * notes them in engine.lineClamp: the line it stops at, and whether more
     * follow), and its descendants lay out again, since the clamp changes
     * what they show.
     */
    beginLineClamp(box) {
        this.forgetLayouts(box);
        const clamp = { limit: box.style.lineClamp, count: 0, at: null, more: false };
        this.lineClamp = clamp;
        return clamp;
    }

    /** Drop the kept layouts of `box`'s descendants, so they lay out again. */
    forgetLayouts(box) {
        for (const child of box.children) {
            if (child.isText) continue;
            child.layoutKey = null;
            child.sizeMemo = null;
            child.sized = null;
            this.forgetLayouts(child);
        }
    }

    /**
     * Finish line-clamp container `box` (Chrome 155, measured): with lines
     * or in-flow blocks after the clamped line, its content ends at the
     * bottom of the last line it keeps (see clampedHeight), that line ends
     * in an ellipsis, and the lines after it are laid out and painted as
     * usual (an overflow clip usually hides them). Returns the content height.
     */
    endLineClamp(box, clamp, contentHeight) {
        this.lineClamp = null;
        if (!clamp.at) return contentHeight;
        const { container, line } = clamp.at;
        if (clamp.more) clampLineEllipsis(this, container, line);
        const offset = container === box ? 0 : this.offsetWithin(container, box).y;
        box.lastBaseline = offset + container.lines[line].baseline;
        return this.clampedHeight(box, clamp.at);
    }

    /**
     * The content height of `box` ending at line `at` ({ container, line })
     * inside it: at the bottom of the line when `box` holds it, else at the
     * border-box bottom of its child that holds it. That child's height is
     * its own: its content ends there too, and its padding, border, height,
     * min-height and max-height apply; its end margin does not count
     * (Chrome 155, measured).
     */
    clampedHeight(box, at) {
        const kept = at.container.lines[at.line];
        if (at.container === box) return Math.max(0, kept.top + kept.height - box.contentY);
        let child = at.container;
        while (child.parent && child.parent !== box) child = child.parent;
        return Math.max(0, this.offsetWithin(child, box).y + child.height - box.contentY);
    }

    /** Lay out an inline-level atomic box (inline-block, inline-flex, replaced). */
    layoutAtomic(box, availableWidth) {
        this.layoutBox(box, { width: availableWidth, height: null }, { shrinkToFit: true, availableWidth });
    }

    /** Baseline of an atomic inline from its border-box top, or null for the margin-box bottom. */
    atomicBaseline(box) {
        if (box.inner === 'replaced' || box.inner === 'svg') {
            const tag = box.element?.localName;
            // Text controls align on their text baseline
            // Single-line controls align on their text; a textarea on its bottom edge
            if (tag === 'input' || tag === 'select') {
                const type = tag === 'input' ? (box.element.getAttribute('type') || 'text').toLowerCase() : tag;
                // A themed checkbox or radio sits on its border-box bottom (a bare
                // one, like any empty inline-block, on its margin-box bottom); a
                // slider always does; a colour well on the bottom of its swatch
                if (type === 'checkbox' || type === 'radio') return box.style.appearance === 'none' ? null : box.height;
                if (type === 'range') return box.height;
                if (type === 'color') return this.shaper.controlBaseline?.(box) ?? null;
                if (type === 'image') return null;
                const el = box.element;
                const top = box.border[0] + box.padding[0];
                const inner = box.height - this.pbHeight(box);
                // A drop-down centres one row as tall as the font's ascent and descent
                if (tag === 'select' && !(el.multiple || el.size > 1)) {
                    const metrics = this.shaper.fontMetrics(box.style);
                    return top + this.unit((inner - metrics.ascent - metrics.descent) / 2) + metrics.ascent;
                }
                const lh = this.shaper.lineHeight(box.style);
                const label = BUTTON_INPUTS.has(type) ? el.getAttribute('value') ?? (type === 'button' ? '' : null) : null;
                // A push button's label keeps its line breaks (the UA sets
                // white-space: pre): its lines are centred together, from the
                // top when taller than the box (auto margins), and, as an
                // inline-block, the button sits on the last one
                const breaks = label?.replace(/[\r\n]/g, '') && KEEPS_NEWLINES.has(box.style.whiteSpace) ? label.split('\n').length - 1 : 0;
                const free = inner - (breaks + 1) * lh;
                const centre = BUTTON_INPUTS.has(type) && free < 0 ? 0 : this.unit(free / 2);
                // A push button with an empty label keeps an empty line, whose
                // content top plus unfloored half-leading the browser floors to
                // a whole layout pixel
                if (label != null && !label.replace(/[\r\n]/g, '')) {
                    const metrics = this.shaper.fontMetrics(box.style);
                    const zoom = this.zoom || 1;
                    const leading = (lh - metrics.ascent - metrics.descent) / 2;
                    return Math.floor((top + leading) * zoom + 1 / 128) / zoom + centre + metrics.ascent;
                }
                return top + centre + breaks * lh + this.shaper.baselineIn(box.style, lh);
            }
            return null;
        }
        if (isScrollContainer(box.style) && box.inner === 'flow') return null;
        if (box.inner === 'flex' || box.inner === 'grid' || box.inner === 'table') return box.baseline;
        return box.lastBaseline ?? box.baseline;
    }

    centerButtonContent(box, contentHeight) {
        const free = box.height - this.pbHeight(box) - contentHeight;
        if (free <= 0.01) return;
        const dy = this.unit(free / 2);
        for (const child of box.children) {
            if (!child.isText && !child.outOfFlow) child.y += dy;
        }
        if (box.runs) for (const run of box.runs) { run.top += dy; run.baseline += dy; }
        if (box.lines) for (const line of box.lines) { line.top += dy; line.baseline += dy; }
        const shiftFragments = (b) => {
            for (const child of b.children || []) {
                if (child.isText) continue;
                if (child.ifc === box && child.fragments) for (const f of child.fragments) f.y += dy;
                // An atomic inside an inline box is placed in the button's coordinates too
                if (b !== box && child.atomic && child.ifc === box) child.y += dy;
                if (child.outer === 'inline' && !child.atomic) shiftFragments(child);
            }
        };
        shiftFragments(box);
        if (box.baseline != null) box.baseline += dy;
        if (box.lastBaseline != null) box.lastBaseline += dy;
    }

    /** Lay out the box's content; returns the content height. */
    layoutInner(box, contentWidth, contentHeight, opts = {}) {
        box.layoutContentWidth = contentWidth;
        switch (box.inner) {
            case 'flex': return layoutFlex(this, box, contentWidth, contentHeight);
            case 'grid': return layoutGrid(this, box, contentWidth, contentHeight, opts.heightBounds);
            case 'table': return layoutTable(this, box, contentWidth, contentHeight);
            case 'table-row-group':
            case 'table-row':
            case 'table-cell':
            case 'flow':
            default:
                if (box.establishesInline) {
                    const height = layoutInline(this, box, contentWidth);
                    return height;
                }
                return this.layoutBlockFlow(box, contentWidth, contentHeight, opts);
        }
    }

    establishesBfc(box) {
        const s = box.style;
        return box.isHost || box.outOfFlow || box.atomic || box.inner !== 'flow' || isScrollContainer(s)
            || box.display === 'flow-root' || box.flexItem || box.gridItem || box.tableCell || box.isButton
            || (s.display && s.display.startsWith('table'));
    }

    // ── Block flow ──────────────────────────────────────────────────────────

    layoutBlockFlow(box, contentWidth, contentHeight) {
        const cb = { width: contentWidth, height: contentHeight };
        const ox = box.contentX;
        const oy = box.contentY;
        // A plain host lets its first and last child margins escape, as a
        // non-BFC block in the page does; the escaped margin lies outside the scene
        const hostCollapses = box.isHost && this.hostCollapsesMargins;
        const bfc = hostCollapses ? false : this.establishesBfc(box);
        const collapseTop = !bfc && box.border[0] === 0 && box.padding[0] === 0;
        const collapseBottom = !bfc && box.border[2] === 0 && box.padding[2] === 0 && (box.style.height === 'auto' || hostCollapses);
        let y = 0;
        let pending = new MarginSet();
        let first = true;
        box.escapedTop = null;
        box.escapedBottom = null;
        box.baseline = null;
        box.lastBaseline = null;
        for (const child of box.children) {
            if (child.isText) continue;
            if (child.outOfFlow) {
                child.staticPos = { x: ox, y: oy + y + pending.value };
                continue;
            }
            this.layoutBox(child, cb, { availableWidth: contentWidth });
            // Horizontal position, with auto margins centring a sized box
            let x = child.margin[3];
            const free = contentWidth - child.width - child.margin[1] - child.margin[3];
            if (child.marginAuto[1] && child.marginAuto[3]) x = child.margin[3] + this.unit(free / 2);
            else if (child.marginAuto[3] && !child.marginAuto[1]) x = child.margin[3] + free;
            child.x = ox + x;
            const childTop = new MarginSet().add(child.margin[0]).merge(child.escapedTop);
            const empty = child.height === 0 && !child.lines?.length && this.collapsesThrough(child);
            if (empty) {
                pending.merge(childTop).add(child.margin[2]).merge(child.escapedBottom);
                child.y = oy + y;
                continue;
            }
            const combined = new MarginSet().merge(pending).merge(childTop);
            if (first && collapseTop) {
                box.escapedTop = combined;
                child.y = oy + y;
            } else {
                child.y = oy + y + combined.value;
            }
            y = child.y - oy + child.height;
            pending = new MarginSet().add(child.margin[2]).merge(child.escapedBottom);
            if (box.baseline == null && child.baseline != null && !isScrollContainer(child.style)) box.baseline = child.y + child.baseline;
            if (child.lastBaseline != null || child.baseline != null) box.lastBaseline = child.y + (child.lastBaseline ?? child.baseline);
            first = false;
        }
        if (first && collapseTop && collapseBottom) {
            // Nothing in flow: margins collapse through
            box.escapedTop = pending.value !== 0 ? pending : null;
            return 0;
        }
        if (collapseBottom) {
            box.escapedBottom = pending;
            return y;
        }
        return y + pending.value;
    }

    collapsesThrough(box) {
        return !this.establishesBfc(box) && box.border[0] === 0 && box.border[2] === 0
            && box.padding[0] === 0 && box.padding[2] === 0 && box.style.height === 'auto'
            && (box.style.minHeight === 'auto' || this.len(box.style.minHeight, null, 0) === 0);
    }

    // ── Intrinsic sizes ─────────────────────────────────────────────────────

    /** Min-content and max-content border-box widths. */
    intrinsic(box) {
        // Intrinsic sizes depend only on the box's own subtree, which a kept box keeps
        const unseen = this.barsUnseen;
        const cached = unseen ? box.intrinsicUnseen : box.intrinsicCache;
        if (cached) {
            if (cached.decidesBar) this.barChoices++;
            return cached;
        }
        const choices = this.barChoices;
        if (!box.margin || !box.border) this.resolveEdges(box, null);
        else if (box.scrollbar == null) this.resolveEdges(box, null);
        const pb = this.pbWidth(box);
        const bp = this.bpWidth(box);
        let result;
        const specified = (() => {
            const w = box.style.width;
            if (w === 'auto' || w == null || typeof w === 'string') return null;
            const px = this.len(w, null);
            if (px == null) return null;
            return box.style.boxSizing === 'border-box' ? Math.max(px, bp) : px + bp;
        })();
        // aspect-ratio with a definite height fixes the width too
        const ratioHeight = specified == null && box.style.aspectRatio && box.inner !== 'replaced' && box.inner !== 'svg'
            ? this.specifiedHeight(box, null) : null;
        if (specified != null) {
            result = { min: specified, max: specified };
        } else if (ratioHeight != null) {
            const width = this.ratioWidth(box, this.clampHeight(box, ratioHeight, null));
            result = { min: width, max: width };
        } else if (box.inner === 'replaced' || box.inner === 'svg') {
            const size = this.replacedSize(box, null, null);
            result = { min: size.width, max: size.width };
            if (box.style.width && typeof box.style.width === 'object' && 'pct' in box.style.width) result.min = 0;
        } else {
            result = this.contentIntrinsic(box, pb);
            // Content that will overflow the box's height shows an auto
            // scrollbar, which its intrinsic widths include (Chrome: 50px of
            // content in a 40px tall overflow-y: auto inline-block of 100px
            // content makes it 65px wide)
            const bar = this.predictedAutoBar(box, result.max);
            if (bar) result = { min: result.min + bar, max: result.max + bar };
        }
        // min/max-width clamp
        const s = box.style;
        const toBorder = (px) => (s.boxSizing === 'border-box' ? px : px + bp);
        if (s.maxWidth !== 'none') {
            const max = this.len(s.maxWidth, null);
            if (max != null) { result.min = Math.min(result.min, toBorder(max)); result.max = Math.min(result.max, toBorder(max)); }
        }
        if (s.minWidth !== 'auto' && typeof s.minWidth === 'object') {
            const min = this.len(s.minWidth, null);
            if (min != null) { result.min = Math.max(result.min, toBorder(min)); result.max = Math.max(result.max, toBorder(min)); }
        }
        // With no overflow: auto bar to decide below it, the sizes are the same either way
        if (this.barChoices !== choices) {
            result.decidesBar = true;
            if (unseen) box.intrinsicUnseen = result;
            else box.intrinsicCache = result;
        } else {
            box.intrinsicUnseen = result;
            box.intrinsicCache = result;
        }
        return result;
    }

    /**
     * What a grid track takes from an item (min or max). Chrome sizes tracks
     * before it lays their items out, so an overflow: auto bar an item has not
     * shown yet adds nothing (measured: 50px of content in an auto track is
     * 50px wide and shows 35px of it; alone it would be 65px wide). Once a
     * layout has shown the bar, a later one counts it (65px after a resize).
     */
    trackContribution(box, kind) {
        const outer = this.barsUnseen;
        if (outer !== 'table') this.barsUnseen = 'grid';
        const value = this.contribution(box, kind);
        this.barsUnseen = outer;
        return value;
    }

    /** A table cell's intrinsic sizes: like a grid track's, but the columns keep them (still 50px after a resize). */
    cellIntrinsic(cell) {
        const outer = this.barsUnseen;
        this.barsUnseen = 'table';
        const value = this.intrinsic(cell);
        this.barsUnseen = outer;
        return value;
    }

    /**
     * The width an overflow-y: auto scrollbar will add to `box`'s intrinsic
     * widths (0 when none): a height or max-height its content, laid out at
     * `width` (its max-content border box), overflows. The trial layout is
     * forgotten, so the box's real layout runs afresh.
     */
    predictedAutoBar(box, width) {
        const s = box.style;
        if (s.overflowY !== 'auto' || box.predictingBar || box.autoBars?.[0]) return 0;
        const room = this.barThickness(s, 0) - box.scrollbar[0];
        if (!(room > 0)) return 0;
        const height = this.specifiedHeight(box, null);
        const max = s.maxHeight !== 'none' ? this.len(s.maxHeight, null) : null;
        if (height == null && max == null) return 0;
        this.barChoices++;
        const unseen = this.barsUnseen;
        if (unseen && !(unseen === 'grid' && this.shownBars.has(box.element))) return 0;
        this.barsUnseen = null;
        box.predictingBar = true;
        let overflows = false;
        try {
            this.layoutBox(box, { width, height: null }, { forcedWidth: width, autoHeight: true });
            const bound = this.clampHeight(box, height ?? box.height, null);
            const extent = this.scrollExtent(box, box.contentUsedHeight ?? 0);
            overflows = this.overflows(extent.height, bound - this.pbHeight(box) + box.padding[0] + box.padding[2]);
        } finally {
            box.predictingBar = false;
            box.layoutKey = null;
            box.sizeMemo = null;
            box.sized = null;
            box.autoBars = null;
            box.scrollbar = this.scrollbarInsets(box);
            this.barsUnseen = unseen;
        }
        return overflows ? room : 0;
    }

    /** Min- and max-content border-box widths from a non-replaced box's content alone. */
    contentIntrinsic(box, pb = this.pbWidth(box)) {
        let inner;
        switch (box.inner) {
            case 'flex': inner = intrinsicFlex(this, box); break;
            case 'grid': inner = intrinsicGrid(this, box); break;
            case 'table': inner = intrinsicTable(this, box); break;
            default:
                if (box.establishesInline) inner = intrinsicInline(this, box);
                else {
                    inner = { min: 0, max: 0 };
                    for (const child of box.children) {
                        if (child.isText || child.outOfFlow) continue;
                        inner.min = Math.max(inner.min, this.contribution(child, 'min'));
                        inner.max = Math.max(inner.max, this.contribution(child, 'max'));
                    }
                }
        }
        return { min: inner.min + pb, max: Math.max(inner.max, inner.min) + pb };
    }

    /**
     * Min-content border-box width of a box's content, not its width
     * property: a flex item's content size suggestion, which the caller
     * clamps by the specified width (a width: 60px item with nothing in it
     * may still shrink to its padding and border).
     */
    contentMin(box) {
        const intrinsic = this.intrinsic(box);
        if (intrinsic.contentMin == null) {
            const w = box.style.width;
            const sized = w != null && w !== 'auto' && typeof w !== 'string' && this.len(w, null) != null;
            intrinsic.contentMin = sized && box.inner !== 'replaced' && box.inner !== 'svg' && !box.style.aspectRatio
                ? this.contentIntrinsic(box).min
                : intrinsic.min;
        }
        return intrinsic.contentMin;
    }

    /** Intrinsic contribution of a box including its margins. */
    contribution(box, kind) {
        const intrinsic = this.intrinsic(box);
        const margins = (box.margin?.[1] || 0) + (box.margin?.[3] || 0);
        return intrinsic[kind] + margins;
    }

    // ── Absolute positioning ────────────────────────────────────────────────

    /** Offset of `box`'s border box within `ancestor`'s border box. */
    offsetWithin(box, ancestor) {
        let x = 0;
        let y = 0;
        let b = box;
        while (b && b !== ancestor) {
            x += b.x;
            y += b.y;
            b = b.outOfFlow ? b.cb : b.parent;
        }
        return { x, y };
    }

    /**
     * Size and place `cbBox`'s absolutely positioned boxes in its padding
     * box, or in `area` ({ x, y, width, height, originX, originY }: an
     * inline box's containing block, from layoutInlineAbsolutes).
     */
    layoutAbsolutes(cbBox, area = null) {
        if (!cbBox.absolutes?.length) return;
        // The padding box, inside any scrollbars and gutters
        const bars = cbBox.scrollbar || NO_BARS;
        const startX = area ? area.x : cbBox.border[3] + (bars[2] || 0);
        const startY = area ? area.y : cbBox.border[0];
        const cbW = area ? area.width : Math.max(0, cbBox.width - cbBox.border[1] - cbBox.border[3] - bars[0] - (bars[2] || 0));
        const cbH = area ? area.height : Math.max(0, cbBox.height - cbBox.border[0] - cbBox.border[2] - bars[1]);
        for (const box of cbBox.absolutes) {
            // Placed here even when its own layout is reused
            this.touch(box);
            this.resolveEdges(box, cbW);
            const s = box.style;
            const left = this.len(s.left, cbW);
            const right = this.len(s.right, cbW);
            const top = this.len(s.top, cbH);
            const bottom = this.len(s.bottom, cbH);
            // Static position in containing block coordinates
            let staticX = 0;
            let staticY = 0;
            if (box.staticPos && box.parent) {
                // (An inline box's own coordinates are its lines' container's)
                const parentOffset = this.offsetWithin(box.parent, cbBox);
                if (area) {
                    parentOffset.x -= area.originX;
                    parentOffset.y -= area.originY;
                }
                staticX = parentOffset.x + box.staticPos.x - startX;
                staticY = parentOffset.y + box.staticPos.y - startY;
            }
            const marginsX = box.margin[1] + box.margin[3];
            let width = this.specifiedWidth(box, cbW);
            const replaced = box.inner === 'replaced' || box.inner === 'svg';
            if (width == null && !replaced) {
                if (left != null && right != null) width = cbW - left - right - marginsX;
                else {
                    const available = cbW - (left ?? staticX) - (right ?? 0) - marginsX;
                    const intrinsic = this.intrinsic(box);
                    width = Math.min(Math.max(intrinsic.min, available), intrinsic.max);
                }
            }
            // min-width / max-width bound a specified width too (width: 300px; max-width: 92%)
            if (width != null && !replaced) width = this.clampWidth(box, width, cbW);
            let forcedHeight = null;
            if (this.specifiedHeight(box, cbH) == null && top != null && bottom != null && !replaced) {
                forcedHeight = Math.max(this.pbHeight(box), cbH - top - bottom - box.margin[0] - box.margin[2]);
            }
            this.layoutBox(box, { width: cbW, height: cbH }, { forcedWidth: width ?? undefined, forcedHeight });
            width = box.width;
            // In a flex or grid container the static position aligns the box
            // as if it were the container's only item
            const alignIn = box.staticPos?.alignIn;
            if (alignIn) {
                const [dx, dy] = this.staticAlignment(box, alignIn);
                staticX += dx;
                staticY += dy;
            }
            let x;
            if (left != null) {
                x = left + box.margin[3];
                if (right != null && box.marginAuto[1] && box.marginAuto[3]) x = left + this.unit((cbW - left - right - width) / 2);
            } else if (right != null) x = cbW - right - box.margin[1] - width;
            else x = staticX + box.margin[3];
            let y;
            if (top != null) {
                y = top + box.margin[0];
                if (bottom != null && box.marginAuto[0] && box.marginAuto[2]) y = top + this.unit((cbH - top - bottom - box.height) / 2);
            } else if (bottom != null) y = cbH - bottom - box.margin[2] - box.height;
            else y = staticY + box.margin[0];
            box.x = x + startX;
            box.y = y + startY;
        }
    }

    /**
     * Lay out the absolutely positioned boxes whose containing block is a
     * non-atomic inline box in `container`'s lines (Chrome 155, measured):
     * that block runs from the padding box top left of the inline box's
     * first fragment to the padding box bottom right of its last, and is
     * never narrower than nothing. Its coordinates start at the first
     * fragment's border box, which is where the inline box sits.
     */
    layoutInlineAbsolutes(container) {
        const walk = (parent) => {
            for (const child of parent.children) {
                if (child.isText || child.atomic || child.outOfFlow || child.outer !== 'inline') continue;
                const frags = child.fragments;
                if (child.absolutes.length && frags?.length && child.ifc === container) {
                    const first = frags[0];
                    const last = frags[frags.length - 1];
                    const x = child.border[3];
                    const y = child.border[0];
                    this.layoutAbsolutes(child, {
                        x, y,
                        width: Math.max(0, last.x + last.width - child.border[1] - first.x - x),
                        height: Math.max(0, last.y + last.height - child.border[2] - first.y - y),
                        originX: first.x, originY: first.y
                    });
                }
                walk(child);
            }
        };
        walk(container);
    }

    /** Offset of an absolutely positioned box's static position inside a flex/grid parent. */
    staticAlignment(box, container) {
        const cs = container.style;
        const cw = container.contentWidthWithScrollbar();
        const ch = Math.max(0, container.height - this.pbHeight(container));
        const outerW = box.width + box.margin[1] + box.margin[3];
        const outerH = box.height + box.margin[0] + box.margin[2];
        // Centred, the browser's static position is the middle of the content
        // box (truncated to a layout unit), and the box is centred in the
        // largest area around it that fits: twice that half
        const place = (value, size, outer) => {
            switch (value) {
                case 'center': case 'space-around': case 'space-evenly': return this.unit((2 * this.unit(size / 2) - outer) / 2);
                case 'flex-end': case 'end': case 'right': case 'self-end': return size - outer;
                default: return 0;
            }
        };
        const selfAlign = box.style.alignSelf && box.style.alignSelf !== 'auto' ? box.style.alignSelf : cs.alignItems;
        if (container.inner === 'grid') {
            const justify = box.style.justifySelf && box.style.justifySelf !== 'auto' ? box.style.justifySelf : cs.justifyItems;
            return [place(justify, cw, outerW), place(selfAlign, ch, outerH)];
        }
        const row = !String(cs.flexDirection || 'row').startsWith('column');
        const main = row ? place(cs.justifyContent, cw, outerW) : place(cs.justifyContent, ch, outerH);
        const cross = row ? place(selfAlign, ch, outerH) : place(selfAlign, cw, outerW);
        return row ? [main, cross] : [cross, main];
    }

    // ── Final coordinates ───────────────────────────────────────────────────

    /** A relatively positioned box's offset ([0, 0] otherwise; finalize gives sticky boxes theirs). */
    relativeOffset(box) {
        const s = box.style;
        if (s.position !== 'relative') return [0, 0];
        const cbW = box.parent?.layoutContentWidth ?? box.parent?.contentWidth ?? 0;
        const left = this.len(s.left, cbW);
        const right = this.len(s.right, cbW);
        // Percentages of top and bottom take the containing block's height
        // where it is definite (its last layout request had one), else act as auto
        const cbH = box.layoutKey?.cb?.height ?? null;
        const top = this.len(s.top, cbH);
        const bottom = this.len(s.bottom, cbH);
        return [left != null ? left : right != null ? -right : 0, top != null ? top : bottom != null ? -bottom : 0];
    }

    /**
     * The offset of sticky box `box`, whose border box (`size`: its width
     * and height) sits at (x, y) in scene coordinates in normal flow, as
     * Chrome 155 computes it (measured): it sticks within the content box of
     * its nearest scroll container, less the scrollbars shown, at that
     * container's scroll position (the stickyViewport when the scene has
     * none; box.stickyScroller records which), its insets pushing it in
     * (percentages of that content box), while its margin box stays inside
     * its containing block's content box (a table part's table; a scroll
     * container's content box spans its scrollable overflow). Right goes
     * before left and bottom before top, each limited on its own, so top and
     * left win. No offset while the box is inside those edges.
     */
    stickyOffset(box, x, y, size) {
        const s = box.style;
        box.stickyScroller = null;
        box.stickyInsets = !(s.top === 'auto' && s.bottom === 'auto' && s.left === 'auto' && s.right === 'auto');
        if (!box.stickyInsets) return NO_OFFSET;
        let scroller = null;
        for (let b = box.outOfFlow ? box.cb : box.parent; b && !b.isHost; b = b.outOfFlow ? b.cb : b.parent) {
            if (isScroller(b.style)) { scroller = b; break; }
        }
        box.stickyScroller = scroller;
        let view = this.stickyViewport;
        if (scroller) {
            // Bars shown come off it, a gutter with no bar in it does not
            const shown = scroller.scrollbarShown;
            const barY = shown?.[0] ? this.barThickness(scroller.style, 0) : 0;
            const barX = shown?.[1] ? this.barThickness(scroller.style, 1) : 0;
            view = {
                x: scroller.absX + scroller.border[3] + (scroller.style.direction === 'rtl' ? barY : 0) + scroller.padding[3],
                y: scroller.absY + scroller.border[0] + scroller.padding[0],
                width: Math.max(0, scroller.width - this.bpWidth(scroller) - barY),
                height: Math.max(0, scroller.height - this.bpHeight(scroller) - barX)
            };
        }
        if (!view) return NO_OFFSET;
        const left = this.len(s.left, view.width);
        const right = this.len(s.right, view.width);
        const top = this.len(s.top, view.height);
        const bottom = this.len(s.bottom, view.height);
        // The containing block: the nearest block container (a table part's table)
        let cb = box.parent;
        while (cb && !cb.isHost && ((cb.outer === 'inline' && !cb.atomic) || cb.outer === 'table-part')) cb = cb.parent;
        if (!cb) return NO_OFFSET;
        let cx = (cb.absX ?? 0) + cb.contentX;
        let cy = (cb.absY ?? 0) + cb.contentY;
        let cw = cb.contentWidthWithScrollbar();
        let ch = Math.max(0, cb.height - this.pbHeight(cb));
        if (cb === scroller) {
            cx -= cb.scrollX || 0;
            cy -= cb.scrollY || 0;
            const extent = cb.scrollExtent;
            if (extent) {
                cw = Math.max(cw, extent.width - cb.padding[1] - cb.padding[3]);
                ch = Math.max(ch, extent.height - cb.padding[0] - cb.padding[2]);
            }
        }
        const m = box.margin;
        const x1 = x + size.width;
        const y1 = y + size.height;
        let dx = 0;
        let dy = 0;
        if (right != null) dx += Math.max(Math.min(0, view.x + view.width - right - x1), Math.min(0, cx + m[3] - x));
        if (left != null) dx += Math.min(Math.max(0, view.x + left - x), Math.max(0, cx + cw - m[1] - x1));
        if (bottom != null) dy += Math.max(Math.min(0, view.y + view.height - bottom - y1), Math.min(0, cy + m[0] - y));
        if (top != null) dy += Math.min(Math.max(0, view.y + top - y), Math.max(0, cy + ch - m[2] - y1));
        return dx || dy ? [dx, dy] : NO_OFFSET;
    }

    /**
     * Turn relative coordinates into scene coordinates and compute per-box
     * transforms (affine, scene space), clip rectangles and painted bounds
     * (box.bounds: the subtree's [x0, y0, x1, y1], or null).
     *
     * `incremental` (the layout kept boxes from the last pass): a kept
     * subtree is not walked again when no box in it was touched this pass,
     * its origin, position, relative offset, parent transform and clip equal
     * the last pass's, no scroll offset in it moved and nothing in it is
     * positioned against a box above it. Its boxes are copied from the last
     * pass's order and its bounds reused. Every box walked gets
     * `changed` for the display list (the walk reaches a box only through
     * its ancestors, so they are walked too).
     */
    finalize(host, incremental = false) {
        const pass = this.pass;
        const view = this.viewport;
        const last = incremental && this.lastOrder && this.finalView?.width === view.width && this.finalView?.height === view.height
            ? this.lastOrder : null;
        if (last) this.noteScrolls();
        const changed = paintClock.frame + 1;
        const order = [];
        const scrollers = [];
        const visit = (box, originX, originY, matrix, clip, depth) => {
            let [rx, ry] = box.isHost ? NO_OFFSET : this.relativeOffset(box);
            // Inline boxes live in their IFC container's coordinates
            const inline = box.outer === 'inline' && !box.atomic && box.fragments?.length;
            const ifc = inline ? box.ifc : null;
            const ox = inline ? (ifc.absX ?? 0) - (ifc.scrollX || 0) : originX;
            const oy = inline ? (ifc.absY ?? 0) - (ifc.scrollY || 0) : originY;
            const lx = inline ? box.fragments[0].x : box.x;
            const ly = inline ? box.fragments[0].y : box.y;
            // A sticky box's offset follows its scroll container's scroll position
            if (box.style.position === 'sticky' && !box.isHost) [rx, ry] = this.stickyOffset(box, ox + lx, oy + ly, inline ? box.fragments[0] : box);
            if (last && box.dirtyPass !== pass && last[box.orderIndex] === box && box.refUp === 0
                && !(inline && ifc.touchedPass === pass)
                && ox === box.inX && oy === box.inY && lx === box.inLX && ly === box.inLY && rx === box.inRX && ry === box.inRY
                && sameMatrix(matrix, box.parentMatrix) && sameClip(clip, box.clip)) {
                // Unchanged: the last pass's coordinates hold for the whole subtree
                for (let i = box.orderIndex, end = i + box.orderCount; i < end; i++) {
                    const b = last[i];
                    b.orderIndex = order.length;
                    order.push(b);
                    if (b.scroller) scrollers.push(b);
                }
                return;
            }
            box.inX = ox;
            box.inY = oy;
            box.inLX = lx;
            box.inLY = ly;
            box.inRX = rx;
            box.inRY = ry;
            box.depth = depth;
            box.changed = changed;
            box.selfChanged = changed;
            box.absX = ox + lx + rx;
            box.absY = oy + ly + ry;
            if (inline) {
                const f0 = box.fragments[0];
                box.width = f0.width;
                box.height = f0.height;
                box.absFragments = box.fragments.map((f) => ({ ...f, x: ox + f.x + rx, y: oy + f.y + ry }));
            }
            let world = matrix;
            const s = box.style;
            if (s.transform && s.transform !== 'none') {
                const m = parseTransform(s.transform, box.width, box.height, { fontSize: s.fontSize, rootFontSize: 16, vw: view.width, vh: view.height });
                if (m) {
                    const [tx, ty] = parseTransformOrigin(s.transformOrigin, box.width, box.height);
                    const ox = box.absX + tx;
                    const oy = box.absY + ty;
                    const local = multiplyAffine(multiplyAffine([1, 0, 0, 1, ox, oy], m), [1, 0, 0, 1, -ox, -oy]);
                    world = matrix ? multiplyAffine(matrix, local) : local;
                }
            }
            // Same values as last pass: keep the object, so children compare by reference
            if (world !== box.matrix && world && sameMatrix(world, box.matrix)) world = box.matrix;
            box.matrix = world;
            box.parentMatrix = matrix;
            box.clip = clip;
            box.orderIndex = order.length;
            order.push(box);
            box.scroller = isScrollContainer(s) && !box.isHost;
            if (box.scroller) scrollers.push(box);
            const scroll = box.scroller ? this.scrollOffsets(box) : null;
            box.scrollX = this.scrollUnit(scroll?.x);
            box.scrollY = this.scrollUnit(scroll?.y);
            if (box.runs) {
                // A scroll container's own text moves with its scroll position
                for (const run of box.runs) {
                    run.absX = box.absX + run.x - box.scrollX;
                    run.absY = box.absY + run.top - box.scrollY;
                    run.absBaseline = box.absY + run.baseline - box.scrollY;
                }
            }
            // Clip for descendants
            let childClip = clip;
            if (box.scroller) {
                // Content is clipped to the padding box inside the scrollbars and gutters
                const bars = box.scrollbar || NO_BARS;
                const pad = {
                    x: box.absX + box.border[3] + (bars[2] || 0),
                    y: box.absY + box.border[0],
                    width: Math.max(0, box.width - box.border[1] - box.border[3] - bars[0] - (bars[2] || 0)),
                    height: Math.max(0, box.height - box.border[0] - box.border[2] - bars[1])
                };
                const r = world ? transformRectBounds(world, pad) : pad;
                childClip = intersect(clip, r);
                box.clipsChildren = true;
                // Rounded clip: the padding box follows the inner border radius
                const outer = resolveRadii(box);
                const b = box.border;
                const own = [
                    Math.max(0, outer[0] - Math.max(b[0], b[3])), Math.max(0, outer[1] - Math.max(b[0], b[1])),
                    Math.max(0, outer[2] - Math.max(b[2], b[1])), Math.max(0, outer[3] - Math.max(b[2], b[3]))
                ];
                // Each corner of the intersection is rounded by the clip that
                // makes both of its edges; a corner where the box's edge meets
                // the outer clip's edge is square
                const edges = (rect) => {
                    const near = (u, v) => Math.abs(u - v) < 1e-3;
                    return [near(childClip.y, rect.y), near(childClip.x + childClip.width, rect.x + rect.width),
                        near(childClip.y + childClip.height, rect.y + rect.height), near(childClip.x, rect.x)];
                };
                const ownEdges = edges(r);
                const clipEdges = edges(clip);
                const corner = (i, radii, at) => (radii && at[i] && at[(i + 3) % 4] ? radii[i] : 0);
                childClip.radii = own.map((_, i) => Math.max(corner(i, own, ownEdges), corner(i, clip.radii, clipEdges)));
                // A corner that lost a radius there may still show part of the
                // arc it cut: that rounded clip is kept as a second one (the
                // box's own first, else the outer clip's), applied on top
                const lost = (radii, at) => radii && radii.some((v, i) => v > 0 && !(at[i] && at[(i + 3) % 4]) && (at[i] || at[(i + 3) % 4]));
                const rounded = lost(own, ownEdges) ? { x: r.x, y: r.y, width: r.width, height: r.height, radii: own }
                    : lost(clip.radii, clipEdges) ? { x: clip.x, y: clip.y, width: clip.width, height: clip.height, radii: clip.radii }
                        : clip.rounded;
                const kept = rounded && roundedCorners(rounded, childClip);
                if (kept) childClip.rounded = kept;
                if (sameClip(childClip, box.childClip)) childClip = box.childClip;
            }
            box.childClip = childClip;
            // Painted bounds of the box, then of its subtree
            let x0 = Infinity;
            let y0 = Infinity;
            let x1 = -Infinity;
            let y1 = -Infinity;
            if (!box.isHost && s.visibility !== 'hidden') {
                let r = { x: box.absX, y: box.absY, width: box.width, height: box.height };
                if (world) r = transformRectBounds(world, r);
                if (clip && clip.width < 1e8) {
                    const cx = Math.max(r.x, clip.x);
                    const cy = Math.max(r.y, clip.y);
                    r = { x: cx, y: cy, width: Math.max(0, Math.min(r.x + r.width, clip.x + clip.width) - cx), height: Math.max(0, Math.min(r.y + r.height, clip.y + clip.height) - cy) };
                }
                if (r.width > 0 && r.height > 0) {
                    const spread = Math.max(0, ...s.boxShadow.map((sh) => sh.blur * 1.5 + Math.abs(sh.spread) + Math.max(Math.abs(sh.x), Math.abs(sh.y))));
                    x0 = r.x - spread;
                    y0 = r.y - spread;
                    x1 = r.x + r.width + spread;
                    y1 = r.y + r.height + spread;
                }
            }
            let maxX = 0;
            let maxY = 0;
            // How many levels above this box its subtree reaches for a containing block
            let refUp = 0;
            for (const child of box.children) {
                if (child.isText) continue;
                if (child.outOfFlow) {
                    const cb = child.cb || host;
                    const cbClip = cb === box ? childClip : (cb.childClip || INFINITE_CLIP);
                    // (A scroll container's positioned boxes scroll with its content)
                    visit(child, (cb.absX ?? 0) - (cb.scrollX || 0), (cb.absY ?? 0) - (cb.scrollY || 0), cb.matrix ?? null, cbClip, depth + 1);
                    // The host never moves; any other box above this one might
                    if (!cb.isHost) refUp = Math.max(refUp, depth - cb.depth);
                } else {
                    // Atomic inlines inside an inline box sit in their IFC container's coordinates
                    const origin = child.atomic && child.ifc && child.ifc !== box ? child.ifc : box;
                    visit(child, origin.absX - origin.scrollX, origin.absY - origin.scrollY, world, childClip, depth + 1);
                    if (child.outer !== 'inline' || child.atomic) {
                        maxX = Math.max(maxX, child.x + child.width + child.margin[1]);
                        maxY = Math.max(maxY, child.y + child.height + child.margin[2]);
                    }
                }
                refUp = Math.max(refUp, child.refUp - 1);
                const b = child.bounds;
                if (b) {
                    if (b[0] < x0) x0 = b[0];
                    if (b[1] < y0) y0 = b[1];
                    if (b[2] > x1) x1 = b[2];
                    if (b[3] > y1) y1 = b[3];
                }
            }
            // A sticky box follows its scroll container's size and its containing
            // block's, whatever keeps its own position the same
            if (s.position === 'sticky' && !box.isHost && box.stickyInsets) {
                const scroller = box.stickyScroller;
                refUp = Math.max(refUp, scroller ? depth - scroller.depth : this.stickyViewport ? depth : 0);
            }
            box.refUp = refUp;
            box.orderCount = order.length - box.orderIndex;
            box.bounds = x0 <= x1 ? [x0, y0, x1, y1] : null;
            if (box.runs) {
                for (const run of box.runs) maxX = Math.max(maxX, run.x + run.width);
            }
            if (box.lines?.length) maxY = Math.max(maxY, box.lines[box.lines.length - 1].top + box.lines[box.lines.length - 1].height);
            // A scroll container's scrollable overflow was measured as it was laid out
            const extent = box.scrollExtent;
            box.scrollWidth = extent ? extent.width : Math.max(box.width - box.border[1] - box.border[3], maxX - box.border[3] + box.padding[1]);
            box.scrollHeight = extent ? extent.height : Math.max(box.height - box.border[0] - box.border[2], maxY - box.border[0] + box.padding[2]);
        };
        host.absX = 0;
        host.absY = 0;
        visit(host, 0, 0, null, INFINITE_CLIP, 0);
        host.order = order;
        this.lastOrder = order;
        this.scrollers = scrollers;
        this.finalView = { width: view.width, height: view.height };
        return order;
    }

    /**
     * A scroll offset read from the page, back on its layout unit: scrollTop
     * is single precision (50.4000015 at 125%), which is enough to tip a box
     * sitting on half a device pixel the other way when it is snapped.
     */
    scrollUnit(px) {
        return px ? roundUnit(px, this.zoom) : 0;
    }

    /** Touch the scroll containers whose scroll offset moved since the last pass. */
    noteScrolls() {
        for (const box of this.scrollers) {
            const scroll = this.scrollOffsets(box);
            if (this.scrollUnit(scroll?.x) !== box.scrollX || this.scrollUnit(scroll?.y) !== box.scrollY) this.touch(box);
        }
    }
}

/**
 * Used corner radii [tl, tr, br, bl] of a box's border box in px, with
 * percentages resolved and the CSS scale-down when adjacent radii overlap.
 * Elliptical corners use the smaller of their two radii.
 */
export function resolveRadii(box, width = box.width, height = box.height) {
    const corners = box.style.borderRadius || [];
    const r = [0, 1, 2, 3].map((i) => {
        const [h, v] = corners[i] || [{ px: 0 }, { px: 0 }];
        const rx = resolveLength(h, { percentBase: width }) ?? 0;
        const ry = resolveLength(v, { percentBase: height }) ?? 0;
        return [Math.max(0, rx), Math.max(0, ry)];
    });
    let f = 1;
    const fit = (sum, side) => { if (sum > side && sum > 0) f = Math.min(f, side / sum); };
    fit(r[0][0] + r[1][0], width);
    fit(r[3][0] + r[2][0], width);
    fit(r[0][1] + r[3][1], height);
    fit(r[1][1] + r[2][1], height);
    return r.map(([rx, ry]) => Math.min(rx, ry) * f);
}

/** Axis-aligned bounds of a rect transformed by an affine matrix. */
export function transformRectBounds(m, rect) {
    const pts = [
        applyAffine(m, rect.x, rect.y),
        applyAffine(m, rect.x + rect.width, rect.y),
        applyAffine(m, rect.x, rect.y + rect.height),
        applyAffine(m, rect.x + rect.width, rect.y + rect.height)
    ];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

// Content width that leaves room for the vertical scrollbar and gutters
LayoutBox.prototype.contentWidthWithScrollbar = function contentWidthWithScrollbar() {
    return Math.max(0, this.width - this.border[1] - this.border[3] - this.padding[1] - this.padding[3]
        - (this.scrollbar?.[0] || 0) - (this.scrollbar?.[2] || 0));
};

export { inheritedStyleFromHost, MarginSet };
