// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Rasterizer - turns content the GPU cannot draw from geometry into atlas
 * entries: text runs (drawn by the browser's font engine, so shaping,
 * kerning, ligatures and colour emoji match DOM text), gradient strips,
 * SVG elements, images and native form-control sprites.
 *
 * Text is rasterized at device pixel ratio in the run's own colour and its
 * coverage tinted on the GPU: the browser tunes glyph coverage (gamma and
 * contrast) to the text colour, so a mask drawn in another colour would
 * read heavier or lighter than DOM text. Runs with emoji keep their colours.
 * SVG and images decode asynchronously and call `onReady` so the surface
 * repaints. A raster a full atlas has no room for asks for a few repaints
 * while eviction can make room (placed()).
 */

import { colorToCss, normalizeStops } from '../css/CssValues.js';
import { canvasKerning } from '../text/TextShaper.js';

const EMOJI = /\p{Extended_Pictographic}/u;

// Frames a raster a full atlas had no room for is asked for again: the atlas
// drops an entry no frame has used for EVICT_AFTER_FRAMES (2, GpuPainter.js)
// frames, so by then whatever was idle when it failed can make room
const RETRY_FRAMES = 2;

function makeCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(width));
    canvas.height = Math.max(1, Math.ceil(height));
    return canvas;
}

export class Rasterizer {
    /**
     * @param {AtlasCache} atlas
     * @param {TextShaper} shaper
     * @param {() => void} onReady called when async content finishes loading
     */
    constructor(atlas, shaper, onReady = () => {}) {
        this.atlas = atlas;
        this.shaper = shaper;
        this.onReady = onReady;
        this.scratch = makeCanvas(256, 64);
        this.ctx = this.scratch.getContext('2d', { willReadFrequently: false });
        this.pending = new Map();
        this.failed = new Set();
        // Rasters a full atlas had no room for, by key: { since } (the atlas
        // frame it first failed in) and `kept`, a decoded raster ({ canvas,
        // w, h, meta }) that is placed from here instead of decoded again
        this.retries = new Map();
        this.prunedAt = -1;
        this.repaintAsked = false;
        // Part of every text key: a font that finished loading draws the same
        // font string differently, so text rastered before it is not reused
        this.fontGeneration = 0;
    }

    /**
     * Atlas entry for a text run, with offsets (scene px) from the run's left
     * edge and baseline to the raster's top-left. `phase` (device px, below
     * one) is where the run starts inside its first device pixel: glyphs are
     * drawn from there, so they land on the pixels DOM text uses.
     */
    text(text, style, dpr, color = null, phase = 0, blur = 0) {
        // A blurred text-shadow: only the shadow of the run, drawn by the
        // canvas (shadowBlur is 2 sigma, as a CSS shadow's blur radius is)
        const shadow = blur > 0;
        const emoji = !shadow && EMOJI.test(text);
        const font = this.shaper.font(style);
        const spacing = style.letterSpacing || 0;
        const ink = color ? colorToCss([color[0], color[1], color[2], 1]) : '#ffffff';
        const kerning = canvasKerning(style);
        const key = `t${this.fontGeneration}|${dpr}|${font}|${spacing}|${kerning}|${ink}|${phase}|${shadow ? `b${blur}|` : ''}${text}`;
        const hit = this.lookup(key);
        if (hit) return hit;
        const ctx = this.ctx;
        // The shaper's font: text with OpenType features (tabular figures...)
        // is set in the FontFace that carries them, as it was measured
        const scaledFont = this.shaper.font(style, dpr);
        ctx.font = scaledFont;
        if ('fontKerning' in ctx) ctx.fontKerning = kerning;
        if ('letterSpacing' in ctx) ctx.letterSpacing = `${spacing * dpr}px`;
        const m = ctx.measureText(text);
        // The blur spreads about 3 sigma past the glyphs
        const pad = shadow ? Math.ceil(blur * dpr * 1.5) + 1 : 0;
        const left = Math.ceil(Math.max(0, m.actualBoundingBoxLeft || 0)) + 1 + pad;
        const right = Math.ceil(Math.max(m.width, m.actualBoundingBoxRight || 0) + phase) + 1 + pad;
        const ascent = Math.ceil(Math.max(m.fontBoundingBoxAscent || 0, m.actualBoundingBoxAscent || 0)) + 1 + pad;
        const descent = Math.ceil(Math.max(m.fontBoundingBoxDescent || 0, m.actualBoundingBoxDescent || 0)) + 1 + pad;
        const w = left + right;
        const h = ascent + descent;
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
        // A run longer than an atlas page is drawn squeezed into one on that
        // axis and stretched back over its box (fitRaster)
        const [tw, th] = this.fitRaster(w, h);
        const sx = tw / w;
        const sy = th / h;
        // Drawn into the atlas's shared staging canvas (clipped to w x h, state
        // restored after), which is uploaded once for the frame
        return this.placed(key, this.atlas.addDrawn(key, tw, th, { offsetX: -left / dpr, offsetY: -ascent / dpr, width: w / dpr, height: h / dpr, color: emoji }, (c, y) => {
            c.font = scaledFont;
            if ('fontKerning' in c) c.fontKerning = kerning;
            if ('letterSpacing' in c) c.letterSpacing = `${spacing * dpr}px`;
            c.textBaseline = 'alphabetic';
            c.fillStyle = ink;
            let top = y;
            if (sx < 1 || sy < 1) {
                c.translate(0, y);
                c.scale(sx, sy);
                top = 0;
            }
            if (!shadow) {
                c.fillText(text, left + phase, top + ascent);
                return;
            }
            // The glyphs land far left of the canvas; their shadow, offset
            // back by as much, lands in the slot (shadows are not scaled by
            // the transform: device pixels)
            const away = c.canvas.width / sx + w + 64;
            c.shadowColor = ink;
            c.shadowBlur = blur * dpr * Math.min(sx, sy);
            c.shadowOffsetX = away * sx;
            c.fillText(text, left + phase - away, top + ascent);
        }));
    }

    /**
     * The largest raster side an atlas page places: its size less the
     * transparent padding on both sides of each region.
     */
    get maxRaster() {
        const padding = this.atlas.pages?.[0]?.atlas?.padding ?? 2;
        return Math.max(1, this.atlas.size - 2 * padding);
    }

    /**
     * A raster's texel size for w x h device pixels: its own, except on an
     * axis longer than an atlas page places (maxRaster), which takes the
     * page's length; the raster is drawn squeezed on that axis and stretched
     * back over its box when painted. Placing it whole beats asking every
     * frame for a raster no page can hold (it was never drawn), but the
     * browser paints such content at full resolution in tiles: squeezed, it
     * shows softer along that axis, and a long squeeze is unreadable (a
     * 12px Consolas line of about 8500 CSS px, squeezed to 24 %, is a grey
     * smear at 1x as at 2x). Known gap: a run that long needs splitting where
     * it is emitted (DisplayList.emitText), ideally into the slices its clip shows.
     */
    fitRaster(w, h) {
        const limit = this.maxRaster;
        return [Math.min(Math.max(1, Math.ceil(w)), limit), Math.min(Math.max(1, Math.ceil(h)), limit)];
    }

    /**
     * `entry`, the atlas entry made for `key`, or null when the atlas had no
     * room (every page full, nothing idle long enough to evict). Then a
     * repaint is asked for while eviction can still make room: what no frame
     * used by the frame this first failed in can be dropped RETRY_FRAMES
     * later. After that nothing more is asked for (a full atlas of rasters
     * in use must not repaint every frame) until a repaint asks for it again
     * after a pause. `kept` ({ canvas, w, h, meta }) is a decoded raster the
     * retries place (place()) instead of decoding it again.
     */
    placed(key, entry, kept = null) {
        const retry = this.retries.get(key);
        if (entry) {
            if (retry) this.retries.delete(key);
            return entry;
        }
        const frame = this.atlas.frame;
        if (typeof frame !== 'number') return null;
        if (this.prunedAt !== frame) this.prune();
        // Retries follow frame after frame; a miss after a pause starts anew
        const since = retry && frame - retry.last <= 1 ? retry.since : frame;
        if (frame - since < RETRY_FRAMES) {
            this.retries.set(key, { since, last: frame, kept: kept ?? retry?.kept ?? null });
            this.askRepaint();
        } else {
            this.retries.delete(key);
        }
        return null;
    }

    /** The atlas entry for `key`, or undefined; every raster is looked up here, so stale retries are forgotten once a frame. */
    lookup(key) {
        if (this.retries.size && this.prunedAt !== this.atlas.frame) this.prune();
        return this.atlas.get(key);
    }

    /**
     * Forgets the retries that ended or were not asked for again, with their
     * kept rasters (up to a page each). It runs on the first raster asked for
     * in a frame, so a raster that left the scene while it waited for room is
     * dropped RETRY_FRAMES + 1 frames after its last miss.
     */
    prune() {
        const frame = this.atlas.frame;
        if (typeof frame !== 'number') return;
        this.prunedAt = frame;
        for (const [other, { last }] of this.retries) {
            if (frame - last > RETRY_FRAMES) this.retries.delete(other);
        }
    }

    /** A decoded raster kept for a retry (placed()), placed now: its entry or null; undefined when none is kept. */
    place(key) {
        const kept = this.retries.get(key)?.kept;
        if (!kept) return undefined;
        return this.placed(key, this.atlas.add(key, kept.canvas, kept.w, kept.h, kept.meta), kept);
    }

    /** One repaint for any number of rasters asked for again, after the frame this runs in. */
    askRepaint() {
        if (this.repaintAsked) return;
        this.repaintAsked = true;
        queueMicrotask(() => {
            this.repaintAsked = false;
            this.onReady();
        });
    }

    /** Web fonts finished loading: raster text again (old entries age out of the atlas). */
    fontsChanged() {
        this.fontGeneration++;
    }

    /**
     * 256-texel gradient strip for stops along a gradient line of `length`
     * px, as { entry, start, period }: the strip spans start..start + period
     * of the line (fractions of it). That is 0..1, or for a repeating
     * gradient one period, from its first stop to its last, which the shader
     * repeats. A repeating gradient with no period paints its last colour,
     * as Chrome does. Stops past either end of a 0..1 strip are cut to it,
     * with the colour the line has there. Rows 0-1 hold the colours, texel i
     * the colour at (i + 0.5) / 256. Rows 2-3 mark hard stops, which the
     * shader does not blend across: texel i is red when one lies between its
     * centre and the next, green and blue give where (16 bits of the way).
     * `space` is the colour space it blends in ('srgb' or 'oklab').
     */
    gradient(stops, length, repeating = false, space = 'srgb') {
        let normalized = normalizeStops(stops, length);
        let start = 0;
        let period = 1;
        if (repeating) {
            const first = normalized[0].pos;
            const span = normalized[normalized.length - 1].pos - first;
            if (span > 1e-7) {
                start = first;
                period = span;
                normalized = normalized.map((stop) => ({ color: stop.color, pos: (stop.pos - first) / span }));
            } else {
                const last = normalized[normalized.length - 1].color;
                normalized = [{ color: last, pos: 0 }, { color: last, pos: 1 }];
            }
        } else {
            normalized = cutToLine(normalized);
        }
        const key = `g|${space}|${normalized.map((s) => `${colorToCss(s.color)}@${s.pos.toFixed(4)}`).join(',')}`;
        const hit = this.lookup(key);
        if (hit) return { entry: hit, start, period };
        const canvas = makeCanvas(256, 4);
        const c = canvas.getContext('2d');
        const g = c.createLinearGradient(0, 0, 256, 0);
        for (const stop of premultiplied(normalized, space)) g.addColorStop(Math.min(1, Math.max(0, stop.pos)), colorToCss(stop.color));
        c.fillStyle = g;
        c.fillRect(0, 0, 256, 2);
        for (let k = 1; k < normalized.length; k++) {
            const a = normalized[k - 1];
            const b = normalized[k];
            if (b.pos - a.pos > 1e-6 || colorToCss(a.color) === colorToCss(b.color)) continue;
            const u = b.pos * 256 - 0.5;
            const i = Math.floor(u);
            if (i < 0 || i > 254) continue;
            const place = Math.min(65535, Math.round((u - i) * 65536));
            c.fillStyle = `rgb(255, ${place >> 8}, ${place & 255})`;
            c.fillRect(i, 2, 1, 2);
        }
        return { entry: this.placed(key, this.atlas.add(key, canvas, 256, 4, {})), start, period };
    }

    /**
     * A radial or conic gradient layer drawn into a width x height tile (scene
     * px) by the canvas, which follows the same colour-stop rules as CSS.
     */
    cssGradient(layer, width, height, dpr) {
        const w = Math.max(1, Math.ceil(width * dpr));
        const h = Math.max(1, Math.ceil(height * dpr));
        const key = `c|${w}x${h}|${JSON.stringify(layer)}`;
        const hit = this.lookup(key);
        if (hit) return hit;
        // A tile larger than an atlas page places is drawn squeezed to fit it (fitRaster)
        const [tw, th] = this.fitRaster(w, h);
        const canvas = makeCanvas(tw, th);
        const c = canvas.getContext('2d');
        c.scale(tw / width, th / height);
        const cx = resolveAxis(layer.at.x, width);
        const cy = resolveAxis(layer.at.y, height);
        if (layer.type === 'conic') {
            // CSS starts at 12 o'clock, the canvas at 3 o'clock
            const g = c.createConicGradient((layer.from - 90) * Math.PI / 180, cx, cy);
            addStops(g, layer.stops, 1, layer.repeating, 1, layer.space);
            c.fillStyle = g;
            c.fillRect(0, 0, width, height);
        } else {
            const [rx, ry] = radialRadii(layer, cx, cy, width, height);
            if (rx <= 0 || ry <= 0) return null;
            // The ray goes on past the ending shape: a repeating gradient
            // repeats there, and a stop placed past it keeps its place
            const reach = layer.repeating
                ? Math.max(1, Math.ceil(Math.hypot(Math.max(cx, width - cx) / rx, Math.max(cy, height - cy) / ry)))
                : Math.max(1, ...normalizeStops(layer.stops, rx).map((stop) => stop.pos));
            c.translate(cx, cy);
            c.scale(1, ry / rx);
            const g = c.createRadialGradient(0, 0, 0, 0, 0, rx * reach);
            addStops(g, layer.stops, rx, layer.repeating, reach, layer.space);
            c.fillStyle = g;
            c.fillRect(-cx, -cy * rx / ry, width, height * rx / ry);
        }
        return this.placed(key, this.atlas.add(key, canvas, tw, th, {}));
    }

    /** Natural size of an image URL once loaded ({ width, height }), else null. */
    imageSize(url) {
        this.sizes ??= new Map();
        const known = this.sizes.get(url);
        if (known) return known.width ? known : null;
        const record = { width: 0, height: 0 };
        this.sizes.set(url, record);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = url;
        img.decode().then(() => {
            record.width = img.naturalWidth;
            record.height = img.naturalHeight;
            this.onReady();
        }).catch(() => { record.failed = true; });
        return null;
    }

    /**
     * Sprite drawn by `draw(ctx, w, h)` at device pixels, cached by key.
     */
    sprite(key, width, height, dpr, draw) {
        const fullKey = `s|${dpr}|${width}x${height}|${key}`;
        const hit = this.lookup(fullKey);
        if (hit) return hit;
        const w = Math.max(1, Math.ceil(width * dpr));
        const h = Math.max(1, Math.ceil(height * dpr));
        const canvas = makeCanvas(w, h);
        const c = canvas.getContext('2d');
        c.scale(dpr, dpr);
        draw(c, width, height);
        return this.placed(fullKey, this.atlas.add(fullKey, canvas, w, h, {}));
    }

    /**
     * SVG element rasterized with its resolved colours; null until decoded.
     * With `placement` ({ matrix, width, height }: a 2D matrix from the SVG's
     * own px to the raster's device pixels, and the raster's size) the vector
     * is drawn through that transform, as the browser draws a scaled or
     * rotated SVG, instead of filling the raster. `viewBox` replaces the
     * SVG's own (stretched to width x height) to show a drawing that reaches
     * past its box.
     */
    svg(element, width, height, dpr, resolveStyle, placement = null, viewBox = null) {
        const markup = serializeSvg(element, width, height, resolveStyle, viewBox);
        const placed = placement ? `|${placement.matrix.map((v) => v.toFixed(4)).join(',')}@${placement.width}x${placement.height}` : '';
        const key = `v|${dpr}|${width}x${height}${placed}|${markup}`;
        const hit = this.lookup(key);
        if (hit) return hit;
        if (this.failed.has(key)) return null;
        // Decoded already, and kept while a full atlas makes room (placed())
        const again = this.place(key);
        if (again !== undefined) return again;
        if (!this.pending.has(key)) {
            const image = new Image();
            const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
            image.src = url;
            const job = image.decode().then(() => {
                const fullW = Math.max(1, Math.ceil(placement ? placement.width : width * dpr));
                const fullH = Math.max(1, Math.ceil(placement ? placement.height : height * dpr));
                // Wider or taller than an atlas page places: the vector is drawn
                // squeezed to fit on that axis (fitRaster)
                const [w, h] = this.fitRaster(fullW, fullH);
                const canvas = makeCanvas(w, h);
                const c = canvas.getContext('2d');
                if (placement) {
                    c.setTransform(w / fullW, 0, 0, h / fullH, 0, 0);
                    c.transform(...placement.matrix);
                    c.drawImage(image, 0, 0, width, height);
                } else {
                    c.drawImage(image, 0, 0, w, h);
                }
                // Repaint once it is placed; a full atlas keeps it while
                // eviction can make room (placed() asks for those repaints)
                if (this.placed(key, this.atlas.add(key, canvas, w, h, {}), { canvas, w, h, meta: {} })) this.onReady();
            }).catch(() => this.failed.add(key)).finally(() => {
                URL.revokeObjectURL(url);
                this.pending.delete(key);
            });
            this.pending.set(key, job);
        }
        return null;
    }

    /**
     * An image element or URL, scaled to its box; null until ready. With
     * `fit` ({ x, y, width, height } px within the box) the image fills that
     * rect instead, as object-fit places it: a vector image is drawn at that
     * size, and what falls outside the box is cut.
     */
    image(source, width, height, dpr, fit = null) {
        const src = typeof source === 'string' ? source : (source.currentSrc || source.src);
        if (!src) return null;
        const w = Math.max(1, Math.ceil(width * dpr));
        const h = Math.max(1, Math.ceil(height * dpr));
        const placed = fit ? `@${[fit.x, fit.y, fit.width, fit.height].map((v) => (v * dpr).toFixed(3)).join(',')}` : '';
        const key = `i|${w}x${h}${placed}|${src}`;
        const hit = this.lookup(key);
        if (hit) return hit;
        if (this.failed.has(key)) return null;
        // Drawn already, and kept while a full atlas makes room (placed())
        const again = this.place(key);
        if (again !== undefined) return again;
        // Wider or taller than an atlas page places: drawn squeezed to fit on that axis (fitRaster)
        const [tw, th] = this.fitRaster(w, h);
        const draw = (img) => {
            try {
                const canvas = makeCanvas(tw, th);
                const c = canvas.getContext('2d');
                // Mipmapped, as the browser scales an <img> down (low leaves aliasing)
                c.imageSmoothingQuality = 'medium';
                if (fit) c.drawImage(img, fit.x * dpr * (tw / w), fit.y * dpr * (th / h), fit.width * dpr * (tw / w), fit.height * dpr * (th / h));
                else c.drawImage(img, 0, 0, tw, th);
                return this.placed(key, this.atlas.add(key, canvas, tw, th, {}), { canvas, w: tw, h: th, meta: {} });
            } catch {
                // Cross-origin images without CORS cannot be uploaded
                this.failed.add(key);
                return null;
            }
        };
        if (typeof source !== 'string' && source.complete && source.naturalWidth) return draw(source);
        if (!this.pending.has(key)) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.src = src;
            this.pending.set(key, img.decode().then(() => { if (draw(img)) this.onReady(); })
                .catch(() => this.failed.add(key))
                .finally(() => this.pending.delete(key)));
        }
        return null;
    }

    /**
     * An SVG image as one raster per shape, laid out as image() lays the
     * whole image out: each is the image with every other shape hidden
     * (a group the browser draws as one, with opacity, a filter, a mask or a
     * clip path, counts as one shape). The browser draws an SVG image in a
     * rounded clip shape by shape, each anti-aliased by the clip (measured),
     * so what lies under a shape shows along the clip's edge; one raster
     * drawn through the clip would hide it. Returns the entries in paint
     * order (`cover` true on a plain rect over the whole image, `solid` on a
     * shape filled with one colour), null while
     * they are made, or false when the source is not an SVG with 1 to
     * MAX_SHAPES shapes (image() draws it then).
     */
    imageShapes(source, width, height, dpr, fit = null) {
        const src = typeof source === 'string' ? source : (source.currentSrc || source.src);
        const shapes = src ? this.svgShapes(src) : false;
        if (!shapes) return shapes;
        const w = Math.max(1, Math.ceil(width * dpr));
        const h = Math.max(1, Math.ceil(height * dpr));
        const placed = fit ? `@${[fit.x, fit.y, fit.width, fit.height].map((v) => (v * dpr).toFixed(3)).join(',')}` : '';
        // Wider or taller than an atlas page places: drawn squeezed to fit on that axis (fitRaster)
        const [tw, th] = this.fitRaster(w, h);
        const entries = [];
        let ready = true;
        shapes.forEach(({ markup, cover, solid }, index) => {
            const key = `is|${w}x${h}${placed}|${index}|${src}`;
            const hit = this.lookup(key);
            if (hit) {
                entries.push(hit);
                return;
            }
            // Drawn already, and kept while a full atlas makes room (placed())
            const again = this.place(key);
            if (again) {
                entries.push(again);
                return;
            }
            ready = false;
            if (again === null || this.pending.has(key) || this.failed.has(key)) return;
            const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
            const img = new Image();
            img.src = url;
            this.pending.set(key, img.decode().then(() => {
                const canvas = makeCanvas(tw, th);
                const c = canvas.getContext('2d');
                // Mipmapped, as the browser scales an <img> down (low leaves aliasing)
                c.imageSmoothingQuality = 'medium';
                if (fit) c.drawImage(img, fit.x * dpr * (tw / w), fit.y * dpr * (th / h), fit.width * dpr * (tw / w), fit.height * dpr * (th / h));
                else c.drawImage(img, 0, 0, tw, th);
                if (this.placed(key, this.atlas.add(key, canvas, tw, th, { cover, solid }), { canvas, w: tw, h: th, meta: { cover, solid } })) this.onReady();
            }).catch(() => this.failed.add(key)).finally(() => {
                URL.revokeObjectURL(url);
                this.pending.delete(key);
            }));
        });
        if (shapes.some((_, index) => this.failed.has(`is|${w}x${h}${placed}|${index}|${src}`))) return false;
        return ready ? entries : null;
    }

    /**
     * The markups of an SVG image with all its shapes but one hidden, one per
     * shape (imageShapes); null while the source loads, false when it is not
     * an SVG of 1 to MAX_SHAPES shapes.
     */
    svgShapes(src) {
        this.svgSources ??= new Map();
        const known = this.svgSources.get(src);
        if (known !== undefined) return known;
        // Only what names itself an SVG is read (a data URL, or a path ending .svg)
        const data = /^data:image\/svg\+xml/i.test(src);
        if (!data && !/^[^?#]*\.svg([?#]|$)/i.test(src)) {
            this.svgSources.set(src, false);
            return false;
        }
        this.svgSources.set(src, null);
        const text = data
            ? Promise.resolve(src.slice(src.indexOf(',') + 1)).then((body) => (/;base64,/i.test(src.slice(0, src.indexOf(',') + 1)) ? atob(body) : decodeURIComponent(body)))
            : fetch(src).then((response) => (response.ok ? response.text() : null));
        text.then((markup) => {
            const shapes = markup ? splitSvgShapes(markup) : null;
            this.svgSources.set(src, shapes && shapes.length >= 1 && shapes.length <= MAX_SHAPES ? shapes : false);
            this.onReady();
        }).catch(() => this.svgSources.set(src, false));
        return null;
    }
}

// An SVG image is drawn shape by shape (Rasterizer.imageShapes) up to this many shapes
const MAX_SHAPES = 24;
// Elements that draw nothing where they stand
const SVG_UNDRAWN = new Set(['defs', 'clipPath', 'mask', 'pattern', 'marker', 'symbol', 'linearGradient', 'radialGradient',
    'filter', 'style', 'title', 'desc', 'metadata', 'script']);
// Containers whose children draw one by one
const SVG_CONTAINERS = new Set(['g', 'a', 'svg', 'switch']);

/**
 * The shapes of an SVG document in paint order, as { markup, cover, solid }:
 * the document with every other shape hidden, whether the shape is a plain
 * rect over its whole view (the browser draws it as a rounded clip's own
 * shape) and whether it is filled with one colour; null when it does not
 * parse. A container with opacity, a filter, a mask or a clip path is drawn
 * as one.
 */
function splitSvgShapes(markup) {
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.namespaceURI !== SVG_NS || doc.querySelector('parsererror')) return null;
    const grouped = (el) => {
        const style = el.getAttribute('style') || '';
        const opacity = el.getAttribute('opacity') ?? (/(^|;)\s*opacity\s*:\s*([^;]+)/.exec(style)?.[2]);
        return (opacity != null && parseFloat(opacity) < 1) || ['filter', 'mask', 'clip-path'].some((name) => el.hasAttribute(name) || new RegExp(`(^|;)\\s*${name}\\s*:`).test(style));
    };
    const shapes = [];
    const walk = (el) => {
        for (const child of el.children) {
            const name = child.localName;
            if (SVG_UNDRAWN.has(name)) continue;
            if (SVG_CONTAINERS.has(name) && !grouped(child)) walk(child);
            else shapes.push(child);
        }
    };
    walk(root);
    // The view a rect must cover: the viewBox, else the root's width and height
    const view = root.viewBox?.baseVal;
    const viewW = view && view.width > 0 ? view.width : parseFloat(root.getAttribute('width')) || 0;
    const viewH = view && view.height > 0 ? view.height : parseFloat(root.getAttribute('height')) || 0;
    const viewX = view && view.width > 0 ? view.x : 0;
    const viewY = view && view.height > 0 ? view.y : 0;
    const length = (el, name, base) => {
        const value = (el.getAttribute(name) || '0').trim();
        return value.endsWith('%') ? parseFloat(value) / 100 * base : parseFloat(value);
    };
    // A fill of one colour (not a gradient or pattern)
    const solid = (el) => !/url\(/i.test(`${el.getAttribute('fill') || ''} ${el.getAttribute('style') || ''}`);
    const covers = (el) => el.localName === 'rect' && el.parentNode === root && !el.hasAttribute('transform')
        && !(parseFloat(el.getAttribute('rx')) > 0) && !(parseFloat(el.getAttribute('ry')) > 0)
        && length(el, 'x', viewW) <= viewX && length(el, 'y', viewH) <= viewY
        && length(el, 'x', viewW) + length(el, 'width', viewW) >= viewX + viewW
        && length(el, 'y', viewH) + length(el, 'height', viewH) >= viewY + viewH;
    const serializer = new XMLSerializer();
    const styles = shapes.map((el) => el.getAttribute('style'));
    const cover = shapes.map(covers);
    return shapes.map((shape, index) => {
        shapes.forEach((el, i) => {
            if (el === shape) {
                if (styles[i] == null) el.removeAttribute('style');
                else el.setAttribute('style', styles[i]);
            } else {
                el.setAttribute('style', `${styles[i] ? `${styles[i]};` : ''}display:none !important`);
            }
        });
        return { markup: serializer.serializeToString(doc), cover: cover[index], solid: solid(shape) };
    });
}

function resolveAxis(axis, size) {
    return (axis?.pct != null ? axis.pct * size : 0) + (axis?.px || 0);
}

function lengthIn(length, base) {
    return length.pct != null ? length.pct * base : length.px;
}

/** Radii (x, y) of a radial gradient's ending shape in a width x height box. */
function radialRadii(layer, cx, cy, width, height) {
    if (layer.lengths) {
        const rx = lengthIn(layer.lengths[0], width);
        const ry = layer.shape === 'circle' ? rx : lengthIn(layer.lengths[1] ?? layer.lengths[0], height);
        return [rx, ry];
    }
    const sidesX = [cx, width - cx];
    const sidesY = [cy, height - cy];
    const corners = [[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) => Math.hypot(x - cx, y - cy));
    const closest = layer.size.startsWith('closest');
    if (layer.shape === 'circle') {
        if (layer.size.endsWith('side')) {
            const sides = [...sidesX, ...sidesY];
            return Array(2).fill(closest ? Math.min(...sides) : Math.max(...sides));
        }
        return Array(2).fill(closest ? Math.min(...corners) : Math.max(...corners));
    }
    const rx = closest ? Math.min(...sidesX) : Math.max(...sidesX);
    const ry = closest ? Math.min(...sidesY) : Math.max(...sidesY);
    // Corner sizes keep the side ellipse's aspect ratio and pass through the corner
    return layer.size.endsWith('corner') ? [rx * Math.SQRT2, ry * Math.SQRT2] : [rx, ry];
}

// sRGB (channels 0..1) to Oklab and back, for gradients blended in Oklab
function srgbToOklab([r, g, b]) {
    const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
    const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    const q = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    return [
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * q,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * q,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * q
    ];
}

function oklabToSrgb([L, A, B]) {
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const q = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
    const gamma = (c) => {
        const v = Math.min(1, Math.max(0, c));
        return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    };
    return [
        gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * q),
        gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * q),
        gamma(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * q)
    ];
}

/**
 * CSS interpolates gradient colours with premultiplied alpha; the canvas does
 * not, so a fade to transparent (black at alpha 0) would darken. Stops next to
 * a transparent one take its neighbour's colour, and stops that differ in
 * alpha get premultiplied steps between them. A gradient blended in Oklab
 * gets such steps between every two colours that differ.
 */
function premultiplied(stops, space = 'srgb') {
    const oklab = space === 'oklab';
    const out = [];
    for (let i = 0; i < stops.length; i++) {
        const a = stops[i];
        const b = stops[i + 1];
        if (!b) {
            out.push(a);
            break;
        }
        const ca = a.color[3] <= 0.001 ? [b.color[0], b.color[1], b.color[2], 0] : a.color;
        const cb = b.color[3] <= 0.001 ? [a.color[0], a.color[1], a.color[2], 0] : b.color;
        out.push({ pos: a.pos, color: ca });
        // The canvas blends straight sRGB: steps in between carry the blend
        // CSS makes, of premultiplied colours (in Oklab when it blends there)
        const differ = oklab ? ca.some((v, j) => Math.abs(v - cb[j]) > 1e-4) : Math.abs(ca[3] - cb[3]) > 0.01;
        if (ca[3] > 0.001 && cb[3] > 0.001 && differ && b.pos > a.pos) {
            const steps = oklab ? 16 : 8;
            const la = oklab ? srgbToOklab(ca) : ca;
            const lb = oklab ? srgbToOklab(cb) : cb;
            for (let k = 1; k < steps; k++) {
                const t = k / steps;
                const alpha = ca[3] + (cb[3] - ca[3]) * t;
                const channel = (j) => (la[j] * ca[3] + (lb[j] * cb[3] - la[j] * ca[3]) * t) / alpha;
                const mixed = [channel(0), channel(1), channel(2)];
                out.push({ pos: a.pos + (b.pos - a.pos) * t, color: [...(oklab ? oklabToSrgb(mixed) : mixed), alpha] });
            }
        }
        out.push({ pos: b.pos, color: cb });
    }
    return out;
}

/**
 * Stops of a gradient, or of a repeating one's copies of its period, cut to
 * its line (0..1). A stop past an end gives way to the colour the line has
 * at that end, interpolated with premultiplied alpha as CSS does; the canvas
 * would clamp its position and paint its own colour there. On a hard stop at
 * an end, the side inside the line counts. An end no stop lies past keeps
 * its stops: a radial ray, drawn out to its last stop, pads with the last
 * colour after it.
 */
function cutToLine(stops) {
    const n = stops.length;
    const cutStart = stops[0].pos < 0;
    const cutEnd = stops[n - 1].pos > 1;
    if (!cutStart && !cutEnd) return stops;
    const colorAt = (pos, after) => {
        const k = stops.findIndex((stop) => (after ? stop.pos > pos : stop.pos >= pos));
        if (k === -1) return stops[n - 1].color;
        if (k === 0) return stops[0].color;
        const a = stops[k - 1];
        const b = stops[k];
        return mixPremultiplied(a.color, b.color, (pos - a.pos) / (b.pos - a.pos));
    };
    return [
        ...(cutStart ? [{ color: colorAt(0, true), pos: 0 }] : []),
        ...stops.filter((stop) => (!cutStart || stop.pos > 0) && (!cutEnd || stop.pos < 1)),
        ...(cutEnd ? [{ color: colorAt(1, false), pos: 1 }] : [])
    ];
}

/** Colour t of the way from a to b, interpolated with premultiplied alpha. */
function mixPremultiplied(a, b, t) {
    const alpha = a[3] + (b[3] - a[3]) * t;
    if (alpha <= 0) return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 0];
    const channel = (j) => (a[j] * a[3] + (b[j] * b[3] - a[j] * a[3]) * t) / alpha;
    return [channel(0), channel(1), channel(2), alpha];
}

/**
 * Add colour stops (positions as fractions of `length`) to a gradient drawn
 * out to `reach` lengths, repeating to it. The stops are cut to the line: a
 * conic turn, or a radial ray out to its last stop or to `reach`. Repeating,
 * copies of the period, premultiplied steps and all, run from the one over
 * the start of the line (the centre, or the seam) to the one over its end.
 */
function addStops(gradient, stops, length, repeating, reach = 1, space = 'srgb') {
    if (!repeating) {
        const line = normalizeStops(stops, length).map((stop) => ({ color: stop.color, pos: stop.pos / reach }));
        for (const stop of premultiplied(cutToLine(line), space)) gradient.addColorStop(Math.min(1, Math.max(0, stop.pos)), colorToCss(stop.color));
        return;
    }
    const normalized = premultiplied(normalizeStops(stops, length), space);
    const first = normalized[0].pos;
    const period = normalized[normalized.length - 1].pos - first;
    if (period <= 1e-4) {
        gradient.addColorStop(0, colorToCss(normalized[normalized.length - 1].color));
        gradient.addColorStop(1, colorToCss(normalized[normalized.length - 1].color));
        return;
    }
    const start = first - Math.ceil(first / period) * period;
    const copies = [];
    for (let offset = start; offset < reach; offset += period) {
        for (const stop of normalized) copies.push({ color: stop.color, pos: (offset + stop.pos - first) / reach });
    }
    // Cut to the line, not clamped: the copies over its start and end keep the colour CSS has
    // there. The steps are copied, not added again: the canvas's precision at hard stops
    // changes with how many stops it gets
    for (const stop of cutToLine(copies)) gradient.addColorStop(Math.min(1, Math.max(0, stop.pos)), colorToCss(stop.color));
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Serialize an SVG element as a standalone image, writing the resolved
 * fill/stroke of each element (CSS variables do not reach an SVG image).
 */
function serializeSvg(element, width, height, resolveStyle, viewBox = null) {
    const clone = element.cloneNode(true);
    clone.setAttribute('xmlns', SVG_NS);
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));
    if (viewBox) {
        clone.setAttribute('viewBox', viewBox.join(' '));
        clone.setAttribute('preserveAspectRatio', 'none');
    }
    const sources = [element, ...element.querySelectorAll('*')];
    const targets = [clone, ...clone.querySelectorAll('*')];
    sources.forEach((src, index) => {
        const target = targets[index];
        const style = resolveStyle?.(src);
        if (!style || !target) return;
        target.removeAttribute('style');
        if (src.style?.display === 'none') target.setAttribute('display', 'none');
        target.setAttribute('fill', style.fill ? colorToCss(style.fill) : 'none');
        target.setAttribute('stroke', style.stroke ? colorToCss(style.stroke) : 'none');
        if (style.strokeWidth != null) target.setAttribute('stroke-width', String(style.strokeWidth));
        for (const prop of ['stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'opacity']) {
            const value = src.style?.getPropertyValue(prop);
            if (value && !value.includes('var(')) target.setAttribute(prop, value);
        }
        // The root's own transform is painted through its box matrix. Inner
        // elements keep theirs as CSS: the transform attribute has no units,
        // so rotate(-90deg) there is a parse error, not a rotation
        if (index > 0) {
            const transform = ['transform', 'transform-origin', 'transform-box']
                .map((prop) => [prop, src.style?.getPropertyValue(prop)])
                .filter(([, value]) => value && !value.includes('var('))
                .map(([prop, value]) => `${prop}: ${value}`)
                .join('; ');
            if (transform) target.setAttribute('style', transform);
        }
    });
    return new XMLSerializer().serializeToString(clone);
}
