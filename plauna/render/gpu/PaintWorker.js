// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * PaintWorker - paints a standalone RenderSurface off the main thread.
 *
 * Owns the surface's canvas (transferred from the page), its GPU device,
 * the GpuPainter with its atlas pages and cached layer textures. The main
 * thread (PaintWorkerHost) posts frames: changed item ranges, layer
 * commands, colour filters, atlas uploads (ImageBitmaps drawn by the page,
 * where fonts and text metrics are the page's) and the compositor layers
 * it hands over. Each frame is drawn as it arrives. While a handed-over
 * layer's animation runs, the worker draws it again every animation frame
 * from the animation's timing (LayerAnimations), moving and fading the
 * layer's cached texture as the browser's compositor does, with no message
 * from the page.
 *
 * The surface has two canvases. The page moves a canvas on its own thread
 * and the worker draws it on this one, and the two reach the screen
 * separately, so a frame that moves the canvas (a scroll) is drawn into the
 * hidden one, placed where it goes, and reported `shown` once drawn and
 * handed to the compositor; the page swaps the two then. Frames and
 * animation frames go to the canvas the latest frame named.
 *
 * Messages in: init { canvases, timeOrigin }, frame, suspend, capture { id },
 * park (the surface left GPU mode: keep the device for the next canvas),
 * lose, destroy. Out: ready { format, maxTextureDimension2D } or failed,
 * lost, ended (an animation left its keyframes' values), error, captured,
 * shown { id } (a frame posted with `ack: id` is on its canvas).
 */

import { FLOATS_PER_ITEM, FLOATS_PER_FILTER } from './shaders.js';

const F = FLOATS_PER_ITEM;

// The painter and the animation sampler load while the device is requested
let GpuPainter = null;
let motion = null;
let device = null;
// The surface's canvases ({ canvas, context }); frames draw into canvases[drawTo]
let canvases = [];
let drawTo = 0;
// A frame posted with an ack: drawn in the next animation frame, then reported shown
let ackId = 0;
let painter = null;
let format = null;
// Main-thread timeline time = worker time + shift
let shift = 0;
// The posted display list: items as the page built them (patched per draw)
let base = new Float32Array(0);
let basePages = new Uint16Array(0);
let count = 0;
let frame = null;
let filterData = new Float32Array(0);
let filterCount = 0;
let scheduled = false;
let endedSent = false;
let closed = false;
let deviceLost = false;

/** Atlas pages filled by the page's uploads (GpuPainter's atlas in the worker). */
class WorkerAtlas {
    constructor(owner) {
        this.painter = owner;
        this.pages = [];
        this.staging = null;
    }

    view(index) {
        return this.pages[index]?.view;
    }

    // Uploads arrive with the frame, before it is drawn
    flush() {}

    apply(op) {
        const queue = device.queue;
        if (op.op === 'page') {
            const created = painter.vgpu.texture.create({
                width: op.width, height: op.height, format: op.format, label: 'plauna-worker-atlas',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
            });
            this.pages[op.index] = { id: created.id, texture: created.texture, view: created.view, format: op.format };
            painter.bindGroups.clear();
            return;
        }
        const page = this.pages[op.page];
        if (op.op === 'image') {
            if (op.source && page) {
                queue.copyExternalImageToTexture({ source: op.source }, { texture: page.texture, origin: { x: op.x, y: op.y } }, { width: op.w, height: op.h });
            }
            op.source?.close?.();
        } else if (op.op === 'write') {
            if (page) queue.writeTexture({ texture: page.texture, origin: { x: op.x, y: op.y } }, op.data, { bytesPerRow: op.bytesPerRow }, { width: op.w, height: op.h });
        } else if (op.op === 'staged') {
            if (op.source) this.copyStaged(op);
            op.source?.close?.();
        }
    }

    /** One upload of the page's staging canvas, then a copy per raster with its padding (AtlasCache.flush). */
    copyStaged(op) {
        let s = this.staging;
        if (!s || s.width < op.canvasWidth || s.height < op.canvasHeight) {
            if (s) painter.vgpu.texture.release(s.id);
            const created = painter.vgpu.texture.create({
                width: op.canvasWidth, height: op.canvasHeight, format: this.pages[0].format, label: 'plauna-worker-atlas-staging',
                usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT
            });
            s = this.staging = { id: created.id, texture: created.texture, width: op.canvasWidth, height: op.canvasHeight };
        }
        device.queue.copyExternalImageToTexture({ source: op.source }, { texture: s.texture }, { width: op.w, height: op.h });
        const pad = op.padding;
        const encoder = device.createCommandEncoder({ label: 'plauna-worker-atlas-upload' });
        for (const [index, px, py, w, h, y] of op.copies) {
            const page = this.pages[index]?.texture;
            if (!page) continue;
            encoder.copyTextureToTexture({ texture: s.texture, origin: { x: 0, y: y - pad } }, { texture: page, origin: { x: px, y: py - pad } }, [w + pad, h + 2 * pad]);
            encoder.copyTextureToTexture({ texture: s.texture, origin: { x: w, y: y - pad } }, { texture: page, origin: { x: px - pad, y: py - pad } }, [pad, h + 2 * pad]);
        }
        device.queue.submit([encoder.finish()]);
    }

    destroy() {
        for (const page of this.pages) {
            try { if (page) painter.vgpu.texture.release(page.id); } catch { /* lease gone */ }
        }
        if (this.staging) {
            try { painter.vgpu.texture.release(this.staging.id); } catch { /* lease gone */ }
        }
        this.pages = [];
        this.staging = null;
    }
}

/** The device and modules, once per worker (a parked worker keeps them for the next surface). */
async function boot() {
    const modules = Promise.all([import('./GpuPainter.js'), import('../LayerAnimations.js')]);
    modules.catch(() => {});
    // The default adapter, as the page's standalone device uses
    const adapter = await navigator.gpu?.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter in the worker');
    device = await adapter.requestDevice({ label: 'plauna.paint-worker' });
    const [painterModule, layerModule] = await modules;
    GpuPainter = painterModule.GpuPainter;
    motion = layerModule;
    format = navigator.gpu.getPreferredCanvasFormat();
    const lost = device;
    device.lost?.then((info) => {
        if (closed || device !== lost) return;
        // Frames posted before the page hears of it are dropped
        deviceLost = true;
        self.postMessage({ type: 'lost', reason: info?.reason || 'unknown', message: info?.message || '' });
    });
}

/** Paint `msg.canvases` for a surface: a painter of its own on the worker's device. */
async function init(msg) {
    canvases = msg.canvases.map((canvas) => ({ canvas, context: null }));
    drawTo = 0;
    ackId = 0;
    shift = performance.timeOrigin - msg.timeOrigin;
    try {
        if (!device) await boot();
        if (deviceLost) throw new Error('The paint worker\'s device was lost');
        for (const entry of canvases) {
            entry.context = entry.canvas.getContext('webgpu');
            if (!entry.context) throw new Error('WebGPU canvas context unavailable in the worker');
            // COPY_SRC lets backdrop-filter read what is already drawn
            entry.context.configure({ device, format, alphaMode: 'premultiplied', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
        }
        painter = new GpuPainter({ device, format, ownerId: 'plauna.paint-worker', atlas: (owner) => new WorkerAtlas(owner) }).init();
    } catch (error) {
        self.postMessage({ type: 'failed', message: String(error?.message || error) });
        close();
        return;
    }
    self.postMessage({ type: 'ready', format, maxTextureDimension2D: device.limits.maxTextureDimension2D });
}

/** The surface left GPU mode: drop its canvas, painter and frame; keep the device for the next one. */
function park() {
    frame = null;
    unconfigure();
    try { painter?.destroy(); } catch { /* lost */ }
    painter = null;
    canvases = [];
    ackId = 0;
    base = new Float32Array(0);
    basePages = new Uint16Array(0);
    count = 0;
    filterData = new Float32Array(0);
    filterCount = 0;
    endedSent = false;
}

/** Take a posted frame: uploads first, then the items, commands, filters and layers. */
function applyFrame(msg) {
    for (const op of msg.ops || []) painter.atlas.apply(op);
    const n = msg.count;
    if (base.length < n * F) {
        const grown = new Float32Array(Math.max(n * F, base.length * 2));
        grown.set(base.subarray(0, count * F));
        base = grown;
        const pages = new Uint16Array(Math.max(n, basePages.length * 2));
        pages.set(basePages.subarray(0, count));
        basePages = pages;
    }
    let o = 0;
    for (let r = 0; r < msg.ranges.length; r += 2) {
        const a = msg.ranges[r];
        const b = msg.ranges[r + 1];
        base.set(msg.data.subarray(o * F, (o + b - a) * F), a * F);
        basePages.set(msg.pages.subarray(o, o + b - a), a);
        o += b - a;
    }
    count = n;
    if (msg.filters) {
        filterData = msg.filters;
        filterCount = msg.filterCount;
    }
    frame = msg;
    drawTo = msg.canvas || 0;
    endedSent = false;
}

const now = () => performance.now() + shift;

/**
 * Draw the frame into `view` (the canvas it names by default) at timeline
 * time `at`: the posted items, each handed-over layer placed and faded where
 * its animations put it at that time.
 */
function draw(at, view = null, target = null) {
    if (!frame || !painter) return;
    if (!view) {
        const { canvas, context } = canvases[drawTo];
        if (frame.width && canvas.width !== frame.width) canvas.width = frame.width;
        if (frame.height && canvas.height !== frame.height) canvas.height = frame.height;
        target = context.getCurrentTexture();
        view = target.createView();
    }
    const items = painter.items;
    items.ensure(count);
    items.data.set(base.subarray(0, count * F));
    items.pages.set(basePages.subarray(0, count));
    items.count = count;
    // The painter marks up commands as it draws them: a fresh copy each time
    const copies = new Map();
    items.commands = frame.commands.map((cmd) => {
        const copy = { ...cmd };
        if (cmd.begin) copy.begin = copies.get(cmd.begin);
        copies.set(cmd, copy);
        return copy;
    });
    if (painter.filterData.length < filterCount * FLOATS_PER_FILTER) painter.filterData = new Float32Array(filterCount * FLOATS_PER_FILTER);
    painter.filterData.set(filterData.subarray(0, filterCount * FLOATS_PER_FILTER));
    painter.filterCount = filterCount;
    let ended = false;
    for (const layer of frame.layers) if (!placeLayer(items.data, layer, at)) ended = true;
    painter.render(view, frame.viewport, { dpr: frame.dpr, time: at, target });
    return ended;
}

/**
 * Write a handed-over layer's matrix and opacity for time `at` into its
 * draw-back item, as the page would build it from the values its computed
 * style shows then. False once an animation has left its keyframes' values
 * (the page draws what comes after).
 */
function placeLayer(data, layer, at) {
    const track = layer.track;
    let transform = track.transform;
    let opacity = track.opacity;
    let live = true;
    for (const desc of track.animations) {
        if (at >= desc.endsAt) live = false;
        const values = motion.sampleAnimation(desc, Math.min(at, desc.endsAt), track.box.width, track.box.height);
        if (!values) {
            live = false;
            continue;
        }
        if (values.transform != null) transform = values.transform;
        if (values.opacity != null) opacity = parseFloat(values.opacity);
    }
    const matrix = track.animatesTransform
        ? motion.layerMatrix(motion.combinedTransform({ transform, translate: track.translate, rotate: track.rotate, scale: track.scale }), track.box, track.style)
        : track.matrix;
    const m = motion.compositeMatrixFor(matrix, layer.place);
    const o = layer.at * F;
    data[o + 44] = m[0]; data[o + 45] = m[1]; data[o + 46] = m[2]; data[o + 47] = m[3]; data[o + 48] = m[4]; data[o + 49] = m[5];
    data[o + 15] = layer.opacity * opacity;
    return live;
}

function running() {
    if (!frame) return false;
    for (const layer of frame.layers) {
        for (const desc of layer.track.animations) if (motion.animationRuns(desc)) return true;
    }
    return false;
}

/**
 * Draw again in the next animation frame while a handed-over animation runs,
 * or once for a frame posted with an ack. Drawn inside the animation frame,
 * the canvas is handed to the compositor at its end; `shown` is posted after.
 */
function schedule() {
    if (scheduled || closed || deviceLost || !frame) return;
    const animating = running();
    if (!animating && !ackId) return;
    scheduled = true;
    self.requestAnimationFrame((time) => {
        scheduled = false;
        if (!frame || closed || deviceLost) return;
        const ack = ackId;
        ackId = 0;
        const ended = safely(() => draw(time + shift));
        if (ack) {
            setTimeout(() => {
                if (!closed) self.postMessage({ type: 'shown', id: ack });
            }, 0);
        }
        if (ended && animating) {
            if (!endedSent) self.postMessage({ type: 'ended' });
            endedSent = true;
            return;
        }
        schedule();
    });
}

function safely(fn) {
    try {
        return fn();
    } catch (error) {
        self.postMessage({ type: 'error', message: String(error?.stack || error?.message || error) });
        return false;
    }
}

/** Draw the current frame into a texture of the canvas's size and read it back (RGBA). */
async function capture(id) {
    if (!frame || !painter || deviceLost) {
        self.postMessage({ type: 'captured', id, error: 'nothing drawn' });
        return;
    }
    const width = frame.width || canvases[drawTo].canvas.width;
    const height = frame.height || canvases[drawTo].canvas.height;
    const texture = device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    safely(() => draw(now(), texture.createView(), texture));
    const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
    const buffer = device.createBuffer({ size: bytesPerRow * height, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [width, height]);
    device.queue.submit([encoder.finish()]);
    await buffer.mapAsync(GPUMapMode.READ);
    const mapped = new Uint8Array(buffer.getMappedRange());
    const data = new Uint8Array(width * height * 4);
    const bgra = format.startsWith('bgra');
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = y * bytesPerRow + x * 4;
            const j = (y * width + x) * 4;
            data[j] = mapped[i + (bgra ? 2 : 0)];
            data[j + 1] = mapped[i + 1];
            data[j + 2] = mapped[i + (bgra ? 0 : 2)];
            data[j + 3] = mapped[i + 3];
        }
    }
    buffer.unmap();
    buffer.destroy();
    texture.destroy();
    self.postMessage({ type: 'captured', id, width, height, data }, [data.buffer]);
}

function unconfigure() {
    for (const { context } of canvases) {
        try { context?.unconfigure(); } catch { /* lost */ }
    }
}

function close() {
    closed = true;
    frame = null;
    unconfigure();
    try { painter?.destroy(); } catch { /* lost */ }
    try { device?.destroy(); } catch { /* lost */ }
    painter = null;
}

self.onmessage = (event) => {
    const msg = event.data;
    if (closed && msg?.type !== 'init') return;
    switch (msg?.type) {
        case 'init':
            init(msg);
            break;
        case 'frame':
            if (!painter || deviceLost) return;
            safely(() => {
                applyFrame(msg);
                // A frame for a canvas just placed (and what follows it there
                // before it shows) is drawn in the next animation frame
                if (msg.ack) ackId = msg.ack;
                else if (!ackId) draw(now());
            });
            schedule();
            break;
        case 'suspend':
            frame = null;
            ackId = 0;
            break;
        case 'capture':
            capture(msg.id).catch((error) => self.postMessage({ type: 'captured', id: msg.id, error: String(error) }));
            break;
        case 'lose':
            deviceLost = true;
            device?.destroy();
            break;
        case 'park':
            park();
            break;
        case 'destroy':
            close();
            self.close();
            break;
        default:
            break;
    }
};
