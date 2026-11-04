// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * GpuPainter - draws a Plauna display list with WebGPU.
 *
 * One instanced pipeline (shaders.js) draws every item: boxes, borders,
 * shadows, gradients, text runs and images. Raster content (text runs,
 * gradients, SVG, images, native control sprites) lives in atlas pages from
 * the engine's VGPUTextureAtlas; items are drawn in paint order, one draw
 * call per run of items that share an atlas page. Holes (KIND.HOLE, page
 * HOLE_PAGE) are drawn by a second pipeline that clears the target under
 * them instead of drawing over it.
 *
 * Resources are owned through a VirtualGPU lease on the given device, so
 * Plauna shares the device with the rest of the stack.
 */

import { acquireVGPU } from '../../../engine/core/gpu/VirtualGPU.js';
import { PAINTER_SHADER, FLOATS_PER_ITEM, FLOATS_PER_FILTER, HOLE_PAGE } from './shaders.js';
import { BlurPass } from './BlurPass.js';

/** Item pages from here up are effect results (backdrops, blurred layers), not atlas pages. */
export const EFFECT_PAGE = 256;

const EVICT_AFTER_FRAMES = 2;

// Frames a cached layer's texture is kept while no frame draws its layer
const LAYER_KEEP_FRAMES = 4;

// Height of the staging canvas drawn rasters share before flush() uploads them
const STAGING_HEIGHT = 1024;

// Transparent texels around each raster in a page, which linear sampling at
// its edge reads: never a neighbour, nor what an evicted raster left there
const PADDING = 2;

/**
 * Atlas pages with keyed entries and least-recently-used eviction. Rasters
 * drawn with addDrawn() share a staging canvas that flush() uploads in one
 * copy, then copies into their pages on the GPU: one upload per raster
 * costs 0.1-0.5 ms, and a text-dense page adds a hundred in one frame.
 */
export class AtlasCache {
    /**
     * @param {Object} vgpu VirtualGPU lease
     * @param {Object} [options] size, maxPages, onPageAdded(page), device
     *   (the GPUDevice addDrawn() rasters are uploaded with)
     */
    constructor(vgpu, options = {}) {
        this.vgpu = vgpu;
        this.device = options.device || vgpu.device;
        this.size = Math.min(options.size || 2048, vgpu.device?.limits?.maxTextureDimension2D || 2048);
        this.maxPages = options.maxPages || 6;
        this.pages = [];
        this.entries = new Map();
        this.frame = 0;
        this.evictedFrame = -1;
        this.onPageAdded = options.onPageAdded || null;
        // Drawn rasters waiting for flush(): { entry, y } in the staging canvas
        this.staged = [];
        this.staging = null;
        this.addPage();
    }

    addPage() {
        if (this.pages.length >= this.maxPages) return null;
        const atlas = this.vgpu.createAtlas({ width: this.size, height: this.size, padding: PADDING });
        const page = { atlas, index: this.pages.length };
        this.pages.push(page);
        this.onPageAdded?.(page);
        return page;
    }

    beginFrame() {
        // Nothing staged outlives its frame: eviction may hand its region to a new entry
        this.flush();
        this.frame++;
    }

    get(key) {
        const entry = this.entries.get(key);
        if (entry) entry.lastUsed = this.frame;
        return entry;
    }

    /** Add raster content; returns the entry or null when the atlas is full. */
    add(key, source, width, height, meta = {}) {
        if (this.entries.has(key)) return this.get(key);
        const w = Math.max(1, Math.ceil(width));
        const h = Math.max(1, Math.ceil(height));
        if (w > this.size || h > this.size) return null;
        // A full page is normal here: the next page, eviction or a new page follow
        const tryAdd = () => {
            for (const page of this.pages) {
                const region = page.atlas.add(key, source, w, h, { quiet: true });
                if (region) return { page: page.index, uv: region.uvs, w, h, region };
            }
            return null;
        };
        let placed = tryAdd();
        // Evict at most once a frame: later misses in the same frame would find
        // nothing new to drop, and go straight to a new page
        if (!placed && this.evictedFrame !== this.frame) {
            this.evictedFrame = this.frame;
            if (this.evict() > 0) placed = tryAdd();
        }
        if (!placed) {
            const page = this.addPage();
            if (page) {
                const region = page.atlas.add(key, source, w, h, { quiet: true });
                if (region) placed = { page: page.index, uv: region.uvs, w, h, region };
            }
        }
        if (!placed) {
            if (!this.warnedFull) {
                console.warn(`[Plauna] Atlas full: ${this.pages.length} pages of ${this.size}px are in use; ${w}x${h} raster skipped`);
                this.warnedFull = true;
            }
            return null;
        }
        const entry = { ...placed, ...meta, key, lastUsed: this.frame };
        this.entries.set(key, entry);
        return entry;
    }

    /**
     * Add a width x height raster drawn by `draw(ctx, y)` with its top-left at
     * (0, y) of the staging canvas, clipped to its size. Its region is placed
     * now; its pixels reach the page at the next flush(), before the frame is
     * drawn. Returns the entry or null when the atlas is full.
     */
    addDrawn(key, width, height, meta, draw) {
        if (this.entries.has(key)) return this.get(key);
        // A null source places the region without uploading anything
        const entry = this.add(key, null, width, height, meta);
        if (!entry) return null;
        const y = this.stage(entry.w, entry.h);
        const ctx = this.staging.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, y, entry.w, entry.h);
        ctx.clip();
        draw(ctx, y);
        ctx.restore();
        this.staged.push({ entry, y });
        return entry;
    }

    /**
     * The top of a w x h slot in the staging canvas; flushes first when it is
     * full. Slots stack in one column at x = 0: glyph positions are float sums,
     * so text drawn further right can round onto another subpixel position
     * than it does in a canvas of its own (with letter-spacing, measured).
     * PADDING clear rows lie above and below each slot and nothing is drawn
     * right of it, so flush() copies the raster with its padding.
     */
    stage(w, h) {
        let s = this.staging;
        if (!s) {
            const canvas = document.createElement('canvas');
            canvas.width = this.size;
            canvas.height = Math.min(this.size, STAGING_HEIGHT);
            s = this.staging = { canvas, ctx: canvas.getContext('2d'), y: 0, width: 0, texture: null };
        }
        if (s.y + h + 2 * PADDING > s.canvas.height) {
            this.flush();
            // Resizing clears the canvas, which is empty now
            if (h + 2 * PADDING > s.canvas.height) s.canvas.height = Math.min(this.size, 2 ** Math.ceil(Math.log2(h + 2 * PADDING)));
        }
        const y = s.y + PADDING;
        s.y = y + h;
        s.width = Math.max(s.width, w);
        return y;
    }

    /**
     * Upload the staging canvas once and copy each staged raster into its
     * page, with the clear texels around its slot as its padding.
     */
    flush() {
        const s = this.staging;
        if (!s || !this.staged.length) return;
        // With the widest slot's right padding and the last one's bottom padding
        const width = s.width + PADDING;
        const height = s.y + PADDING;
        if (!s.texture || s.texture.texture.height < s.canvas.height) {
            if (s.texture) this.vgpu.texture.release(s.texture.id);
            s.texture = this.vgpu.texture.create({
                width: s.canvas.width,
                height: s.canvas.height,
                format: this.pages[0].atlas.format,
                usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
                label: 'plauna-atlas-staging'
            });
        }
        const queue = this.device.queue;
        // Unpremultiplied, as a per-raster canvas upload stores it
        queue.copyExternalImageToTexture({ source: s.canvas }, { texture: s.texture.texture }, { width, height });
        const encoder = this.device.createCommandEncoder({ label: 'plauna-atlas-upload' });
        for (const { entry, y } of this.staged) {
            const page = this.pages[entry.page].atlas.getTexture();
            const { x: px, y: py } = entry.region;
            // The raster with its top, right and bottom padding, then its left
            // padding from the clear column right of it
            encoder.copyTextureToTexture(
                { texture: s.texture.texture, origin: { x: 0, y: y - PADDING } },
                { texture: page, origin: { x: px, y: py - PADDING } },
                [entry.w + PADDING, entry.h + 2 * PADDING]
            );
            encoder.copyTextureToTexture(
                { texture: s.texture.texture, origin: { x: entry.w, y: y - PADDING } },
                { texture: page, origin: { x: px - PADDING, y: py - PADDING } },
                [PADDING, entry.h + 2 * PADDING]
            );
        }
        queue.submit([encoder.finish()]);
        s.ctx.clearRect(0, 0, width, height);
        s.y = 0;
        s.width = 0;
        this.staged = [];
    }

    /** Drop entries not used in the last frames; returns how many were dropped. */
    evict() {
        const stale = this.pages.map(() => []);
        let dropped = 0;
        for (const [key, entry] of this.entries) {
            if (this.frame - entry.lastUsed >= EVICT_AFTER_FRAMES) {
                stale[entry.page]?.push(key);
                this.entries.delete(key);
                dropped++;
            }
        }
        // One merge of the freed space per page, not one per entry
        this.pages.forEach((page, index) => {
            if (stale[index].length) page.atlas.removeMany(stale[index]);
        });
        return dropped;
    }

    clear() {
        this.dropStaged();
        for (const page of this.pages) page.atlas.clear();
        this.entries.clear();
    }

    /** Forget staged rasters without uploading them. */
    dropStaged() {
        const s = this.staging;
        if (s && this.staged.length) s.ctx.clearRect(0, 0, s.width, s.y);
        if (s) s.y = s.width = 0;
        this.staged = [];
    }

    view(index) {
        return this.pages[index]?.atlas.getView();
    }

    destroy() {
        this.dropStaged();
        if (this.staging?.texture) {
            try { this.vgpu.texture.release(this.staging.texture.id); } catch { /* released with the lease */ }
        }
        this.staging = null;
        for (const page of this.pages) {
            try { page.atlas.destroy(); } catch { /* released with the lease */ }
        }
        this.pages = [];
        this.entries.clear();
    }
}

/** Growable packed item storage. */
export class ItemBuffer {
    constructor(capacity = 1024) {
        this.data = new Float32Array(capacity * FLOATS_PER_ITEM);
        this.pages = new Uint16Array(capacity);
        this.count = 0;
        // Effect commands in paint order: { type: 'backdrop' | 'layer-begin' | 'layer-end', at, ... }.
        // A layer-begin with a `key` is a cached layer (GpuPainter.renderWithEffects)
        this.commands = [];
        this.effects = 0;
        // Colour filter index for items pushed now (-1: none)
        this.filter = -1;
    }

    reset() {
        this.count = 0;
        this.filter = -1;
        this.commands = [];
        this.effects = 0;
    }

    /** A page id for an effect result drawn by a later item. */
    effectPage() {
        return EFFECT_PAGE + this.effects++;
    }

    ensure(n) {
        const capacity = this.pages.length;
        if (n <= capacity) return;
        const next = Math.max(n, capacity * 2);
        const data = new Float32Array(next * FLOATS_PER_ITEM);
        data.set(this.data.subarray(0, this.count * FLOATS_PER_ITEM));
        const pages = new Uint16Array(next);
        pages.set(this.pages.subarray(0, this.count));
        this.data = data;
        this.pages = pages;
    }

    /**
     * Push one item. `f` holds: rect, shape, radii, color, border,
     * borderColor, shape2, radii2, uv, clip, clipRadii, matrix, kind, flags,
     * extra, clip2, clip2Radii, page. Missing fields default sensibly.
     */
    push(f) {
        this.ensure(this.count + 1);
        const o = this.count * FLOATS_PER_ITEM;
        const d = this.data;
        const put = (offset, v, fallback) => {
            const src = v || fallback;
            d[o + offset] = src[0]; d[o + offset + 1] = src[1]; d[o + offset + 2] = src[2]; d[o + offset + 3] = src[3];
        };
        put(0, f.rect, ZERO4);
        put(4, f.shape || f.rect, ZERO4);
        put(8, f.radii, ZERO4);
        put(12, f.color, ZERO4);
        put(16, f.border, ZERO4);
        put(20, f.borderColor, ZERO4);
        put(24, f.shape2 || f.shape || f.rect, ZERO4);
        put(28, f.radii2, ZERO4);
        put(32, f.uv, ZERO4);
        put(36, f.clip, NO_CLIP);
        put(40, f.clipRadii, ZERO4);
        const m = f.matrix || IDENTITY;
        d[o + 44] = m[0]; d[o + 45] = m[1]; d[o + 46] = m[2]; d[o + 47] = m[3];
        d[o + 48] = m[4]; d[o + 49] = m[5]; d[o + 50] = f.kind || 0; d[o + 51] = f.flags ?? 15;
        put(52, f.extra, ZERO4);
        d[o + 56] = this.filter; d[o + 57] = 0; d[o + 58] = 0; d[o + 59] = 0;
        put(60, f.clip2, ZERO4);
        put(64, f.clip2Radii, ZERO4);
        this.pages[this.count] = f.page || 0;
        this.count++;
    }
}

const ZERO4 = [0, 0, 0, 0];
const NO_CLIP = [-1e7, -1e7, 1e7, 1e7];
const IDENTITY = [1, 0, 0, 1, 0, 0];

export class GpuPainter {
    /**
     * @param {Object} options
     * @param {GPUDevice} options.device
     * @param {string} [options.format] colour target format
     * @param {string} [options.ownerId]
     * @param {(painter: GpuPainter) => Object} [options.atlas] makes the atlas pages instead of an
     *   AtlasCache (the paint worker's, filled from the main thread): view(page), flush(), destroy()
     */
    constructor(options = {}) {
        this.device = options.device;
        this.format = options.format || (typeof navigator !== 'undefined' && navigator.gpu?.getPreferredCanvasFormat?.()) || 'bgra8unorm';
        this.ownerId = options.ownerId || 'plauna.gpu-painter';
        this.makeAtlas = options.atlas || null;
        this.lease = null;
        this.vgpu = null;
        this.pipeline = null;
        this.layout = null;
        this.sampler = null;
        this.uniform = null;
        this.storage = null;
        this.storageCapacity = 0;
        this.atlas = null;
        this.bindGroups = new Map();
        this.items = new ItemBuffer();
        this.uniformData = new Float32Array(8);
        this.filterData = new Float32Array(FLOATS_PER_FILTER * 16);
        this.filterCount = 0;
        this.filterBuffer = null;
        this.filterCapacity = 0;
        // Cached layers' textures by layer key, and the frame count they age by
        this.layerCache = new Map();
        this.frameCount = 0;
        this.destroyed = false;
    }

    /** Forget the frame's colour filters (DisplayListBuilder.build). */
    resetFilters() {
        this.filterCount = 0;
    }

    /** Register a composed colour filter ({ m, o, k }); returns its index. */
    addFilter(filter) {
        const index = this.filterCount++;
        if (this.filterData.length < this.filterCount * FLOATS_PER_FILTER) {
            const grown = new Float32Array(this.filterData.length * 2);
            grown.set(this.filterData);
            this.filterData = grown;
        }
        const d = this.filterData;
        const o = index * FLOATS_PER_FILTER;
        const { m } = filter;
        d.set([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, filter.o[0], filter.o[1], filter.o[2], filter.k], o);
        return index;
    }

    ensureFilterStorage(count) {
        const needed = Math.max(1, count);
        if (needed <= this.filterCapacity) return;
        const capacity = Math.max(needed, this.filterCapacity * 2 || 16);
        if (this.filterBufferId) this.vgpu.buffer.release(this.filterBufferId);
        const created = this.vgpu.buffer.create({ size: capacity * FLOATS_PER_FILTER * 4, usage: 'storage', label: 'plauna-painter-filters' });
        this.filterBuffer = created.buffer;
        this.filterBufferId = created.id;
        this.filterCapacity = capacity;
        this.bindGroups.clear();
    }

    init() {
        if (this.pipeline) return this;
        this.lease = acquireVGPU(this.ownerId, this.device);
        this.vgpu = this.lease.vgpu;
        this.atlas = this.makeAtlas
            ? this.makeAtlas(this)
            : new AtlasCache(this.vgpu, { device: this.device, onPageAdded: () => this.bindGroups.clear() });
        this.sampler = this.vgpu.texture.sampler({
            magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge'
        });
        const module = this.vgpu.shader.compile('plauna-painter', PAINTER_SHADER);
        this.layout = this.vgpu.bindings.defineLayout('plauna-painter', [
            { binding: 0, type: 'uniform', visibility: 'vertex|fragment', minBindingSize: 32 },
            { binding: 1, type: 'read-storage', visibility: 'vertex|fragment', minBindingSize: FLOATS_PER_ITEM * 4 },
            { binding: 2, type: 'sampler', visibility: 'fragment' },
            { binding: 3, type: 'texture', visibility: 'fragment' },
            { binding: 4, type: 'read-storage', visibility: 'fragment', minBindingSize: FLOATS_PER_FILTER * 4 }
        ]);
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module, entryPoint: 'vs' },
            fragment: { module, entryPoint: 'fs' },
            layouts: [this.layout],
            colorFormat: this.format,
            blend: 'premultiplied',
            depthFormat: null,
            cullMode: 'none',
            label: 'PlaunaGpuPainter'
        });
        // Holes: the target is kept times (1 - the item's alpha), colour and alpha
        const erase = { srcFactor: 'zero', dstFactor: 'one-minus-src-alpha', operation: 'add' };
        this.erasePipeline = this.vgpu.pipeline.render({
            vertex: { module, entryPoint: 'vs' },
            fragment: { module, entryPoint: 'fs' },
            layouts: [this.layout],
            colorFormat: this.format,
            blend: { color: erase, alpha: erase },
            depthFormat: null,
            cullMode: 'none',
            label: 'PlaunaGpuPainterErase'
        });
        const uniform = this.vgpu.buffer.create({ size: 32, usage: 'uniform', label: 'plauna-painter-view' });
        this.uniform = uniform.buffer;
        this.ensureStorage(1024);
        this.ensureFilterStorage(16);
        return this;
    }

    ensureStorage(count) {
        if (count <= this.storageCapacity) return;
        const capacity = Math.max(count, this.storageCapacity * 2 || 1024);
        if (this.storageId) this.vgpu.buffer.release(this.storageId);
        const created = this.vgpu.buffer.create({ size: capacity * FLOATS_PER_ITEM * 4, usage: 'storage', label: 'plauna-painter-items' });
        this.storage = created.buffer;
        this.storageId = created.id;
        this.storageCapacity = capacity;
        this.bindGroups.clear();
    }

    bindGroup(page) {
        let group = this.bindGroups.get(page);
        if (!group) {
            group = this.vgpu.bindings.createGroup(this.layout, [
                { binding: 0, buffer: this.uniform },
                { binding: 1, buffer: this.storage },
                { binding: 2, sampler: this.sampler },
                { binding: 3, textureView: this.atlas.view(page) },
                { binding: 4, buffer: this.filterBuffer }
            ], 'plauna-painter-bind');
            this.bindGroups.set(page, group);
        }
        return group;
    }

    /**
     * Draw the packed items into `view` (a GPUTextureView).
     * viewport: { x, y, width, height } in scene px; options: dpr, time,
     * clear colour, load (keep the target's content), encoder (record into
     * this command encoder; the caller submits it), target (the GPUTexture
     * behind `view`, with COPY_SRC, which backdrop-filter reads; without it
     * backdrops are left out).
     */
    render(view, viewport, options = {}) {
        if (this.destroyed || !this.pipeline) return;
        this.releaseEffects();
        // Rasters drawn this frame reach their pages before anything samples them
        this.atlas.flush();
        if (this.items.commands.length) {
            this.renderWithEffects(view, viewport, options);
            return;
        }
        const device = this.device;
        const count = this.items.count;
        this.ensureStorage(count);
        const u = this.uniformData;
        u[0] = viewport.x; u[1] = viewport.y; u[2] = viewport.width; u[3] = viewport.height;
        u[4] = options.dpr || 1; u[5] = (options.time || 0) / 1000; u[6] = 0; u[7] = 0;
        device.queue.writeBuffer(this.uniform, 0, u);
        if (count) device.queue.writeBuffer(this.storage, 0, this.items.data, 0, count * FLOATS_PER_ITEM);
        this.ensureFilterStorage(this.filterCount);
        if (this.filterCount) device.queue.writeBuffer(this.filterBuffer, 0, this.filterData, 0, this.filterCount * FLOATS_PER_FILTER);
        const encoder = options.encoder || device.createCommandEncoder({ label: 'plauna-painter' });
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view,
                clearValue: options.clear || { r: 0, g: 0, b: 0, a: 0 },
                loadOp: options.load ? 'load' : 'clear',
                storeOp: 'store'
            }]
        });
        if (count) {
            pass.setPipeline(this.pipeline);
            let start = 0;
            const pages = this.items.pages;
            for (let i = 1; i <= count; i++) {
                if (i === count || pages[i] !== pages[start]) {
                    this.drawRun(pass, this.bindGroup(pages[start] === HOLE_PAGE ? 0 : pages[start]), pages[start], start, i - start);
                    start = i;
                }
            }
        }
        pass.end();
        if (!options.encoder) device.queue.submit([encoder.finish()]);
    }

    /**
     * Render with effects. A layer draws its items into an offscreen texture
     * that a later item draws back: blurred (filter: blur), or as it is, with
     * that item's opacity, rounded mask, transform and clip (a compositing
     * group). A layer with a `key` keeps its texture from frame to frame and
     * draws into it again only when its bounds, its items or a layer inside
     * it changed; otherwise its items are skipped. Backdrops copy what is
     * under an element, blur and filter it, and draw it under the element.
     * Passes split at each command; every target has its own view uniform.
     */
    renderWithEffects(view, viewport, options) {
        const device = this.device;
        const dpr = options.dpr || 1;
        const count = this.items.count;
        const data = this.items.data;
        const commands = this.items.commands;
        this.ensureStorage(count);
        this.blur ??= new BlurPass(this.vgpu, device, this.format);
        this.effectViews = new Map();
        this.layerUniforms ??= [];
        let layers = 0;
        const main = { view, texture: options.target || null, x: viewport.x, y: viewport.y, width: viewport.width, height: viewport.height };
        main.uniform = this.uniform;
        this.writeView(main.uniform, main, dpr, options.time);

        // Plan on the CPU first: targets for layers, regions and uvs for
        // backdrops, and the cached layers that can be drawn back as they are
        const stack = [main];
        const open = [];
        for (let k = 0; k < commands.length; k++) {
            const cmd = commands[k];
            const top = stack[stack.length - 1];
            if (cmd.type === 'layer-begin') {
                cmd.target = { ...cmd.bounds, layer: true };
                // Whether every layer and backdrop inside it is unchanged
                cmd.settled = true;
                stack.push(cmd.target);
                open.push(cmd);
            } else if (cmd.type === 'layer-end') {
                stack.pop();
                const begin = open.pop();
                begin.end = k;
                begin.record = begin.key != null && !(begin.blur >= 0.25) ? this.layerRecord(begin.key, begin.bounds, dpr) : null;
                begin.keep = Boolean(begin.record) && begin.settled && this.layerUnchanged(begin.record, begin, cmd, dpr);
                // A layer drawn again changes what the layer around it shows
                if (!begin.keep && open.length) open[open.length - 1].settled = false;
            } else if (cmd.type === 'backdrop') {
                if (open.length) open[open.length - 1].settled = false;
                const margin = Math.ceil(cmd.blur * 3);
                const x0 = Math.max(cmd.rect.x - margin, top.x);
                const y0 = Math.max(cmd.rect.y - margin, top.y);
                const x1 = Math.min(cmd.rect.x + cmd.rect.width + margin, top.x + top.width);
                const y1 = Math.min(cmd.rect.y + cmd.rect.height + margin, top.y + top.height);
                const o = cmd.item * FLOATS_PER_ITEM;
                if ((!top.texture && !top.layer) || x1 - x0 < 1 || y1 - y0 < 1) {
                    cmd.skip = true;
                    data[o + 15] = 0;
                    continue;
                }
                cmd.source = top;
                cmd.region = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
                data[o + 32] = (cmd.rect.x - x0) / (x1 - x0);
                data[o + 33] = (cmd.rect.y - y0) / (y1 - y0);
                data[o + 34] = (cmd.rect.x + cmd.rect.width - x0) / (x1 - x0);
                data[o + 35] = (cmd.rect.y + cmd.rect.height - y0) / (y1 - y0);
            }
        }
        if (count) device.queue.writeBuffer(this.storage, 0, data, 0, count * FLOATS_PER_ITEM);
        this.ensureFilterStorage(this.filterCount);
        if (this.filterCount) device.queue.writeBuffer(this.filterBuffer, 0, this.filterData, 0, this.filterCount * FLOATS_PER_FILTER);

        const encoder = options.encoder || device.createCommandEncoder({ label: 'plauna-painter-effects' });
        const targets = [main];
        let pass = null;
        let current = main;
        const begin = (target, load) => {
            current = target;
            pass = encoder.beginRenderPass({
                colorAttachments: [{
                    view: target.view,
                    clearValue: target === main ? (options.clear || { r: 0, g: 0, b: 0, a: 0 }) : { r: 0, g: 0, b: 0, a: 0 },
                    loadOp: load ? 'load' : 'clear',
                    storeOp: 'store'
                }]
            });
            pass.setPipeline(this.pipeline);
        };
        const end = () => {
            pass?.end();
            pass = null;
        };
        begin(main, Boolean(options.load));
        let ci = 0;
        let i = 0;
        const pages = this.items.pages;
        while (i < count || ci < commands.length) {
            while (ci < commands.length && commands[ci].at <= i) {
                const cmd = commands[ci++];
                if (cmd.type === 'layer-begin' && cmd.keep) {
                    // Unchanged: its texture is drawn back as it is and its items are skipped
                    const close = commands[cmd.end];
                    this.effectViews.set(close.page, cmd.record.view);
                    ci = cmd.end + 1;
                    i = Math.max(i, close.at);
                    continue;
                }
                end();
                if (cmd.type === 'layer-begin') {
                    const t = cmd.target;
                    if (cmd.record) {
                        t.texture = cmd.record.texture;
                        t.view = cmd.record.view;
                        t.uniform = cmd.record.uniform;
                    } else {
                        const created = this.blur.texture(t.width * dpr, t.height * dpr, 'plauna-layer');
                        t.texture = created.texture;
                        t.view = created.view;
                        // Layer view uniforms are reused frame to frame, one per layer
                        t.uniform = this.layerUniforms[layers]
                            ?? (this.layerUniforms[layers] = this.vgpu.buffer.create({ size: 32, usage: 'uniform', label: 'plauna-layer-view' }).buffer);
                        layers++;
                    }
                    this.writeView(t.uniform, t, dpr, options.time);
                    targets.push(t);
                    begin(t, false);
                    continue;
                }
                if (cmd.type === 'layer-end') {
                    const t = cmd.begin.target;
                    if (cmd.begin.record) this.storeLayer(cmd.begin.record, cmd.begin, cmd, dpr);
                    const result = cmd.begin.blur >= 0.25 ? this.blur.run(encoder, t, cmd.begin.blur * dpr) : t;
                    this.effectViews.set(cmd.page, result.view);
                    targets.pop();
                } else if (cmd.type === 'backdrop' && !cmd.skip) {
                    const src = cmd.source;
                    const px = (v, origin) => Math.round((v - origin) * dpr);
                    const sx = Math.max(0, px(cmd.region.x, src.x));
                    const sy = Math.max(0, px(cmd.region.y, src.y));
                    const sw = Math.max(1, Math.min(src.texture.width - sx, Math.round(cmd.region.width * dpr)));
                    const sh = Math.max(1, Math.min(src.texture.height - sy, Math.round(cmd.region.height * dpr)));
                    const copy = this.blur.texture(sw, sh, 'plauna-backdrop');
                    encoder.copyTextureToTexture({ texture: src.texture, origin: { x: sx, y: sy } }, { texture: copy.texture }, [sw, sh]);
                    const result = this.blur.run(encoder, copy, cmd.blur * dpr, cmd.filter);
                    this.effectViews.set(cmd.page, result.view);
                }
                begin(targets[targets.length - 1], true);
            }
            if (i >= count) break;
            const limit = ci < commands.length ? Math.max(commands[ci].at, i + 1) : count;
            let j = i + 1;
            while (j < limit && pages[j] === pages[i]) j++;
            const group = this.groupFor(current.uniform, pages[i] === HOLE_PAGE ? 0 : pages[i]);
            if (group) this.drawRun(pass, group, pages[i], i, j - i);
            i = j;
        }
        end();
        if (!options.encoder) device.queue.submit([encoder.finish()]);
    }

    /** Draw `n` items from `first` with `group`; a run of holes with the erase pipeline. */
    drawRun(pass, group, page, first, n) {
        const hole = page === HOLE_PAGE;
        if (hole) pass.setPipeline(this.erasePipeline);
        pass.setBindGroup(0, group);
        pass.draw(6, n, 0, first);
        if (hole) pass.setPipeline(this.pipeline);
    }

    writeView(buffer, target, dpr, time = 0) {
        const u = new Float32Array([target.x, target.y, target.width, target.height, dpr, time / 1000, 0, 0]);
        this.device.queue.writeBuffer(buffer, 0, u);
    }

    /**
     * The cached layer `key` draws into this frame: its texture (bounds at
     * `dpr`) and view uniform, kept from earlier frames. Null when the key
     * was drawn already this frame (the second one draws uncached).
     */
    layerRecord(key, bounds, dpr) {
        let record = this.layerCache.get(key);
        if (record?.frame === this.frameCount) return null;
        if (!record) {
            record = { frame: -1, texture: null, data: null };
            this.layerCache.set(key, record);
        }
        record.frame = this.frameCount;
        const width = Math.max(1, Math.ceil(bounds.width * dpr - 1e-4));
        const height = Math.max(1, Math.ceil(bounds.height * dpr - 1e-4));
        if (!record.texture || record.width !== width || record.height !== height) {
            if (record.textureId != null) this.vgpu.texture.release(record.textureId);
            const created = this.vgpu.texture.create({
                width, height, format: this.format, label: 'plauna-cached-layer',
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST
            });
            record.textureId = created.id;
            record.texture = created.texture;
            record.view = created.view;
            record.width = width;
            record.height = height;
            record.data = null;
        }
        if (!record.uniform) {
            const uniform = this.vgpu.buffer.create({ size: 32, usage: 'uniform', label: 'plauna-cached-layer-view' });
            record.uniform = uniform.buffer;
            record.uniformId = uniform.id;
        }
        return record;
    }

    /**
     * True when a cached layer would draw what its texture holds: the same
     * bounds and scale, and the same items (effect pages aside: a layer
     * inside that changed has marked it unsettled).
     */
    layerUnchanged(record, begin, close, dpr) {
        const b = begin.bounds;
        const n = close.at - begin.at;
        if (!record.data || record.dpr !== dpr || record.count !== n || record.x !== b.x || record.y !== b.y
            || record.boundsWidth !== b.width || record.boundsHeight !== b.height) return false;
        const data = this.items.data;
        const from = begin.at * FLOATS_PER_ITEM;
        for (let k = 0, end = n * FLOATS_PER_ITEM; k < end; k++) {
            if (data[from + k] !== record.data[k] && !(Number.isNaN(data[from + k]) && Number.isNaN(record.data[k]))) return false;
        }
        const pages = this.items.pages;
        for (let k = 0; k < n; k++) {
            const page = pages[begin.at + k];
            const was = record.pages[k];
            if (page !== was && !(page >= EFFECT_PAGE && was >= EFFECT_PAGE)) return false;
        }
        return true;
    }

    /** Remember what a cached layer's texture now holds. */
    storeLayer(record, begin, close, dpr) {
        const b = begin.bounds;
        record.dpr = dpr;
        record.x = b.x;
        record.y = b.y;
        record.boundsWidth = b.width;
        record.boundsHeight = b.height;
        record.count = close.at - begin.at;
        record.data = this.items.data.slice(begin.at * FLOATS_PER_ITEM, close.at * FLOATS_PER_ITEM);
        record.pages = this.items.pages.slice(begin.at, close.at);
    }

    /** Release cached layers no frame has drawn for LAYER_KEEP_FRAMES frames (all with `all`). */
    releaseLayers(all = false) {
        for (const [key, record] of this.layerCache) {
            if (!all && this.frameCount - record.frame <= LAYER_KEEP_FRAMES) continue;
            try {
                if (record.textureId != null) this.vgpu.texture.release(record.textureId);
                if (record.uniformId != null) this.vgpu.buffer.release(record.uniformId);
            } catch { /* lease gone */ }
            this.layerCache.delete(key);
        }
    }

    /**
     * Bind group for atlas or effect `page` under a target's view uniform.
     * Effect textures and layer uniforms are pooled, so groups are cached by
     * texture view and uniform, and rebuilt when the item or filter storage
     * has been replaced.
     */
    groupFor(uniform, page) {
        if (uniform === this.uniform && page < EFFECT_PAGE) return this.bindGroup(page);
        const textureView = page >= EFFECT_PAGE ? this.effectViews.get(page) : this.atlas.view(page);
        if (!textureView) return null;
        this.effectGroups ??= new WeakMap();
        let byUniform = this.effectGroups.get(textureView);
        if (!byUniform) this.effectGroups.set(textureView, byUniform = new Map());
        const cached = byUniform.get(uniform);
        if (cached && cached.storage === this.storage && cached.filters === this.filterBuffer) return cached.group;
        const group = this.vgpu.bindings.createGroup(this.layout, [
            { binding: 0, buffer: uniform },
            { binding: 1, buffer: this.storage },
            { binding: 2, sampler: this.sampler },
            { binding: 3, textureView },
            { binding: 4, buffer: this.filterBuffer }
        ], 'plauna-painter-effect-bind');
        byUniform.set(uniform, { group, storage: this.storage, filters: this.filterBuffer });
        return group;
    }

    /**
     * Return the last frame's effect textures to the pool (it has been
     * submitted by now), start the next frame's count and release cached
     * layers that have gone unused.
     */
    releaseEffects() {
        this.blur?.releaseFrame();
        this.frameCount++;
        this.releaseLayers();
    }

    destroy() {
        if (this.destroyed) return;
        this.releaseEffects();
        this.releaseLayers(true);
        this.destroyed = true;
        this.atlas?.destroy();
        this.bindGroups.clear();
        try { this.lease?.release?.(); } catch { /* already released */ }
        this.lease = null;
        this.vgpu = null;
        this.pipeline = null;
    }
}
