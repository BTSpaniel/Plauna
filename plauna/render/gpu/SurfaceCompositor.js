// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * SurfaceCompositor - draws surface textures into a host frame.
 *
 * Each layer is a texture view placed at a rectangle of the target (device
 * pixels), cut to its shape (rect, rounded rect, circle or ellipse, with an
 * anti-aliased edge), at an opacity. Textures hold premultiplied colour, as
 * Plauna's painter writes it, and blend over the target.
 *
 * draw() records its own render pass (into the host's encoder when given);
 * encode() draws inside a pass the host already began, whose colour target
 * must have the compositor's format. Layer uniforms and bind groups are kept
 * per layer key and reused across frames.
 */

import { acquireVGPU } from '../../../engine/core/gpu/VirtualGPU.js';

export { resolveGpuDevice } from '../RenderModes.js';

const UNIFORM_BYTES = 64;

const SHAPES = { rect: 0, rectangle: 0, 'rounded-rect': 1, rounded_rect: 1, roundedrect: 1, circle: 2, ellipse: 3 };

export const COMPOSITOR_SHADER = /* wgsl */`
struct Layer {
    rect: vec4f,    // x, y, width, height in target px
    info: vec4f,    // target width, target height, opacity, shape ('target' is reserved in WGSL)
    shape: vec4f,   // corner or circle radius, ellipse radius x, ellipse radius y
    uv: vec4f,      // u0, v0, u1, v1
};

@group(0) @binding(0) var<uniform> layer: Layer;
@group(0) @binding(1) var layerSampler: sampler;
@group(0) @binding(2) var layerTexture: texture_2d<f32>;

struct VOut {
    @builtin(position) position: vec4f,
    @location(0) local: vec2f,
    @location(1) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) index: u32) -> VOut {
    var corners = array<vec2f, 6>(
        vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
        vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0)
    );
    let c = corners[index];
    let px = layer.rect.xy + c * layer.rect.zw;
    var out: VOut;
    out.position = vec4f(px.x / layer.info.x * 2.0 - 1.0, 1.0 - px.y / layer.info.y * 2.0, 0.0, 1.0);
    out.local = c * layer.rect.zw;
    out.uv = mix(layer.uv.xy, layer.uv.zw, c);
    return out;
}

// Anti-aliased coverage of the layer's shape at a local point
fn coverage(local: vec2f) -> f32 {
    let size = layer.rect.zw;
    let shape = layer.info.w;
    if (shape < 0.5) {
        return 1.0;
    }
    if (shape < 1.5) {
        let r = min(layer.shape.x, min(size.x, size.y) * 0.5);
        let q = abs(local - size * 0.5) - (size * 0.5 - vec2f(r));
        let d = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
        return clamp(0.5 - d, 0.0, 1.0);
    }
    let circle = vec2f(min(layer.shape.x, min(size.x, size.y) * 0.5));
    let radii = max(select(layer.shape.yz, circle, shape < 2.5), vec2f(0.0001));
    let p = (local - size * 0.5) / radii;
    let d = (length(p) - 1.0) * min(radii.x, radii.y);
    return clamp(0.5 - d, 0.0, 1.0);
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
    let color = textureSample(layerTexture, layerSampler, in.uv);
    return color * (coverage(in.local) * layer.info.z);
}
`;

export class SurfaceCompositor {
    /**
     * @param {Object} options
     * @param {GPUDevice} options.device
     * @param {GPUTextureFormat} [options.format] target format
     * @param {string} [options.ownerId]
     */
    constructor(options = {}) {
        this.device = options.device;
        this.format = options.format || (typeof navigator !== 'undefined' && navigator.gpu?.getPreferredCanvasFormat?.()) || 'bgra8unorm';
        this.ownerId = options.ownerId || 'plauna.surface-compositor';
        this.lease = null;
        this.vgpu = null;
        this.pipeline = null;
        this.layout = null;
        this.sampler = null;
        this.layers = new Map();
        this.data = new Float32Array(UNIFORM_BYTES / 4);
        this.destroyed = false;
    }

    init() {
        if (this.pipeline) return this;
        if (this.destroyed) throw new Error('SurfaceCompositor has been destroyed');
        this.lease = acquireVGPU(this.ownerId, this.device);
        this.vgpu = this.lease.vgpu;
        this.sampler = this.vgpu.texture.sampler({
            magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge'
        });
        const module = this.vgpu.shader.compile('plauna-surface-compositor', COMPOSITOR_SHADER);
        this.layout = this.vgpu.bindings.defineLayout('plauna-surface-compositor', [
            { binding: 0, type: 'uniform', visibility: 'vertex|fragment', minBindingSize: UNIFORM_BYTES },
            { binding: 1, type: 'sampler', visibility: 'fragment' },
            { binding: 2, type: 'texture', visibility: 'fragment' }
        ]);
        this.pipeline = this.vgpu.pipeline.render({
            vertex: { module, entryPoint: 'vs' },
            fragment: { module, entryPoint: 'fs' },
            layouts: [this.layout],
            colorFormat: this.format,
            blend: 'premultiplied',
            depthFormat: null,
            cullMode: 'none',
            label: 'PlaunaSurfaceCompositor'
        });
        return this;
    }

    /** Per-layer uniform buffer and bind group, rebuilt when the view changes. */
    slot(key, view) {
        let slot = this.layers.get(key);
        if (!slot) {
            const created = this.vgpu.buffer.create({ size: UNIFORM_BYTES, usage: 'uniform', label: `plauna-layer-${key}` });
            slot = { buffer: created.buffer, bufferId: created.id, view: null, group: null };
            this.layers.set(key, slot);
        }
        if (slot.view !== view) {
            slot.view = view;
            slot.group = this.vgpu.bindings.createGroup(this.layout, [
                { binding: 0, buffer: slot.buffer },
                { binding: 1, sampler: this.sampler },
                { binding: 2, textureView: view }
            ], `plauna-layer-${key}`);
        }
        return slot;
    }

    /**
     * Draw `layers` inside an already-begun pass.
     * layer: { key, view, rect: {x,y,width,height}, uv?: [u0,v0,u1,v1],
     *          opacity?, shape?, radius?, radiusX?, radiusY? } (target px)
     */
    encode(pass, targetSize, layers) {
        if (this.destroyed || !this.pipeline) return 0;
        let drawn = 0;
        pass.setPipeline(this.pipeline);
        for (const layer of layers) {
            const r = layer.rect;
            if (!layer.view || !(r.width > 0) || !(r.height > 0)) continue;
            const slot = this.slot(layer.key ?? layer.view, layer.view);
            const d = this.data;
            const uv = layer.uv || [0, 0, 1, 1];
            d[0] = r.x; d[1] = r.y; d[2] = r.width; d[3] = r.height;
            d[4] = targetSize.width; d[5] = targetSize.height;
            const shape = SHAPES[String(layer.shape || 'rect').toLowerCase()] ?? 0;
            d[6] = layer.opacity ?? 1;
            d[7] = shape;
            // Same defaults as the surface manager's hit testing
            d[8] = layer.radius ?? (shape === 2 ? Math.min(r.width, r.height) / 2 : Math.min(r.width, r.height) / 8);
            d[9] = layer.radiusX ?? r.width / 2;
            d[10] = layer.radiusY ?? r.height / 2;
            d[11] = 0;
            d[12] = uv[0]; d[13] = uv[1]; d[14] = uv[2]; d[15] = uv[3];
            this.device.queue.writeBuffer(slot.buffer, 0, d);
            pass.setBindGroup(0, slot.group);
            pass.draw(6);
            drawn++;
        }
        return drawn;
    }

    /**
     * Draw `layers` over `view` in a pass of its own. options: encoder (record
     * into the host's encoder; the host submits), load (default true), clear.
     */
    draw(view, targetSize, layers, options = {}) {
        if (this.destroyed || !this.pipeline) return 0;
        const encoder = options.encoder || this.device.createCommandEncoder({ label: 'plauna-surface-compositor' });
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view,
                clearValue: options.clear || { r: 0, g: 0, b: 0, a: 0 },
                loadOp: options.load === false ? 'clear' : 'load',
                storeOp: 'store'
            }]
        });
        const drawn = this.encode(pass, targetSize, layers);
        pass.end();
        if (!options.encoder) this.device.queue.submit([encoder.finish()]);
        return drawn;
    }

    /** Release a layer's uniform buffer and bind group. */
    forget(key) {
        const slot = this.layers.get(key);
        if (!slot) return;
        this.layers.delete(key);
        try { this.vgpu?.buffer.release(slot.bufferId); } catch { /* lease gone */ }
    }

    destroy() {
        if (this.destroyed) return;
        this.destroyed = true;
        for (const key of [...this.layers.keys()]) this.forget(key);
        try { this.lease?.release?.(); } catch { /* already released */ }
        this.lease = null;
        this.vgpu = null;
        this.pipeline = null;
    }
}
