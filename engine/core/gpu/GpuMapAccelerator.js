// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Low-latency GPU readback.
 *
 * Firefox's WebGPU resolves mapAsync only when its GPU process next polls the
 * device, roughly every 100 ms. Each queue.submit() prompts an immediate poll,
 * so submitting empty command lists while a map is pending cuts the round
 * trip from ~109 ms to ~1-2 ms. Chromium resolves maps in a few ms on its own,
 * and sustained pokes only queue hundreds of empty submits per map on its GPU
 * wire, so each device calibrates over its first readbacks and keeps the poke
 * only when it saves a poll interval: at least twice as fast and by at least
 * MIN_POKE_GAIN_MS. This changes only when the CPU notices finished GPU work;
 * results are unaffected.
 *
 * WebGPU OS broker facades (`__isGpuFacade`) take the plain path: the broker
 * meters every submit against the app's authority and command budget, so an
 * empty poke could spend a one-shot authority. The kernel's own frame submits
 * already make Firefox poll, so those maps settle within a frame.
 */

const CALIBRATION_SAMPLES = 4;         // per strategy
// Each strategy samples two even and two odd readbacks, so a caller that maps
// twice per submit (a slow map, then one whose copy already finished) cannot
// make either strategy look faster.
const CALIBRATION_ORDER = ['none', 'submit', 'submit', 'none', 'none', 'submit', 'submit', 'none'];
const FAST_POKE_WINDOW_MS = 250;       // macrotask pokes; slower timer pokes afterwards
const MIN_POKE_GAIN_MS = 8;            // Chromium shows <= ~6 ms; Firefox >= ~10 ms at a 60 Hz frame loop
const states = new WeakMap();

// Captured at load: hardened callers (VirtualGPU, GPUTimestampProfiler) pass
// promises while host code may have replaced Promise.resolve/then.
const NATIVE_PROMISE = Promise;
const NATIVE_PROMISE_RESOLVE = Promise.resolve;
const NATIVE_PROMISE_THEN = Promise.prototype.then;
const NATIVE_HAS_INSTANCE = Function.prototype[Symbol.hasInstance];
const NATIVE_GPU_QUEUE = typeof GPUQueue === 'function' ? GPUQueue : null;
const resolvePromise = value => Reflect.apply(NATIVE_PROMISE_RESOLVE, NATIVE_PROMISE, [value]);
const thenPromise = (promise, onSettled) => Reflect.apply(NATIVE_PROMISE_THEN, promise, [onSettled, onSettled]);

let channel = null; const waiters = [];
function nextTask() {
    if (!channel) {
        channel = new MessageChannel();
        channel.port1.onmessage = () => waiters.shift()?.();
    }
    return new NATIVE_PROMISE(resolve => { waiters.push(resolve); channel.port2.postMessage(0); });
}
const sleep = ms => new NATIVE_PROMISE(resolve => setTimeout(resolve, ms));
const median = values => [...values].sort((a, b) => a - b)[values.length >> 1];

function stateFor(device) {
    let state = states.get(device);
    if (!state) { state = { strategy: null, samples: { none: [], submit: [] } }; states.set(device, state); }
    return state;
}

function chooseStrategy(state) {
    if (state.strategy) return state.strategy;
    const { none, submit } = state.samples;
    if (none.length >= CALIBRATION_SAMPLES && submit.length < CALIBRATION_SAMPLES) return 'submit';
    if (submit.length >= CALIBRATION_SAMPLES && none.length < CALIBRATION_SAMPLES) return 'none';
    if (none.length < CALIBRATION_SAMPLES) return CALIBRATION_ORDER[none.length + submit.length];
    // Keep the poke only when it is clearly better (it costs CPU while waiting).
    const plain = median(none), poked = median(submit);
    state.strategy = poked < 0.5 * plain && plain - poked >= MIN_POKE_GAIN_MS ? 'submit' : 'none';
    return state.strategy;
}

// Forward exactly the arguments the caller gave, as a direct call would.
const requestMap = (buffer, mode, offset, size) => size === undefined
    ? (offset === undefined ? buffer.mapAsync(mode) : buffer.mapAsync(mode, offset))
    : buffer.mapAsync(mode, offset, size);

// The queue to poke, or null for the plain path. Only a real GPUQueue (or a
// Proxy over one) is poked: test doubles record submits, and broker facades
// meter them. submit is captured once, so host changes mid-wait are ignored.
function pokeAuthority(device) {
    if (device.__isGpuFacade === true || !NATIVE_GPU_QUEUE) return null;
    try {
        const queue = device.queue;
        if (!Reflect.apply(NATIVE_HAS_INSTANCE, NATIVE_GPU_QUEUE, [queue])) return null;
        const submit = queue.submit;
        return typeof submit === 'function' ? { queue, submit } : null;
    } catch (_) { return null; }
}

async function pokeWhilePending(poke, pending, started) {
    let settled = false;
    thenPromise(pending, () => { settled = true; });
    await null;    // a wait that had already settled needs no poke
    try {
        while (!settled) {
            Reflect.apply(poke.submit, poke.queue, [[]]);
            await (performance.now() - started < FAST_POKE_WINDOW_MS ? nextTask() : sleep(4));
        }
    } catch (_) {}
}

// Samples (while calibrating) and pokes alongside one already-requested wait.
function track(state, strategy, poke, started, pending) {
    const settles = resolvePromise(pending);
    if (!state.strategy) {
        thenPromise(settles, () => {
            if (!state.strategy) state.samples[strategy].push(performance.now() - started);
        });
    }
    if (strategy === 'submit') pokeWhilePending(poke, settles, started);
}

/**
 * Drop-in replacement for buffer.mapAsync(mode, offset, size) with low latency.
 * Returns the buffer's own mapAsync promise, so resolution order, rejection
 * and synchronous throws match a direct call; pokes run alongside it.
 * @param {GPUDevice} device the device that owns the buffer
 */
export function acceleratedMapAsync(device, buffer, mode, offset, size) {
    const poke = pokeAuthority(device);
    if (!poke) return requestMap(buffer, mode, offset, size);
    const state = stateFor(device), strategy = chooseStrategy(state);
    const started = performance.now();
    const mapping = requestMap(buffer, mode, offset, size);
    track(state, strategy, poke, started, mapping);
    return mapping;
}

/**
 * Low-latency wait for GPU work the caller already requested: a mapAsync made
 * through the caller's own captured authority, or queue.onSubmittedWorkDone().
 * Call it right after the request. Shares acceleratedMapAsync's per-device
 * calibration. Returns `pending` unchanged and never throws, so the caller's
 * promise settles exactly as it would alone.
 * @param {GPUDevice} device the device whose queue completes the work
 * @param {Promise} pending the promise the request returned
 */
export function acceleratePending(device, pending) {
    try {
        const poke = pokeAuthority(device);
        if (poke) {
            const state = stateFor(device);
            track(state, chooseStrategy(state), poke, performance.now(), pending);
        }
    } catch (_) {}
    return pending;
}

/** Calibration result for diagnostics: null while still calibrating. */
export function mapAccelerationStrategy(device) { return states.get(device)?.strategy ?? null; }
