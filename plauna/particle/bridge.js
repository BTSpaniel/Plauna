// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * PlaunaGPUBridge - puts Plauna UI into a host's GPU frame.
 *
 * A host (the editor viewport, the OS compositor, an XR session) shares its
 * GPU device through getVGPU. The bridge then:
 *
 *   Surfaces   gives each Plauna surface a texture. A RenderSurface source,
 *              or a DOM element (laid out and painted by Plauna's GPU
 *              renderer), is painted into it whenever its content changes;
 *              canvases, images, bitmaps and video frames are copied in; a
 *              GPUTexture or view the host renders itself is used as it is.
 *   Frames     renderUIPass() draws the visible surfaces into the host frame
 *              in z order, cut to their shape, then the text labels.
 *   Labels     setLabel() places text in the frame, laid out and rasterised
 *              exactly like Plauna's GPU-painted DOM text, at a screen point
 *              or following a world anchor.
 *   Anchors    projectWorldAnchor() projects a UIAnchor's target entity to
 *              screen space with the host camera's view-projection matrix.
 *   Input      pointer() routes surface-local pointer input to a surface's
 *              Plauna content (hover, press, click, focus).
 */

import { getEntityComponent } from '../../engine/ecs/storage/ArchetypeStorage.js';
import { RenderSurface } from '../render/RenderSurface.js';
import { resolveGpuDevice } from '../render/RenderModes.js';
import { surfaceLayer } from '../surface/surface-manager.js';

export { resolveGpuDevice };

// The GPU stack loads when a bridge initializes, so DOM-only apps do not pay for it
let gpuModules = null;
function loadGpuModules() {
    gpuModules ??= Promise.all([
        import('../../engine/core/gpu/VirtualGPU.js'),
        import('../render/gpu/SurfaceCompositor.js')
    ]).then(([vgpu, compositor]) => ({
        acquireVGPU: vgpu.acquireVGPU,
        SurfaceCompositor: compositor.SurfaceCompositor
    }));
    return gpuModules;
}

const TEXTURE_USAGE = () => GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC;

/**
 * Project a world position with a column-major view-projection matrix
 * (WebGPU clip space, depth 0..1) to a point in a width x height viewport.
 * Returns { x, y, depth, visible } or null when the point is behind the camera.
 */
export function projectToScreen(position, viewProjection, width, height) {
    const [px, py, pz] = Array.isArray(position) || ArrayBuffer.isView(position)
        ? position
        : [position?.x ?? 0, position?.y ?? 0, position?.z ?? 0];
    const m = viewProjection;
    const cx = m[0] * px + m[4] * py + m[8] * pz + m[12];
    const cy = m[1] * px + m[5] * py + m[9] * pz + m[13];
    const cz = m[2] * px + m[6] * py + m[10] * pz + m[14];
    const cw = m[3] * px + m[7] * py + m[11] * pz + m[15];
    if (!(cw > 1e-6)) return null;
    const nx = cx / cw;
    const ny = cy / cw;
    const depth = cz / cw;
    return {
        x: (nx * 0.5 + 0.5) * width,
        y: (0.5 - ny * 0.5) * height,
        depth,
        visible: nx >= -1 && nx <= 1 && ny >= -1 && ny <= 1 && depth >= 0 && depth <= 1
    };
}

function sourceKind(source) {
    if (!source || typeof source !== 'object') return 'none';
    if (source instanceof RenderSurface) return 'plauna';
    if (typeof GPUTexture !== 'undefined' && source instanceof GPUTexture) return 'gpu-texture';
    if (typeof GPUTextureView !== 'undefined' && source instanceof GPUTextureView) return 'gpu-view';
    if (typeof HTMLVideoElement !== 'undefined' && source instanceof HTMLVideoElement) return 'video';
    if ((typeof HTMLCanvasElement !== 'undefined' && source instanceof HTMLCanvasElement)
        || (typeof OffscreenCanvas !== 'undefined' && source instanceof OffscreenCanvas)) return 'canvas';
    if ((typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap)
        || (typeof HTMLImageElement !== 'undefined' && source instanceof HTMLImageElement)
        || (typeof VideoFrame !== 'undefined' && source instanceof VideoFrame)) return 'image';
    if (typeof Element !== 'undefined' && source instanceof Element) return 'element';
    return 'none';
}

function naturalSize(source) {
    const width = source.videoWidth || source.naturalWidth || source.displayWidth || source.width || 0;
    const height = source.videoHeight || source.naturalHeight || source.displayHeight || source.height || 0;
    return [width, height];
}

/** A hidden, non-interactive page host for content painted off the page. */
function offPageHost(width) {
    const host = document.createElement('div');
    host.className = 'plauna-offpage-host';
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:0;overflow:visible;opacity:0;pointer-events:none;z-index:-1;`;
    document.body.appendChild(host);
    return host;
}

export class PlaunaGPUBridge {
    /**
     * @param {Object} options
     * @param {() => any} options.getVGPU the host's VGPU instance (or GPUDevice)
     * @param {Object} [options.engine]
     * @param {Object} [options.uiWorld] Plauna's UI ECS world (UIAnchor entities)
     * @param {Object} [options.sceneWorld] the host scene's ECS world (anchor targets)
     * @param {Object} [options.textService]
     * @param {GPUTextureFormat} [options.format] frame format (default: preferred canvas format)
     * @param {number} [options.dpr] device pixel ratio for surface textures
     */
    constructor(options = {}) {
        this.getVGPU = options.getVGPU;
        this.engine = options.engine || globalThis.window?.ParticleEngine || null;
        this.uiWorld = options.uiWorld || null;
        this.sceneWorld = options.sceneWorld || null;
        this.textService = options.textService || null;
        this.format = options.format || null;
        this.dpr = options.dpr || null;

        this.vgpu = null;
        this.device = null;
        this.gpu = null;
        this.lease = null;
        this.compositors = new Map();
        this.surfaceResources = new Map();
        this.labels = new Map();
        this.overlay = null;
        this.overlayHost = null;
        this.initialized = false;
    }

    async initialize() {
        this.vgpu = typeof this.getVGPU === 'function' ? this.getVGPU() : null;
        this.device = resolveGpuDevice(this.vgpu);
        if (!this.device) {
            throw new Error('VGPU required for Plauna GPU features');
        }
        this.format ||= navigator.gpu.getPreferredCanvasFormat();
        this.gpu = await loadGpuModules();
        this.lease = this.gpu.acquireVGPU('plauna.bridge', this.device);
        this.compositor(this.format);
        this.initialized = true;
    }

    /** The compositor for a target format. */
    compositor(format = this.format) {
        let compositor = this.compositors.get(format);
        if (!compositor) {
            compositor = new this.gpu.SurfaceCompositor({ device: this.device, format, ownerId: `plauna.bridge.${format}` }).init();
            this.compositors.set(format, compositor);
        }
        return compositor;
    }

    get pixelRatio() {
        return this.dpr || globalThis.devicePixelRatio || 1;
    }

    // ── Surface resources ─────────────────────────────────────────────────

    createSurfaceResources(surface) {
        if (!this.initialized) {
            throw new Error('GPU bridge not initialized');
        }
        const resources = {
            kind: sourceKind(surface.source),
            source: surface.source,
            // The descriptor's source; a host texture set later does not change it
            declared: surface.source,
            texture: null,
            view: null,
            textureId: null,
            width: 0,
            height: 0,
            renderSurface: null,
            host: null,
            version: -1,
            painted: false
        };
        this.surfaceResources.set(surface.id, { surface, resources });
        this.attachSource(surface, resources);
        this.refreshSurface(surface);
        return resources;
    }

    attachSource(surface, resources) {
        const source = resources.source;
        if (resources.kind === 'plauna') {
            resources.renderSurface = source;
        } else if (resources.kind === 'element') {
            // Lay the element out at the surface's size and paint it off the page
            resources.host = offPageHost(surface.width);
            resources.renderSurface = new RenderSurface({
                mode: 'gpu',
                present: false,
                format: this.format,
                getDevice: async () => this.device
            });
            resources.host.appendChild(resources.renderSurface.element);
            resources.renderSurface.mount(source);
        } else if (resources.kind === 'gpu-texture') {
            resources.view = source.createView();
        } else if (resources.kind === 'gpu-view') {
            resources.view = source;
        }
    }

    detachSource(resources) {
        if (resources.kind === 'element') {
            resources.renderSurface?.destroy();
            resources.host?.remove();
        }
        resources.renderSurface = null;
        resources.host = null;
        this.releaseTexture(resources);
        resources.view = null;
    }

    updateSurfaceResources(surface) {
        const entry = this.surfaceResources.get(surface.id);
        if (!entry) {
            return this.createSurfaceResources(surface);
        }
        const { resources } = entry;
        // The surface manager passes its staged next state; keep it as current
        entry.surface = surface;
        if (surface.source !== resources.declared) {
            this.detachSource(resources);
            resources.declared = surface.source;
            resources.source = surface.source;
            resources.kind = sourceKind(surface.source);
            this.attachSource(surface, resources);
        } else if (resources.host) {
            resources.host.style.width = `${surface.width}px`;
        }
        resources.version = -1;
        this.refreshSurface(surface);
        return resources;
    }

    destroySurfaceResources(surface) {
        const entry = this.surfaceResources.get(surface.id);
        if (!entry) {
            return;
        }
        this.surfaceResources.delete(surface.id);
        this.detachSource(entry.resources);
        for (const compositor of this.compositors.values()) compositor.forget(surface.id);
    }

    /** Use a texture the host renders itself (a camera, a video decoder) for a surface. */
    setSurfaceTexture(surfaceId, textureOrView) {
        const entry = this.surfaceResources.get(surfaceId);
        if (!entry) throw new Error(`Surface has no GPU resources: ${surfaceId}`);
        const { resources } = entry;
        this.detachSource(resources);
        resources.source = textureOrView;
        resources.kind = sourceKind(textureOrView);
        this.attachSource(entry.surface, resources);
        return resources;
    }

    ensureTexture(resources, width, height, format = this.format) {
        width = Math.max(1, Math.ceil(width));
        height = Math.max(1, Math.ceil(height));
        if (resources.textureId != null && resources.width === width && resources.height === height && resources.format === format) {
            return false;
        }
        this.releaseTexture(resources);
        const created = this.lease.vgpu.texture.create({
            width, height, format, usage: TEXTURE_USAGE(), label: 'plauna-surface'
        });
        resources.texture = created.texture;
        resources.view = created.view;
        resources.textureId = created.id;
        resources.width = width;
        resources.height = height;
        resources.format = format;
        return true;
    }

    releaseTexture(resources) {
        if (resources.textureId == null) return;
        try { this.lease?.vgpu.texture.release(resources.textureId); } catch { /* lease gone */ }
        resources.texture = null;
        resources.view = null;
        resources.textureId = null;
        resources.width = 0;
        resources.height = 0;
    }

    /** Bring a surface's texture up to date with its source. Returns true if it painted. */
    refreshSurface(surfaceOrId) {
        const id = typeof surfaceOrId === 'string' ? surfaceOrId : surfaceOrId?.id;
        const entry = this.surfaceResources.get(id);
        if (!entry) return false;
        const { surface, resources } = entry;
        const dpr = this.pixelRatio;
        switch (resources.kind) {
            case 'plauna':
            case 'element': {
                const rs = resources.renderSurface;
                if (!rs || rs.activeMode !== 'gpu' || !rs.gpu || rs.gpu.device !== this.device) return false;
                const resized = this.ensureTexture(resources, surface.width * dpr, surface.height * dpr, rs.gpu.format);
                if (!resized && resources.version === rs.version) return false;
                resources.version = rs.version;
                rs.renderTo(resources.view, {
                    viewport: { x: 0, y: 0, width: surface.width, height: surface.height },
                    dpr
                });
                resources.painted = true;
                return true;
            }
            case 'video':
            case 'canvas':
            case 'image': {
                const source = resources.source;
                if (resources.kind === 'video' && source.readyState < 2) return false;
                if (resources.kind === 'image' && resources.painted) return false;
                if (resources.kind === 'image' && source.complete === false) return false;
                const [width, height] = naturalSize(source);
                if (!width || !height) return false;
                this.ensureTexture(resources, width, height);
                this.device.queue.copyExternalImageToTexture(
                    { source },
                    { texture: resources.texture, premultipliedAlpha: true },
                    [resources.width, resources.height]
                );
                resources.painted = true;
                return true;
            }
            default:
                return false;
        }
    }

    /** Refresh every surface whose source changed (video and canvases every frame). */
    refreshSurfaces() {
        let painted = 0;
        for (const id of this.surfaceResources.keys()) {
            if (this.refreshSurface(id)) painted++;
        }
        return painted;
    }

    /** Compositor layers for the visible surfaces, lowest z first. */
    layers(dpr = this.pixelRatio, surfaces = null) {
        const list = [];
        let order = 0;
        for (const { surface, resources } of this.surfaceResources.values()) {
            if (surfaces && !surfaces.some((candidate) => candidate.id === surface.id)) continue;
            if (!surface.visible || surface.destroyed || !resources.view) continue;
            list.push({ layer: surfaceLayer(surface, resources.view, dpr), z: surface.zIndex || 0, order: order++ });
        }
        return list.sort((a, b) => a.z - b.z || a.order - b.order).map((entry) => entry.layer);
    }

    // ── Input ─────────────────────────────────────────────────────────────

    /**
     * Route a pointer event at a surface-local point (CSS px, as the surface
     * manager's hitTest returns it) to the surface's Plauna content.
     * Returns the element hit, or null.
     */
    pointer(surfaceOrId, type, x, y, init = {}) {
        const id = typeof surfaceOrId === 'string' ? surfaceOrId : surfaceOrId?.id;
        const rs = this.surfaceResources.get(id)?.resources.renderSurface;
        return rs ? rs.pointer(type, x, y, init) : null;
    }

    // ── Text labels ───────────────────────────────────────────────────────

    /**
     * Place a text label in the frame at a CSS-pixel point, or following a
     * UIAnchor entity (projected each frame). `style` takes CSS properties
     * (camelCase or kebab-case) for the label's box and text.
     */
    setLabel(id, text, options = {}) {
        let label = this.labels.get(id);
        if (!label) {
            label = { element: document.createElement('span'), x: 0, y: 0, anchor: null };
            label.element.className = 'plauna-label';
            this.labels.set(id, label);
            this.ensureOverlay()?.scene.appendChild(label.element);
        }
        const el = label.element;
        el.textContent = String(text ?? '');
        el.style.cssText = 'position:absolute;white-space:nowrap;';
        for (const [name, value] of Object.entries(options.style || {})) {
            if (name.includes('-')) el.style.setProperty(name, String(value));
            else el.style[name] = value;
        }
        label.x = options.x ?? label.x;
        label.y = options.y ?? label.y;
        label.anchor = options.anchor ?? null;
        el.style.left = `${label.x}px`;
        el.style.top = `${label.y}px`;
        return el;
    }

    removeLabel(id) {
        const label = this.labels.get(id);
        if (!label) return false;
        label.element.remove();
        this.labels.delete(id);
        return true;
    }

    clearLabels() {
        for (const id of [...this.labels.keys()]) this.removeLabel(id);
    }

    ensureOverlay(format = this.format) {
        if (typeof document === 'undefined' || !this.device) return null;
        if (this.overlay && this.overlay.format !== format) {
            // Rebuild for a frame of another format, keeping the labels
            const elements = [...this.labels.values()].map((label) => label.element);
            this.overlay.destroy();
            this.overlayHost.remove();
            this.overlay = null;
            this.overlayHost = null;
            this.ensureOverlay(format);
            for (const el of elements) this.overlay.scene.appendChild(el);
            return this.overlay;
        }
        if (!this.overlay) {
            this.overlayHost = offPageHost(globalThis.innerWidth || 1024);
            this.overlay = new RenderSurface({ mode: 'gpu', present: false, format, getDevice: async () => this.device });
            this.overlay.scene.style.position = 'relative';
            this.overlayHost.appendChild(this.overlay.element);
        }
        return this.overlay;
    }

    /** Draw the labels into the frame (see renderUIPass for frameCtx). */
    renderLabels(frameCtx = {}) {
        if (!this.initialized || !this.labels.size) return false;
        const target = this.frameTarget(frameCtx);
        if (!target) return false;
        const overlay = this.ensureOverlay(target.format);
        if (overlay.activeMode !== 'gpu' || !overlay.gpu) return false;
        const cssWidth = target.width / target.dpr;
        const cssHeight = target.height / target.dpr;
        this.overlayHost.style.width = `${cssWidth}px`;
        for (const label of this.labels.values()) {
            if (label.anchor == null) {
                label.element.style.display = '';
                continue;
            }
            const p = this.projectWorldAnchor(label.anchor, { ...frameCtx, width: cssWidth, height: cssHeight });
            label.element.style.display = p?.visible ? '' : 'none';
            if (p?.visible) {
                label.element.style.left = `${p.x}px`;
                label.element.style.top = `${p.y}px`;
            }
        }
        overlay.relayout();
        overlay.renderTo(target.view, {
            viewport: { x: 0, y: 0, width: cssWidth, height: cssHeight },
            dpr: target.dpr,
            load: true,
            encoder: frameCtx.commandEncoder,
            time: frameCtx.time
        });
        return true;
    }

    // ── Frames ────────────────────────────────────────────────────────────

    frameTarget(frameCtx) {
        const texture = frameCtx.texture || (frameCtx.view ? null : frameCtx.context?.getCurrentTexture?.());
        const view = frameCtx.view || texture?.createView();
        if (!view) return null;
        const width = frameCtx.width ?? texture?.width;
        const height = frameCtx.height ?? texture?.height;
        if (!width || !height) return null;
        return {
            view,
            width,
            height,
            dpr: frameCtx.dpr || this.pixelRatio,
            format: frameCtx.format || texture?.format || this.format
        };
    }

    /**
     * Draw Plauna's UI into the host frame: visible surfaces in z order, then
     * text labels. frameCtx: { view | texture | context, width, height (device
     * px), dpr, format, commandEncoder (record into it; the host submits),
     * viewProjection (column-major, for world anchors), time }.
     */
    renderUIPass(frameCtx = {}) {
        if (!this.initialized) {
            return;
        }
        const target = this.frameTarget(frameCtx);
        if (!target) return;
        this.refreshSurfaces();
        const layers = this.layers(target.dpr);
        if (layers.length) {
            this.compositor(target.format).draw(target.view, target, layers, { encoder: frameCtx.commandEncoder, load: true });
        }
        this.renderLabels(frameCtx);
    }

    // ── Projection ────────────────────────────────────────────────────────

    /** World position of a scene entity (its Transform), or null. */
    worldPositionOf(entity, world = this.sceneWorld) {
        if (!world || entity == null) return null;
        const transform = getEntityComponent(world, entity, 'Transform');
        const position = transform?.position;
        if (!position) return null;
        return Array.isArray(position) || ArrayBuffer.isView(position)
            ? [position[0] ?? 0, position[1] ?? 0, position[2] ?? 0]
            : [position.x ?? 0, position.y ?? 0, position.z ?? 0];
    }

    /**
     * Screen position (CSS px) of a UIAnchor entity: its target entity's world
     * position projected with frame.viewProjection into frame.width x
     * frame.height, moved by the anchor's gap toward its first preferred side
     * and kept in bounds when asked. frame.worldPosition overrides the
     * target's position; frame.sceneWorld overrides the bridge's scene world.
     * Returns { x, y, depth, visible } or null.
     */
    projectWorldAnchor(anchorEntity, frame = {}) {
        if (!this.uiWorld || anchorEntity == null) {
            return null;
        }
        const anchor = getEntityComponent(this.uiWorld, anchorEntity, 'UIAnchor');
        if (!anchor || anchor.mode === 'screen') {
            return null;
        }
        const position = frame.worldPosition || this.worldPositionOf(anchor.targetEntity, frame.sceneWorld || this.sceneWorld);
        if (!position || !frame.viewProjection || !frame.width || !frame.height) {
            return null;
        }
        const point = projectToScreen(position, frame.viewProjection, frame.width, frame.height);
        if (!point) {
            return { x: 0, y: 0, depth: 0, visible: false };
        }
        const gap = anchor.gap || 0;
        const side = (anchor.sidePreference || [])[0];
        if (side === 'right') point.x += gap;
        else if (side === 'left') point.x -= gap;
        else if (side === 'bottom') point.y += gap;
        else if (side === 'top') point.y -= gap;
        if (anchor.keepInBounds) {
            point.x = Math.min(Math.max(point.x, 0), frame.width);
            point.y = Math.min(Math.max(point.y, 0), frame.height);
        }
        return point;
    }

    // ── Cleanup ───────────────────────────────────────────────────────────

    destroy() {
        for (const { surface } of [...this.surfaceResources.values()]) {
            this.destroySurfaceResources(surface);
        }
        this.surfaceResources.clear();
        this.clearLabels();
        this.overlay?.destroy();
        this.overlayHost?.remove();
        this.overlay = null;
        this.overlayHost = null;
        for (const compositor of this.compositors.values()) compositor.destroy();
        this.compositors.clear();
        try { this.lease?.release?.(); } catch { /* already released */ }
        this.lease = null;
        this.initialized = false;
    }
}
