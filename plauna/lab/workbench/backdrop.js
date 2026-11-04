// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Workbench lab particle backdrop: WebGPU/canvas particles that flow around panels and Pretext text.
 * Split out of lab/workbench-lab.js.
 */

import { acquireGpuDeviceForConsumer } from '../../../engine/core/gpu/GpuDeviceOwnership.js';
import { PRETEXT_PARTICLE_COUNT, randomBetween } from './support.js';

export function buildBackdropController(canvas, logger, options = {}) {
    const gpu = {
        canvas,
        deviceLease: null,
        device: null,
        context: null,
        format: null,
        pipeline: null,
        bindGroup: null,
        uniformBuffer: null
    };
    let destroyed = false;
    let initialized = false;
    let lifecycleGeneration = 0;
    let initializePromise = null;

    function lifecycleError() {
        const error = new Error('Plauna workbench backdrop lifecycle was revoked');
        error.code = 'PLAUNA_BACKDROP_DESTROYED';
        return error;
    }

    function releaseGpuState() {
        initialized = false;
        try { gpu.uniformBuffer?.destroy(); } catch (_) {}
        try { gpu.context?.unconfigure?.(); } catch (_) {}
        try { gpu.deviceLease?.release?.(); } catch (_) {}
        gpu.deviceLease = null;
        gpu.device = null;
        gpu.context = null;
        gpu.format = null;
        gpu.pipeline = null;
        gpu.bindGroup = null;
        gpu.uniformBuffer = null;
    }

    function initialize() {
        if (destroyed) return Promise.reject(lifecycleError());
        if (initialized) return Promise.resolve(true);
        if (initializePromise) return initializePromise;
        const generation = ++lifecycleGeneration;
        let tracked;
        tracked = initializeGeneration(generation).catch(error => {
            if (generation === lifecycleGeneration) releaseGpuState();
            throw error;
        }).finally(() => {
            if (initializePromise === tracked) initializePromise = null;
        });
        initializePromise = tracked;
        return tracked;
    }

    async function initializeGeneration(generation) {
        if (!('gpu' in navigator) && !options.gpuLeaseFactory) {
            logger.warn('WebGPU not available; using DOM-only fallback');
            return false;
        }

        const candidateLease = await (options.gpuLeaseFactory || acquireGpuDeviceForConsumer)({
            ownerId: 'plauna-workbench-backdrop',
            device: options.gpuDevice || options.device || null,
            ownership: options.deviceOwnership || options.ownership || null,
            ownsDevice: options.ownsDevice === true,
            profile: options.gpuProfile || options.profile || 'baseline-render',
            label: 'PlaunaLabBackdrop.device',
        });
        if (destroyed || generation !== lifecycleGeneration) {
            try { candidateLease?.release?.(); } catch (_) {}
            throw lifecycleError();
        }
        gpu.deviceLease = candidateLease;
        gpu.device = candidateLease.device;
        gpu.context = canvas.getContext('webgpu');
        gpu.format = options.format
            || navigator.gpu?.getPreferredCanvasFormat?.()
            || 'bgra8unorm';
        resize();
        gpu.context.configure({
            device: gpu.device,
            format: gpu.format,
            alphaMode: 'opaque'
        });

        const shader = gpu.device.createShaderModule({
            label: 'PlaunaLabBackdropShader',
            code: `
                struct VsOut {
                    @builtin(position) position: vec4f,
                    @location(0) uv: vec2f,
                };

                struct Uniforms {
                    resolution: vec2f,
                    time: f32,
                    mode: f32,
                };

                @group(0) @binding(0) var<uniform> uniforms: Uniforms;

                @vertex
                fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VsOut {
                    var positions = array<vec2f, 3>(
                        vec2f(-1.0, -3.0),
                        vec2f(-1.0, 1.0),
                        vec2f(3.0, 1.0)
                    );
                    var out: VsOut;
                    let pos = positions[vertex_index];
                    out.position = vec4f(pos, 0.0, 1.0);
                    out.uv = pos * 0.5 + vec2f(0.5, 0.5);
                    return out;
                }

                fn hash21(p: vec2f) -> f32 {
                    let h = dot(p, vec2f(127.1, 311.7));
                    return fract(sin(h) * 43758.5453123);
                }

                fn noise(p: vec2f) -> f32 {
                    let i = floor(p);
                    let f = fract(p);
                    let a = hash21(i);
                    let b = hash21(i + vec2f(1.0, 0.0));
                    let c = hash21(i + vec2f(0.0, 1.0));
                    let d = hash21(i + vec2f(1.0, 1.0));
                    let u = f * f * (3.0 - 2.0 * f);
                    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
                }

                fn fbm(p: vec2f) -> f32 {
                    var value = 0.0;
                    var amplitude = 0.5;
                    var q = p;
                    for (var i = 0; i < 4; i = i + 1) {
                        value += amplitude * noise(q);
                        q *= 2.03;
                        amplitude *= 0.5;
                    }
                    return value;
                }

                @fragment
                fn fs_main(in: VsOut) -> @location(0) vec4f {
                    let uv = in.uv;
                    let aspect = uniforms.resolution.x / max(uniforms.resolution.y, 1.0);
                    let p = vec2f((uv.x - 0.5) * aspect, uv.y - 0.5);
                    let t = uniforms.time * 0.12;
                    let field = fbm(p * 5.0 + vec2f(t, -t * 0.6));
                    let glowA = exp(-length(p - vec2f(-0.28, 0.12)) * 5.2);
                    let glowB = exp(-length(p - vec2f(0.34, -0.24)) * 4.4);
                    let band = smoothstep(0.18, 0.92, field);
                    let base = vec3f(0.025, 0.04, 0.08);
                    let cyan = vec3f(0.08, 0.56, 0.92) * (glowA * 0.9 + band * 0.38);
                    let amber = vec3f(0.95, 0.54, 0.16) * (glowB * 0.55 + band * 0.12);
                    let grid = 0.02 * sin(uv.x * uniforms.resolution.x * 0.08) * sin(uv.y * uniforms.resolution.y * 0.08);
                    let color = base + cyan + amber + vec3f(grid);
                    return vec4f(color, 1.0);
                }
            `
        });

        gpu.uniformBuffer = gpu.device.createBuffer({
            label: 'PlaunaLabBackdropUniforms',
            size: 16,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        gpu.pipeline = gpu.device.createRenderPipeline({
            label: 'PlaunaLabBackdropPipeline',
            layout: 'auto',
            vertex: { module: shader, entryPoint: 'vs_main' },
            fragment: { module: shader, entryPoint: 'fs_main', targets: [{ format: gpu.format }] },
            primitive: { topology: 'triangle-list' }
        });
        gpu.bindGroup = gpu.device.createBindGroup({
            layout: gpu.pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: gpu.uniformBuffer } }]
        });

        logger.info('WebGPU backdrop initialized', {
            format: gpu.format,
            ownership: gpu.deviceLease.ownership,
        });
        initialized = true;
        return true;
    }

    function resize() {
        if (!gpu.device || !gpu.context) {
            return;
        }
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
        const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
        if (canvas.width === width && canvas.height === height) {
            return;
        }
        canvas.width = width;
        canvas.height = height;
    }

    function render(time) {
        if (!gpu.device || !gpu.context || !gpu.pipeline || !gpu.bindGroup) {
            return;
        }
        resize();
        gpu.device.queue.writeBuffer(gpu.uniformBuffer, 0, new Float32Array([canvas.width, canvas.height, time, 0]));
        const encoder = gpu.device.createCommandEncoder({ label: 'PlaunaLabBackdropEncoder' });
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: gpu.context.getCurrentTexture().createView(),
                clearValue: { r: 0.01, g: 0.02, b: 0.04, a: 1 },
                loadOp: 'clear',
                storeOp: 'store'
            }]
        });
        pass.setPipeline(gpu.pipeline);
        pass.setBindGroup(0, gpu.bindGroup);
        pass.draw(3, 1, 0, 0);
        pass.end();
        gpu.device.queue.submit([encoder.finish()]);
    }

    function destroy() {
        if (destroyed) return false;
        destroyed = true;
        lifecycleGeneration += 1;
        releaseGpuState();
        return true;
    }

    return { initialize, resize, render, destroy };
}

function pointInsideRect(x, y, rect) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function buildParticleObstacle(rect, inset = 16) {
    return {
        left: rect.left + inset,
        top: rect.top + inset,
        right: rect.left + rect.width - inset,
        bottom: rect.top + rect.height - inset
    };
}

export function initializePretextParticles(container, state) {
    if (!container || state.pretextParticles.length > 0) {
        return;
    }

    for (let index = 0; index < PRETEXT_PARTICLE_COUNT; index += 1) {
        const element = document.createElement('div');
        element.className = 'plauna-pretext-particle';
        const x = randomBetween(0, container.clientWidth || 320);
        const y = randomBetween(0, container.clientHeight || 140);
        element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        container.appendChild(element);
        state.pretextParticles.push({
            element,
            x,
            y,
            vx: randomBetween(-3, 3),
            vy: randomBetween(-3, 3),
            targetX: x,
            targetY: y,
            jitter: randomBetween(0.4, 1.2),
            phase: randomBetween(0, Math.PI * 2),
            scale: randomBetween(0.7, 1.3),
            pressure: 0,
            slither: randomBetween(-1, 1)
        });
    }
}

export function buildPretextMask({ lines, containerWidth, fontSize, fontWeight, lineHeight }) {
    const horizontalPadding = 14;
    const verticalPadding = 14;
    const haloRadius = Math.max(4, Math.round(fontSize * 0.22));
    const width = Math.max(1, Math.ceil(containerWidth));
    const height = Math.max(120, Math.ceil(lines.length * lineHeight + verticalPadding * 2));

    const canvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `${fontWeight} ${fontSize}px Inter`;

    const lineRects = [];
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const y = verticalPadding + index * lineHeight;
        const baselineY = y + fontSize;
        ctx.fillText(line.text, horizontalPadding, baselineY);
        lineRects.push({
            left: horizontalPadding,
            top: y,
            right: horizontalPadding + Math.ceil(line.width),
            bottom: y + lineHeight
        });
    }

    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const contourPoints = [];
    const threshold = 20;
    const step = 3;
    const haloMask = new Uint8Array(width * height);
    const alphaAt = (x, y) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return 0;
        return data[(y * width + x) * 4 + 3];
    };

    const haloAt = (x, y) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return 0;
        return haloMask[y * width + x];
    };

    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if (alphaAt(x, y) <= threshold) continue;
            for (let oy = -haloRadius; oy <= haloRadius; oy += 1) {
                for (let ox = -haloRadius; ox <= haloRadius; ox += 1) {
                    if (ox * ox + oy * oy > haloRadius * haloRadius) continue;
                    const nx = x + ox;
                    const ny = y + oy;
                    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
                    haloMask[ny * width + nx] = 1;
                }
            }
        }
    }

    for (let y = 1; y < height - 1; y += step) {
        for (let x = 1; x < width - 1; x += step) {
            const alpha = haloAt(x, y);
            if (alpha <= 0) continue;
            if (
                haloAt(x - 1, y) <= 0 ||
                haloAt(x + 1, y) <= 0 ||
                haloAt(x, y - 1) <= 0 ||
                haloAt(x, y + 1) <= 0
            ) {
                contourPoints.push({ x, y });
            }
        }
    }

    return {
        width,
        height,
        alphaAt,
        haloAt,
        contourPoints,
        lineRects
    };
}

export function resolvePretextMaskCollision(particle, mask) {
    if (!mask) return;
    const px = Math.round(particle.x);
    const py = Math.round(particle.y);
    if (mask.haloAt(px, py) <= 0) {
        return;
    }

    const directions = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1]
    ];

    for (let radius = 1; radius <= 18; radius += 1) {
        for (const [dx, dy] of directions) {
            const nx = px + dx * radius;
            const ny = py + dy * radius;
            if (mask.haloAt(nx, ny) <= 0) {
                particle.x = nx;
                particle.y = ny;
                particle.vx -= dx * 0.6;
                particle.vy -= dy * 0.6;
                return;
            }
        }
    }
}

export function clampMagnitude(x, y, maxMagnitude) {
    const magnitude = Math.hypot(x, y);
    if (magnitude <= maxMagnitude || magnitude === 0) {
        return { x, y };
    }

    const scale = maxMagnitude / magnitude;
    return { x: x * scale, y: y * scale };
}

export function computeBoidSteering(particles, particle, radius, maxForce) {
    let separationX = 0;
    let separationY = 0;
    let alignmentX = 0;
    let alignmentY = 0;
    let cohesionX = 0;
    let cohesionY = 0;
    let count = 0;

    for (const other of particles) {
        if (other === particle) continue;
        const dx = particle.x - other.x;
        const dy = particle.y - other.y;
        const distance = Math.hypot(dx, dy);
        if (distance <= 0.001 || distance > radius) continue;
        const inv = 1 / distance;
        const weight = 1 - distance / radius;
        separationX += dx * inv * weight;
        separationY += dy * inv * weight;
        alignmentX += other.vx;
        alignmentY += other.vy;
        cohesionX += other.x;
        cohesionY += other.y;
        count += 1;
    }

    if (count === 0) {
        return { x: 0, y: 0 };
    }

    alignmentX = alignmentX / count - particle.vx;
    alignmentY = alignmentY / count - particle.vy;
    cohesionX = cohesionX / count - particle.x;
    cohesionY = cohesionY / count - particle.y;

    const combinedX = separationX * 1.9 + alignmentX * 0.12 + cohesionX * 0.004;
    const combinedY = separationY * 1.9 + alignmentY * 0.12 + cohesionY * 0.004;
    return clampMagnitude(combinedX, combinedY, maxForce);
}

export function computeRectFlowForce(particle, obstacles, padding = 20) {
    let forceX = 0;
    let forceY = 0;
    let pressureInput = 0;

    for (const obstacle of obstacles) {
        const cx = Math.max(obstacle.left, Math.min(particle.x, obstacle.right));
        const cy = Math.max(obstacle.top, Math.min(particle.y, obstacle.bottom));
        const dx = particle.x - cx;
        const dy = particle.y - cy;
        const distance = Math.hypot(dx, dy);
        const inside = pointInsideRect(particle.x, particle.y, obstacle);
        const influence = inside ? 1 : Math.max(0, 1 - distance / padding);
        if (influence <= 0) continue;

        const nx = inside ? (particle.x < (obstacle.left + obstacle.right) * 0.5 ? -1 : 1) : dx / Math.max(distance, 0.001);
        const ny = inside ? (particle.y < (obstacle.top + obstacle.bottom) * 0.5 ? -1 : 1) : dy / Math.max(distance, 0.001);
        const tangentX = -ny * particle.slither;
        const tangentY = nx * particle.slither;
        const pressureFactor = Math.min(1, particle.pressure / 1.1);
        const repelScale = inside ? (0.72 - pressureFactor * 0.42) : influence * 0.46;
        const tangentScale = 0.45 + influence * 1.05 + pressureFactor * 0.52;
        forceX += nx * repelScale + tangentX * tangentScale;
        forceY += ny * repelScale + tangentY * tangentScale;
        pressureInput = Math.max(pressureInput, inside ? 0.85 : influence * 0.24);
    }

    return { forceX, forceY, pressureInput };
}

export function computeMaskFlowForce(particle, mask) {
    if (!mask) {
        return { forceX: 0, forceY: 0, pressureInput: 0 };
    }

    const px = Math.round(particle.x);
    const py = Math.round(particle.y);
    let gradientX = 0;
    let gradientY = 0;
    const sampleStep = 3;
    for (let offset = 1; offset <= sampleStep; offset += 1) {
        gradientX += mask.haloAt(px + offset, py) - mask.haloAt(px - offset, py);
        gradientY += mask.haloAt(px, py + offset) - mask.haloAt(px, py - offset);
    }

    const insideAlpha = mask.haloAt(px, py) > 0 ? 255 : 0;
    const magnitude = Math.hypot(gradientX, gradientY);
    if (magnitude <= 0.001 && insideAlpha <= 20) {
        return { forceX: 0, forceY: 0, pressureInput: 0 };
    }

    const nx = magnitude > 0.001 ? -gradientX / magnitude : 0;
    const ny = magnitude > 0.001 ? -gradientY / magnitude : -1;
    const tangentX = -ny * particle.slither;
    const tangentY = nx * particle.slither;
    const inside = insideAlpha > 20;
    const pressureFactor = Math.min(1, particle.pressure / 1.1);
    const repelScale = inside ? (0.68 - pressureFactor * 0.34) : 0.2;
    const tangentScale = inside ? (0.9 + pressureFactor * 0.62) : 0.42;
    return {
        forceX: nx * repelScale + tangentX * tangentScale,
        forceY: ny * repelScale + tangentY * tangentScale,
        pressureInput: inside ? 0.8 : Math.min(0.18, insideAlpha / 255)
    };
}

export function updatePressure(particle, pressureInput, dt) {
    const rise = pressureInput > 0 ? pressureInput * dt * 1.5 : -dt * 2.2;
    particle.pressure = Math.max(0, Math.min(1.1, particle.pressure + rise));
}

export function bounceWithinBounds(particle, minX, minY, maxX, maxY, damping = 0.72) {
    if (particle.x <= minX) {
        particle.x = minX;
        particle.vx = Math.abs(particle.vx) * damping;
    } else if (particle.x >= maxX) {
        particle.x = maxX;
        particle.vx = -Math.abs(particle.vx) * damping;
    }
    if (particle.y <= minY) {
        particle.y = minY;
        particle.vy = Math.abs(particle.vy) * damping;
    } else if (particle.y >= maxY) {
        particle.y = maxY;
        particle.vy = -Math.abs(particle.vy) * damping;
    }
}
