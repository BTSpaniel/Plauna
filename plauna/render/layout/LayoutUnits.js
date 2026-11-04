// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * LayoutUnits - the units the browser lays a page out in.
 *
 * Chrome applies display scaling and browser zoom as zoom: every CSS length
 * is multiplied by the zoom (devicePixelRatio), layout runs in device pixels
 * in steps of 1/64, text is shaped at the scaled font size with its ascent,
 * descent and half-leading rounded there, and border and outline widths snap
 * to whole device pixels. getBoundingClientRect() divides by the zoom again.
 * Plauna lays out in CSS px and rounds the way the browser does in its
 * units: layoutZoom() is the factor, the helpers below round in its pixels.
 * At zoom 1 they reduce to rounding in CSS px.
 *
 * Device-scale emulation (DevTools, Playwright's deviceScaleFactor) scales
 * only the paint and keeps layout in CSS px. A 0.1px border tells the two
 * apart: it snaps to one layout pixel, which is 1 / zoom CSS px.
 */

let probedRatio = null;
let probedBodyZoom = null;
let probedZoom = 1;

/**
 * The factor between CSS px and the browser's layout pixels (1 without a
 * document). CSS zoom on the body (the OS's UI scale) zooms layout the same
 * way, and the probe sits in the body: a new body zoom probes again.
 */
export function layoutZoom() {
    if (typeof document === 'undefined' || !document.body) return 1;
    const ratio = globalThis.devicePixelRatio || 1;
    const bodyZoom = document.body.currentCSSZoom || 1;
    if (ratio === probedRatio && bodyZoom === probedBodyZoom) return probedZoom;
    const probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:absolute;left:-10000px;top:0;width:0;height:0;visibility:hidden;border:0 solid;border-top-width:0.1px;';
    document.body.appendChild(probe);
    const px = parseFloat(getComputedStyle(probe).borderTopWidth);
    probe.remove();
    probedRatio = ratio;
    probedBodyZoom = bodyZoom;
    // The computed width is 1 / zoom to six digits: take the exact factor when one agrees
    const exact = [ratio * bodyZoom, bodyZoom, ratio].find((zoom) => Math.abs(px * zoom - 1) < 1e-3);
    probedZoom = px > 0 ? (exact ?? 1 / px) : 1;
    return probedZoom;
}

/**
 * The CSS zoom `element` is laid out under (1 without any): element rects
 * read under it are that many times their CSS px.
 */
export function cssZoomOf(element) {
    return element?.currentCSSZoom || 1;
}

/**
 * A border or outline width as the browser uses it: at least one layout
 * pixel, otherwise floored to whole layout pixels (CSS "snap as a border
 * width"). 0 stays 0.
 */
export function snapBorderWidth(px, zoom = 1) {
    if (!(px > 0)) return 0;
    const units = px * zoom;
    return units < 1 ? 1 / zoom : Math.floor(units + 1 / 1024) / zoom;
}

// Float error allowed when a value already on a layout unit is converted again
const SLACK = 1e-6;

/**
 * A length as a layout unit: truncated toward zero to 1/64 of a layout
 * pixel, as the browser stores lengths and divides.
 */
export function truncUnit(px, zoom = 1) {
    const units = px * zoom * 64;
    if (!Number.isFinite(units)) return px;
    return (units < 0 ? -Math.floor(SLACK - units) : Math.floor(units + SLACK)) / (zoom * 64);
}

/**
 * `pct` percent of `base` (plus `px`, a calc() length's px part) as a layout
 * unit, worked in single precision as the browser stores and resolves
 * percentages: the base times the float percentage over 100, or for calc()
 * px + pct / 100 * base, then truncated. 33.3333333% of 900px is
 * 299.984375px, not 300px.
 */
export function percentUnit(pct, base, zoom = 1, px = null) {
    const max = Math.fround(base * zoom);
    const value = px == null
        ? Math.fround(Math.fround(max * Math.fround(pct)) / 100)
        : Math.fround(Math.fround(px * zoom) + Math.fround(Math.fround(Math.fround(pct) / 100) * max));
    return truncUnit(value / zoom, zoom);
}

/** Rounded up to a layout unit, as the browser snaps shaped text widths. */
export function ceilUnit(px, zoom = 1) {
    const units = px * zoom * 64;
    if (!Number.isFinite(units)) return px;
    return Math.ceil(units - SLACK) / (zoom * 64);
}

/** Rounded to the nearest layout unit. */
export function roundUnit(px, zoom = 1) {
    const units = px * zoom * 64;
    if (!Number.isFinite(units)) return px;
    return Math.round(units) / (zoom * 64);
}

/**
 * Hands `px` out in `buckets` shares of whole layout units, as the browser
 * distributes free space (Blink's LayoutUnitDiffuser): every share is the
 * truncated quotient, and the remainder goes one unit at a time to shares
 * spread along a Bresenham line. A share asked for past the last is 0.
 */
export class UnitDiffuser {
    constructor(px, buckets, zoom = 1) {
        this.scale = zoom * 64;
        const raw = Math.round(truncUnit(px, zoom) * this.scale);
        this.count = buckets > 0 ? buckets : 0;
        this.base = this.count ? Math.trunc(raw / buckets) : 0;
        this.x = 0;
        this.y = buckets;
        this.dx = this.count ? (raw % buckets) * 2 : 0;
        this.dy = buckets * 2;
    }

    /** The next share, in px. */
    next() {
        if (!this.count) return 0;
        this.count--;
        this.x += this.dx;
        if (this.x >= this.y) {
            this.y += this.dy;
            return (this.base + 1) / this.scale;
        }
        return this.base / this.scale;
    }
}
