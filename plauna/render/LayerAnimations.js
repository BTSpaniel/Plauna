// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * LayerAnimations - transform and opacity animations of compositor layers,
 * sampled from their timing.
 *
 * The browser runs an element's transform and opacity animations on its
 * compositor thread, from their keyframes and timing, without the page's
 * main thread. Plauna's paint worker does the same for compositor layers
 * (AnimationController): describeAnimation() turns an Animation into plain
 * data on the main thread, and sampleAnimation() gives, on any thread, the
 * values getComputedStyle shows for it at a timeline time. They are computed
 * as Blink computes them (lengths in single precision, exact quarter turns,
 * its cubic-bezier solver) and written as it writes them (six significant
 * digits), so they go through the same parsing as values read from the page
 * and draw the same layer matrix.
 *
 * Covered: keyframe effects on transform (translate, scale, rotate and skew
 * functions in px and %, or none) and opacity, replacing the underlying
 * value, with any delay, duration, iteration count and start, direction,
 * fill, playback rate (or a held time: paused, finished, rate 0), and
 * keyframe and effect easing (linear, cubic-bezier, steps). Anything else
 * describes as null, and the main thread samples it every frame.
 *
 * Also here, shared by the main thread and the worker: how the layer's
 * matrix follows from a transform value (layerMatrix) and how the layer is
 * drawn back from it (compositeMatrixFor).
 */

import { multiplyAffine, invertAffine, parseTransform, parseTransformOrigin, splitWhitespace } from './css/CssValues.js';

// ── Easing (Blink: gfx::CubicBezier, StepsTimingFunction) ──────────────────

const SPLINE_SAMPLES = 11;
const NEWTON_ITERATIONS = 4;
const BEZIER_EPSILON = 1e-7;

/** A cubic-bezier easing solved as Chrome solves it (spline guess, Newton, then bisection). */
function cubicBezier(p1x, p1y, p2x, p2y) {
    const cx = 3.0 * p1x;
    const bx = 3.0 * (p2x - p1x) - cx;
    const ax = 1.0 - cx - bx;
    const cy = 3.0 * p1y;
    const by = 3.0 * (p2y - p1y) - cy;
    const ay = 1.0 - cy - by;
    const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
    const sampleY = (t) => ((ay * t + by) * t + cy) * t;
    const derivativeX = (t) => (3.0 * ax * t + 2.0 * bx) * t + cx;
    const samples = new Float64Array(SPLINE_SAMPLES);
    const delta = 1.0 / (SPLINE_SAMPLES - 1);
    for (let i = 0; i < SPLINE_SAMPLES; i++) samples[i] = sampleX(i * delta);
    // Gradients past the ends, for inputs outside 0..1
    const startGradient = p1x > 0 ? p1y / p1x : (!p1y && p2x > 0 ? p2y / p2x : (!p1y && !p2y ? 1 : 0));
    const endGradient = p2x < 1 ? (p2y - 1) / (p2x - 1) : (p2y === 1 && p1x < 1 ? (p1y - 1) / (p1x - 1) : (p2y === 1 && p1y === 1 ? 1 : 0));
    const solveX = (x, epsilon) => {
        let t0 = 0;
        let t1 = 0;
        let t2 = x;
        let x2 = 0;
        for (let i = 1; i < SPLINE_SAMPLES; i++) {
            if (x <= samples[i]) {
                t1 = delta * i;
                t0 = t1 - delta;
                t2 = t0 + (t1 - t0) * (x - samples[i - 1]) / (samples[i] - samples[i - 1]);
                break;
            }
        }
        const newtonEpsilon = Math.min(BEZIER_EPSILON, epsilon);
        for (let i = 0; i < NEWTON_ITERATIONS; i++) {
            x2 = sampleX(t2) - x;
            if (Math.abs(x2) < newtonEpsilon) return t2;
            const d2 = derivativeX(t2);
            if (Math.abs(d2) < BEZIER_EPSILON) break;
            t2 = t2 - x2 / d2;
        }
        if (Math.abs(x2) < epsilon) return t2;
        while (t0 < t1) {
            x2 = sampleX(t2);
            if (Math.abs(x2 - x) < epsilon) return t2;
            if (x > x2) t0 = t2;
            else t1 = t2;
            t2 = (t1 + t0) * 0.5;
        }
        return t2;
    };
    return (x) => {
        if (x < 0) return startGradient * x;
        if (x > 1) return 1 + endGradient * (x - 1);
        return sampleY(solveX(x, BEZIER_EPSILON));
    };
}

/** steps(n, position); `before` is the left limit at a step boundary. */
function steps(count, position) {
    const startOffset = position === 'start' || position === 'jump-start' || position === 'jump-both' ? 1 : 0;
    const jumps = position === 'jump-both' ? count + 1 : position === 'jump-none' ? count - 1 : count;
    return (t, before = false) => {
        let step = Math.floor(count * t + startOffset);
        if (before && count * t - Math.floor(count * t) === 0) step -= 1;
        if (t >= 0 && step < 0) step = 0;
        if (t <= 1 && step > jumps) step = jumps;
        return step / jumps;
    };
}

const PRESETS = {
    linear: null,
    ease: [0.25, 0.1, 0.25, 1.0],
    'ease-in': [0.42, 0.0, 1.0, 1.0],
    'ease-out': [0.0, 0.0, 0.58, 1.0],
    'ease-in-out': [0.42, 0.0, 0.58, 1.0]
};

const easings = new Map();

/** An easing function from its CSS text (null when not covered, e.g. linear() with points). */
export function easingFunction(text) {
    const key = String(text ?? 'linear').trim().toLowerCase();
    if (easings.has(key)) return easings.get(key);
    let fn = null;
    if (key === 'linear') fn = (t) => t;
    else if (PRESETS[key]) fn = cubicBezier(...PRESETS[key]);
    else if (key === 'step-start') fn = steps(1, 'start');
    else if (key === 'step-end') fn = steps(1, 'end');
    else {
        const bezier = /^cubic-bezier\(([^)]*)\)$/.exec(key);
        const stepped = /^steps\(\s*(\d+)\s*(?:,\s*([a-z-]+)\s*)?\)$/.exec(key);
        if (bezier) {
            const p = bezier[1].split(',').map(Number);
            if (p.length === 4 && p.every(Number.isFinite)) fn = cubicBezier(p[0], p[1], p[2], p[3]);
        } else if (stepped) {
            const count = parseInt(stepped[1], 10);
            const position = stepped[2] || 'end';
            if (count > 0 && ['start', 'end', 'jump-start', 'jump-end', 'jump-both', 'jump-none'].includes(position) && !(position === 'jump-none' && count < 2)) {
                fn = steps(count, position);
            }
        }
    }
    easings.set(key, fn);
    return fn;
}

// ── Transform values ────────────────────────────────────────────────────────

const ANGLE_UNITS = { deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360 };

function parseAngleText(text) {
    const m = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|rad|grad|turn)?$/i.exec(text.trim());
    if (!m) return null;
    const value = parseFloat(m[1]);
    if (!m[2]) return value === 0 ? 0 : null;
    return value * ANGLE_UNITS[m[2].toLowerCase()];
}

/** A length as Blink keeps it: { value (float; px zoomed), pct }; px and % only. */
function parseLengthText(text, zoom) {
    const m = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px|%)?$/i.exec(text.trim());
    if (!m) return null;
    const value = parseFloat(m[1]);
    if (!m[2]) return value === 0 ? { value: 0, pct: false } : null;
    const pct = m[2] === '%';
    return { value: Math.fround(pct ? value : value * zoom), pct };
}

function parseNumberText(text) {
    const m = /^(-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%)?$/i.exec(text.trim());
    if (!m) return null;
    return m[2] ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
}

/**
 * A transform value as a list of primitive operations ({ kind: translate |
 * scale | rotate | skew, ... }), [] for none, or null when it uses anything
 * else (matrix, 3D, other units, var()). Px lengths are kept zoomed.
 */
export function parseTransformOps(text, zoom = 1) {
    const value = String(text ?? '').trim();
    if (!value || value === 'none') return value === 'none' ? [] : null;
    const ops = [];
    const re = /\s*([a-zA-Z]+)\(([^()]*)\)\s*/gy;
    let match;
    let end = 0;
    while ((match = re.exec(value))) {
        end = re.lastIndex;
        const fn = match[1].toLowerCase();
        const args = match[2].split(',').map((s) => s.trim());
        let op = null;
        if (fn === 'translate' || fn === 'translatex' || fn === 'translatey') {
            const zero = { value: 0, pct: false };
            const a = parseLengthText(args[0] ?? '', zoom);
            const b = fn === 'translate' && args.length > 1 ? parseLengthText(args[1], zoom) : zero;
            if (a && b && args.length <= (fn === 'translate' ? 2 : 1)) op = { kind: 'translate', x: fn === 'translatey' ? zero : a, y: fn === 'translatey' ? a : b };
        } else if (fn === 'scale' || fn === 'scalex' || fn === 'scaley') {
            const a = parseNumberText(args[0] ?? '');
            const b = fn === 'scale' && args.length > 1 ? parseNumberText(args[1]) : (fn === 'scale' ? a : 1);
            if (a != null && b != null && args.length <= (fn === 'scale' ? 2 : 1)) op = { kind: 'scale', x: fn === 'scaley' ? 1 : a, y: fn === 'scaley' ? a : b };
        } else if (fn === 'rotate' || fn === 'rotatez') {
            const a = args.length === 1 ? parseAngleText(args[0]) : null;
            if (a != null) op = { kind: 'rotate', angle: a };
        } else if (fn === 'skew' || fn === 'skewx' || fn === 'skewy') {
            const a = parseAngleText(args[0] ?? '');
            const b = fn === 'skew' && args.length > 1 ? parseAngleText(args[1]) : 0;
            if (a != null && b != null && args.length <= (fn === 'skew' ? 2 : 1)) op = { kind: 'skew', x: fn === 'skewy' ? 0 : a, y: fn === 'skewy' ? a : b };
        }
        if (!op) return null;
        ops.push(op);
    }
    return end === value.length && ops.length ? ops : null;
}

function identityOp(kind) {
    if (kind === 'translate') return { kind, x: { value: 0, pct: false }, y: { value: 0, pct: false } };
    if (kind === 'scale') return { kind, x: 1, y: 1 };
    if (kind === 'rotate') return { kind, angle: 0 };
    return { kind, x: 0, y: 0 };
}

/** Whether two operation lists interpolate function by function (no matrix interpolation). */
export function opsMatch(a, b) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i].kind !== b[i].kind) return false;
    for (let i = 0; i < n; i++) {
        if (a[i].kind !== 'translate') continue;
        for (const axis of ['x', 'y']) {
            const p = a[i][axis];
            const q = b[i][axis];
            if (p.value !== 0 && q.value !== 0 && p.pct !== q.pct) return false;
        }
    }
    return true;
}

// Blink's blend of doubles (InterpolableNumber, Blend()) and of float lengths
function blend(from, to, t) {
    if (t === 0 || from === to) return from;
    if (t === 1) return to;
    return from * (1 - t) + to * t;
}

function blendLength(from, to, t) {
    if (t === 0) return from;
    if (t === 1) return to;
    if (from.value === 0 && to.value === 0) return to;
    const pct = to.value === 0 ? from.pct : to.pct;
    return { value: Math.fround(from.value * (1 - t) + to.value * t), pct };
}

function blendOps(from, to, t) {
    const n = Math.max(from.length, to.length);
    const out = [];
    for (let i = 0; i < n; i++) {
        const a = from[i] || identityOp(to[i].kind);
        const b = to[i] || identityOp(from[i].kind);
        if (a.kind === 'translate') out.push({ kind: 'translate', x: blendLength(a.x, b.x, t), y: blendLength(a.y, b.y, t) });
        else if (a.kind === 'scale') out.push({ kind: 'scale', x: blend(a.x, b.x, t), y: blend(a.y, b.y, t) });
        else if (a.kind === 'rotate') out.push({ kind: 'rotate', angle: blend(a.angle, b.angle, t) });
        else out.push({ kind: 'skew', x: blend(a.x, b.x, t), y: blend(a.y, b.y, t) });
    }
    return out;
}

// gfx::SinCosDegrees: exact at multiples of 90 degrees
function sinCosDegrees(degrees) {
    const quarters = degrees / 90;
    const n = Math.trunc(quarters);
    if (n === quarters) {
        const k = ((n % 4) + 4) % 4;
        return [[0, 1], [1, 0], [0, -1], [-1, 0]][k];
    }
    const rad = (degrees % 360) * (Math.PI / 180);
    return [Math.sin(rad), Math.cos(rad)];
}

// A Blink length resolved against a reference size (FloatValueForLength), in single precision
function lengthValue(length, size) {
    return length.pct ? Math.fround(Math.fround(size * length.value) / 100) : length.value;
}

/**
 * The matrix of an operation list for a reference box (layout px), applied
 * as Blink applies it, and written as getComputedStyle writes it.
 */
function serializeOps(ops, width, height, zoom) {
    if (!ops.length) return 'none';
    let a = 1;
    let b = 0;
    let c = 0;
    let d = 1;
    let e = 0;
    let f = 0;
    const w = Math.fround(width);
    const h = Math.fround(height);
    for (const op of ops) {
        if (op.kind === 'translate') {
            const x = lengthValue(op.x, w);
            const y = lengthValue(op.y, h);
            e += a * x + c * y;
            f += b * x + d * y;
        } else if (op.kind === 'scale') {
            // gfx::Transform::Scale takes floats
            const sx = Math.fround(op.x);
            const sy = Math.fround(op.y);
            a *= sx; b *= sx; c *= sy; d *= sy;
        } else if (op.kind === 'rotate') {
            const [s, k] = sinCosDegrees(op.angle);
            const na = a * k + c * s;
            const nb = b * k + d * s;
            const nc = a * -s + c * k;
            const nd = b * -s + d * k;
            a = na; b = nb; c = nc; d = nd;
        } else {
            const tx = Math.tan(op.x * (Math.PI / 180));
            const ty = Math.tan(op.y * (Math.PI / 180));
            const na = a + c * ty;
            const nb = b + d * ty;
            const nc = a * tx + c;
            const nd = b * tx + d;
            a = na; b = nb; c = nc; d = nd;
        }
    }
    const n = (v) => Number(v.toPrecision(6));
    // Unzoomed as AffineTransform::Zoom(1.f / zoom) unzooms it: by a float factor
    const unzoom = zoom === 1 ? 1 : Math.fround(1 / Math.fround(zoom));
    return `matrix(${n(a)}, ${n(b)}, ${n(c)}, ${n(d)}, ${n(e * unzoom)}, ${n(f * unzoom)})`;
}

// ── Timing (Web Animations, as Blink computes it) ──────────────────────────

/**
 * Iteration progress after the effect easing at local time `local`, or null
 * when the effect has no value then.
 */
function iterationProgress(timing, local, backwards) {
    const { delay, endDelay, duration, iterations, iterationStart, direction, fill } = timing;
    const activeDuration = duration === 0 || iterations === 0 ? 0 : duration * iterations;
    const endTime = Math.max(delay + activeDuration + endDelay, 0);
    const beforeBoundary = Math.max(Math.min(delay, endTime), 0);
    const afterBoundary = Math.max(Math.min(delay + activeDuration, endTime), 0);
    let phase = 'active';
    if (local < beforeBoundary || (backwards && local === beforeBoundary)) phase = 'before';
    else if (local > afterBoundary || (!backwards && local === afterBoundary)) phase = 'after';
    let activeTime = null;
    if (phase === 'before') activeTime = fill === 'backwards' || fill === 'both' ? Math.max(local - delay, 0) : null;
    else if (phase === 'active') activeTime = local - delay;
    else activeTime = fill === 'forwards' || fill === 'both' ? Math.max(Math.min(local - delay, activeDuration), 0) : null;
    if (activeTime == null) return null;
    let overall;
    if (duration === 0) overall = (phase === 'before' ? 0 : iterations) + iterationStart;
    else overall = activeTime / duration + iterationStart;
    let simple = Number.isFinite(overall) ? overall % 1 : iterationStart % 1;
    if (simple === 0 && (phase === 'active' || phase === 'after') && activeTime === activeDuration && iterations !== 0) simple = 1;
    let iteration;
    if (phase === 'after' && iterations === Infinity) iteration = Infinity;
    else if (simple === 1) iteration = Math.floor(overall) - 1;
    else iteration = Math.floor(overall);
    let directed = simple;
    if (direction !== 'normal') {
        let forwards = direction !== 'reverse';
        if (direction === 'alternate' || direction === 'alternate-reverse') {
            const even = iteration === Infinity || iteration % 2 === 0;
            forwards = direction === 'alternate' ? even : !even;
        }
        if (!forwards) directed = 1 - simple;
    }
    const ease = timing.ease;
    const before = phase === 'before';
    return { progress: ease ? ease(directed, before) : directed, before };
}

/** The keyframe interval holding `fraction` and the eased distance into it. */
function interval(frames, fraction, before) {
    const last = frames.length - 2;
    for (let i = 0; i <= last; i++) {
        const from = i === 0 ? -Infinity : frames[i].offset;
        const to = i === last ? Infinity : frames[i + 1].offset;
        if (!(fraction >= from && fraction < to)) continue;
        const length = frames[i + 1].offset - frames[i].offset;
        let local = length ? (fraction - frames[i].offset) / length : 0;
        if (frames[i].ease) local = frames[i].ease(local, before);
        return [frames[i], frames[i + 1], local];
    }
    return null;
}

// ── Describing and sampling ────────────────────────────────────────────────

const PROPERTIES = new Set(['transform', 'opacity']);

/**
 * Plain data for a transform/opacity Animation, or null when it is not
 * covered or has no value from its keyframes now (it is pending, before its
 * delay without backwards fill, or after its end without forwards fill).
 * `zoom` is the page's layout zoom (computed lengths are zoomed).
 */
export function describeAnimation(animation, zoom = 1) {
    const effect = animation?.effect;
    if (!effect || typeof effect.getKeyframes !== 'function' || animation.pending) return null;
    const state = animation.playState;
    if (state !== 'running' && state !== 'paused' && state !== 'finished') return null;
    const doc = effect.target?.ownerDocument;
    if (!doc || animation.timeline !== doc.timeline) return null;
    if ((effect.composite || 'replace') !== 'replace' || (effect.iterationComposite || 'replace') !== 'replace') return null;
    const computed = effect.getComputedTiming();
    const duration = typeof computed.duration === 'number' ? computed.duration : 0;
    const timing = {
        delay: computed.delay || 0,
        endDelay: computed.endDelay || 0,
        duration,
        iterations: computed.iterations,
        iterationStart: computed.iterationStart || 0,
        direction: computed.direction || 'normal',
        fill: computed.fill || 'none',
        easing: computed.easing || 'linear'
    };
    if (!easingFunction(timing.easing) || !(duration >= 0) || !(timing.iterations >= 0)) return null;
    let raw;
    try {
        raw = effect.getKeyframes();
    } catch {
        return null;
    }
    const tracks = {};
    for (const frame of raw) {
        if (frame.composite != null && frame.composite !== 'auto' && frame.composite !== 'replace') return null;
        for (const key of Object.keys(frame)) {
            if (key === 'offset' || key === 'computedOffset' || key === 'easing' || key === 'composite') continue;
            if (!PROPERTIES.has(key)) return null;
            const easing = frame.easing || 'linear';
            if (!easingFunction(easing)) return null;
            let value;
            if (key === 'transform') {
                value = parseTransformOps(frame[key], zoom);
                if (!value) return null;
            } else {
                value = parseFloat(frame[key]);
                if (!Number.isFinite(value)) return null;
            }
            (tracks[key] ??= []).push({ offset: frame.computedOffset ?? frame.offset, easing, value });
        }
    }
    const properties = Object.keys(tracks);
    if (!properties.length) return null;
    for (const key of properties) {
        const frames = tracks[key];
        // Keyframes at both ends: no underlying value to fill in
        if (frames.length < 2 || frames[0].offset !== 0 || frames[frames.length - 1].offset !== 1) return null;
        if (key === 'transform') {
            for (let i = 1; i < frames.length; i++) if (!opsMatch(frames[i - 1].value, frames[i].value)) return null;
        }
    }
    const startTime = animation.startTime;
    const rate = animation.playbackRate;
    // Paused, finished or at rate 0: the time holds
    const holdTime = startTime == null || state !== 'running' || rate === 0 ? animation.currentTime : null;
    if (holdTime == null && startTime == null) return null;
    const desc = {
        timing,
        tracks,
        startTime: holdTime == null ? startTime : null,
        holdTime,
        rate,
        zoom,
        endsAt: Infinity
    };
    if (holdTime == null && animation.currentTime == null) return null;
    if (sampleValues(desc, holdTime ?? animation.currentTime) == null) return null;
    // When a running animation leaves the values its keyframes give
    if (holdTime == null && rate !== 0) {
        const activeDuration = duration === 0 ? 0 : duration * timing.iterations;
        const endTime = Math.max(timing.delay + activeDuration + timing.endDelay, 0);
        const boundary = rate > 0
            ? Math.max(Math.min(timing.delay + activeDuration, endTime), 0)
            : Math.max(Math.min(timing.delay, endTime), 0);
        if (Number.isFinite(boundary)) desc.endsAt = startTime + boundary / rate;
    }
    return desc;
}

const compiled = new WeakMap();

// Easing functions for a description (descriptions are plain data, posted between threads)
function prepare(desc) {
    let ready = compiled.get(desc);
    if (!ready) {
        ready = {
            timing: { ...desc.timing, ease: desc.timing.easing === 'linear' ? null : easingFunction(desc.timing.easing) },
            tracks: {}
        };
        for (const [key, frames] of Object.entries(desc.tracks)) {
            ready.tracks[key] = frames.map((frame) => ({ ...frame, ease: frame.easing === 'linear' ? null : easingFunction(frame.easing) }));
        }
        compiled.set(desc, ready);
    }
    return ready;
}

function sampleValues(desc, local) {
    const ready = prepare(desc);
    const at = iterationProgress(ready.timing, local, desc.rate < 0);
    if (at == null) return null;
    const out = {};
    for (const [key, frames] of Object.entries(ready.tracks)) {
        const hit = interval(frames, at.progress, at.before);
        if (!hit) return null;
        const [from, to, t] = hit;
        out[key] = key === 'transform' ? blendOps(from.value, to.value, t) : blend(from.value, to.value, t);
    }
    return out;
}

/**
 * The values getComputedStyle shows for a described animation at timeline
 * time `now` (ms), for an element whose reference box is width x height
 * (CSS px): { transform?: 'matrix(...)' | 'none', opacity?: '0.5' }, or null
 * when its keyframes give no value then.
 */
export function sampleAnimation(desc, now, width, height) {
    const local = desc.holdTime ?? (now - desc.startTime) * desc.rate;
    const values = sampleValues(desc, local);
    if (!values) return null;
    const out = {};
    if (values.transform) out.transform = serializeOps(values.transform, width * desc.zoom, height * desc.zoom, desc.zoom);
    if (values.opacity != null) out.opacity = String(Number(Math.fround(Math.min(1, Math.max(0, values.opacity))).toPrecision(6)));
    return out;
}

/** True when a described animation's values change with time. */
export function animationRuns(desc) {
    return desc.holdTime == null && desc.rate !== 0;
}

// Animations whose description another thread holds -> called when they change
const watchers = new WeakMap();
const listened = new WeakSet();
let hooked = false;

/**
 * Call `onChange` whenever `animation` changes in a way its description does
 * not foresee: played, paused, reversed, finished, cancelled or removed, its
 * time, start time, rate, timing, keyframes or target set. The browser tells
 * its compositor the same; a CSS change (animation-play-state, a class)
 * reaches the surface as a mutation instead.
 */
export function watchAnimation(animation, onChange) {
    hookAnimations();
    watchers.set(animation, onChange);
    if (animation.effect) watchers.set(animation.effect, onChange);
    if (!listened.has(animation)) {
        listened.add(animation);
        const notify = () => watchers.get(animation)?.();
        for (const type of ['finish', 'cancel', 'remove']) animation.addEventListener(type, notify);
    }
}

function hookAnimations() {
    if (hooked || typeof Animation === 'undefined') return;
    hooked = true;
    const notify = (target) => watchers.get(target)?.();
    const method = (proto, name) => {
        const original = proto?.[name];
        if (typeof original !== 'function') return;
        Object.defineProperty(proto, name, {
            configurable: true,
            writable: true,
            value: function (...args) {
                try {
                    return original.apply(this, args);
                } finally {
                    notify(this);
                }
            }
        });
    };
    const setter = (proto, name) => {
        const d = proto && Object.getOwnPropertyDescriptor(proto, name);
        if (!d?.set) return;
        Object.defineProperty(proto, name, {
            ...d,
            set(value) {
                d.set.call(this, value);
                notify(this);
            }
        });
    };
    for (const name of ['play', 'pause', 'reverse', 'finish', 'cancel', 'updatePlaybackRate']) method(Animation.prototype, name);
    for (const name of ['currentTime', 'startTime', 'playbackRate', 'effect', 'timeline']) setter(Animation.prototype, name);
    if (typeof AnimationEffect !== 'undefined') method(AnimationEffect.prototype, 'updateTiming');
    if (typeof KeyframeEffect !== 'undefined') {
        method(KeyframeEffect.prototype, 'setKeyframes');
        for (const name of ['target', 'pseudoElement', 'composite', 'iterationComposite']) setter(KeyframeEffect.prototype, name);
    }
}

// ── Layer matrices (shared with AnimationController and DisplayList) ────────

/** transform plus the individual translate, rotate and scale, as StyleResolver combines them. */
export function combinedTransform(cs) {
    const parts = [];
    const t = splitWhitespace(String(cs.translate || 'none').trim());
    if (t[0] && t[0] !== 'none') parts.push(`translate(${t[0]}, ${t[1] || '0px'})`);
    const r = splitWhitespace(String(cs.rotate || 'none').trim());
    if (r[0] && r[0] !== 'none') {
        const angle = r[r.length - 1];
        const axis = r.slice(0, -1).join(' ').toLowerCase();
        if (!axis || axis === 'z' || axis === '0 0 1') parts.push(`rotate(${angle})`);
    }
    const s = splitWhitespace(String(cs.scale || 'none').trim()).map((v) => (v.endsWith('%') ? String(parseFloat(v) / 100) : v));
    if (s[0] && s[0] !== 'none') parts.push(`scale(${s[0]}, ${s[1] || s[0]})`);
    const transform = cs.transform || 'none';
    if (!parts.length) return transform;
    if (transform !== 'none') parts.push(transform);
    return parts.join(' ');
}

/**
 * A box's matrix with transform value `transform` in place of its own:
 * about its transform origin, after its parent's matrix. `box` gives width,
 * height, absX, absY and parentMatrix; `style` fontSize and transformOrigin.
 */
export function layerMatrix(transform, box, style) {
    const parent = box.parentMatrix || null;
    const m = parseTransform(transform, box.width, box.height, { fontSize: style.fontSize });
    if (!m) return parent;
    const [tx, ty] = parseTransformOrigin(style.transformOrigin, box.width, box.height);
    const ox = box.absX + tx;
    const oy = box.absY + ty;
    const local = multiplyAffine(multiplyAffine([1, 0, 0, 1, ox, oy], m), [1, 0, 0, 1, -ox, -oy]);
    return parent ? multiplyAffine(parent, local) : local;
}

const roundPx = (v) => Math.round(v + 1e-6);

function isTranslation(m) {
    return Math.abs(m[0] - 1) < 1e-9 && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && Math.abs(m[3] - 1) < 1e-9;
}

const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);

/**
 * The matrix a compositor layer is drawn back with (DisplayList
 * compositeMatrix): `matrix` is the root's animated matrix, `place` holds
 * base (its laid-out matrix), outer (the painted matrix above it), absX,
 * absY, gridX, gridY, layoutPx and dpr.
 */
export function compositeMatrixFor(matrix, place) {
    const { base, outer } = place;
    let m = matrix || IDENTITY;
    if (!isTranslation(m) || (outer && !isTranslation(outer))) {
        const z = place.layoutPx;
        const x = place.absX + (outer ? outer[4] : 0);
        const y = place.absY + (outer ? outer[5] : 0);
        const dx = roundPx((x - place.gridX) * z) / z + place.gridX - x;
        const dy = roundPx((y - place.gridY) * z) / z + place.gridY - y;
        const d = place.dpr;
        const sx = roundPx((place.absX - place.gridX) * d) / d + place.gridX - place.absX;
        const sy = roundPx((place.absY - place.gridY) * d) / d + place.gridY - place.absY;
        m = multiplyAffine([m[0], m[1], m[2], m[3], m[4] + dx, m[5] + dy], [1, 0, 0, 1, -sx, -sy]);
    }
    return base ? multiplyAffine(m, invertAffine(base)) : m;
}
