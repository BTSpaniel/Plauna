// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * BlurPass - separable Gaussian blur for the painter's effects.
 *
 * `run()` blurs a source texture into a new texture of the same size in two
 * render passes (horizontal, then vertical with an optional colour filter on
 * premultiplied colour, as CSS backdrop-filter chains apply it). Sigma is in
 * texels; 33 taps spread over +-3 sigma. Textures and per-pass uniforms are
 * leased from the painter's VirtualGPU and pooled: `releaseFrame()` returns
 * a submitted frame's textures for the next frame to reuse, and only textures
 * no frame has used for a few frames are released. Bind groups are cached by
 * texture view and uniform buffer, so a repeated frame creates no GPU objects.
 */

const BLUR_SHADER = /* wgsl */`
struct Params {
    dir: vec2f,
    sigma: f32,
    filtered: f32,
    r0: vec4f,
    r1: vec4f,
    r2: vec4f,
    ok: vec4f,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var source: texture_2d<f32>;
@group(0) @binding(2) var sourceSampler: sampler;

struct VOut {
    @builtin(position) position: vec4f,
    @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) index: u32) -> VOut {
    var points = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
    let p = points[index];
    var out: VOut;
    out.position = vec4f(p, 0.0, 1.0);
    out.uv = vec2f((p.x + 1.0) * 0.5, (1.0 - p.y) * 0.5);
    return out;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
    let texel = 1.0 / vec2f(textureDimensions(source));
    var color = textureSampleLevel(source, sourceSampler, in.uv, 0.0);
    if (params.sigma >= 0.5) {
        let spacing = max(1.0, params.sigma * 3.0 / 16.0);
        var sum = vec4f(0.0);
        var total = 0.0;
        for (var k = -16; k <= 16; k++) {
            let x = f32(k) * spacing;
            let w = exp(-(x * x) / (2.0 * params.sigma * params.sigma));
            sum += textureSampleLevel(source, sourceSampler, in.uv + params.dir * texel * x, 0.0) * w;
            total += w;
        }
        color = sum / total;
    }
    if (params.filtered > 0.5) {
        let rgb = vec3f(dot(params.r0.xyz, color.rgb), dot(params.r1.xyz, color.rgb), dot(params.r2.xyz, color.rgb)) + params.ok.xyz * color.a;
        color = vec4f(clamp(rgb, vec3f(0.0), vec3f(color.a)) * params.ok.w, color.a * params.ok.w);
    }
    return color;
}
`;

const USAGE = () => GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
    | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST;

// Frames a pooled texture may sit unused before it is released
const KEEP_FRAMES = 4;

export class BlurPass {
    /**
     * @param {Object} vgpu the painter's leased VirtualGPU
     * @param {GPUDevice} device
     * @param {GPUTextureFormat} format
     */
    constructor(vgpu, device, format) {
        this.vgpu = vgpu;
        this.device = device;
        this.format = format;
        const module = vgpu.shader.compile('plauna-blur', BLUR_SHADER);
        this.layout = vgpu.bindings.defineLayout('plauna-blur', [
            { binding: 0, type: 'uniform', visibility: 'fragment', minBindingSize: 80 },
            { binding: 1, type: 'texture', visibility: 'fragment' },
            { binding: 2, type: 'sampler', visibility: 'fragment' }
        ]);
        this.pipeline = vgpu.pipeline.render({
            vertex: { module, entryPoint: 'vs' },
            fragment: { module, entryPoint: 'fs' },
            layouts: [this.layout],
            colorFormat: format,
            blend: null,
            depthFormat: null,
            cullMode: 'none',
            label: 'PlaunaBlur'
        });
        this.sampler = vgpu.texture.sampler({
            magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge'
        });
        this.free = new Map();       // "w x h" -> idle textures, last taken on top
        this.used = [];              // textures handed out this frame, in order
        this.uniforms = [];          // one per pass of a frame, reused frame to frame
        this.passIndex = 0;
        this.groups = new WeakMap(); // source view -> Map(uniform buffer -> bind group)
        this.data = new Float32Array(20);
    }

    /** A texture of the effect format for this frame ({ id, texture, view }); returned by releaseFrame(). */
    texture(width, height, label = 'plauna-effect') {
        const w = Math.max(1, Math.ceil(width));
        const h = Math.max(1, Math.ceil(height));
        const key = `${w}x${h}`;
        let entry = this.free.get(key)?.pop();
        if (!entry) {
            const created = this.vgpu.texture.create({ width: w, height: h, format: this.format, usage: USAGE(), label });
            entry = { id: created.id, texture: created.texture, view: created.view, key, idle: 0 };
        }
        entry.idle = 0;
        this.used.push(entry);
        return entry;
    }

    /**
     * Blur `source` ({ texture, view }) by `sigma` texels, then apply `filter`
     * ({ m, o, k } or null). Records two passes into `encoder`; returns the
     * result ({ texture, view }).
     */
    run(encoder, source, sigma, filter = null) {
        const { width, height } = source.texture;
        const middle = this.texture(width, height, 'plauna-blur-h');
        const result = this.texture(width, height, 'plauna-blur-v');
        this.pass(encoder, source.view, middle.view, [1, 0], sigma, null);
        this.pass(encoder, middle.view, result.view, [0, 1], sigma, filter);
        return result;
    }

    pass(encoder, sourceView, targetView, dir, sigma, filter) {
        const d = this.data;
        d.fill(0);
        d[0] = dir[0]; d[1] = dir[1]; d[2] = sigma; d[3] = filter ? 1 : 0;
        if (filter) {
            const m = filter.m;
            d.set([m[0], m[1], m[2], 0, m[3], m[4], m[5], 0, m[6], m[7], m[8], 0, filter.o[0], filter.o[1], filter.o[2], filter.k], 4);
        }
        // One uniform buffer per pass: writes land before the frame's submit
        const uniform = this.uniforms[this.passIndex]
            ?? (this.uniforms[this.passIndex] = this.vgpu.buffer.create({ size: 80, usage: 'uniform', label: 'plauna-blur-params' }).buffer);
        this.passIndex++;
        this.device.queue.writeBuffer(uniform, 0, d);
        let byUniform = this.groups.get(sourceView);
        if (!byUniform) this.groups.set(sourceView, byUniform = new Map());
        let group = byUniform.get(uniform);
        if (!group) {
            group = this.vgpu.bindings.createGroup(this.layout, [
                { binding: 0, buffer: uniform },
                { binding: 1, textureView: sourceView },
                { binding: 2, sampler: this.sampler }
            ], 'plauna-blur-bind');
            byUniform.set(uniform, group);
        }
        const pass = encoder.beginRenderPass({
            colorAttachments: [{ view: targetView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }]
        });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, group);
        pass.draw(3);
        pass.end();
    }

    /**
     * Return the frame's textures to the pool (after the frame is submitted)
     * so the next frame takes them in the same order, and release textures
     * no frame has used for KEEP_FRAMES frames.
     */
    releaseFrame() {
        for (let k = this.used.length - 1; k >= 0; k--) {
            const entry = this.used[k];
            if (!this.free.has(entry.key)) this.free.set(entry.key, []);
            this.free.get(entry.key).push(entry);
        }
        this.used = [];
        this.passIndex = 0;
        for (const [key, list] of this.free) {
            for (let k = list.length - 1; k >= 0; k--) {
                if (++list[k].idle <= KEEP_FRAMES) continue;
                try { this.vgpu.texture.release(list[k].id); } catch { /* lease gone */ }
                list.splice(k, 1);
            }
            if (!list.length) this.free.delete(key);
        }
    }
}
