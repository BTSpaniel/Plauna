// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * NativeWell - what only the browser can paint, live and visible in GPU mode.
 *
 * Canvas, video, iframe, object, embed and audio controls have no GPU paint.
 * They stay where the app put them, in the scene, and the browser shows them:
 * a surface with such an element in view has a well, the device-pixel rect
 * around it, in which the screen shows the browser's own painting of the
 * scene instead of the GPU canvas:
 *
 *   - the scene (opacity 0 otherwise) is revealed by a mask of the wells,
 *   - the GPU canvas's clip box is masked with the same rects cut out.
 *
 * The element is not moved, so nothing about it changes: iframes do not
 * reload, video does not pause, style rules, event delegation, focus and
 * querySelector work, and the browser keeps it placed through layout,
 * scrolling, transforms and animations. Only the masks follow it: frame()
 * syncs them, and anything that moves an element asks for a frame (mutations,
 * scrolling, resizing, running animations; a surface with wells in view does
 * not hand animations over to a paint worker, so its frames keep running).
 *
 * Inside a well everything is the browser's own painting, so it matches DOM
 * mode by construction: what the scene paints around and over the element
 * (a border radius, a HUD, a translucent or backdrop-filtered panel over a
 * video) is there once, and input hits the same elements. An in-paint-order
 * hole in the GPU canvas (DisplayList.setHole) would instead leave the GPU
 * copy of an overlay on top of the browser's: doubled translucent panels and
 * bolder text. setHole is for native content kept outside the scene.
 *
 * Measured at real scale factors 1, 1.25, 1.5 and 2 (tests/test_plauna_native_well.py):
 * a mask does not change hit testing (a clip-path would); with its edges on
 * device pixels neither mask changes a pixel (the only difference is one
 * level in a canvas the browser resamples, which goes through a render
 * surface now). A well is never needed exactly: any rect around the element
 * shows the same pixels, so wells past MAX_WELLS merge into one.
 *
 * Elements that show nothing need no well, and a surface with no well in view
 * costs nothing: no box, a zero-size box, visibility hidden, opacity 0 on the
 * way up to the scene (an offscreen video source, a print iframe), or out of
 * the visible part of the surface.
 *
 * An element marked data-plauna-well is an island: a whole region the browser
 * owns, for what Plauna cannot paint or must not lay out (a textarea, a
 * contenteditable, thousands of text spans over page canvases). It gets one
 * well and one leaf box, sized by the CSS around it, never by its content.
 * Plauna does not lay out, watch or restyle anything below it, so typing and
 * scrolling there cost no layout and no frame, and focus, selection, IME and
 * scrolling stay the browser's. Style sheets go outside it: a style element
 * added in an island is not noticed. The scene's observers still see an
 * island's mutations (a mutation observer cannot leave out a subtree), so
 * content there should change a few nodes at a time, not rewrite thousands.
 */

import { flatParent, WELL_ATTRIBUTE } from './layout/LayoutTree.js';
import { cssZoomOf } from './layout/LayoutUnits.js';

/** The elements only the browser can paint (audio has a box only with controls). */
export const NATIVE_TAGS = new Set(['canvas', 'video', 'iframe', 'object', 'embed', 'audio']);

const MAX_WELLS = 32;
// Below this an element's opacity rounds to nothing
const MIN_OPACITY = 1 / 512;
const SOLID = 'linear-gradient(#000,#000)';
const MASK_PROPERTIES = ['maskImage', 'maskPosition', 'maskSize', 'maskRepeat', 'maskClip', 'maskComposite'];

/** Whether `node` is below `ancestor` in the flat tree (an element can be moved out of the scene). */
function inFlatTree(ancestor, node) {
    for (let at = flatParent(node); at; at = flatParent(at)) if (at === ancestor) return true;
    return false;
}

/** CSS px per local px of `element` under what scales it: CSS zoom, or a transform above it. */
function localScale(element, rect) {
    const zoom = cssZoomOf(element);
    const width = element.offsetWidth;
    return width > 0 && Math.abs(rect.width / zoom - width) > 1 ? rect.width / width : zoom;
}

/** [x0, y0, x1, y1] (device px) around client rect `r`, or null when nothing of it is in `view`. */
export function deviceRect(r, view, dpr) {
    const left = Math.max(r.left, view.left);
    const top = Math.max(r.top, view.top);
    const right = Math.min(r.right, view.left + view.width);
    const bottom = Math.min(r.bottom, view.top + view.height);
    if (!(right > left) || !(bottom > top)) return null;
    // (rects are single precision: an edge on a device pixel stays on it)
    return [Math.floor(left * dpr + 1e-3), Math.floor(top * dpr + 1e-3), Math.ceil(right * dpr - 1e-3), Math.ceil(bottom * dpr - 1e-3)];
}

/** Rects past `limit` merged into one: a larger well shows the same pixels. */
export function mergeWells(rects, limit = MAX_WELLS) {
    if (rects.length <= limit) return rects;
    const kept = rects.slice(0, limit - 1);
    const rest = rects.slice(limit - 1);
    kept.push([
        Math.min(...rest.map((r) => r[0])), Math.min(...rest.map((r) => r[1])),
        Math.max(...rest.map((r) => r[2])), Math.max(...rest.map((r) => r[3]))
    ]);
    return kept;
}

/** Mask layers for device rects, in an element at client (x, y) with `scale` CSS px per local px. */
function layersFor(rects, x, y, scale, dpr) {
    return rects.map(([x0, y0, x1, y1]) => ({
        position: `${(x0 / dpr - x) / scale}px ${(y0 / dpr - y) / scale}px`,
        size: `${(x1 - x0) / dpr / scale}px ${(y1 - y0) / dpr / scale}px`
    }));
}

function clearMask(style) {
    for (const name of MASK_PROPERTIES) style[name] = '';
}

export class NativeWell {
    /** @param {RenderSurface} surface */
    constructor(surface) {
        this.surface = surface;
        // The native elements in the scene (RenderSurface.scan keeps this)
        this.natives = new Set();
        // Those of them marked data-plauna-well
        this.islands = new Set();
        // The wells in view, device px, as of the last sync
        this.rects = [];
        this.revealed = false;
        this.sceneKey = '';
        this.clipKeys = new WeakMap();
    }

    /** The number of wells in view. */
    get count() {
        return this.rects.length;
    }

    add(element) {
        this.natives.add(element);
        if (element.hasAttribute(WELL_ATTRIBUTE)) this.islands.add(element);
    }

    remove(element) {
        this.natives.delete(element);
        this.islands.delete(element);
    }

    /** The island `node` is in, or is, or null. Nothing to look up on a surface without islands. */
    islandOf(node) {
        if (!this.islands.size) return null;
        const element = node?.nodeType === 1 ? node : node?.parentElement;
        return element?.closest?.(`[${WELL_ATTRIBUTE}]`) ?? null;
    }

    /** Whether a mutation record is the browser's alone: anything in an island but the island's own attributes. */
    ownsRecord(record) {
        const island = this.islandOf(record.target);
        return Boolean(island) && !(record.type === 'attributes' && record.target === island);
    }

    /** Whether `element` shows anything: its box, its visibility and every opacity up to the scene. */
    shows(element) {
        const surface = this.surface;
        let box = surface.layout?.boxes.get(element);
        if (box) {
            if (box.style.visibility === 'hidden') return false;
            for (; box; box = box.parent) if (box.style && box.style.opacity < MIN_OPACITY) return false;
            return true;
        }
        // Not laid out by Plauna (an element it does not reach): the browser's values
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        for (let at = element; at && at !== surface.scene; at = flatParent(at)) {
            if (parseFloat(getComputedStyle(at).opacity) < MIN_OPACITY) return false;
        }
        return true;
    }

    /** The wells of the elements in `visible` (RenderSurface.visibleRect), in device px. */
    measure(visible) {
        const dpr = window.devicePixelRatio || 1;
        const rects = [];
        for (const element of this.natives) {
            if (!element.isConnected || !inFlatTree(this.surface.scene, element)) {
                this.remove(element);
                continue;
            }
            const r = element.getBoundingClientRect();
            if (!(r.width > 0) || !(r.height > 0) || !this.shows(element)) continue;
            const rect = deviceRect(r, visible.client, dpr);
            if (rect) rects.push(rect);
        }
        return mergeWells(rects);
    }

    /**
     * Follow the elements for this frame: `visible` is the surface's visible
     * part (null: nothing of it). Reveals the scene in the wells, or hides it
     * again when none is in view. Returns the number of wells.
     */
    sync(visible) {
        const rects = visible && this.natives.size ? this.measure(visible) : [];
        this.rects = rects;
        const scene = this.surface.scene;
        if (!rects.length) {
            if (this.revealed) this.surface.quietScene(() => this.hide());
            return 0;
        }
        const dpr = window.devicePixelRatio || 1;
        const r = scene.getBoundingClientRect();
        const layers = layersFor(rects, r.left, r.top, localScale(scene, r), dpr);
        const position = layers.map((layer) => layer.position).join(',');
        const size = layers.map((layer) => layer.size).join(',');
        const key = `${position}|${size}`;
        if (key !== this.sceneKey || !this.revealed) {
            this.sceneKey = key;
            this.surface.quietScene(() => {
                const style = scene.style;
                style.maskImage = layers.map(() => SOLID).join(',');
                style.maskPosition = position;
                style.maskSize = size;
                style.maskRepeat = 'no-repeat';
                // Content past the scene's box is in the mask's reach too
                style.maskClip = 'no-clip';
                style.opacity = '';
                this.revealed = true;
            });
        }
        return rects.length;
    }

    /**
     * Cut the wells out of a GPU canvas's clip box, which sits at client
     * position (x, y) with `scale` CSS px per local px.
     */
    cover(clip, x, y, scale) {
        const rects = this.rects;
        const style = clip.style;
        if (!rects.length) {
            if (this.clipKeys.get(clip)) {
                clearMask(style);
                this.clipKeys.set(clip, '');
            }
            return;
        }
        const layers = layersFor(rects, x, y, scale, window.devicePixelRatio || 1);
        const position = layers.map((layer) => layer.position).join(',');
        const size = layers.map((layer) => layer.size).join(',');
        const key = `${position}|${size}`;
        if (this.clipKeys.get(clip) === key) return;
        this.clipKeys.set(clip, key);
        // The first layer is all of the box (reaching past it, so its edge is
        // never drawn), less what the others cover
        style.maskImage = [SOLID, ...layers.map(() => SOLID)].join(',');
        style.maskPosition = `-4px -4px,${position}`;
        style.maskSize = `calc(100% + 8px) calc(100% + 8px),${size}`;
        style.maskRepeat = 'no-repeat';
        style.maskClip = 'no-clip';
        style.maskComposite = ['subtract', ...layers.map(() => 'add')].join(',');
    }

    /** Hide the scene again: the GPU canvas shows everything. */
    hide() {
        const style = this.surface.scene.style;
        clearMask(style);
        style.opacity = '0';
        this.revealed = false;
        this.sceneKey = '';
    }

    /** GPU mode ended: masks off the scene (the canvases go with their clips). */
    stop() {
        if (this.revealed) this.hide();
        this.natives.clear();
        this.islands.clear();
        this.rects = [];
    }
}
