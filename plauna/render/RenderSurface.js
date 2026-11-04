// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * RenderSurface - shows a Plauna scene in DOM, GPU or auto mode.
 *
 *   <div class="plauna-render-surface">     surface.element (position: relative)
 *     <div class="plauna-surface-scene">    surface.scene: renderers render here
 *     <div class="plauna-surface-canvas-clip">  GPU mode only: the visible part
 *       <canvas class="plauna-surface-canvas">
 *
 * DOM mode shows the scene as the browser draws it. GPU mode lays the scene
 * out with Plauna's LayoutEngine and paints it with WebGPU onto a canvas over
 * the scene; the scene stays in the page at opacity 0, exactly where the
 * painted content is, so pointer input, focus, keyboard, text editing, IME
 * and screen readers keep working natively. Plauna paints carets, selections
 * and focus rings itself.
 *
 * The canvas covers only the visible part of the scene, so large or
 * scrolling scenes never need a huge canvas. Repaints are driven by scene
 * mutations, input, focus, scrolling, resizing, theme, style sheet and font
 * changes, and by hover and press when style rules depend on them. A sticky
 * box with no scroll container above it in the scene sticks within the one
 * above the scene, or the viewport, as in the DOM (stickyView); a scroll
 * there lays out again only while such a box exists, and a scroll anywhere
 * else (not above the scene) costs nothing. Open shadow trees in the scene
 * are watched as the scene is, until their hosts leave it; a shadow root
 * attached to a host already in the scene makes no mutation record, so it
 * is noted when the host next changes, or at once with watch(host). Frames
 * run on requestAnimationFrame, or when the host's requestFrame hook says
 * (the host owns the frame then, and its errors: failGpu()).
 *
 * Native content in the scene (canvas, video, iframe, object, embed) has no
 * GPU paint: the browser shows it through a well in the canvas (NativeWell).
 * A box marked data-plauna-glass blurs what lies behind the surface through
 * a DOM element under the canvas (GlassUnderlay).
 *
 * The mode a request resolves to is decided in RenderModes.decideRenderMode:
 * auto is GPU in a Chromium browser with WebGPU, and any GPU error (it cannot
 * start, a frame throws or raises a GPU validation or out-of-memory error)
 * shows the DOM until the mode is requested again. A lost device retries.
 *
 * For targets with no page DOM behind them (world-space panels, XR), use
 * renderTo() with a texture and pointer() to route input by hit testing.
 * `present: false` makes such a texture-only surface: no canvas on the page;
 * onInvalidate tells the host when to paint it again.
 *
 * A surface that shows its own canvas and is given no device paints in a
 * worker (PaintWorkerHost): the canvas, the GPU device, the painter, its
 * atlas and cached layers live there, and the main thread posts what its
 * frames change. Compositor layers whose transform and opacity animations
 * run are drawn by the worker from their timing, so such animations cost
 * the main thread nothing per frame, as in DOM mode. Such a surface has two
 * canvas clips, one hidden: a frame that moves the canvas is drawn into the
 * hidden one and swapped in once the worker has it on screen (placeCanvas),
 * so a scroll never shows content where the canvas was. Surfaces given a
 * device (a host's frame: editor viewport, OS, XR) and texture-only ones
 * paint on the main thread, as does any surface when the browser has no
 * OffscreenCanvas or the worker gets no device, or with `worker: false`.
 */

import { normalizeRenderMode, decideRenderMode, sharedGpuDevice } from './RenderModes.js';
import { NativeWell, NATIVE_TAGS } from './NativeWell.js';
import { WELL_ATTRIBUTE } from './layout/LayoutTree.js';
import { GlassUnderlay, GLASS_ATTRIBUTE } from './GlassUnderlay.js';
import { LayoutEngine, probeScrollbarWidth, probeScrollbarMetrics, transformRectBounds } from './layout/LayoutEngine.js';
import { StyleResolver, inheritedStyleFromHost } from './css/StyleResolver.js';
import { userAgentStyles, userAgentStylesFor } from './css/UserAgentStyles.js';
import { HOVER_ATTRIBUTE, ACTIVE_ATTRIBUTE, VAR_REFERENCE, styleRules, rulesFor, watchStyleSheets } from './css/StyleRules.js';
import { invertAffine, applyAffine, multiplyAffine } from './css/CssValues.js';
import { textShaper } from './text/TextShaper.js';
import { layoutZoom, roundUnit, cssZoomOf } from './layout/LayoutUnits.js';
import { AnimationController } from './AnimationController.js';
import { markChanged, flatChildren, flatParent } from './layout/LayoutTree.js';

// The GPU painter (and the engine GPU stack under it) loads on first use,
// so DOM-only pages do not pay for it
let gpuModules = null;
function loadGpuModules() {
    gpuModules ??= Promise.all([
        import('./gpu/GpuPainter.js'),
        import('./gpu/Rasterizer.js'),
        import('./gpu/DisplayList.js')
    ]).then(([painter, raster, list]) => ({
        GpuPainter: painter.GpuPainter,
        Rasterizer: raster.Rasterizer,
        DisplayListBuilder: list.DisplayListBuilder
    }));
    return gpuModules;
}

let workerHost = null;
function loadWorkerHost() {
    workerHost ??= import('./gpu/PaintWorkerHost.js');
    return workerHost;
}

const CARET_PERIOD = 1060;
const IDENTITY = Object.freeze([1, 0, 0, 1, 0, 0]);
const LOST_RETRY_MS = 1000;
// Animation frames after a worker canvas is swapped out before it is drawn into again
const CANVAS_COOLING = 2;
// While the surface moves (a scroll), a worker canvas reaches past the view by 8
// frames of the motion (64 px at least, half the view at most), kept while 3 are left
const CANVAS_REACH_FRAMES = 8;
const CANVAS_REACH_MIN = 64;
const CANVAS_LEAD_FRAMES = 3;
// The surface stood still this long: a worker canvas covers just the visible part again
const CANVAS_SETTLE_MS = 200;
const TEXT_FIELDS = new Set(['INPUT', 'TEXTAREA']);
const SCENE_MUTATIONS = Object.freeze({ subtree: true, childList: true, attributes: true, characterData: true });

/** The values of an inherited host style, to compare two of them. */
/** Whether `element` matches :focus-visible right now. */
function focusVisibleNow(element) {
    try {
        return element.matches(':focus-visible');
    } catch {
        return false;
    }
}

function hostKey(style) {
    const { custom, ...values } = style;
    return JSON.stringify(values) + JSON.stringify([...(custom || [])]);
}

/**
 * Take a hidden worker canvas's clip out of the surface's extent: hidden, it
 * still takes part in layout, and where it was could hold the page taller.
 */
function collapseClip(clip) {
    clip.style.left = '0px';
    clip.style.top = '0px';
    clip.style.width = '0px';
    clip.style.height = '0px';
}

/**
 * The box `element` clips its content to, in client px: its padding box less
 * any scrollbar. Under CSS zoom (the OS's UI scale) its rect is zoomed while
 * its client metrics are whole px of its own, unzoomed, so its borders come
 * from its computed style (which keeps their fraction) times its zoom, and
 * so do the bars it shows (scrollbarRoom: clientWidth reads 15.2px at 125%
 * as 15, clientLeft 2.4 as 2). A client size a pixel or more short of the
 * padding box with no bar shown (a stable gutter) is measured by the client
 * metrics. `metrics` gives the probed scrollbar sizes.
 */
function clipBox(element, metrics) {
    const z = cssZoomOf(element);
    const r = element.getBoundingClientRect();
    const cs = getComputedStyle(element);
    const border = (side) => parseFloat(cs[`border${side}Width`]) || 0;
    const [bl, br, bt, bb] = [border('Left'), border('Right'), border('Top'), border('Bottom')];
    const width = r.width / z - bl - br;
    const height = r.height / z - bt - bb;
    let [barY, barX] = scrollbarRoom(element, cs, width, height, metrics);
    if (!barY && width - element.clientWidth >= 1) barY = (width - element.clientWidth) * z;
    if (!barX && height - element.clientHeight >= 1) barX = (height - element.clientHeight) * z;
    const rtl = cs.direction === 'rtl';
    return {
        left: r.left + bl * z + (rtl ? barY : 0),
        top: r.top + bt * z,
        right: r.right - br * z - (rtl ? 0 : barY),
        bottom: r.bottom - bb * z - barX
    };
}

// Overflow values that make a scroll container (visible and clip do not)
const SCROLLS = new Set(['hidden', 'auto', 'scroll']);
const CONTAIN_BLOCK = /\b(?:layout|paint|strict|content)\b/;
const WILL_CHANGE_FIXED = /(?:^|,)\s*(?:transform|translate|rotate|scale|perspective|filter|backdrop-filter|contain)\s*(?=,|$)/;
const WILL_CHANGE_ABSOLUTE = /(?:^|,)\s*position\s*(?=,|$)/;

/**
 * Whether computed style `cs` makes its element the containing block of
 * fixed descendants, and so of absolute ones (the rules LayoutEngine's
 * containsFixed follows, as the browser reports them).
 */
function containsFixedBoxes(cs) {
    return cs.transform !== 'none' || cs.translate !== 'none' || cs.rotate !== 'none' || cs.scale !== 'none'
        || cs.perspective !== 'none' || cs.filter !== 'none' || cs.backdropFilter !== 'none'
        || cs.transformStyle === 'preserve-3d' || cs.contentVisibility === 'auto'
        || CONTAIN_BLOCK.test(cs.contain) || WILL_CHANGE_FIXED.test(cs.willChange);
}

/**
 * The ancestors of `element` (up the flat tree, below the root) whose boxes
 * hold it, with their computed styles: its containing-block chain, whose
 * overflow clips it and whose scroll containers its sticky boxes stick
 * within. As in Chrome (measured): an absolutely positioned box skips the
 * static ancestors that do not contain absolute boxes, and their clips and
 * scrolling; a fixed one every ancestor that does not contain fixed boxes;
 * display: contents has no box.
 */
function* containingAncestors(element) {
    const root = document.documentElement;
    let position = getComputedStyle(element).position;
    for (let at = flatParent(element); at && at !== root; at = flatParent(at)) {
        const cs = getComputedStyle(at);
        if (cs.display === 'contents') continue;
        if (position === 'fixed' && !containsFixedBoxes(cs)) continue;
        if (position === 'absolute' && cs.position === 'static' && !containsFixedBoxes(cs) && !WILL_CHANGE_ABSOLUTE.test(cs.willChange)) continue;
        yield [at, cs];
        position = cs.position;
    }
}

/**
 * The scroll container above `scene` that sticky boxes in the scene stick
 * within when no scroll container in the scene lies between, or null for
 * the viewport: the first one up the containing-block chain (an absolute
 * box in a static scroller sticks within the page, measured). The body's
 * overflow is the viewport's while the root's is visible.
 */
function stickyContainerOf(scene) {
    const rootStyle = getComputedStyle(document.documentElement);
    const bodyIsViewport = rootStyle.overflowX === 'visible' && rootStyle.overflowY === 'visible';
    for (const [at, cs] of containingAncestors(scene)) {
        if ((SCROLLS.has(cs.overflowX) || SCROLLS.has(cs.overflowY)) && !(at === document.body && bodyIsViewport)) return at;
    }
    return null;
}

/**
 * The room `element`'s scrollbars take, in client px: [vertical, horizontal].
 * `width` and `height` are its padding box (its own px). A bar takes room
 * while shown (overflow scroll, or auto with content overflowing) with
 * classic scrollbars (the client size is short of the padding box: hidden
 * and overlay bars take none). Its thickness, measured at 1, 1.25 and 1.5:
 * scrollbar-width none 0, thin and auto the probed sizes (`metrics()`: in
 * the body's px; any scrollbar-width but auto turns ::-webkit-scrollbar
 * off), a ::-webkit-scrollbar size floored to device pixels, and 0 for
 * ::-webkit-scrollbar { display: none }. The client sizes are whole px, so
 * they only say whether a bar is there (15.2 px at 125% reads as 15).
 */
function scrollbarRoom(element, cs, width, height, metrics) {
    const shownY = (cs.overflowY === 'scroll' || (cs.overflowY === 'auto' && element.scrollHeight > element.clientHeight))
        && width - element.clientWidth >= 0.5;
    const shownX = (cs.overflowX === 'scroll' || (cs.overflowX === 'auto' && element.scrollWidth > element.clientWidth))
        && height - element.clientHeight >= 0.5;
    if ((!shownY && !shownX) || cs.scrollbarWidth === 'none') return [0, 0];
    const custom = cs.scrollbarWidth === 'auto' ? getComputedStyle(element, '::-webkit-scrollbar') : null;
    if (custom?.display === 'none') return [0, 0];
    const dpr = window.devicePixelRatio || 1;
    const z = cssZoomOf(element);
    const thickness = (size) => {
        const px = parseFloat(size);
        if (Number.isFinite(px)) return Math.floor(px * z * dpr + 1e-6) / dpr;
        const probed = metrics();
        return (cs.scrollbarWidth === 'thin' ? probed.thin : probed.auto) * cssZoomOf(document.body);
    };
    return [shownY ? thickness(custom?.width) : 0, shownX ? thickness(custom?.height) : 0];
}

/**
 * The content box of scroll container `element` less its scrollbars, in
 * client px: where sticky boxes in it stick (measured: the padding comes
 * off; a right-to-left box has its vertical bar on the left). Borders come
 * from its computed style, which keeps their fraction (clientTop rounds
 * 2.4px at 125% to 2), times its zoom.
 */
function stickyBoxOf(element, metrics) {
    const z = cssZoomOf(element);
    const r = element.getBoundingClientRect();
    const cs = getComputedStyle(element);
    const px = (name) => parseFloat(cs[name]) || 0;
    const [bl, br, bt, bb] = [px('borderLeftWidth'), px('borderRightWidth'), px('borderTopWidth'), px('borderBottomWidth')];
    const [barY, barX] = scrollbarRoom(element, cs, r.width / z - bl - br, r.height / z - bt - bb, metrics);
    const rtl = cs.direction === 'rtl';
    return {
        left: r.left + (bl + px('paddingLeft')) * z + (rtl ? barY : 0),
        top: r.top + (bt + px('paddingTop')) * z,
        right: r.right - (br + px('paddingRight')) * z - (rtl ? 0 : barY),
        bottom: r.bottom - (bb + px('paddingBottom')) * z - barX
    };
}

/** Whether `node` is `ancestor` or below it in the flat tree (through open shadow roots and slots). */
function flatContains(ancestor, node) {
    for (let at = node; at; at = flatParent(at)) if (at === ancestor) return true;
    return false;
}

/** The element children of `element` in the flat tree. */
function flatElements(element) {
    if (!element.shadowRoot && element.localName !== 'slot') return element.children;
    return [...flatChildren(element)].filter((node) => node.nodeType === 1);
}

function isTextField(element) {
    if (!element || !TEXT_FIELDS.has(element.tagName)) return false;
    if (element.tagName === 'TEXTAREA') return true;
    const type = (element.getAttribute('type') || 'text').toLowerCase();
    return !['checkbox', 'radio', 'range', 'color', 'file', 'button', 'submit', 'reset', 'image', 'hidden'].includes(type);
}

export class RenderSurface {
    /**
     * @param {Object} [options]
     * @param {'dom'|'gpu'|'auto'} [options.mode='dom']
     * @param {GPUDevice} [options.device] a device to share (the OS or engine device)
     * @param {() => Promise<GPUDevice>} [options.getDevice]
     * @param {(mode: string) => void} [options.onModeChange] called with the active mode
     * @param {HTMLElement} [options.element] an existing element to become the surface
     * @param {boolean} [options.present=true] false: paint only through renderTo()
     * @param {(layout: boolean) => void} [options.onInvalidate] called when the surface needs a repaint
     * @param {GPUTextureFormat} [options.format] target format (default: the preferred canvas format)
     * @param {boolean} [options.worker=true] paint a surface with its own canvas and no given
     *   device in a worker; false paints it on the main thread
     * @param {(paint: (time?: number) => void) => any} [options.requestFrame] runs a frame when
     *   the host says: call `paint` once, inside the host's frame (default: the next animation
     *   frame). It returns a handle for cancelFrame, and `paint` lets errors reach the host
     *   (failGpu() shows the DOM, as frames on animation frames do by themselves). One
     *   request at a time; a `paint` called again, or after its request was cancelled
     *   (a mode change, destroy), does nothing. A requestFrame that throws (or a paint
     *   it runs at once that throws) shows the DOM, as failGpu() does.
     * @param {(handle: any) => void} [options.cancelFrame] the frame requested will not be needed
     */
    constructor(options = {}) {
        this.requestedMode = normalizeRenderMode(options.mode, 'dom');
        this.element = options.element || document.createElement('div');
        this.element.classList.add('plauna-render-surface');
        if (!this.element.style.position) this.element.style.position = 'relative';
        this.scene = document.createElement('div');
        this.scene.className = 'plauna-surface-scene';
        this.scene.style.display = 'flow-root';
        this.element.appendChild(this.scene);
        this.device = options.device || null;
        this.getDevice = options.getDevice || null;
        this.onModeChange = options.onModeChange || null;
        this.present = options.present !== false;
        this.onInvalidate = options.onInvalidate || null;
        this.format = options.format || null;
        this.requestFrame = options.requestFrame || null;
        this.cancelFrame = options.cancelFrame || null;
        // A surface given a device stays on it (and on the main thread) after losing one
        this.useWorker = options.worker !== false && !options.device && !options.getDevice;
        // Set once a paint worker could not start: the main thread paints from then on
        this.workerUnavailable = false;
        // Bumped on every invalidation, so texture hosts can tell when to repaint
        this.version = 0;
        this.activeMode = 'dom';
        this.element.dataset.renderMode = 'dom';
        this.lastError = null;
        // GPU rendering failed since the mode was last requested: the DOM shows
        this.gpuFailed = false;
        this.failedOn = null;
        this.destroyed = false;
        this.layout = null;
        this.paintOrder = [];
        this.varCache = new Map();
        this.resolver = new StyleResolver({
            variables: (name) => this.variable(name),
            // A value read mid-transition is restyled once the transition ends
            onLiveSettled: (element) => {
                if (this.destroyed || !element.isConnected || !flatContains(this.scene, element)) return;
                this.restyleRoots.add(element);
                // An SVG is painted from its descendants' styles: redraw the outer svg
                let svg = element.ownerSVGElement;
                while (svg?.ownerSVGElement) svg = svg.ownerSVGElement;
                if (svg && this.scene.contains(svg)) this.dirtyElements.add(svg);
                this.invalidate(true);
            }
        });
        this.keyedFocus = null;
        this.engine = new LayoutEngine({
            resolver: this.resolver,
            hostCollapsesMargins: false,
            scrollOffsets: (box) => (box.element ? { x: box.element.scrollLeft || 0, y: box.element.scrollTop || 0 } : null)
        });
        // The browser animates the (invisible) scene; GPU frames paint its values
        this.animations = new AnimationController({ root: this.scene });
        // Native content shown through wells, glass over what lies behind the surface
        this.wells = new NativeWell(this);
        this.underlay = new GlassUnderlay(this);
        // Open shadow roots inside the scene -> what stops watching them
        this.trees = new Map();
        // The browser's scrollbar sizes (body px), probed once per layout zoom
        // and only when a bar above the scene takes room (clipBox, stickyView)
        this.barSizes = () => {
            const zoom = layoutZoom();
            if (this.barMetrics?.zoom !== zoom) this.barMetrics = { zoom, ...(probeScrollbarMetrics() || { auto: 0, thin: 0 }) };
            return this.barMetrics;
        };
        this.gpuGeneration = 0;
        this.caretEpoch = 0;
        this.hovered = [];
        this.dirtyElements = new Set();
        this.dirtySubtrees = new Set();
        // Elements whose subtrees a state change (hover, focus, press) may restyle
        this.restyleRoots = new Set();
        this.fullLayout = true;
        this.stats = { frames: 0, layouts: 0, items: 0, lastLayoutMs: 0, lastPaintMs: 0 };
        this.ready = this.evaluate();
    }

    get mode() {
        return this.requestedMode;
    }

    /** Add rendered content (a DOM element) to the scene. */
    mount(element) {
        this.scene.appendChild(element);
        this.invalidate(true);
        return element;
    }

    /** Change the requested mode; resolves to the active mode. */
    setMode(mode) {
        this.requestedMode = normalizeRenderMode(mode, this.requestedMode);
        // Asked again: a GPU error does not hold any longer
        this.gpuFailed = false;
        this.failedOn = null;
        this.ready = this.evaluate();
        return this.ready;
    }

    /** The active mode a request resolves to right now. */
    decide() {
        return decideRenderMode(this.requestedMode, {
            failed: this.gpuFailed,
            lost: Boolean(this.lostAt) && performance.now() - this.lostAt < LOST_RETRY_MS
        });
    }

    async evaluate() {
        if (this.destroyed) return this.activeMode;
        const want = this.decide();
        if (want === 'gpu' && this.activeMode !== 'gpu') {
            try {
                await this.startGpu();
            } catch (error) {
                this.lastError = error;
                this.gpuFailed = true;
                this.stopGpu();
            }
            // The mode may have been requested again while the GPU was starting
            if (this.activeMode === 'gpu' && this.decide() === 'dom') this.stopGpu();
        } else if (want === 'dom' && this.activeMode !== 'dom') {
            this.stopGpu();
        }
        return this.activeMode;
    }

    /**
     * GPU rendering failed: show the DOM until the mode is requested again.
     * Frames on animation frames come here by themselves; a host running
     * frames through requestFrame calls this from its own error handling.
     */
    failGpu(error) {
        if (this.destroyed || this.gpuFailed) return;
        this.lastError = error;
        this.gpuFailed = true;
        this.failedOn = this.gpu?.device ?? null;
        console.error(`[Plauna] GPU rendering failed, the surface shows the DOM: ${error?.message ?? error}`);
        this.stopGpu();
    }

    variable(name) {
        if (!this.varCache.has(name)) {
            const value = typeof getComputedStyle !== 'undefined' && this.scene.isConnected
                ? getComputedStyle(this.scene).getPropertyValue(name).trim()
                : '';
            this.varCache.set(name, value || undefined);
        }
        return this.varCache.get(name);
    }

    // ── GPU lifecycle ───────────────────────────────────────────────────────

    async startGpu() {
        if (this.painter) return;
        const generation = ++this.gpuGeneration;
        // A surface showing its own canvas, with no device given, paints in a worker
        if (this.useWorker && this.present && !this.workerUnavailable) {
            if (await this.startWorkerGpu(generation)) return;
            if (this.destroyed || generation !== this.gpuGeneration || this.painter) return;
        }
        const [{ GpuPainter, Rasterizer, DisplayListBuilder }, device] = await Promise.all([
            loadGpuModules(),
            this.device || (this.getDevice ? this.getDevice() : sharedGpuDevice())
        ]);
        if (this.destroyed || generation !== this.gpuGeneration || this.painter) return;
        if (!device) throw new Error('No GPU device');
        const format = this.format || navigator.gpu.getPreferredCanvasFormat();
        const painter = new GpuPainter({ device, format, ownerId: 'plauna.surface' }).init();
        let canvas = null;
        let clip = null;
        let context = null;
        if (this.present) {
            ({ clip, canvas } = this.createCanvas());
            context = canvas.getContext('webgpu');
            if (!context) {
                painter.destroy();
                throw new Error('WebGPU canvas context unavailable');
            }
            // COPY_SRC lets backdrop-filter read what is already drawn
            context.configure({ device, format, alphaMode: 'premultiplied', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
        }
        this.gpu = { device, format, painter, canvas, clip, context };
        this.painter = painter;
        this.raster = new Rasterizer(painter.atlas, textShaper, () => this.invalidate(false));
        this.builder = new DisplayListBuilder(painter, this.raster, textShaper);
        if (clip) this.showCanvas(clip);
        // The scene stays in the page, invisible, for input and accessibility
        this.scene.style.opacity = '0';
        this.attach();
        device.lost?.then((info) => {
            if (this.gpu?.device === device || this.failedOn === device) this.handleDeviceLost(info);
        });
        this.activeMode = 'gpu';
        this.element.dataset.renderMode = 'gpu';
        this.onModeChange?.('gpu');
        this.invalidate(true);
    }

    /**
     * Start painting in a worker (PaintWorkerHost). Resolves to true when it
     * started (or another start or a stop came first), false when it cannot
     * here: no OffscreenCanvas, or the worker got no device; the main thread
     * paints then. A parked worker (kept from an earlier start) that fails is
     * replaced by a new one once (`retry`).
     */
    async startWorkerGpu(generation, retry = false) {
        const host = await loadWorkerHost();
        if (this.destroyed || generation !== this.gpuGeneration || this.painter) return true;
        if (!host.paintWorkerAvailable()) {
            this.workerUnavailable = true;
            return false;
        }
        // Two canvases: a frame that moves the canvas is drawn into the hidden
        // one, placed where it goes, and swapped in once shown (placeCanvas)
        const canvases = [this.createCanvas(), this.createCanvas()];
        // The worker starts (its modules, its device) while this thread loads its own
        const modules = loadGpuModules();
        modules.catch(() => {});
        let painter = null;
        try {
            painter = await host.startPaintWorker(canvases.map((entry) => entry.canvas), {
                onLost: (info) => {
                    if (this.painter === painter) this.handleDeviceLost(info);
                },
                onEnded: () => this.invalidate(false),
                onShown: (id) => {
                    if (this.painter === painter) this.canvasShown(id);
                },
                onError: (message) => {
                    if (this.painter === painter) this.failGpu(new Error(`Paint worker: ${message}`));
                    else console.error(`[Plauna] Paint worker: ${message}`);
                }
            });
        } catch (error) {
            if (error.parked && !retry) return this.startWorkerGpu(generation, true);
            this.lastError = error;
            this.workerUnavailable = true;
            return false;
        }
        let Rasterizer;
        let DisplayListBuilder;
        try {
            ({ Rasterizer, DisplayListBuilder } = await modules);
        } catch (error) {
            painter.destroy();
            throw error;
        }
        if (this.destroyed || generation !== this.gpuGeneration || this.painter) {
            painter.destroy();
            return true;
        }
        for (const entry of canvases) {
            entry.key = null;
            entry.box = null;
            entry.cooling = 0;
        }
        const [{ canvas, clip }, back] = canvases;
        back.clip.style.opacity = '0';
        // canvas and clip: the shown one (canvases[front]); `placed`: the frame
        // waiting to be shown on another; `owed`: a frame waits for a canvas
        this.gpu = {
            device: null, format: painter.format, painter, canvas, clip, context: null, worker: true,
            canvases, front: 0, placed: null, owed: false, acks: 0,
            // Where the surface was last frame, when it last moved, and capture()'s settled frames
            at: null, movedAt: -Infinity, settleTimer: null, exact: false
        };
        this.painter = painter;
        this.raster = new Rasterizer(painter.atlas, textShaper, () => this.invalidate(false));
        this.builder = new DisplayListBuilder(painter, this.raster, textShaper);
        // Running compositor layers are the worker's to animate
        this.animations.offload = true;
        this.animations.onChange = () => this.invalidate(false);
        this.showCanvas(clip, back.clip);
        this.scene.style.opacity = '0';
        this.attach();
        this.activeMode = 'gpu';
        this.element.dataset.renderMode = 'gpu';
        this.onModeChange?.('gpu');
        this.invalidate(true);
        return true;
    }

    /**
     * The canvas and the box that clips it. The canvas covers whole device
     * pixels, up to one past the scene's fractional edge; the clip box spans
     * only the visible part, so that pixel never adds scrollable overflow
     * (GPU mode would scroll a pixel further than DOM mode).
     */
    createCanvas() {
        const clip = document.createElement('div');
        clip.className = 'plauna-surface-canvas-clip';
        clip.setAttribute('aria-hidden', 'true');
        clip.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:hidden;pointer-events:none;z-index:1;';
        const canvas = document.createElement('canvas');
        canvas.className = 'plauna-surface-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;display:block;';
        clip.appendChild(canvas);
        return { clip, canvas };
    }

    showCanvas(...clips) {
        for (const clip of clips) this.element.appendChild(clip);
        // The clip's z-index stays inside the surface, so content placed
        // after the surface stacks over the canvas as it does over the scene
        this.isolationBefore = this.element.style.isolation;
        this.element.style.isolation = 'isolate';
    }

    stopGpu() {
        this.gpuGeneration++;
        this.clearRouted();
        this.detach();
        this.wells.stop();
        this.underlay.stop();
        if (this.gpu) {
            try { this.gpu.context?.unconfigure(); } catch { /* lost */ }
            for (const { canvas, clip } of this.gpu.canvases || [this.gpu]) {
                canvas?.remove();
                clip?.remove();
            }
            if (this.gpu.clip) this.element.style.isolation = this.isolationBefore ?? '';
            clearTimeout(this.gpu.settleTimer);
            this.painter.destroy();
        }
        this.gpu = null;
        this.painter = null;
        this.raster = null;
        this.builder = null;
        this.animations.offload = false;
        this.animations.onChange = null;
        this.animations.offloaded = new Map();
        this.scene.style.opacity = '';
        const changed = this.activeMode !== 'dom';
        this.activeMode = 'dom';
        this.element.dataset.renderMode = 'dom';
        if (changed) this.onModeChange?.('dom');
    }

    handleDeviceLost() {
        this.lostAt = performance.now();
        // A frame's error on a dying device is the loss, and retries as one
        this.gpuFailed = false;
        this.failedOn = null;
        if (this.device && this.gpu?.device === this.device) this.device = null;
        this.stopGpu();
        if (this.requestedMode !== 'dom' && !this.destroyed) {
            setTimeout(() => this.evaluate(), LOST_RETRY_MS + 10);
        }
    }

    attach() {
        // Focus may have moved while detached: the next key press restyles it
        this.keyedFocus = null;
        const invalidateLayout = () => this.invalidate(true);
        // A scroll inside an island moves nothing Plauna laid out
        const scrolled = (invalidateScroll) => (event) => { if (!this.wells.islandOf(event.target)) invalidateScroll(); };
        // Value, checked and load changes: that element changed (state rules: everything)
        const changed = (event) => {
            if (this.wells.islandOf(event.target)) return;
            const target = event.target?.nodeType === 1 ? event.target : null;
            if (target) {
                this.dirtyElements.add(target);
                // :checked and friends can restyle siblings and their subtrees
                if (this.ruleFlag('stateful', target)) this.dirtySubtrees.add(flatParent(target) || target);
            }
            this.invalidate(true);
        };
        this.mutations = new MutationObserver((records) => {
            if (records.every((record) => this.wells.ownsRecord(record))) return;
            this.noteMutations(records);
            this.invalidate(true);
        });
        this.mutations.observe(this.scene, SCENE_MUTATIONS);
        this.treeListeners = { changed, invalidateLayout };
        // Scene, theme and font changes made while detached (DOM mode) were not
        // observed: forget what was read from them and lay out everything once
        this.themeChanged();
        this.fontsChanged();
        this.themeObserver = new MutationObserver((records) => {
            if (this.themeRecordsMatter(records)) this.themeChanged();
        });
        this.themeObserver.observe(document.documentElement, { attributes: true, attributeOldValue: true });
        if (document.head) this.themeObserver.observe(document.head, { childList: true, subtree: true, characterData: true });
        this.watchSheets();
        this.resizeObserver = new ResizeObserver(() => {
            this.hostStyle = null;
            // @container rules follow their containers: restyle what lies in them
            const treeRules = [this.resolver.rules, ...[...this.trees.keys()].map((root) => rulesFor(root))];
            for (const rules of treeRules) {
                for (const container of rules?.containerElements ?? []) {
                    if (container.isConnected && flatContains(this.scene, container)) this.dirtySubtrees.add(container);
                }
            }
            invalidateLayout();
        });
        this.resizeObserver.observe(this.element);
        // :hover, :active and :focus rules restyle the scene as state changes
        // Hover and focus move between two elements: only what lies below
        // their common ancestor changes state (press changes whole chains,
        // and crossing the scene's edge changes states above it)
        // A native push button's face follows hover, press and key activation
        // whatever the page's rules: repaint the buttons an event touches
        let pressedFaces = [];
        const repaintFaces = (...nodes) => {
            const touched = [];
            for (const node of nodes) {
                for (let el = node?.nodeType === 1 ? node : null; el && el !== this.scene; el = el.parentElement) {
                    const box = this.layout?.boxes.get(el);
                    if (box?.style?.nativeFace) { markChanged(box); touched.push(box); }
                }
            }
            return touched;
        };
        const onState = (event) => {
            // The pointer moving inside an island changes nothing Plauna styled
            if ((event.type === 'pointerover' || event.type === 'pointerout')
                && this.wells.islandOf(event.target) && this.wells.islandOf(event.relatedTarget)) return;
            const faces = repaintFaces(event.target, event.relatedTarget);
            if (event.type === 'pointerdown') pressedFaces = faces;
            else if (event.type === 'pointerup') { for (const box of pressedFaces) markChanged(box); pressedFaces = []; }
            const restyle = this.ruleFlag('interactive');
            if (restyle) {
                const changedRoot = event.type === 'pointerdown' || event.type === 'pointerup'
                    ? null : this.commonAncestor(event.target, event.relatedTarget);
                this.restyleRoots.add(changedRoot || this.scene);
            }
            this.invalidate(restyle);
        };
        const onCaret = (event) => {
            // Keys typed in an island are the browser's, and so is the caret they move
            if (event.type === 'keydown' && this.wells.islandOf(event.target)) return;
            this.caretEpoch = performance.now();
            // The UA :focus-visible outline follows focus whatever the page's rules
            const target = event.target?.nodeType === 1 && this.scene.contains(event.target) ? event.target : null;
            if (target && (event.type === 'focusin' || event.type === 'focusout')) {
                this.restyleRoots.add(target);
                this.invalidate(true);
                this.keyedFocus = event.type === 'focusin' && focusVisibleNow(target) ? target : null;
            } else if (target && event.type === 'keydown' && this.keyedFocus !== target) {
                // A key press turns :focus-visible on for an element the mouse focused
                this.keyedFocus = target;
                this.restyleRoots.add(target);
                this.invalidate(true);
            }
            onState(event);
        };
        // A scroll above the scene moves the part of it in view and what sticks
        // within the view there (stickyView). A scroll anywhere else (a list in
        // another window) moves nothing here, and one in the scene is the scene's
        const aboveScrolled = (event) => {
            const target = event.target;
            if (target !== document && !(target?.nodeType === 1 && target !== this.scene && flatContains(target, this.scene))) return;
            this.invalidate(Boolean(this.viewSticky));
        };
        this.listeners = [
            [this.scene, 'input', changed, false],
            [this.scene, 'change', changed, false],
            [this.scene, 'focusin', onCaret, false],
            [this.scene, 'focusout', onCaret, false],
            [this.scene, 'pointerover', onState, false],
            [this.scene, 'pointerout', onState, false],
            [this.scene, 'pointerdown', onState, false],
            [this.scene, 'pointerup', onState, false],
            [this.scene, 'scroll', scrolled(invalidateLayout), true],
            [this.scene, 'load', changed, true],
            // A video's size comes with its metadata, and changes with its frames
            [this.scene, 'loadedmetadata', changed, true],
            [this.scene, 'resize', changed, true],
            // Capture: a key handler that stops propagation still turns :focus-visible on
            [this.scene, 'keydown', onCaret, true],
            [this.scene, 'keyup', (event) => { if (repaintFaces(event.target).length) this.invalidate(false); }, true],
            [document, 'selectionchange', () => {
                if (!this.scene.contains(document.activeElement) || this.wells.islandOf(document.activeElement)) return;
                this.caretEpoch = performance.now();
                this.invalidate(false);
            }, false],
            [window, 'scroll', aboveScrolled, { capture: true, passive: true }],
            [window, 'resize', invalidateLayout, false]
        ];
        // Scroll events do not leave a shadow tree: a scroller above the scene
        // in the shadow trees the surface is in is heard there
        for (let root = this.scene.getRootNode?.(); root?.nodeType === 11; root = root.host?.getRootNode?.()) {
            this.listeners.push([root, 'scroll', aboveScrolled, { capture: true, passive: true }]);
        }
        for (const [target, type, fn, opts] of this.listeners) target.addEventListener(type, fn, opts);
        this.onFonts = () => this.fontsChanged();
        document.fonts?.addEventListener?.('loadingdone', this.onFonts);
        this.clippers = null;
        this.scan(this.scene);
    }

    /**
     * Note what `node` and everything below it brings to GPU mode: native
     * elements, glass boxes, and open shadow roots to watch. `node` is an
     * element, or a shadow root.
     */
    scan(node) {
        const visit = (element) => {
            if (NATIVE_TAGS.has(element.localName) || element.hasAttribute(WELL_ATTRIBUTE)) this.wells.add(element);
            if (element.hasAttribute(GLASS_ATTRIBUTE)) this.underlay.add(element);
            if (element.shadowRoot) this.watchTree(element.shadowRoot);
        };
        if (node.nodeType === 1) visit(node);
        // Below an island everything is the browser's: nothing there needs a well
        let island = node.nodeType === 1 && node.hasAttribute(WELL_ATTRIBUTE) ? node : null;
        for (const element of node.querySelectorAll('*')) {
            if (island?.contains(element)) continue;
            if (element.hasAttribute(WELL_ATTRIBUTE)) island = element;
            visit(element);
        }
    }

    /**
     * Watch a shadow tree inside the scene as the scene is watched: the
     * scene's observers and bubbling listeners do not see into it, and scroll,
     * change, load and a video's loadedmetadata and resize events do not leave it.
     */
    watchTree(root) {
        if (this.trees.has(root)) return;
        const { changed, invalidateLayout } = this.treeListeners;
        this.mutations.observe(root, SCENE_MUTATIONS);
        const stopSheets = watchStyleSheets(root, (reason) => this.styleSheetsChanged(reason));
        const listeners = [['scroll', invalidateLayout], ['change', changed], ['load', changed], ['loadedmetadata', changed], ['resize', changed]];
        for (const [type, fn] of listeners) root.addEventListener(type, fn, true);
        this.trees.set(root, () => {
            stopSheets();
            for (const [type, fn] of listeners) root.removeEventListener(type, fn, true);
        });
        this.scan(root);
    }

    /**
     * Stop watching the shadow trees whose hosts left the scene: their rules
     * no longer count (ruleFlag), and their sheets and events no longer reach
     * the surface. A MutationObserver cannot let go of one node, so it
     * observes the rest again. Returns whether the records it held meanwhile
     * changed child lists.
     */
    pruneTrees() {
        let pruned = false;
        for (const [root, stop] of this.trees) {
            if (root.host?.isConnected && flatContains(this.scene, root.host)) continue;
            stop();
            this.trees.delete(root);
            pruned = true;
        }
        if (!pruned || !this.mutations) return false;
        const pending = this.mutations.takeRecords();
        this.mutations.disconnect();
        this.mutations.observe(this.scene, SCENE_MUTATIONS);
        for (const root of this.trees.keys()) this.mutations.observe(root, SCENE_MUTATIONS);
        return pending.length > 0 && this.noteMutations(pending);
    }

    /**
     * A shadow root was attached under the scene after its host was added (or
     * a custom element defined after it was), which no mutation record says:
     * GPU mode lays out, watches and restyles the tree from now on, as it does
     * any other. A host that changes afterwards (an attribute, a child) is
     * noted by itself; call this when nothing else changes. `node` is the
     * host, or an element above it in the scene.
     */
    watch(node) {
        if (!this.treeListeners || node?.nodeType !== 1 || !flatContains(this.scene, node)) return;
        this.scan(node);
        this.dirtyElements.add(node);
        this.dirtySubtrees.add(node);
        this.invalidate(true);
    }

    /**
     * Whether style rules set `flag`: the scene tree's, or those of `element`'s
     * tree when given, or of any tree inside the scene when not.
     */
    ruleFlag(flag, element = null) {
        if (this.trees.size && element) return Boolean(this.resolver.rulesOf(element)?.[flag]);
        if (this.resolver.rules?.[flag]) return true;
        for (const root of this.trees.keys()) if (rulesFor(root)[flag]) return true;
        return false;
    }

    /**
     * Write the scene's own style without it counting as a scene change:
     * what the observer holds so far is noted first.
     */
    quietScene(write) {
        const pending = this.mutations?.takeRecords();
        if (pending?.length) {
            this.noteMutations(pending);
            this.invalidate(true);
        }
        write();
        this.mutations?.takeRecords();
    }

    /**
     * Whether root attribute and head changes can restyle the scene. A page
     * transition sets view-transition-name and its timing variables on
     * <html>, clears them, and retitles the page on every navigation; each
     * cost a full restyle and relayout.
     */
    themeRecordsMatter(records) {
        const root = document.documentElement;
        let rootStyleBefore = null;
        for (const record of records) {
            const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
            // The title's text never reaches a style
            if (target?.localName === 'title') continue;
            if (record.type === 'attributes' && record.target === root && record.attributeName === 'style') {
                rootStyleBefore ??= record.oldValue ?? '';
                continue;
            }
            return true;
        }
        return rootStyleBefore !== null && !this.rootStyleChangeInert(rootStyleBefore, root.getAttribute('style') ?? '');
    }

    /**
     * True when the root's inline style changed only in what no scene style
     * reads: view-transition properties, and custom properties that no style
     * rule, the root's own style or a style attribute on or above the scene
     * reads with var().
     */
    rootStyleChangeInert(before, after) {
        const declarations = (text) => {
            const style = document.createElement('div').style;
            style.cssText = text;
            const values = new Map();
            for (let i = 0; i < style.length; i++) {
                const name = style[i];
                values.set(name, `${style.getPropertyValue(name)}!${style.getPropertyPriority(name)}`);
            }
            return values;
        };
        const was = declarations(before);
        const now = declarations(after);
        const changed = new Set();
        for (const [name, value] of was) if (now.get(name) !== value) changed.add(name);
        for (const name of now.keys()) if (!was.has(name)) changed.add(name);
        const custom = new Set();
        for (const name of changed) {
            if (name.startsWith('--')) custom.add(name);
            else if (name !== 'view-transition-name' && name !== 'view-transition-class') return false;
        }
        if (!custom.size) return true;
        const read = this.resolver.rules?.variableReferences?.();
        if (!read) return false;
        for (const name of custom) if (read.has(name)) return false;
        const reads = (text) => {
            for (const [, name] of String(text || '').matchAll(VAR_REFERENCE)) if (custom.has(name)) return true;
            return false;
        };
        if (reads(before) || reads(after)) return false;
        for (let el = this.scene; el && el !== document.documentElement; el = el.parentElement) {
            if (reads(el.getAttribute('style'))) return false;
        }
        for (const el of this.scene.querySelectorAll('[style]')) {
            if (reads(el.getAttribute('style'))) return false;
        }
        return true;
    }

    /** Theme variables, style sheets or root attributes changed. */
    themeChanged() {
        this.hostStyle = null;
        // (an ancestor's position or overflow may have changed with it)
        this.stickyContainer = undefined;
        this.varCache.clear();
        this.resolver.rules?.invalidate();
        for (const root of this.trees.keys()) rulesFor(root).invalidate();
        this.resolver.invalidate();
        this.fullLayout = true;
        this.invalidate(true);
    }

    /** Web fonts finished loading: text measures differently. */
    fontsChanged() {
        textShaper.clear();
        this.raster?.fontsChanged();
        this.fullLayout = true;
        this.invalidate(true);
    }

    /**
     * Watch the style sheets that reach the scene (StyleRules.watchStyleSheets):
     * style and link elements added, removed or edited anywhere in the page
     * (head, panels, app containers, the scene) or in the scene's own shadow
     * root, linked sheets and @imports as they load, and the body's style and
     * class, which carry the OS font and UI scale (zoom).
     */
    watchSheets() {
        this.unwatchSheets?.();
        const onChange = (reason) => this.styleSheetsChanged(reason);
        const stops = [watchStyleSheets(document, onChange)];
        const root = this.scene.getRootNode?.();
        if (root && root !== document && root.nodeType === 11) stops.push(watchStyleSheets(root, onChange));
        this.sheetZoom = cssZoomOf(this.element);
        this.unwatchSheets = () => {
            for (const stop of stops) stop();
            this.unwatchSheets = null;
        };
    }

    /**
     * Style sheets changed ('sheets'), or the body's style or class ('body'):
     * every rule match and inherited value may have moved, so restyle and
     * lay out everything. A new zoom (UI scale) also changes the units the
     * browser lays text out in: forget measured text.
     */
    styleSheetsChanged(reason) {
        if (this.destroyed) return;
        if (reason === 'body') {
            const zoom = cssZoomOf(this.element);
            if (zoom !== this.sheetZoom) {
                this.sheetZoom = zoom;
                this.fontsChanged();
            }
        }
        this.themeChanged();
    }

    detach() {
        this.unwatchSheets?.();
        this.mutations?.disconnect();
        this.themeObserver?.disconnect();
        this.resizeObserver?.disconnect();
        for (const [target, type, fn, opts] of this.listeners || []) target.removeEventListener(type, fn, opts);
        document.fonts?.removeEventListener?.('loadingdone', this.onFonts);
        for (const stop of this.trees.values()) stop();
        this.trees.clear();
        this.listeners = null;
        this.treeListeners = null;
        this.mutations = null;
        this.themeObserver = null;
        this.resizeObserver = null;
        this.cancelScheduledFrame();
        if (this.caretTimer) clearTimeout(this.caretTimer);
        this.caretTimer = null;
    }

    // ── Frames ──────────────────────────────────────────────────────────────

    /** Request a repaint; `layout` also re-runs layout. */
    invalidate(layout = true) {
        if (layout) this.layoutDirty = true;
        this.version++;
        if (this.activeMode !== 'gpu' || this.destroyed) return;
        if (!this.present) {
            this.onInvalidate?.(layout);
            return;
        }
        if (this.frameHandle) return;
        if (this.requestFrame) {
            // One ticket per request: a paint the host calls once more, or
            // after the request was cancelled, paints nothing
            const ticket = (this.frameTicket = (this.frameTicket || 0) + 1);
            const paint = (time = performance.now()) => {
                if (this.frameTicket !== ticket || !this.frameHandle) return;
                this.frameTicket++;
                this.frameHandle = null;
                this.frame(time);
            };
            // (held first: the host may paint before requestFrame returns)
            this.frameHandle = true;
            let handle;
            try {
                handle = this.requestFrame(paint);
            } catch (error) {
                // No frame is coming: none stays held (unless a newer request
                // stands), or none would ever be asked for again; the DOM shows
                if (this.frameTicket === ticket) {
                    this.frameTicket++;
                    this.frameHandle = null;
                }
                this.failGpu(error);
                return;
            }
            if (this.frameTicket === ticket && this.frameHandle === true) this.frameHandle = handle || true;
            return;
        }
        this.frameHandle = requestAnimationFrame((time) => {
            this.frameHandle = null;
            this.animationFrame(time);
        });
    }

    /** Drop the frame requested, if any. */
    cancelScheduledFrame() {
        const handle = this.frameHandle;
        if (!handle) return;
        this.frameHandle = null;
        if (this.requestFrame) {
            this.frameTicket = (this.frameTicket || 0) + 1;
            this.cancelFrame?.(handle);
        } else {
            cancelAnimationFrame(handle);
        }
    }

    /**
     * A frame on an animation frame: the surface answers for its errors
     * (decision 11, DOM on GPU errors). In a worker the worker reports them.
     */
    animationFrame(time) {
        const device = this.gpu?.device?.pushErrorScope ? this.gpu.device : null;
        device?.pushErrorScope('validation');
        device?.pushErrorScope('out-of-memory');
        let thrown = null;
        try {
            this.frame(time);
        } catch (error) {
            thrown = error;
        }
        if (device) {
            Promise.all([device.popErrorScope(), device.popErrorScope()]).then(([memory, validation]) => {
                const error = memory || validation;
                if (error && this.gpu?.device === device) this.failGpu(error);
            }, () => {});
        }
        if (thrown) this.failGpu(thrown);
    }

    /** Deepest scene element containing both a and b, or null (the scene or outside it). */
    commonAncestor(a, b) {
        if (!a || !b || !flatContains(this.scene, a) || !flatContains(this.scene, b)) return null;
        const chain = new Set();
        for (let el = a; el && el !== this.scene; el = flatParent(el)) chain.add(el);
        for (let el = b; el && el !== this.scene; el = flatParent(el)) if (chain.has(el)) return el;
        return null;
    }

    /**
     * Record what mutations changed for incremental layout. Returns true when
     * the scene's child lists changed.
     */
    noteMutations(records) {
        const nested = this.trees.size > 0;
        let rules = this.resolver.rules;
        let structural = false;
        let removed = false;
        for (const record of records) {
            if (this.wells.ownsRecord(record)) continue;
            let target = record.type === 'characterData' ? record.target.parentNode : record.target;
            // A shadow root's own child list is its host's content
            if (target?.nodeType === 11) target = target.host;
            if (!target || target.nodeType !== 1) continue;
            if (nested) rules = this.resolver.rulesOf(target);
            this.dirtyElements.add(target);
            // A shadow root attached since its host was scanned (no record says so)
            if (this.treeListeners && target.shadowRoot && !this.trees.has(target.shadowRoot)) {
                this.watchTree(target.shadowRoot);
                this.dirtySubtrees.add(target);
            }
            if (record.type === 'childList') {
                structural = true;
                if (rules?.structural) this.dirtySubtrees.add(target);
                // (text taken out takes no shadow host with it)
                if (!removed) for (const node of record.removedNodes) if (node.nodeType === 1) { removed = true; break; }
                // New elements may be native content, glass or shadow hosts
                if (this.treeListeners) for (const node of record.addedNodes) if (node.nodeType === 1) this.scan(node);
            } else if (record.type === 'attributes' && record.attributeName === GLASS_ATTRIBUTE) {
                if (target.hasAttribute(GLASS_ATTRIBUTE)) this.underlay.add(target);
                else this.underlay.remove(target);
            } else if (record.type === 'attributes' && record.attributeName === WELL_ATTRIBUTE) {
                // An island's inside joins or leaves layout
                if (target.hasAttribute(WELL_ATTRIBUTE)) this.wells.add(target);
                else {
                    this.wells.remove(target);
                    if (this.treeListeners) this.scan(target);
                }
                this.fullLayout = true;
            } else if (record.type === 'attributes' && record.attributeName !== 'style'
                && (rules?.count || rules?.pseudoCount || rules?.selectionCount || rules?.scrollbarCount
                    || (record.attributeName === 'open' && target.localName === 'details'))) {
                // Class, id and attribute changes can change rule matches below
                // too; a details' open state changes what it shows and its summary's marker
                this.dirtySubtrees.add(target);
            }
        }
        // A removed shadow host takes its tree with it
        if (removed && this.trees.size && this.pruneTrees()) structural = true;
        return structural;
    }

    /**
     * Use the style rules and UA defaults of the tree the scene is in: the
     * document's, or a shadow root's own (the document's sheets do not reach
     * into a shadow tree). A resolver given its own rules keeps them.
     */
    useTreeScope() {
        const shared = this.resolver.rules === styleRules || this.resolver.rules?.root;
        if (!shared) return;
        const root = this.scene.getRootNode?.();
        const rules = rulesFor(root);
        const ua = userAgentStylesFor(root);
        if (this.resolver.rules === rules && this.resolver.ua === ua) return;
        this.resolver.rules = rules;
        this.resolver.ua = ua;
        this.engine.ua = ua;
        this.resolver.invalidate();
        this.fullLayout = true;
    }

    /** Lay out the scene now (also used by tests and texture targets). */
    relayout() {
        this.useTreeScope();
        // UA sizes depend on the zoom (display scaling, browser zoom)
        const ua = this.resolver.ua ?? userAgentStyles;
        if (!ua.calibrated || ua.zoom !== layoutZoom()) ua.calibrate(this.scene);
        if (!this.engine.scrollbarProbed) {
            this.engine.scrollbarWidth = probeScrollbarWidth();
            this.engine.scrollbarProbed = true;
        }
        const started = performance.now();
        const width = this.sceneWidth() || this.element.clientWidth || 0;
        // Changes made since the last mutation callback count too
        const pending = this.mutations?.takeRecords();
        if (pending?.length) this.noteMutations(pending);
        // Keep untouched parts of the last layout while changes are tracked
        let tracked = Boolean(this.mutations) && !this.fullLayout && this.layout;
        // A state change at the scene's edge can change what the scene inherits
        if (tracked && this.hostStyle && this.restyleRoots.has(this.scene)) {
            const host = inheritedStyleFromHost(this.scene);
            if (hostKey(host) !== hostKey(this.hostStyle)) tracked = false;
        }
        // The host's inherited style reads computed style with a probe; keep it
        // until a theme change, a resize or a full relayout
        if (!tracked || !this.hostStyle) this.hostStyle = inheritedStyleFromHost(this.scene);
        this.engine.stickyViewport = this.stickyView();
        // Kept boxes enter the layout with their laid-out values, not animated ones
        this.animations.restore();
        if (tracked && this.restyleRoots.size) this.restyle(this.restyleRoots);
        this.restyleRoots = new Set();
        this.layout = this.engine.layout(null, {
            contentOf: this.scene,
            width,
            rootInherited: this.hostStyle,
            previous: tracked ? this.layout.boxes : null,
            dirty: tracked ? this.dirtyElements : 'all',
            subtrees: this.dirtySubtrees
        });
        this.dirtyElements = new Set();
        this.dirtySubtrees = new Set();
        this.fullLayout = false;
        this.layoutDirty = false;
        // A scroll above the scene lays out again while a box sticks within the view there
        this.viewSticky = false;
        if (this.engine.stickyViewport) {
            for (const box of this.layout.order) {
                if (box.stickyInsets && !box.stickyScroller && box.style?.position === 'sticky') {
                    this.viewSticky = true;
                    break;
                }
            }
        }
        this.stats.layouts++;
        this.stats.lastLayoutMs = performance.now() - started;
        return this.layout;
    }

    /**
     * A state change (hover, focus, press) only restyles: walk the elements
     * below `roots` (the scene: all of it) and mark those whose computed
     * style is no longer their box's as changed. Only those boxes (and their
     * ancestors) are built again; every other box keeps its style object
     * (StyleResolver keeps it while its values stay) and its layout.
     */
    restyle(roots) {
        const boxes = this.layout.boxes;
        const resolver = this.resolver;
        const dirty = this.dirtyElements;
        resolver.beginPass?.();
        const pseudo = this.ruleFlag('pseudoCount');
        // ::before / ::after boxes sit first or last, or in an anonymous block there
        const generatedOf = (box, which) => {
            for (const child of box.children) {
                if (child.generated === which) return child;
                if (child.anonymous) for (const inner of child.children) if (inner.generated === which) return inner;
            }
            return null;
        };
        // An SVG is painted from its descendants' styles, resolved at paint
        const svgRestyled = (element, style) => {
            for (const child of element.children) {
                const before = resolver.lastStyle(child);
                const now = resolver.compute(child, style);
                if ((before && before !== now) || svgRestyled(child, now)) return true;
            }
            return false;
        };
        const walk = (element, parentStyle) => {
            const style = resolver.compute(element, parentStyle);
            const box = boxes.get(element);
            if (style.display === 'none' || style.display === 'svg-child') {
                if (box) dirty.add(element);
                return;
            }
            if (style.display === 'contents') {
                if (box) dirty.add(element);
            } else {
                if (!box) {
                    dirty.add(element);
                    return;
                }
                if (box.style !== style) dirty.add(element);
                if (pseudo) {
                    for (const which of ['before', 'after']) {
                        const generated = resolver.computePseudo(element, which, style);
                        const shown = generated && generated.content != null && generated.display !== 'none' ? generated : null;
                        if ((generatedOf(box, which)?.style || null) !== shown) dirty.add(element);
                    }
                }
                if (box.inner === 'svg' && svgRestyled(element, style)) dirty.add(element);
                if (box.inner === 'svg' || box.inner === 'replaced') return;
            }
            for (const child of flatElements(element)) walk(child, style);
        };
        for (const root of roots) {
            if (root === this.scene) {
                for (const child of root.children) walk(child, this.engine.hostStyle);
                continue;
            }
            if (!flatContains(this.scene, root)) continue;
            const parent = flatParent(root);
            const parentStyle = parent === this.scene ? this.engine.hostStyle : boxes.get(parent)?.style;
            if (parentStyle) {
                walk(root, parentStyle);
            } else {
                // Below a display: contents parent: build it again
                dirty.add(root);
                this.dirtySubtrees.add(root);
            }
        }
    }

    /**
     * The scene's padding-box width as laid out. clientWidth rounds it to
     * whole CSS px, which under display scaling is a fraction of a device
     * pixel away from where the browser lays the scene out. The computed
     * width keeps six digits; the border box keeps them all, unless a
     * transform scales it.
     */
    sceneWidth() {
        const cs = getComputedStyle(this.scene);
        const width = parseFloat(cs.width);
        if (!(width > 0)) return this.scene.clientWidth;
        const px = (name) => parseFloat(cs[name]) || 0;
        const borders = px('borderLeftWidth') + px('borderRightWidth');
        let border = cs.boxSizing === 'border-box' ? width : width + px('paddingLeft') + px('paddingRight') + borders;
        // (a rect read under CSS zoom, the OS's UI scale, is zoomed)
        const exact = this.scene.getBoundingClientRect().width / cssZoomOf(this.scene);
        if (Math.abs(exact - border) < 0.01) border = exact;
        return border - borders;
    }

    /**
     * Where a sticky box with no scroll container above it in the scene
     * sticks (LayoutEngine.stickyViewport), in scene px: the content box,
     * less its scrollbars, of the scroll container above the scene that it
     * sticks within (stickyContainerOf), or the viewport less its
     * scrollbars, as Chrome places it (measured at real scale factors 1 and
     * 1.25, under body zoom, with and without classic scrollbars). A
     * texture-only surface has no place on the page: null, and such a box
     * stays where it is.
     */
    stickyView() {
        if (!this.present || !this.scene.isConnected) return null;
        if (this.stickyContainer === undefined || (this.stickyContainer && !this.stickyContainer.isConnected)) {
            this.stickyContainer = stickyContainerOf(this.scene);
        }
        const container = this.stickyContainer;
        let left = 0;
        let top = 0;
        let right;
        let bottom;
        if (container) {
            ({ left, top, right, bottom } = stickyBoxOf(container, this.barSizes));
        } else {
            // The visual viewport's size has the layout viewport's fraction (the
            // root's client size is rounded) while it is not pinch-zoomed
            const vv = window.visualViewport;
            const exact = vv && vv.scale === 1;
            right = exact ? vv.width : document.documentElement.clientWidth;
            bottom = exact ? vv.height : document.documentElement.clientHeight;
        }
        const r = this.scene.getBoundingClientRect();
        const z = cssZoomOf(this.scene);
        const unit = layoutZoom();
        return {
            x: roundUnit((left - r.left) / z, unit),
            y: roundUnit((top - r.top) / z, unit),
            width: Math.max(0, roundUnit((right - left) / z, unit)),
            height: Math.max(0, roundUnit((bottom - top) / z, unit))
        };
    }

    /** Visible part of the scene in client and scene coordinates, or null. */
    visibleRect() {
        // Element rects are single precision; positions are whole layout
        // units, and a half device pixel must stay one when rounded. Under
        // CSS zoom (the OS's UI scale on the body) client px are the scene's
        // px times the zoom: work in client px, hand the scene its own
        const z = cssZoomOf(this.element);
        const zoom = layoutZoom() / z;
        const r = this.element.getBoundingClientRect();
        const rect = { left: roundUnit(r.left, zoom), top: roundUnit(r.top, zoom), width: roundUnit(r.width, zoom), height: roundUnit(r.height, zoom) };
        const laid = this.layout?.bounds;
        const b = laid ? { x: laid.x * z, y: laid.y * z, width: laid.width * z, height: laid.height * z } : { x: 0, y: 0, width: rect.width, height: rect.height };
        let left = rect.left + Math.min(0, b.x);
        let top = rect.top + Math.min(0, b.y);
        let right = rect.left + Math.max(rect.width, b.x + b.width);
        let bottom = rect.top + Math.max(rect.height, b.y + b.height);
        left = Math.max(left, 0);
        top = Math.max(top, 0);
        right = Math.min(right, window.innerWidth);
        bottom = Math.min(bottom, window.innerHeight);
        if (!this.clippers) {
            // The overflow that clips the surface: up its containing-block
            // chain (an absolute or fixed surface escapes the clips between
            // it and its containing block, as the scene does in DOM mode)
            this.clippers = [];
            for (const [a, cs] of containingAncestors(this.element)) {
                if (a === document.body) break;
                if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') this.clippers.push(a);
            }
        }
        for (const clipper of this.clippers) {
            const box = clipBox(clipper, this.barSizes);
            left = Math.max(left, box.left);
            top = Math.max(top, box.top);
            right = Math.min(right, box.right);
            bottom = Math.min(bottom, box.bottom);
        }
        if (right - left < 1 || bottom - top < 1) return null;
        const dpr = window.devicePixelRatio || 1;
        // The canvas starts on a device pixel; the scene keeps its real origin.
        // Under a 90.5px header the browser snaps each box edge and baseline
        // once, at its page position (90.5 + 225.5 lands on 316). The display
        // list snaps to the canvas grid the same way; rounding the origin
        // first would round twice and drop every half-pixel line a pixel low
        const floor = (v) => Math.floor(v * dpr) / dpr;
        left = floor(left);
        top = floor(top);
        return {
            client: { left, top, width: right - left, height: bottom - top },
            scene: { x: (left - rect.left) / z, y: (top - rect.top) / z, width: (right - left) / z, height: (bottom - top) / z },
            // The surface's own box (client px; in scene px under CSS zoom)
            surface: z === 1 ? rect : { left: rect.left / z, top: rect.top / z, width: rect.width / z, height: rect.height / z }
        };
    }

    frame(time = performance.now()) {
        if (this.activeMode !== 'gpu' || !this.gpu?.canvas || this.destroyed) return;
        if (!this.scene.isConnected) return;
        if (this.layoutDirty || !this.layout) this.relayout();
        const visible = this.visibleRect();
        const { context, worker } = this.gpu;
        let { canvas, clip } = this.gpu;
        const clips = worker ? this.gpu.canvases.map((entry) => entry.clip) : [clip];
        this.wells.sync(visible);
        if (!visible) {
            this.underlay.sync();
            for (const each of clips) each.style.display = 'none';
            // Nothing in view to animate; a canvas placed for a frame not shown stays hidden
            if (worker) {
                if (this.gpu.placed) collapseClip(this.gpu.canvases[this.gpu.placed.index].clip);
                this.gpu.placed = null;
                this.gpu.owed = false;
                this.gpu.at = null;
                this.painter.suspend();
            }
            return;
        }
        for (const each of clips) each.style.display = 'block';
        // Device pixels per scene px: CSS zoom (the UI scale) zooms the canvas too
        const dpr = (window.devicePixelRatio || 1) * cssZoomOf(this.element);
        // What the canvas covers (scene px): the visible part (a worker's
        // canvas reaches past it while the surface moves: canvasBox)
        const box = worker ? this.canvasBox(visible, dpr) : visible.scene;
        // Whole device pixels, and a CSS size of exactly that many: a canvas
        // stretched by a fraction of a pixel is resampled, which blurs everything
        const w = Math.max(1, Math.ceil(box.width * dpr - 0.01));
        const h = Math.max(1, Math.ceil(box.height * dpr - 0.01));
        // A worker's canvas is sized in the worker, with the frame
        if (!worker && canvas.width !== w) canvas.width = w;
        if (!worker && canvas.height !== h) canvas.height = h;
        const scene = { x: box.x, y: box.y, width: w / dpr, height: h / dpr };
        let place = null;
        if (worker) {
            place = this.placeCanvas(box, `${box.x} ${box.y} ${box.width} ${box.height} ${w} ${h}`);
            if (!place) return;
            ({ canvas, clip } = this.gpu.canvases[place.index]);
        }
        clip.style.left = `${scene.x}px`;
        clip.style.top = `${scene.y}px`;
        clip.style.width = `${box.width}px`;
        clip.style.height = `${box.height}px`;
        canvas.style.width = `${scene.width}px`;
        canvas.style.height = `${scene.height}px`;
        const zoom = dpr / (window.devicePixelRatio || 1);
        this.wells.cover(clip, (visible.surface.left + box.x) * zoom, (visible.surface.top + box.y) * zoom, zoom);
        // What follows moving elements here needs frames here as they move
        if (worker) this.animations.offload = !this.wells.count && !this.underlay.size;
        const started = performance.now();
        if (worker) {
            this.paint(null, scene, dpr, time, { width: w, height: h, canvas: place.index, ack: place.ack });
        } else {
            const texture = context.getCurrentTexture();
            this.paint(texture.createView(), scene, dpr, time, { target: texture });
        }
        this.stats.lastPaintMs = performance.now() - started;
        this.stats.frames++;
        this.underlay.sync();
        // Keep the caret blinking while a text field has focus
        const focused = document.activeElement;
        if (isTextField(focused) && this.scene.contains(focused) && !this.wells.islandOf(focused)) {
            const phase = (time - this.caretEpoch) % CARET_PERIOD;
            const wait = (phase < CARET_PERIOD / 2 ? CARET_PERIOD / 2 : CARET_PERIOD) - phase;
            if (this.caretTimer) clearTimeout(this.caretTimer);
            this.caretTimer = setTimeout(() => { this.caretTimer = null; this.invalidate(false); }, Math.max(16, wait));
        }
    }

    /**
     * The worker canvas for a frame covering `box`, whose canvas geometry is
     * `key`: { index, ack }, or null when the frame has to wait. This thread
     * moves a canvas and the worker draws it, and the two reach the screen
     * separately, so a frame that moves the canvas (a scroll, a resize) is
     * drawn into a hidden canvas placed where it goes, with an ack;
     * canvasShown() swaps it in once the worker has it on screen. One canvas
     * is placed at a time; the canvas swapped out is drawn into again only
     * after the frame that hid it.
     */
    placeCanvas(box, key) {
        const gpu = this.gpu;
        const front = gpu.canvases[gpu.front];
        let index = -1;
        let ack = 0;
        if (gpu.placed) {
            if (gpu.placed.key === key) index = gpu.placed.index;
        } else if (front.key === null || front.key === key) {
            index = gpu.front;
            front.key = key;
            front.box = box;
        } else {
            index = gpu.canvases.findIndex((entry, i) => i !== gpu.front && !entry.cooling);
            if (index < 0) {
                // Try again next frame, once the canvas swapped out has cooled
                gpu.owed = true;
                this.invalidate(false);
                return null;
            }
            ack = ++gpu.acks;
            gpu.placed = { index, key, id: ack };
            gpu.canvases[index].key = key;
            gpu.canvases[index].box = box;
        }
        // Waiting for the placed canvas to show: canvasShown() asks for the frame
        gpu.owed = index < 0;
        return index < 0 ? null : { index, ack };
    }

    /**
     * What a worker canvas covers this frame (scene px). Settled, the visible
     * part, exactly as on the main thread. While the surface moves on the
     * screen (a scroll), a canvas placed reaches past the view where content
     * comes in, within the surface, so the canvas still shown covers it until
     * the next one is swapped in (placeCanvas); the latest canvas's box is
     * kept while it will do (reachingBox). It settles once the surface has
     * stood still a moment (and for capture()).
     */
    canvasBox(visible, dpr) {
        const gpu = this.gpu;
        const view = visible.scene;
        const at = visible.surface;
        const last = gpu.at;
        gpu.at = at;
        // How far the surface moved on the screen since the last frame (a scroll)
        const sx = last ? at.left - last.left : 0;
        const sy = last ? at.top - last.top : 0;
        const now = performance.now();
        if (sx || sy) gpu.movedAt = now;
        if (gpu.exact || !(now - gpu.movedAt < CANVAS_SETTLE_MS)) return view;
        const box = this.reachingBox(visible, dpr, sx, sy);
        // A canvas reaching past the view settles once the surface stands still
        if (box.x !== view.x || box.y !== view.y || box.width !== view.width || box.height !== view.height) {
            clearTimeout(gpu.settleTimer);
            gpu.settleTimer = setTimeout(() => {
                if (this.gpu === gpu) this.invalidate(false);
            }, gpu.movedAt + CANVAS_SETTLE_MS - now + 1);
        }
        return box;
    }

    /**
     * canvasBox while the surface moves by (sx, sy): the latest canvas's box
     * while it covers the view, within the surface, on whole device pixels,
     * with room ahead of the motion; else one reaching ahead of it.
     */
    reachingBox(visible, dpr, sx, sy) {
        const gpu = this.gpu;
        const view = visible.scene;
        const surface = visible.surface;
        const right = view.x + view.width;
        const bottom = view.y + view.height;
        // How far a canvas may reach: the surface's box, or the view where it
        // overflows that (further, the canvas would hold the page taller)
        const minX = Math.min(view.x, 0);
        const minY = Math.min(view.y, 0);
        const maxRight = Math.max(right, surface.width);
        const maxBottom = Math.max(bottom, surface.height);
        const box = (gpu.placed ? gpu.canvases[gpu.placed.index] : gpu.canvases[gpu.front]).box;
        const e = 1e-4;
        const grid = (v) => Math.abs(v * dpr - Math.round(v * dpr)) < 1e-3;
        const lead = (d) => CANVAS_LEAD_FRAMES * Math.abs(d);
        if (box && box.x <= view.x + e && box.y <= view.y + e && box.x + box.width >= right - e && box.y + box.height >= bottom - e
            && box.x >= minX - e && box.y >= minY - e && box.x + box.width <= maxRight + e && box.y + box.height <= maxBottom + e
            // A fractional scroll leaves it between device pixels
            && grid(box.x + surface.left) && grid(box.y + surface.top)
            // Room where content comes into view (at the bottom as the surface
            // moves up), unless it reaches as far as it may
            && !(sx < 0 && box.x + box.width - right < lead(sx) && box.x + box.width < maxRight - e)
            && !(sy < 0 && box.y + box.height - bottom < lead(sy) && box.y + box.height < maxBottom - e)
            && !(sx > 0 && view.x - box.x < lead(sx) && box.x >= minX + 1 / dpr)
            && !(sy > 0 && view.y - box.y < lead(sy) && box.y >= minY + 1 / dpr)) return box;
        if (!sx && !sy) return view;
        const reach = (d, size) => Math.min(Math.max(CANVAS_REACH_FRAMES * Math.abs(d), CANVAS_REACH_MIN), Math.max(CANVAS_REACH_MIN, size / 2));
        // The origin moves back by whole device pixels, not past the surface's
        const back = (v, d, size) => Math.max(0, Math.min(Math.round(reach(d, size) * dpr), Math.floor(v * dpr + 1e-6))) / dpr;
        const x0 = sx > 0 ? view.x - back(view.x, sx, view.width) : view.x;
        const y0 = sy > 0 ? view.y - back(view.y, sy, view.height) : view.y;
        const x1 = sx < 0 ? Math.min(right + reach(sx, view.width), maxRight) : right;
        const y1 = sy < 0 ? Math.min(bottom + reach(sy, view.height), maxBottom) : bottom;
        return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    }

    /** The worker reports frame `id` on its placed canvas: show that canvas, hide the other. */
    canvasShown(id) {
        const gpu = this.gpu;
        if (!gpu?.worker || gpu.placed?.id !== id) return;
        const shown = gpu.canvases[gpu.placed.index];
        const hidden = gpu.canvases[gpu.front];
        shown.clip.style.opacity = '';
        hidden.clip.style.opacity = '0';
        collapseClip(hidden.clip);
        gpu.front = gpu.placed.index;
        gpu.canvas = shown.canvas;
        gpu.clip = shown.clip;
        gpu.placed = null;
        // Until the frame that hides it has gone to the screen, what the worker
        // draws into the hidden canvas would still show where it was
        hidden.cooling = CANVAS_COOLING;
        const cool = () => {
            if (this.gpu === gpu && --hidden.cooling > 0) requestAnimationFrame(cool);
        };
        requestAnimationFrame(cool);
        if (gpu.owed) {
            gpu.owed = false;
            this.invalidate(false);
        }
    }

    /**
     * Build the display list and draw it into `view` for `viewport` (scene px).
     * options: load (keep the target's content), clear colour, encoder (record
     * into the host's command encoder instead of submitting). Painted in a
     * worker, `view` is unused: the frame goes to the worker's canvas
     * options.canvas (options.ack: report it shown), sized options.width x
     * options.height device px (unchanged when not given).
     */
    paint(view, viewport, dpr = 1, time = performance.now(), options = {}) {
        const focusedElement = document.activeElement && this.scene.contains(document.activeElement) && !this.wells.islandOf(document.activeElement) ? document.activeElement : null;
        const caretVisible = ((time - this.caretEpoch) % CARET_PERIOD) < CARET_PERIOD / 2;
        const styleCache = new Map();
        const styleOf = (element) => {
            const box = this.layout.boxes.get(element);
            if (box) return box.style;
            if (styleCache.has(element)) return styleCache.get(element);
            const parent = element.parentElement && element !== this.scene ? styleOf(element.parentElement) : null;
            const style = this.resolver.compute(element, parent);
            styleCache.set(element, style);
            return style;
        };
        // CSS animations and transitions run on the GPU path
        const moving = this.animations.apply(this.layout, time, (box) => this.builder.outOfView(this.layout, box, viewport));
        const result = this.builder.build(this.layout, {
            dpr,
            time,
            viewport,
            focused: focusedElement,
            focusVisible: Boolean(focusedElement?.matches?.(':focus-visible')),
            caretVisible,
            styleOf
        });
        this.paintOrder = result.paintOrder;
        this.stats.items = result.count;
        this.painter.render(view, viewport, {
            dpr, time, load: options.load, clear: options.clear, encoder: options.encoder, target: options.target,
            width: options.width, height: options.height, canvas: options.canvas, ack: options.ack,
            composites: result.composites, layers: this.animations.offloaded
        });
        if (moving) this.invalidate(false);
    }

    /**
     * Paint into another target (a world-space panel, XR or host frame
     * texture view of the painter's format). Lays out first when needed.
     * options: viewport (scene px), dpr, time, load, clear, encoder, target
     * (the texture behind `view`, with COPY_SRC, for backdrop-filter).
     */
    renderTo(view, options = {}) {
        if (!this.painter) throw new Error('renderTo needs GPU mode');
        if (this.gpu?.worker) throw new Error('renderTo needs a surface painted on the main thread (worker: false, or present: false)');
        if (this.layoutDirty || !this.layout) this.relayout();
        const b = this.layout.bounds;
        const viewport = options.viewport || { x: 0, y: 0, width: Math.max(1, b.x + b.width), height: Math.max(1, b.y + b.height) };
        this.paint(view, viewport, options.dpr || 1, options.time ?? performance.now(), options);
    }

    /**
     * Paint a frame for `time` (the caret's blink) and read back what the
     * canvas shows: resolves to { width, height, data } (RGBA bytes, device
     * pixels), or null outside GPU mode or with nothing in view. For
     * comparing the worker's frames with the main thread's.
     */
    async capture(time = performance.now()) {
        if (this.activeMode !== 'gpu' || !this.gpu?.canvas || this.destroyed) return null;
        this.cancelScheduledFrame();
        if (this.gpu.worker) {
            const gpu = this.gpu;
            // The settled canvas: the visible part. A frame that waits for a
            // canvas (placeCanvas) is posted once one is free
            gpu.exact = true;
            try {
                this.frame(time);
                for (let tries = 0; gpu.owed && tries < 60; tries++) {
                    await new Promise((resolve) => requestAnimationFrame(resolve));
                    if (this.gpu !== gpu || this.destroyed) return null;
                    this.cancelScheduledFrame();
                    this.frame(time);
                }
            } finally {
                gpu.exact = false;
            }
            return this.painter.capture();
        }
        if (this.layoutDirty || !this.layout) this.relayout();
        const visible = this.visibleRect();
        if (!visible) return null;
        const dpr = (window.devicePixelRatio || 1) * cssZoomOf(this.element);
        const width = Math.max(1, Math.ceil(visible.scene.width * dpr - 0.01));
        const height = Math.max(1, Math.ceil(visible.scene.height * dpr - 0.01));
        const scene = { x: visible.scene.x, y: visible.scene.y, width: width / dpr, height: height / dpr };
        const { device, format } = this.gpu;
        const texture = device.createTexture({ size: [width, height], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
        this.paint(texture.createView(), scene, dpr, time, { target: texture });
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
        return { width, height, data };
    }

    // ── Hit testing and routed input (for targets without page DOM) ─────────

    /** Topmost element at scene point (x, y), or null. */
    hitTest(x, y) {
        if (!this.layout) this.relayout();
        const order = this.paintOrder.length ? this.paintOrder : this.layout.order;
        for (let i = order.length - 1; i >= 0; i--) {
            const box = order[i];
            if (!box.element || box.style.visibility === 'hidden' || box.style.pointerEvents === 'none') continue;
            let px = x;
            let py = y;
            const matrix = this.hitMatrix(box);
            if (matrix) {
                const inv = invertAffine(matrix);
                if (!inv) continue;
                [px, py] = applyAffine(inv, x, y);
            }
            const clip = box.clip;
            if (clip && (x < clip.x || y < clip.y || x > clip.x + clip.width || y > clip.y + clip.height)) continue;
            const rects = box.absFragments || [{ x: box.absX, y: box.absY, width: box.width, height: box.height }];
            // Generated content belongs to its element
            if (rects.some((r) => px >= r.x && py >= r.y && px < r.x + r.width && py < r.y + r.height)) return box.element.host || box.element;
        }
        return null;
    }

    /**
     * The matrix `box` is hit through: its own, moved as a compositor layer
     * above it moves (AnimationController draws such a layer where its
     * animation puts it and leaves the boxes inside it as laid out).
     */
    hitMatrix(box) {
        if (!this.animations.compositors.size) return box.matrix;
        for (let b = box.parent; b; b = b.parent) {
            if (!b.compositor) continue;
            const base = b.compositor.base ? invertAffine(b.compositor.base) : IDENTITY;
            return multiplyAffine(multiplyAffine(b.matrix || IDENTITY, base || IDENTITY), box.matrix || IDENTITY);
        }
        return box.matrix;
    }

    /**
     * Route a pointer event at scene point (x, y) to the scene: dispatches
     * pointer and mouse events (and click on release over the same element),
     * tracks hover enter/leave, focuses on press. `type` is down, move or up.
     */
    pointer(type, x, y, init = {}) {
        const target = this.hitTest(x, y);
        const rect = this.element.getBoundingClientRect();
        // Client px are scene px times the CSS zoom (the OS's UI scale)
        const z = cssZoomOf(this.element);
        const coords = { clientX: rect.left + x * z, clientY: rect.top + y * z, bubbles: true, cancelable: true, composed: true, view: window, ...init };
        const fire = (el, name, Ctor = MouseEvent, extra = {}) => el?.dispatchEvent(new Ctor(name, { ...coords, ...extra }));
        const PointerCtor = typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent;
        // Hover chain, up the flat tree as Chrome's (measured): a shadow tree's
        // host and a slotted element's slot are hovered too
        const chain = [];
        for (let el = target; el && el !== this.scene; el = flatParent(el)) chain.push(el);
        const left = this.hovered.filter((el) => !chain.includes(el));
        const entered = chain.filter((el) => !this.hovered.includes(el));
        const previous = this.hovered[0] || null;
        if (previous && previous !== target) {
            fire(previous, 'pointerout', PointerCtor);
            fire(previous, 'mouseout');
        }
        // Enter and leave reach each element once: not composed (a host would
        // also get those of its shadow tree's elements)
        for (const el of left) {
            fire(el, 'pointerleave', PointerCtor, { bubbles: false, composed: false });
            fire(el, 'mouseleave', MouseEvent, { bubbles: false, composed: false });
        }
        if (target && previous !== target) {
            fire(target, 'pointerover', PointerCtor);
            fire(target, 'mouseover');
        }
        for (const el of entered.reverse()) {
            fire(el, 'pointerenter', PointerCtor, { bubbles: false, composed: false });
            fire(el, 'mouseenter', MouseEvent, { bubbles: false, composed: false });
        }
        this.hovered = chain;
        this.markRouted(HOVER_ATTRIBUTE, chain);
        if (!target) return null;
        if (type === 'move') {
            fire(target, 'pointermove', PointerCtor);
            fire(target, 'mousemove');
        } else if (type === 'down') {
            fire(target, 'pointerdown', PointerCtor, { buttons: 1 });
            const ok = fire(target, 'mousedown', MouseEvent, { buttons: 1 });
            if (ok) {
                const focusable = target.closest('input, textarea, select, button, a[href], [tabindex]');
                if (focusable && this.scene.contains(focusable)) focusable.focus({ preventScroll: true });
            }
            this.pressed = target;
            this.markRouted(ACTIVE_ATTRIBUTE, chain);
        } else if (type === 'up') {
            fire(target, 'pointerup', PointerCtor);
            fire(target, 'mouseup');
            if (this.pressed && (this.pressed === target || this.pressed.contains(target) || target.contains(this.pressed))) {
                fire(this.pressed.contains(target) ? target : this.pressed, 'click');
            }
            this.pressed = null;
            this.markRouted(ACTIVE_ATTRIBUTE, []);
        }
        this.invalidate(false);
        return target;
    }

    /**
     * Mark routed hover or press state on `elements` so :hover and :active
     * rules match them (StyleRules). Only while rules depend on those states.
     */
    markRouted(attribute, elements) {
        this.routedMarks ??= new Map();
        const previous = this.routedMarks.get(attribute) || [];
        // (the scene tree's rules, or a shadow tree's inside it)
        const next = this.ruleFlag('interactive') ? elements : [];
        for (const el of previous) if (!next.includes(el)) el.removeAttribute(attribute);
        for (const el of next) if (!el.hasAttribute(attribute)) el.setAttribute(attribute, '');
        this.routedMarks.set(attribute, next);
    }

    clearRouted() {
        this.markRouted(HOVER_ATTRIBUTE, []);
        this.markRouted(ACTIVE_ATTRIBUTE, []);
        this.hovered = [];
        this.pressed = null;
    }

    destroy() {
        if (this.destroyed) return;
        this.stopGpu();
        this.destroyed = true;
    }
}

export { transformRectBounds };
