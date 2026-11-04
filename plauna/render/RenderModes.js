// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Plauna render modes.
 *
 *   'dom'  - the browser lays out and paints the element tree.
 *   'gpu'  - Plauna lays out the tree itself and paints it with WebGPU; the
 *            tree stays in the page, invisible, for input and accessibility.
 *   'auto' - GPU in a Chromium browser with WebGPU, DOM otherwise (Chrome is
 *            the browser GPU mode is measured against). Native content
 *            (video, iframes, canvases, plugins) no longer sends it to the
 *            DOM: the surface shows it through a well (NativeWell.js).
 *
 * In 'gpu' and 'auto' a surface whose GPU rendering fails (it cannot start,
 * or a frame throws or raises a GPU validation or out-of-memory error) shows
 * the DOM until its mode is requested again.
 */

export const RENDER_MODES = Object.freeze(['dom', 'gpu', 'auto']);

export function normalizeRenderMode(mode, fallback = 'dom') {
    const value = String(mode || '').toLowerCase();
    return RENDER_MODES.includes(value) ? value : fallback;
}

/** True when the browser exposes WebGPU. */
export function gpuAvailable() {
    return typeof navigator !== 'undefined' && Boolean(navigator.gpu);
}

/** Whether `nav` is a Chromium browser (Chrome, Edge, Opera, headless Chrome...). */
export function isChromium(nav = globalThis.navigator) {
    const brands = nav?.userAgentData?.brands;
    if (Array.isArray(brands) && brands.length) return brands.some((entry) => String(entry?.brand ?? '') === 'Chromium');
    const agent = String(nav?.userAgent ?? '');
    return /\b(?:Chrome|Chromium|HeadlessChrome)\/\d/.test(agent) && !/\b(?:Edge|Firefox|FxiOS|CriOS)\//.test(agent);
}

/**
 * The mode a request resolves to: 'dom' or 'gpu'. state: gpu (WebGPU is
 * there), chromium (auto takes the GPU only there), failed (GPU rendering
 * failed since the mode was last requested), lost (the device was lost a
 * moment ago: auto waits before trying again).
 */
export function decideRenderMode(requested, state = {}) {
    const mode = normalizeRenderMode(requested, 'dom');
    const { gpu = gpuAvailable(), chromium = isChromium(), failed = false, lost = false } = state;
    if (mode === 'dom' || !gpu || failed) return 'dom';
    if (mode === 'gpu') return 'gpu';
    return chromium && !lost ? 'gpu' : 'dom';
}

// Content only the browser can paint: GPU mode shows it through a well (NativeWell.js)
export const DOM_ONLY_SELECTOR = 'video, iframe, canvas, object, embed, audio[controls]';

/** Elements in `scene` only the browser can paint (shown through wells in GPU mode), or an empty list. */
export function domOnlyContent(scene) {
    if (!scene?.querySelectorAll) return [];
    return [...scene.querySelectorAll(DOM_ONLY_SELECTOR)];
}

/** The GPUDevice behind a VGPU instance, a lease, or a device itself. */
export function resolveGpuDevice(gpu) {
    if (!gpu) return null;
    if (typeof gpu.createBuffer === 'function' && gpu.queue) return gpu;
    const device = gpu.device || gpu.vgpu?.device || (typeof gpu.getDevice === 'function' ? gpu.getDevice() : null);
    return device && typeof device.createBuffer === 'function' ? device : null;
}

let sharedLease = null;
let sharedPromise = null;

/**
 * The GPU device Plauna surfaces share when the host provides none.
 * Resolves to a GPUDevice or rejects when WebGPU is unavailable.
 */
export function sharedGpuDevice() {
    if (sharedLease && !sharedLease.released && !sharedLease.gpuDevice?.lost) return Promise.resolve(sharedLease.device);
    if (!sharedPromise) {
        sharedPromise = import('../../engine/core/gpu/GpuDeviceOwnership.js')
            .then(({ acquireGpuDeviceForConsumer }) => acquireGpuDeviceForConsumer({ ownerId: 'plauna.render', ownership: 'standalone-fallback', label: 'plauna.render' }))
            .then((lease) => {
                sharedLease = lease;
                lease.device.lost?.then(() => {
                    if (sharedLease === lease) { sharedLease = null; sharedPromise = null; }
                });
                return lease.device;
            })
            .catch((error) => {
                sharedPromise = null;
                throw error;
            });
    }
    return sharedPromise;
}
