// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * AnimationController - CSS animations and transitions for GPU mode.
 *
 * In DOM mode the browser animates. In GPU mode the scene stays in the page
 * (invisible), so the browser still runs every CSS transition, @keyframes
 * animation and Web Animation on it. Each frame this controller asks the
 * scene for its running animations (getAnimations) and paints the values the
 * browser computes for the animated properties: same timing, easing, colour
 * space and properties as the DOM shows. Covered: opacity, colours
 * (background, text, borders, outline, text decoration, fill, stroke),
 * box and text shadows, filters and backdrop filters, transforms (with
 * translate, rotate and scale), outline width and offset, background position.
 *
 * Properties that move boxes (width, height, offsets) ease the geometry of
 * leaf boxes (bars, thumbs, indicators) between layouts.
 *
 * Values are applied on top of each box's laid-out base, which the next frame
 * (or restore(), before a relayout) puts back. Geometry targets only change
 * with the layout, so a new layout is checked where it changed (boxes stamped
 * with a later paint frame since the last check, which includes every box
 * finalize() walked).
 *
 * An element whose animations only move, turn, scale or fade it is drawn as
 * the browser composites it (measured): while they run, or while a paused
 * one holds a turn or scale, its content is painted once as laid out and
 * drawn back where the animation puts it. Such a box gets the animated
 * matrix and opacity and `box.compositor` ({ base: its laid-out matrix });
 * its descendants keep their laid-out matrices and nothing is marked
 * changed, so the display list copies its content (DisplayList.paintUnit).
 *
 * With `offload` (a surface painted in a worker), a running layer whose
 * animations LayerAnimations can describe is handed over: `offloaded` maps
 * its box to what the worker samples it from, and it no longer keeps the
 * main thread's frames running. `onChange` is called when such an
 * animation is changed from script.
 *
 * Nor does an animation that only repaints its box in place (colours,
 * background position, opacity) while the frame culls all of the box's
 * subtree (apply's `unseen`): what it changes is not drawn, the next frame
 * culls it too, and a scroll or relayout that brings it into view asks for
 * a frame.
 */

import {
    parseColor, parseTransform, multiplyAffine, invertAffine,
    parseBoxShadow, parseColorFilter, parseBlurFilter, parseDropShadowFilter
} from './css/CssValues.js';
import { pseudoElementOf } from './css/StyleResolver.js';
import { markChanged, paintClock } from './layout/LayoutTree.js';
import { layoutZoom } from './layout/LayoutUnits.js';
import { combinedTransform, layerMatrix, describeAnimation, watchAnimation } from './LayerAnimations.js';

// ── Easing ──────────────────────────────────────────────────────────────────

function cubicBezier(x1, y1, x2, y2) {
    const sample = (a, b, t) => ((1 - 3 * b + 3 * a) * t + (3 * b - 6 * a)) * t * t + 3 * a * t;
    return (x) => {
        if (x <= 0) return 0;
        if (x >= 1) return 1;
        let lo = 0;
        let hi = 1;
        let t = x;
        for (let i = 0; i < 24; i++) {
            const v = sample(x1, x2, t);
            if (Math.abs(v - x) < 1e-5) break;
            if (v < x) lo = t; else hi = t;
            t = (lo + hi) / 2;
        }
        return sample(y1, y2, t);
    };
}

const EASINGS = {
    linear: (t) => t,
    ease: cubicBezier(0.25, 0.1, 0.25, 1),
    'ease-in': cubicBezier(0.42, 0, 1, 1),
    'ease-out': cubicBezier(0, 0, 0.58, 1),
    'ease-in-out': cubicBezier(0.42, 0, 0.58, 1)
};

export function easing(name) {
    const text = String(name || 'ease').trim();
    if (EASINGS[text]) return EASINGS[text];
    const bezier = /^cubic-bezier\(([^)]+)\)$/.exec(text);
    if (bezier) {
        const [a, b, c, d] = bezier[1].split(',').map(Number);
        return cubicBezier(a, b, c, d);
    }
    const steps = /^steps\((\d+)/.exec(text);
    if (steps) {
        const n = parseInt(steps[1], 10);
        return (t) => Math.floor(t * n) / n;
    }
    return EASINGS.ease;
}

const lerp = (a, b, t) => a + (b - a) * t;

// What the browser animates on the compositor
const COMPOSITED = new Set(['transform', 'translate', 'rotate', 'scale', 'opacity']);

// What repaints a box where it is: nothing moves, grows or reaches further,
// so a frame that culls all of it culls it the next frame too
const IN_PLACE = new Set([
    'opacity', 'color', 'background-color', 'border-color', 'border-top-color', 'border-right-color',
    'border-bottom-color', 'border-left-color', 'outline-color', 'text-decoration-color', 'fill', 'stroke',
    'background-position', 'background-position-x', 'background-position-y'
]);

/** A matrix that only moves (or none). */
function moves(m) {
    return !m || (Math.abs(m[0] - 1) < 1e-9 && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && Math.abs(m[3] - 1) < 1e-9);
}

// ── Reading what the browser animates ───────────────────────────────────────

const SIDES = ['Top', 'Right', 'Bottom', 'Left'];

// A CSS animation's properties, read once: its keyframes come from its
// @keyframes rule, and reading them every frame costs more than the sampling
const cssAnimationProperties = new WeakMap();

/** CSS property names an animation drives (hyphenated). */
function animatedProperties(animation) {
    if (animation.transitionProperty) return [animation.transitionProperty];
    if (animation.animationName != null) {
        let props = cssAnimationProperties.get(animation);
        if (props) return props;
        props = keyframeProperties(animation);
        // Not before its rule arrives (widgets add @keyframes as they need them)
        if (props.size) cssAnimationProperties.set(animation, props);
        return props;
    }
    return keyframeProperties(animation);
}

function keyframeProperties(animation) {
    const props = new Set();
    try {
        for (const frame of animation.effect.getKeyframes()) {
            for (const key of Object.keys(frame)) {
                if (key === 'offset' || key === 'computedOffset' || key === 'easing' || key === 'composite') continue;
                props.add(key === 'cssFloat' ? 'float' : key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
            }
        }
    } catch {
        // An effect without keyframes animates nothing we paint
    }
    return props;
}

/** Style overrides for `props` from the browser's computed (animated) style. */
function readAnimated(cs, props, style) {
    const out = {};
    const color = (value) => parseColor(value, style.color);
    for (const prop of props) {
        if (prop === 'opacity') out.opacity = parseFloat(cs.opacity);
        else if (prop === 'color') out.color = color(cs.color);
        else if (prop === 'background-color') out.backgroundColor = color(cs.backgroundColor);
        else if (prop === 'border-color' || /^border-(top|right|bottom|left)-color$/.test(prop)) {
            out.borderColor = SIDES.map((side) => color(cs[`border${side}Color`]));
        } else if (prop === 'outline-color') out.outlineColor = color(cs.outlineColor);
        else if (prop === 'outline-width') out.outlineWidth = parseFloat(cs.outlineWidth) || 0;
        else if (prop === 'outline-offset') out.outlineOffset = parseFloat(cs.outlineOffset) || 0;
        else if (prop === 'text-decoration-color') out.textDecorationColor = color(cs.textDecorationColor);
        else if (prop === 'fill') out.fill = cs.fill === 'none' ? null : color(cs.fill);
        else if (prop === 'stroke') out.stroke = cs.stroke === 'none' ? null : color(cs.stroke);
        else if (prop === 'box-shadow') out.boxShadow = parseBoxShadow(cs.boxShadow, style.color);
        else if (prop === 'text-shadow') out.textShadow = cs.textShadow === 'none' ? [] : parseBoxShadow(cs.textShadow, style.color);
        else if (prop === 'filter') {
            const filter = cs.filter;
            const on = filter && filter !== 'none';
            out.colorFilter = on ? parseColorFilter(filter) : null;
            out.blurFilter = on ? parseBlurFilter(filter) : 0;
            out.dropShadows = on ? parseDropShadowFilter(filter, style.color) : [];
        } else if (prop === 'backdrop-filter') {
            const filter = cs.backdropFilter;
            const on = filter && filter !== 'none';
            out.backdropBlur = on ? parseBlurFilter(filter) : 0;
            out.backdropColor = on ? parseColorFilter(filter) : null;
        } else if (prop === 'transform' || prop === 'translate' || prop === 'rotate' || prop === 'scale') {
            out.transform = combinedTransform(cs);
        } else if (prop.startsWith('background-position')) {
            out.backgroundPositionX = cs.backgroundPositionX;
            out.backgroundPositionY = cs.backgroundPositionY;
        }
    }
    return out;
}

/** What a box holds before animations apply on top of it. */
function baseOf(box) {
    return {
        style: box.style,
        matrix: box.matrix,
        geometry: { absX: box.absX, absY: box.absY, width: box.width, height: box.height }
    };
}

export class AnimationController {
    /** @param {Object} options root: the element whose subtree is animated (a surface's scene) */
    constructor(options = {}) {
        this.root = options.root || null;
        this.tweens = new WeakMap();
        this.shown = new WeakMap();
        this.targets = new WeakMap();
        this.active = false;
        // Boxes the last frame changed (each holds its laid-out values in
        // box.base): restoring them changes what is painted
        this.committed = [];
        // The layout whose targets are recorded, and the paint frame of that check
        this.layout = null;
        this.checked = 0;
        // Boxes with a running geometry transition, in paint order
        this.live = [];
        // Boxes drawn as compositor layers last frame, and which boxes' subtrees can be
        this.compositors = new Set();
        this.layerable = new WeakMap();
        // Layers handed to a paint worker (box -> what it samples them from)
        this.offload = false;
        this.offloaded = new Map();
        this.onChange = null;
    }

    // ── Per frame ───────────────────────────────────────────────────────────

    /**
     * Apply animations and transitions to `layout` for time `now` (ms).
     * Returns true while anything is still moving. `unseen(box)`: true when
     * this frame paints nothing of the box (its view culls all of it).
     */
    apply(layout, now, unseen = null) {
        this.restore();
        if (layout !== this.layout) this.noteLayout(layout, now);
        const { overrides, loose, states } = this.sample(layout);
        // Handing layers over, only what the worker does not draw keeps frames
        // running (painted here, so does an animation on an element with no box)
        let moving = !this.offload && loose;
        let live = 0;
        for (const box of this.live) {
            const extra = overrides.get(box) || {};
            if (this.applyTransitions(box, now, extra)) moving = true;
            if (Object.keys(extra).length) overrides.set(box, extra);
            if (this.tweens.has(box.element)) this.live[live++] = box;
        }
        this.live.length = live;
        // In paint order: an ancestor's transform moves its descendants first
        const boxes = [...overrides.keys()].sort((a, b) => a.orderIndex - b.orderIndex);
        const compositors = new Set();
        const offloaded = new Map();
        for (const box of boxes) {
            const values = overrides.get(box);
            const state = states.get(box);
            const layer = this.composited(box, values, state, layout);
            if (layer) compositors.add(box);
            const track = layer && this.offload ? this.handOver(box, state) : null;
            if (track) offloaded.set(box, track);
            this.commit(box, values, layer, Boolean(track));
        }
        // Nor does what only repaints in place out of view: the next frame
        // culls it too (a scroll or layout change asks for a frame)
        for (const [box, state] of states) {
            if (!state.running || offloaded.has(box)) continue;
            if (unseen && state.props.size && [...state.props].every((prop) => IN_PLACE.has(prop)) && unseen(box)) continue;
            moving = true;
        }
        // A box that starts or stops being a layer (or being handed over) paints differently
        for (const box of this.compositors) if (!compositors.has(box)) markChanged(box);
        for (const box of compositors) {
            if (!this.compositors.has(box) || this.offloaded.has(box) !== offloaded.has(box)) markChanged(box);
        }
        this.compositors = compositors;
        this.offloaded = offloaded;
        this.active = moving;
        return moving;
    }

    /**
     * What a paint worker samples a running compositor layer from, or null
     * when one of its animations cannot be described (LayerAnimations) or
     * two drive the same property: its animations, and the box's laid-out
     * geometry, matrix, opacity and other transform values its layer matrix
     * is built from (commit).
     */
    handOver(box, state) {
        if (!state.running) return null;
        const zoom = layoutZoom();
        const animations = [];
        const props = new Set();
        for (const animation of state.animations) {
            const desc = describeAnimation(animation, zoom);
            if (!desc) return null;
            for (const key of Object.keys(desc.tracks)) {
                if (props.has(key)) return null;
                props.add(key);
            }
            animations.push(desc);
        }
        const cs = getComputedStyle(state.element, state.pseudo);
        const onChange = this.onChange;
        if (onChange) for (const animation of state.animations) watchAnimation(animation, onChange);
        return {
            animations,
            animatesTransform: props.has('transform'),
            transform: cs.transform,
            translate: cs.translate,
            rotate: cs.rotate,
            scale: cs.scale,
            opacity: box.style.opacity,
            matrix: box.matrix || null,
            box: { width: box.width, height: box.height, absX: box.absX, absY: box.absY, parentMatrix: box.parentMatrix || null },
            style: { fontSize: box.style.fontSize, transformOrigin: box.style.transformOrigin }
        };
    }

    /**
     * Whether `box` is drawn as a compositor layer this frame, as the browser
     * draws it (measured): every property its animations drive is one the
     * compositor animates, and one runs, or a paused one holds a transform
     * that is more than a move (a paused move is painted where it stopped).
     * Only boxes whose own and laid-out parent matrices just move, and whose
     * subtree nothing clips but the clip around it, so the layer is painted
     * as laid out and cut where it is drawn back.
     */
    composited(box, values, state, layout) {
        // An inline box paints with its line's text, not as a layer of its own
        if (!state || !box.element || box.isHost || values.geometry || (box.outer === 'inline' && !box.atomic)) return false;
        for (const prop of state.props) if (!COMPOSITED.has(prop)) return false;
        if (!moves(box.parentMatrix) || !moves(box.matrix)) return false;
        let known = this.layerable.get(box);
        if (!known || known.layout !== layout) {
            const clip = box.clip;
            const unclipped = (b) => !b.scroller && b.clip === clip && b.children.every((c) => c.isText || unclipped(c));
            known = { layout, ok: unclipped(box) };
            this.layerable.set(box, known);
        }
        if (!known.ok) return false;
        if (state.running) return true;
        if (values.transform == null) return false;
        const m = parseTransform(values.transform, box.width, box.height, { fontSize: box.style.fontSize });
        return !moves(m);
    }

    /**
     * The browser's current values for every running animation in the scene:
     * { overrides: Map(box -> style overrides), running, loose (one runs on
     * an element without a box), states }.
     */
    sample(layout) {
        const overrides = new Map();
        // Per box: the properties its animations drive, and whether one runs
        const states = new Map();
        let running = false;
        let loose = false;
        const root = this.root;
        if (!root?.getAnimations) return { overrides, running, loose, states };
        let animations;
        try {
            animations = root.getAnimations({ subtree: true });
        } catch {
            return { overrides, running, loose, states };
        }
        for (const animation of animations) {
            const effect = animation.effect;
            const element = effect?.target;
            if (!element) continue;
            const runs = animation.playState === 'running';
            if (runs) running = true;
            const pseudo = effect.pseudoElement || null;
            const key = pseudo ? pseudoElementOf(element, pseudo.replace(/^::?/, '')) : element;
            const box = layout.boxes.get(key);
            if (!box) {
                if (runs) loose = true;
                continue;
            }
            let entry = states.get(box);
            if (!entry) states.set(box, entry = { element, pseudo, props: new Set(), running: false, animations: [] });
            if (runs) entry.running = true;
            entry.animations.push(animation);
            for (const prop of animatedProperties(animation)) entry.props.add(prop);
        }
        for (const [box, { element, pseudo, props }] of states) {
            const values = readAnimated(getComputedStyle(element, pseudo), props, box.style);
            if (Object.keys(values).length) overrides.set(box, values);
        }
        return { overrides, running, loose, states };
    }

    /**
     * Put back the laid-out values of the boxes the last frame changed.
     * RenderSurface also calls this before a relayout, so kept boxes enter
     * the layout with what the last layout gave them.
     */
    restore() {
        for (const box of this.committed) {
            // A compositor layer's content did not change: its matrix and opacity draw it back
            if (box.compositor) box.compositor = null;
            else markChanged(box);
            const base = box.base;
            if (!base) continue;
            Object.assign(box, base.geometry);
            box.style = base.style;
            box.matrix = base.matrix;
            box.base = null;
        }
        this.committed = [];
    }

    /**
     * Record geometry targets for a new layout and start the transitions its
     * changes trigger. Only boxes stamped with a paint frame after the last
     * check can have new targets; their ancestors carry the stamp too, so the
     * walk reaches them without visiting kept subtrees.
     */
    noteLayout(layout, now) {
        const all = !this.layout;
        // Once a frame was drawn since the last check, stamps up to that
        // frame came before it (paint() draws right after apply())
        const since = paintClock.frame > this.checked ? this.checked + 1 : this.checked;
        this.layout = layout;
        this.checked = paintClock.frame;
        const order = layout.order;
        const live = new Set();
        for (const box of this.live) if (order[box.orderIndex] === box) live.add(box);
        const visit = (box) => {
            for (const child of box.children) {
                if (child.isText || !(all || child.changed > since)) continue;
                if (child.element && this.noteTargets(child, now)) live.add(child);
                visit(child);
            }
        };
        visit(layout.host);
        this.live = [...live].sort((a, b) => a.orderIndex - b.orderIndex);
    }

    /**
     * Record the geometry a leaf box transitions to and start a transition
     * when it changed. Returns true while the box has one running.
     */
    noteTargets(box, now) {
        const style = box.style;
        const el = box.element;
        const target = [box.absX, box.absY, box.width, box.height];
        const previous = this.targets.get(el);
        this.targets.set(el, target);
        let tweens = this.tweens.get(el);
        const transitions = style.transitions || [];
        const names = ['width', 'height', 'left', 'top', 'right', 'bottom', 'inset', 'margin', 'padding', 'transform'];
        const tr = transitions.find((entry) => entry.property === 'all' || names.includes(entry.property));
        const moved = previous && previous.some((v, i) => Math.abs(v - target[i]) >= 0.01);
        // Geometry only animates on leaf boxes (bars, thumbs, indicators)
        if (moved && tr && !box.children.some((c) => !c.isText)) {
            tweens = { geometry: { from: this.shown.get(el) || previous, to: target, start: now + tr.delay, duration: tr.duration, ease: easing(tr.easing) } };
            this.tweens.set(el, tweens);
        }
        if (!tweens) this.shown.set(el, target);
        return Boolean(tweens);
    }

    /** Step `box`'s geometry transition to `now` into `overrides`; true while it runs. */
    applyTransitions(box, now, overrides) {
        const el = box.element;
        const tw = this.tweens.get(el)?.geometry;
        if (!tw) return false;
        const raw = tw.duration > 0 ? (now - tw.start) / tw.duration : 1;
        if (raw >= 1) {
            this.tweens.delete(el);
            this.shown.set(el, tw.to);
            return false;
        }
        const k = tw.ease(Math.max(0, raw));
        const geometry = tw.from.map((v, i) => lerp(v, tw.to[i], k));
        overrides.geometry = geometry;
        this.shown.set(el, geometry);
        return true;
    }

    /**
     * Apply `overrides` to `box`; a compositor `layer` takes only its own
     * matrix and opacity (`handedOver`: a paint worker animates it).
     */
    commit(box, overrides, layer = false, handedOver = false) {
        // An ancestor's transform may have moved it already this frame
        box.base ??= baseOf(box);
        if (layer) box.compositor = { base: box.base.matrix || null, handedOver };
        else markChanged(box);
        this.committed.push(box);
        const style = { ...box.style };
        for (const [key, value] of Object.entries(overrides)) {
            if (key !== 'geometry' && key !== 'transform') style[key] = value;
        }
        box.style = style;
        if (overrides.geometry) {
            [box.absX, box.absY, box.width, box.height] = overrides.geometry;
        }
        if (overrides.transform != null) {
            // Replace the box's own transform; descendants follow
            const before = box.matrix;
            const world = layerMatrix(overrides.transform, box, style);
            box.matrix = world;
            const inverse = before ? invertAffine(before) : [1, 0, 0, 1, 0, 0];
            const delta = world ? (inverse ? multiplyAffine(world, inverse) : world) : (inverse || null);
            // A compositor layer's content stays as laid out
            if (delta && !layer) {
                const walk = (b) => {
                    for (const child of b.children) {
                        if (child.isText) continue;
                        child.base ??= baseOf(child);
                        const base = child.base.matrix;
                        child.matrix = base ? multiplyAffine(delta, base) : delta;
                        markChanged(child);
                        this.committed.push(child);
                        walk(child);
                    }
                };
                walk(box);
            }
        }
    }
}
