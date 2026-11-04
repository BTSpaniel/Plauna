// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * PaintWorkerHost - the main thread's side of a surface painted in a worker.
 *
 * A standalone surface (a RenderSurface with a canvas of its own and no host
 * device) hands its canvas to a worker (PaintWorker.js) that owns the GPU
 * device, the painter, the atlas pages and the cached layers. The main
 * thread keeps style, layout, display-list building and rasterization, with
 * RemotePainter standing in for GpuPainter: atlas regions are packed here,
 * exactly as AtlasCache packs them (its VGPUTextureAtlas pages run with
 * their GPU calls recorded instead of made), and each frame posts what the
 * worker needs to draw it: the item ranges that changed since the last
 * frame, the layer commands and colour filters, the rasters drawn since
 * (as ImageBitmaps) and the compositor layers whose animations the worker
 * samples from their timing (LayerAnimations). While those are the only
 * motion on the page, the main thread posts nothing and runs no frames.
 */

import { VGPUTextureAtlas } from '../../../engine/core/gpu/VGPUTextureAtlas.js';
import { FLOATS_PER_ITEM, FLOATS_PER_FILTER } from './shaders.js';

// The painter module (and the engine GPU stack under it) loads while the worker starts
let painterModule = null;
function loadPainterModule() {
    painterModule ??= import('./GpuPainter.js');
    return painterModule;
}

/** Whether this page can hand a canvas to a worker to paint. */
export function paintWorkerAvailable() {
    return typeof Worker === 'function' && typeof OffscreenCanvas === 'function' && typeof createImageBitmap === 'function'
        && typeof HTMLCanvasElement !== 'undefined' && typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';
}

/**
 * An ImageBitmap of the top-left w x h of a canvas as it is now: the
 * snapshot is taken in this call, before the canvas is cleared or drawn
 * again; the promise resolves later.
 */
function snapshot(source, w, h) {
    return createImageBitmap(source, 0, 0, w, h).catch(() => null);
}

/**
 * A stand-in VirtualGPU for main-thread atlas pages: VGPUTextureAtlas packs
 * against it as against a device, and its uploads are recorded as ops for
 * the worker to make (page index, origin, size, source snapshot).
 */
function recordingVgpu(limits, record) {
    const shim = {
        pageOf: new Map(),
        pages: 0,
        record,
        device: {
            limits,
            createTexture: (desc) => ({ label: desc?.label, destroy() {}, createView: () => ({}) })
        },
        queue: {
            copyExternalImageToTexture(source, destination, size) {
                record({
                    op: 'image', page: shim.pageOf.get(destination.texture),
                    x: destination.origin?.x || 0, y: destination.origin?.y || 0,
                    w: size.width, h: size.height, source: snapshot(source.source, size.width, size.height)
                });
            },
            writeTexture(destination, data, layout, size) {
                const bytes = ArrayBuffer.isView(data) ? data : new Uint8Array(data);
                record({
                    op: 'write', page: shim.pageOf.get(destination.texture),
                    x: destination.origin?.x || 0, y: destination.origin?.y || 0,
                    w: size.width, h: size.height, bytesPerRow: layout.bytesPerRow,
                    data: new Uint8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
                });
            }
        },
        createAtlas(options) {
            const atlas = new VGPUTextureAtlas(shim, options);
            const index = shim.pages++;
            shim.pageOf.set(atlas.getTexture(), index);
            record({ op: 'page', index, width: atlas.width, height: atlas.height, format: atlas.format });
            return atlas;
        }
    };
    return shim;
}

let RemoteAtlasCache = null;

/** AtlasCache whose staged rasters go to the worker as one ImageBitmap per flush. */
function remoteAtlasCache(AtlasCache) {
    RemoteAtlasCache ??= class extends AtlasCache {
        flush() {
            const s = this.staging;
            if (!s || !this.staged.length) return;
            const pad = this.pages[0].atlas.padding;
            const width = s.width + pad;
            const height = s.y + pad;
            this.vgpu.record({
                op: 'staged', source: snapshot(s.canvas, width, height), w: width, h: height,
                canvasWidth: s.canvas.width, canvasHeight: s.canvas.height, padding: pad,
                copies: this.staged.map(({ entry, y }) => [entry.page, entry.region.x, entry.region.y, entry.w, entry.h, y])
            });
            s.ctx.clearRect(0, 0, width, height);
            s.y = 0;
            s.width = 0;
            this.staged = [];
        }
    };
    return RemoteAtlasCache;
}

let nextKeyId = 1;
const keyIds = new WeakMap();

/** A cached layer's key as a number the worker keeps its texture by. */
function keyId(key) {
    let id = keyIds.get(key);
    if (id == null) keyIds.set(key, id = nextKeyId++);
    return id;
}

/** Plain copies of a frame's layer commands (layer-end keeps its layer-begin by reference). */
function plainCommands(commands) {
    const copies = new Map();
    return commands.map((cmd) => {
        const copy = { type: cmd.type, at: cmd.at };
        if (cmd.type === 'layer-begin') {
            copy.blur = cmd.blur;
            copy.bounds = cmd.bounds;
            copy.key = cmd.key == null ? null : keyId(cmd.key);
        } else if (cmd.type === 'layer-end') {
            copy.begin = copies.get(cmd.begin);
            copy.page = cmd.page;
        } else if (cmd.type === 'backdrop') {
            copy.item = cmd.item;
            copy.page = cmd.page;
            copy.rect = cmd.rect;
            copy.blur = cmd.blur;
            copy.filter = cmd.filter;
        }
        copies.set(cmd, copy);
        return copy;
    });
}

// A worker whose surface left GPU mode, kept with its device and modules for
// the next surface that starts (a switch back to GPU mode costs no new device)
let parked = null;

/**
 * Start a paint worker for `canvases` (a surface's, not yet given a
 * context; frames name the one they draw into). Resolves to a RemotePainter
 * once the worker has a device and its painter, or rejects when it cannot
 * (no worker, no adapter or device, a module that fails; `error.parked`
 * when a parked worker could not take the canvases).
 * The worker starts at once; the painter module loads here meanwhile.
 */
export async function startPaintWorker(canvases, options = {}) {
    const offscreens = canvases.map((canvas) => canvas.transferControlToOffscreen());
    const reused = parked;
    parked = null;
    const worker = reused || new Worker(new URL('./PaintWorker.js', import.meta.url), { type: 'module', name: 'plauna-paint' });
    const ready = new Promise((resolve, reject) => {
        worker.onerror = (event) => {
            event.preventDefault?.();
            reject(new Error(`Paint worker failed to start: ${event.message || 'error'}`));
        };
        worker.onmessage = (event) => {
            const msg = event.data;
            if (msg?.type === 'ready') resolve(msg);
            else if (msg?.type === 'failed') reject(new Error(msg.message || 'Paint worker has no GPU device'));
        };
    });
    worker.postMessage({ type: 'init', canvases: offscreens, timeOrigin: performance.timeOrigin }, offscreens);
    try {
        const [painter, info] = await Promise.all([loadPainterModule(), ready]);
        worker.onerror = null;
        return new RemotePainter(worker, info, options, painter);
    } catch (error) {
        worker.terminate();
        if (reused) error.parked = true;
        throw error;
    }
}

/** Keep `worker` (its surface's painter destroyed) for the next surface; one is kept at a time. */
function park(worker) {
    if (parked) parked.terminate();
    parked = worker;
    worker.onerror = null;
    // A device lost while parked is of no use to the next surface
    worker.onmessage = (event) => {
        if (event.data?.type !== 'lost') return;
        worker.terminate();
        if (parked === worker) parked = null;
    };
    worker.postMessage({ type: 'park' });
}

/**
 * Stands in for GpuPainter on the main thread (what DisplayListBuilder and
 * Rasterizer use: items, atlas, colour filters, device limits) and posts
 * frames to the worker. options: onLost(info), onEnded(), onError(message),
 * onShown(id) (a frame posted with `ack: id` is on its canvas);
 * `painter` is the GpuPainter module.
 */
export class RemotePainter {
    constructor(worker, info, options, painter) {
        this.worker = worker;
        this.format = info.format;
        this.device = { limits: { maxTextureDimension2D: info.maxTextureDimension2D } };
        // The colour filter table works as the in-thread painter's does
        this.filters = painter.GpuPainter.prototype;
        this.items = new painter.ItemBuffer();
        this.filterData = new Float32Array(FLOATS_PER_FILTER * 16);
        this.filterCount = 0;
        this.ops = [];
        this.vgpu = recordingVgpu(this.device.limits, (op) => this.ops.push(op));
        this.atlas = new (remoteAtlasCache(painter.AtlasCache))(this.vgpu, {});
        // What the worker holds: items, pages, count, and the filters
        this.sent = new Float32Array(0);
        this.sentPages = new Uint16Array(0);
        this.sentCount = 0;
        this.sentFilters = null;
        // Posts waiting for their rasters' ImageBitmaps, in order
        this.queue = null;
        this.waiting = 0;
        this.captures = new Map();
        this.nextCapture = 1;
        this.destroyed = false;
        this.lost = false;
        options ??= {};
        this.onLost = options.onLost || null;
        this.onEnded = options.onEnded || null;
        this.onError = options.onError || null;
        this.onShown = options.onShown || null;
        worker.onmessage = (event) => this.receive(event.data);
        worker.onerror = (event) => {
            event.preventDefault?.();
            this.onError?.(event.message || 'paint worker error');
        };
    }

    receive(msg) {
        if (this.destroyed || !msg) return;
        if (msg.type === 'lost') {
            this.lost = true;
            this.onLost?.(msg);
        } else if (msg.type === 'shown') this.onShown?.(msg.id);
        else if (msg.type === 'ended') this.onEnded?.();
        else if (msg.type === 'error') this.onError?.(msg.message);
        else if (msg.type === 'captured') {
            const done = this.captures.get(msg.id);
            this.captures.delete(msg.id);
            done?.(msg.error ? null : msg);
        }
    }

    /**
     * Post a frame: `viewport` (scene px) at options.dpr into canvas
     * options.canvas (an index into the canvases the worker was given), of
     * options.width x options.height device px (unchanged when not given);
     * with options.ack the worker reports it `shown` once on that canvas.
     * options.composites (DisplayListBuilder) and options.layers (box ->
     * track, AnimationController.offloaded) name the compositor layers the
     * worker animates.
     */
    render(view, viewport, options = {}) {
        if (this.destroyed) return;
        this.atlas.flush();
        const message = {
            type: 'frame',
            viewport: { x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height },
            dpr: options.dpr || 1,
            time: options.time || 0,
            width: options.width || 0,
            height: options.height || 0,
            canvas: options.canvas || 0,
            ack: options.ack || 0,
            commands: plainCommands(this.items.commands),
            layers: []
        };
        this.packItems(message);
        this.packFilters(message);
        const layers = options.layers;
        if (layers?.size) {
            for (const entry of options.composites || []) {
                const track = layers.get(entry.root);
                if (track) message.layers.push({ at: entry.at, opacity: entry.opacity, place: entry.place, track });
            }
        }
        const ops = this.ops;
        this.ops = [];
        this.post(message, ops);
    }

    /** The item ranges that differ from what the worker holds. */
    packItems(message) {
        const items = this.items;
        const n = items.count;
        const F = FLOATS_PER_ITEM;
        if (this.sent.length < n * F) {
            const grown = new Float32Array(Math.max(n * F, this.sent.length * 2));
            grown.set(this.sent);
            this.sent = grown;
            const pages = new Uint16Array(Math.max(n, this.sentPages.length * 2));
            pages.set(this.sentPages);
            this.sentPages = pages;
        }
        const now = new Uint32Array(items.data.buffer, items.data.byteOffset, n * F);
        const was = new Uint32Array(this.sent.buffer, 0, n * F);
        const ranges = [];
        let start = -1;
        let total = 0;
        for (let i = 0; i < n; i++) {
            let same = i < this.sentCount && items.pages[i] === this.sentPages[i];
            if (same) {
                for (let k = i * F, end = k + F; k < end; k++) {
                    if (now[k] !== was[k]) {
                        same = false;
                        break;
                    }
                }
            }
            if (!same && start < 0) start = i;
            if (same && start >= 0) {
                ranges.push(start, i);
                total += i - start;
                start = -1;
            }
        }
        if (start >= 0) {
            ranges.push(start, n);
            total += n - start;
        }
        const data = new Float32Array(total * F);
        const pages = new Uint16Array(total);
        let o = 0;
        for (let r = 0; r < ranges.length; r += 2) {
            const a = ranges[r];
            const b = ranges[r + 1];
            data.set(items.data.subarray(a * F, b * F), o * F);
            pages.set(items.pages.subarray(a, b), o);
            this.sent.set(items.data.subarray(a * F, b * F), a * F);
            this.sentPages.set(items.pages.subarray(a, b), a);
            o += b - a;
        }
        this.sentCount = n;
        message.count = n;
        message.ranges = ranges;
        message.data = data;
        message.pages = pages;
    }

    packFilters(message) {
        const n = this.filterCount * FLOATS_PER_FILTER;
        const was = this.sentFilters;
        let same = was && was.length === n;
        for (let k = 0; same && k < n; k++) if (Object.is(was[k], this.filterData[k]) === false) same = false;
        if (same) return;
        this.sentFilters = this.filterData.slice(0, n);
        message.filters = this.filterData.slice(0, n);
        message.filterCount = this.filterCount;
    }

    /** Post `message` once its rasters are ImageBitmaps; posts keep their order. */
    post(message, ops) {
        const send = (bitmaps) => {
            if (this.destroyed) {
                for (const bitmap of bitmaps) bitmap?.close?.();
                return;
            }
            const transfer = [message.data.buffer, message.pages.buffer];
            if (message.filters) transfer.push(message.filters.buffer);
            message.ops = ops.map((op, i) => {
                const plain = { ...op };
                if ('source' in op) {
                    plain.source = bitmaps[i] || null;
                    if (plain.source) transfer.push(plain.source);
                }
                if (op.data) transfer.push(op.data.buffer);
                return plain;
            });
            this.worker.postMessage(message, transfer);
        };
        const pending = ops.map((op) => op.source || null);
        if (!pending.some(Boolean) && !this.waiting) {
            send([]);
            return;
        }
        this.waiting++;
        const previous = this.queue || Promise.resolve();
        this.queue = previous.then(() => Promise.all(pending)).then((bitmaps) => {
            send(bitmaps);
        }).catch((error) => this.onError?.(String(error?.message || error))).finally(() => {
            if (--this.waiting === 0) this.queue = null;
        });
    }

    /** Stop animating until the next frame (the surface is out of view). */
    suspend() {
        if (!this.destroyed) this.worker.postMessage({ type: 'suspend' });
    }

    /**
     * Read back the last posted frame as the canvas shows it: resolves to
     * { width, height, data (RGBA bytes) }, or null.
     */
    capture() {
        if (this.destroyed) return Promise.resolve(null);
        const id = this.nextCapture++;
        return new Promise((resolve) => {
            this.captures.set(id, resolve);
            const ask = () => this.worker.postMessage({ type: 'capture', id });
            if (this.queue) this.queue.then(ask);
            else ask();
        });
    }

    /** Make the worker's device lost (tests of the lost-device fallback). */
    loseDevice() {
        if (!this.destroyed) this.worker.postMessage({ type: 'lose' });
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        for (const done of this.captures.values()) done(null);
        this.captures.clear();
        this.atlas.destroy();
        // A worker with its device kept for the next surface, unless the device was lost
        if (!this.lost) {
            park(this.worker);
            return;
        }
        try { this.worker.postMessage({ type: 'destroy' }); } catch { /* gone */ }
        this.worker.terminate();
    }

    resetFilters() {
        this.filters.resetFilters.call(this);
    }

    addFilter(filter) {
        return this.filters.addFilter.call(this, filter);
    }
}
