// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * GlassUnderlay - backdrop-filter over what a surface did not draw.
 *
 * The GPU painter's backdrop blur reads its own canvas, so a glass box that
 * must blur content outside the surface (shell chrome over the ambient
 * wallpaper) cannot get that from it. Mark such a box in the scene:
 *
 *   element.setAttribute(GLASS_ATTRIBUTE, '');   // data-plauna-glass
 *
 * and in GPU mode the surface keeps a DOM element below the scene and the
 * canvas, on the box, with the box's backdrop-filter and corners. The canvas
 * is transparent there unless something is painted (the box's own background
 * and content are, on top), so the browser's blur of the page shows through.
 * In DOM mode the box's own backdrop-filter does this and no underlay exists.
 *
 * Isolating the surface does not stop the blur from reaching the page (it is
 * not a backdrop root), and the invisible scene is not in its way (it is one,
 * but the underlay sits outside it). What the surface itself draws under the
 * box the painter blurs on its own canvas, above the underlay.
 *
 * The underlay follows the box's laid-out position, the matrix and opacity
 * animations give it, and the clip around it, in every frame the surface
 * paints. As in the DOM, the box's own opacity fades the blur, and an
 * ancestor that is a backdrop root keeps the page from the box, so the
 * underlay is not shown. Chrome's backdrop roots (measured): opacity below 1,
 * any filter (brightness(1) too), backdrop-filter, clip-path, mask-image
 * (mask, -webkit-mask-image), mix-blend-mode other than normal, a
 * view-transition-name (with no transition running), and will-change naming
 * any of opacity, filter, backdrop-filter, clip-path, mask, mask-image or
 * mix-blend-mode (or their -webkit- names, but -webkit-backdrop-filter). Not:
 * transform, isolation, contain: paint, overflow, or will-change: transform,
 * isolation, view-transition-name or mask-border.
 *
 * Without opacity this matches the box's own backdrop-filter to one level,
 * at real scale factors 1, 1.25, 1.5 and 2 (tests/test_plauna_native_well.py).
 * Two cases differ (written allowances there):
 * - A box mid-fade: the browser fades the sharp page back in under the box's
 *   content as well, and the underlay lies below the canvas, so under content
 *   the sharp page shows less than it should (by a fraction of the difference
 *   between the sharp page and the blurred one).
 * - Surface content under the box: the painter draws its blur of the canvas
 *   source-over what it drew there (DisplayList.emitBackdrop), so where that
 *   blur is translucent the sharp content still shows (up to 79 levels at a
 *   box's edge over a solid block). The browser blurs the page and the content
 *   together. Clearing the region before the painter's blur is drawn measures
 *   worse (twice the pixels off): the page under the content would have to be
 *   hidden before the blur, so what the surface draws below the box would have
 *   to lie under the underlay (a canvas split at the glass box).
 * -webkit-mask-box-image makes a backdrop root too but has no style field: an
 * ancestor with only that still shows the underlay.
 */

export const GLASS_ATTRIBUTE = 'data-plauna-glass';

const NO_CLIP = 1e6;

// will-change names that make a backdrop root (measured: -webkit-filter does, -webkit-backdrop-filter does not)
const WILL_CHANGE_ROOT = /(?:^|,)\s*(?:opacity|filter|-webkit-filter|backdrop-filter|clip-path|-webkit-clip-path|mask|-webkit-mask|mask-image|-webkit-mask-image|mix-blend-mode)\s*(?=,|$)/;

// What makes an element a backdrop root, as style fields
function backdropRoot(style) {
    if (!style) return false;
    return style.opacity < 1 || style.blurFilter > 0 || Boolean(style.colorFilter) || (style.dropShadows?.length > 0)
        || isSet(style.filter) || isSet(style.backdropFilter) || style.backdropBlur > 0 || Boolean(style.backdropColor)
        || isSet(style.maskImage) || (style.mixBlendMode && style.mixBlendMode !== 'normal')
        || isSet(style.clipPath) || isSet(style.viewTransitionName)
        || (isSet(style.willChange) && style.willChange !== 'auto' && WILL_CHANGE_ROOT.test(style.willChange));
}

function isSet(value) {
    return value != null && value !== '' && value !== 'none';
}

/** Whether the page can reach `box`'s backdrop: no ancestor in the scene is a backdrop root. */
function reachesPage(box) {
    for (let at = box.parent; at; at = at.parent) if (!at.isHost && backdropRoot(at.style)) return false;
    return true;
}

/**
 * The clip around `box`, or null: layout's clip of what escapes every clip
 * reaches billions of px, and an axis nothing clips keeps a size CSS holds exactly.
 */
function clipOf(box) {
    const clip = box.clip;
    if (!clip) return null;
    const x0 = Math.max(clip.x, -NO_CLIP);
    const y0 = Math.max(clip.y, -NO_CLIP);
    const x1 = Math.min(clip.x + clip.width, NO_CLIP);
    const y1 = Math.min(clip.y + clip.height, NO_CLIP);
    if (x0 === -NO_CLIP && y0 === -NO_CLIP && x1 === NO_CLIP && y1 === NO_CLIP) return null;
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0, radii: clip.radii };
}

export class GlassUnderlay {
    /** @param {RenderSurface} surface */
    constructor(surface) {
        this.surface = surface;
        // Glass element -> its { clip, under } elements (and their styles as written)
        this.entries = new Map();
        this.layer = null;
    }

    get size() {
        return this.entries.size;
    }

    add(element) {
        if (this.entries.has(element)) return;
        if (!this.layer) {
            const layer = document.createElement('div');
            layer.className = 'plauna-surface-underlay';
            layer.setAttribute('aria-hidden', 'true');
            layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;';
            // First: below the scene and the canvas
            this.surface.element.insertBefore(layer, this.surface.element.firstChild);
            this.layer = layer;
        }
        const clip = document.createElement('div');
        clip.style.cssText = 'position:absolute;display:none;';
        const under = document.createElement('div');
        under.className = 'plauna-surface-glass';
        under.style.cssText = 'position:absolute;';
        clip.appendChild(under);
        this.layer.appendChild(clip);
        this.entries.set(element, { clip, under, shown: false, clipKey: '', boxKey: '' });
    }

    remove(element) {
        this.entries.get(element)?.clip.remove();
        this.entries.delete(element);
    }

    /** Follow every glass box; a frame's layout and animated values are in place. */
    sync() {
        for (const [element, entry] of this.entries) {
            if (!element.isConnected || !element.hasAttribute(GLASS_ATTRIBUTE)) this.remove(element);
            else this.place(element, entry);
        }
    }

    place(element, entry) {
        const box = this.surface.layout?.boxes.get(element);
        const computed = box ? getComputedStyle(element) : null;
        const filter = computed?.backdropFilter;
        if (!box || !isSet(filter) || box.style.visibility === 'hidden' || !reachesPage(box)) {
            if (entry.shown) {
                entry.clip.style.display = 'none';
                entry.shown = false;
            }
            return;
        }
        if (!entry.shown) {
            entry.clip.style.display = 'block';
            entry.shown = true;
        }
        const clip = clipOf(box);
        const clipKey = clip ? `${clip.x} ${clip.y} ${clip.width} ${clip.height} ${clip.radii ?? ''}` : '';
        if (clipKey !== entry.clipKey) {
            entry.clipKey = clipKey;
            const style = entry.clip.style;
            style.left = `${clip ? clip.x : 0}px`;
            style.top = `${clip ? clip.y : 0}px`;
            style.width = clip ? `${clip.width}px` : '0';
            style.height = clip ? `${clip.height}px` : '0';
            style.overflow = clip ? 'hidden' : 'visible';
            style.borderRadius = clip?.radii ? clip.radii.map((r) => `${r}px`).join(' ') : '';
        }
        const x = box.absX - (clip ? clip.x : 0);
        const y = box.absY - (clip ? clip.y : 0);
        // (under a compositor layer: as the layer moves it, too)
        const m = this.surface.hitMatrix(box);
        const radius = `${computed.borderTopLeftRadius}|${computed.borderTopRightRadius}|${computed.borderBottomRightRadius}|${computed.borderBottomLeftRadius}`;
        const boxKey = `${x} ${y} ${box.width} ${box.height} ${m ?? ''} ${box.style.opacity} ${filter} ${radius}`;
        if (boxKey === entry.boxKey) return;
        entry.boxKey = boxKey;
        const style = entry.under.style;
        style.left = `${x}px`;
        style.top = `${y}px`;
        style.width = `${box.width}px`;
        style.height = `${box.height}px`;
        // box.matrix is in scene px: applied about the scene's origin
        style.transformOrigin = m ? `${-box.absX}px ${-box.absY}px` : '';
        style.transform = m ? `matrix(${m.join(',')})` : '';
        style.opacity = box.style.opacity < 1 ? String(box.style.opacity) : '';
        style.borderTopLeftRadius = computed.borderTopLeftRadius;
        style.borderTopRightRadius = computed.borderTopRightRadius;
        style.borderBottomRightRadius = computed.borderBottomRightRadius;
        style.borderBottomLeftRadius = computed.borderBottomLeftRadius;
        style.backdropFilter = filter;
    }

    /** GPU mode ended: the box's own backdrop-filter shows in the DOM. */
    stop() {
        this.layer?.remove();
        this.layer = null;
        this.entries.clear();
    }
}
