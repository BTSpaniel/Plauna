# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Plauna's GPU layout under real display scaling.

Chrome applies display scaling (Windows 110%, 125%, 150%) and browser zoom
as zoom: it lays the page out in device pixels in 1/64 px layout units, sets
text at the scaled font size and snaps borders to whole device pixels.
Playwright's device_scale_factor does not do that (it lays out in CSS px and
scales the paint), so this test starts Chrome with --force-device-scale-factor,
which scales like a real display. At each scale every box Plauna lays out,
and every line of text, must sit within 1/64 device px of where Chrome puts
it, and the GPU frame must draw each line of text on the same device pixels
as the DOM does.
"""

import io
import os
import sys
from contextlib import ExitStack
from pathlib import Path
from unittest import SkipTest, TestCase, main

ROOT = Path(__file__).resolve().parents[1]
SHOWCASE_PAGE = os.environ.get("PLAUNA_SHOWCASE_PAGE", "/examples/showcase.html"
                              if (ROOT / "plauna-manifest.json").is_file() else "/plauna.html")
sys.path.insert(0, str(ROOT / "tests"))
from plauna_browser_support import chrome_path, performance_run_lock, sdk_server

SCALES = (1.1, 1.25, 1.5)
WINDOW = (964, 982)
# The overview holds every widget; these pages add selects, abspos centring,
# flex and grid distribution and tables in the playground chrome
ROUTES = ("#/", "#/widget/pagination", "#/widget/radio", "#/widget/range", "#/widget/select", "#/widget/table")
# One layout unit, plus float noise from single-precision element rects
TOLERANCE = 1 / 64 + 1e-3

# Plauna's boxes and text runs against the browser's, in device px
MEASURE = r"""
async () => {
    const surface = window.plaunaShowcase.gallery.surface;
    surface.fullLayout = true;
    surface.relayout();
    const z = devicePixelRatio;
    const { transformRectBounds } = await import('/plauna/render/layout/LayoutEngine.js');
    const origin = surface.scene.getBoundingClientRect();
    const name = (el) => {
        const text = (el.textContent || '').trim().slice(0, 20);
        return `${el.localName}${el.id ? '#' + el.id : el.classList.length ? '.' + el.classList[0] : ''}${text ? ` "${text}"` : ''}`;
    };
    const off = [];
    // Plauna paints what a running animation does; it does not lay it out.
    // Under a moving element (a marquee's track, drawn as a compositor
    // layer) boxes keep their laid-out place, which the browser's rects do
    // not show. The text-line check skips them the same way
    const running = new Set(surface.scene.getAnimations({ subtree: true })
        .filter((a) => a.playState === 'running' && !a.effect?.pseudoElement).map((a) => a.effect?.target));
    const underAnimation = (el) => {
        for (let e = el.parentElement; e && e !== surface.scene; e = e.parentElement) if (running.has(e)) return true;
        return false;
    };
    let boxes = 0;
    for (const box of surface.layout.order) {
        const el = box.element;
        if (!el || el.nodeType !== 1 || !el.isConnected || (box.outer === 'inline' && !box.atomic)) continue;
        if (el.getAnimations().length || underAnimation(el)) continue;
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        boxes++;
        const rect = { x: box.absX, y: box.absY, width: box.width, height: box.height };
        const p = box.matrix ? transformRectBounds(box.matrix, rect) : rect;
        const d = [p.x - (r.left - origin.left), p.y - (r.top - origin.top), p.width - r.width, p.height - r.height].map((v) => v * z);
        if (d.some((v) => Math.abs(v) > TOLERANCE)) off.push(`box ${name(el)}: ${d.map((v) => v.toFixed(3)).join(', ')}`);
    }
    let lines = 0;
    const range = document.createRange();
    for (const box of surface.layout.order) {
        for (const run of box.runs || []) {
            if (run.marker || !run.nodes.length || !run.text.trim() || !run.nodes[0].isConnected) continue;
            range.selectNodeContents(run.nodes[0]);
            const rects = [...range.getClientRects()].filter((r) => r.width > 0);
            if (!rects.length) continue;
            const t = { x: run.absX, y: run.absY, width: run.width, height: run.height };
            const p = box.matrix ? transformRectBounds(box.matrix, t) : t;
            let best = rects[0];
            for (const r of rects) {
                const score = (q) => Math.abs(q.top - origin.top - p.y) * 4 + Math.abs(q.left - origin.left - p.x);
                if (score(r) < score(best)) best = r;
            }
            lines++;
            const d = [p.y - (best.top - origin.top), p.height - best.height].map((v) => v * z);
            if (d.some((v) => Math.abs(v) > TOLERANCE)) off.push(`text "${run.text.slice(0, 20)}": top ${d[0].toFixed(3)}, height ${d[1].toFixed(3)}`);
        }
    }
    return { boxes, lines, off };
}
""".replace("TOLERANCE", repr(TOLERANCE))

# Where the showcase draws its render-mode status and GPU timings: they
# differ between the modes by design. Measured in GPU mode, where both show
OVERLAYS = r"""
() => ['plauna-render-stats', 'plauna-render-mode'].map((id) => document.getElementById(id)?.getBoundingClientRect())
    .filter((r) => r && r.width && r.height).map((r) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom }))
"""

# Lines of text in the visible part of the scene clear of `avoid`, in device px
TEXT_LINES = r"""
(avoid) => {
    const surface = window.plaunaShowcase.gallery.surface;
    const z = devicePixelRatio;
    const visible = surface.visibleRect();
    if (!visible) return [];
    const c = visible.client;
    const out = [];
    const walker = document.createTreeWalker(surface.scene, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.data.trim()) continue;
        let skip = false;
        for (let el = node.parentElement; el && el !== surface.scene && !skip; el = el.parentElement) {
            const cs = getComputedStyle(el);
            skip = el.getAnimations().some((a) => a.playState === 'running') || cs.visibility === 'hidden' || cs.opacity === '0';
        }
        if (skip) continue;
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
            if (r.width < 2 || r.height < 4) continue;
            if (r.left < c.left || r.top < c.top || r.right > c.left + c.width || r.bottom > c.top + c.height) continue;
            if (avoid.some((a) => r.right > a.left && r.left < a.right && r.bottom > a.top && r.top < a.bottom)) continue;
            out.push({ text: node.data.trim().slice(0, 20), x: r.left * z, y: r.top * z, w: r.width * z, h: r.height * z });
        }
    }
    return out;
}
"""

# sub and sup elements and vertical-align sub/super spans at several sizes,
# laid out by Plauna's own engine next to the browser's layout
SUB_SUPER = r"""
async () => {
    const { LayoutEngine } = await import('/plauna/render/layout/LayoutEngine.js');
    const { StyleResolver, inheritedStyleFromHost } = await import('/plauna/render/css/StyleResolver.js');
    const { layoutZoom } = await import('/plauna/render/layout/LayoutUnits.js');
    const stage = document.createElement('div');
    stage.style.cssText = 'position:absolute;left:0;top:0;width:600px';
    document.body.append(stage);
    const root = document.createElement('div');
    root.innerHTML = [11, 13, 13.28, 16, 20].map((s) => `<p style="font:${s}px Arial;margin:0">x<sub>2</sub> y<sup>3</sup> `
        + `z<span style="vertical-align:sub">s</span><span style="vertical-align:super">S</span></p>`).join('');
    stage.append(root);
    const engine = new LayoutEngine({ resolver: new StyleResolver({}), scrollbarWidth: 0 });
    engine.zoom = layoutZoom();
    const result = engine.layout(root, { width: 600, rootInherited: inheritedStyleFromHost(stage) });
    const base = stage.getBoundingClientRect();
    const off = [];
    let boxes = 0;
    for (const el of root.querySelectorAll('*')) {
        const box = result.boxes.get(el);
        if (!box) continue;
        boxes++;
        const r = el.getBoundingClientRect();
        let y = box.absY;
        let h = box.height;
        if (box.absFragments?.length) {
            y = Math.min(...box.absFragments.map((f) => f.y));
            h = Math.max(...box.absFragments.map((f) => f.y + f.height)) - y;
        }
        const d = [y - (r.top - base.top), h - r.height];
        if (d.some((v) => Math.abs(v) > TOLERANCE)) off.push(`${el.localName} at ${el.closest('p').style.fontSize}: ${d.map((v) => v.toFixed(3)).join(', ')}`);
    }
    stage.remove();
    return { boxes, off };
}
""".replace("TOLERANCE", repr(TOLERANCE))

SETTLE = "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 150))))"

# Before any page script: intervals never fire. Live demos tick on them (the
# rolling-number counter every 2.4 s, carousel autoplay, toast progress), and
# the DOM and GPU frames are taken seconds apart, so a tick in between changed
# the digits under the compared lines (about 1 run in 3)
FREEZE_INTERVALS = "(() => { let next = 1e6; window.setInterval = () => ++next; })();"


def shifted_lines(dom, gpu, lines, np, pad=3, search=3):
    """Lines the GPU frame draws clearly better aligned at another offset."""
    shifted = []
    height, width = dom.shape
    for line in lines:
        x0 = int(np.floor(line["x"])) - pad
        y0 = int(np.floor(line["y"])) - pad
        x1 = int(np.ceil(line["x"] + line["w"])) + pad
        y1 = int(np.ceil(line["y"] + line["h"])) + pad
        if x0 < search or y0 < search or x1 + search > width or y1 + search > height:
            continue
        a = dom[y0:y1, x0:x1]
        if float(np.abs(a - np.median(a)).mean()) <= 4:
            continue
        base = float(np.abs(a - gpu[y0:y1, x0:x1]).mean())
        best = min((float(np.abs(a - gpu[y0 + dy:y1 + dy, x0 + dx:x1 + dx]).mean()), dx, dy)
                   for dy in range(-search, search + 1) for dx in range(-search, search + 1))
        if (best[1] or best[2]) and base > 2 and best[0] < base * 0.75:
            shifted.append(f'"{line["text"]}" drawn ({best[1]}, {best[2]}) device px from the DOM text')
    return shifted


class PlaunaRealScalingTests(TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            from playwright.sync_api import sync_playwright
            cls.executable = chrome_path()
        except (ImportError, ValueError) as error:
            raise SkipTest(str(error)) from error
        cls.resources = ExitStack()
        try:
            cls.resources.enter_context(performance_run_lock(ROOT))
            cls.origin, _ = cls.resources.enter_context(sdk_server(ROOT))
            cls.playwright = sync_playwright().start()
            cls.resources.callback(cls.playwright.stop)
        except BaseException:
            cls.resources.close()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.resources.close()

    def open(self, scale):
        """The showcase in GPU mode in a Chrome scaled like a real display."""
        browser = self.playwright.chromium.launch(
            executable_path=self.executable, headless=True,
            args=["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU",
                  f"--force-device-scale-factor={scale}", f"--window-size={WINDOW[0]},{WINDOW[1]}"])
        self.addCleanup(browser.close)
        context = browser.new_context(no_viewport=True, service_workers="block")
        context.add_init_script(FREEZE_INTERVALS)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        self.addCleanup(lambda: self.assertEqual(errors, []))
        page.goto(f"{self.origin}{SHOWCASE_PAGE}#/", wait_until="networkidle")
        page.wait_for_function("window.plaunaShowcase?.gallery?.surface", timeout=60000)
        page.evaluate("document.fonts.ready.then(() => true)")
        if page.evaluate("window.plaunaShowcase.gallery.setRenderMode('gpu')") != "gpu":
            raise SkipTest("WebGPU is not available in this Chrome")
        page.wait_for_function("window.plaunaShowcase.gallery.surface.layout", timeout=60000)
        ratio, zoom = page.evaluate("import('/plauna/render/layout/LayoutUnits.js').then((m) => [devicePixelRatio, m.layoutZoom()])")
        self.assertAlmostEqual(ratio, scale, places=5, msg="Chrome did not apply the display scale")
        self.assertEqual(zoom, ratio, "Plauna does not see the display scale as a layout zoom")
        return page

    def visit(self, page, route):
        page.evaluate(f"location.hash = {route!r}")
        expected = "overview" if route == "#/" else route[2:]
        page.wait_for_function(f"document.getElementById('plauna-gallery-content')?.dataset.route === {expected!r}", timeout=20000)
        page.wait_for_timeout(400)
        page.evaluate(SETTLE)

    def test_layout_matches_the_browser(self):
        for scale in SCALES:
            page = self.open(scale)
            for route in ROUTES:
                with self.subTest(scale=scale, route=route):
                    self.visit(page, route)
                    result = page.evaluate(MEASURE)
                    self.assertGreater(result["boxes"], 50)
                    self.assertGreater(result["lines"], 50)
                    self.assertEqual(result["off"][:8], [], f"{len(result['off'])} boxes or lines off at {scale}x on {route}")

    def test_sub_and_super_shift_in_layout_pixels(self):
        """vertical-align sub/super move by font-size/5 + 1 and /3 + 1 layout px: at a
        display scale that is not 1 the + 1 is a device pixel, not a CSS pixel."""
        for scale in SCALES:
            page = self.open(scale)
            with self.subTest(scale=scale):
                result = page.evaluate(SUB_SUPER)
                self.assertGreater(result["boxes"], 20)
                self.assertEqual(result["off"][:8], [], f"{len(result['off'])} boxes off at {scale}x")

    def test_gpu_text_sits_where_dom_text_does(self):
        try:
            import numpy as np
            from PIL import Image
        except ImportError as error:
            raise SkipTest(str(error)) from error

        def shot(page):
            return np.asarray(Image.open(io.BytesIO(page.screenshot())).convert("L"), dtype=np.float32)

        for scale in SCALES:
            page = self.open(scale)
            self.visit(page, "#/")
            overlays = page.evaluate(OVERLAYS)
            scroll = "document.getElementById('root')"
            end = page.evaluate(f"{scroll}.scrollHeight - {scroll}.clientHeight")
            step = page.evaluate(f"{scroll}.clientHeight") * 0.85
            positions = [min(end, i * step) for i in range(6)]
            frames = {}
            for mode in ("dom", "gpu"):
                self.assertEqual(page.evaluate(f"window.plaunaShowcase.gallery.setRenderMode('{mode}')"), mode)
                page.wait_for_timeout(300)
                for top in positions:
                    page.evaluate(f"{scroll}.scrollTop = {top}")
                    page.evaluate(SETTLE)
                    if mode == "gpu":
                        page.evaluate("window.plaunaShowcase.gallery.surface.frame()")
                        page.evaluate(SETTLE)
                    lines = page.evaluate(TEXT_LINES, overlays) if mode == "dom" else None
                    frames.setdefault(top, {})[mode] = shot(page)
                    if lines is not None:
                        frames[top]["lines"] = lines
            with self.subTest(scale=scale):
                shifted = []
                checked = 0
                for frame in frames.values():
                    checked += len(frame["lines"])
                    shifted.extend(shifted_lines(frame["dom"], frame["gpu"], frame["lines"], np))
                self.assertGreater(checked, 100)
                self.assertEqual(shifted[:8], [], f"{len(shifted)} lines of text move between DOM and GPU mode at {scale}x")


if __name__ == "__main__":
    main()
