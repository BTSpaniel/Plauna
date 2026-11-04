# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Native content and backdrop glass in GPU mode, at real device scale factors.

The same page is shot in DOM mode and in GPU mode (switching live, so what
stays alive across the switch is checked too): no channel may be off by more
than TEXT_LIMIT anywhere, and inside a well by more than WELL_LIMIT, where the
browser paints everything. Every case asserts the surface really is in GPU
mode with the wells it should have, so a check cannot pass by showing the DOM.

Also: input reaches native elements and the overlays above them, elements that
show nothing get no well, iframes and video survive mode switches, and glass
underlays (GlassUnderlay) match the box's own backdrop-filter in the DOM.
"""

import io
import sys
from contextlib import ExitStack
from dataclasses import dataclass
from pathlib import Path
from unittest import SkipTest, TestCase, main

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from plauna_browser_support import chrome_path, performance_run_lock, sdk_server  # noqa: E402

PAGE = "/__plauna_native_well__.html"
HTML = "<!doctype html><meta charset=utf-8><body></body>"
SCALES = (1, 1.25, 1.5, 2)
WALL = ("background:radial-gradient(circle at 120px 90px,#ff0 0 28px,transparent 29px),"
        "repeating-linear-gradient(45deg,#c33 0 7px,#36c 7px 13px),"
        "repeating-linear-gradient(-30deg,#0a0 0 3px,transparent 3px 11px),#888")
# Text and box edges GPU mode paints itself, as in the other parity tests
TEXT_LIMIT = 24
# Inside a well the browser paints: at most a level from the render surface the mask takes
WELL_LIMIT = 2

# 16 px pattern of two colours and a diagonal, on whole canvas pixels
FILL = r"""(canvas, a, b) => {
    const g = canvas.getContext('2d');
    for (let y = 0; y < canvas.height; y += 8) for (let x = 0; x < canvas.width; x += 8) {
        g.fillStyle = ((x + y) / 8) % 2 ? a : b;
        g.fillRect(x, y, 8, 8);
    }
    g.strokeStyle = '#0ff';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(canvas.width, canvas.height);
    g.stroke();
}"""

MOUNT = r"""async ([html, css, wall, options, zoom, fill]) => {
    const { RenderSurface } = await import('/plauna/render/RenderSurface.js');
    // (full height: an empty root would give the background images no area)
    document.documentElement.style.height = '100%';
    document.body.style.cssText = `margin:0;height:100%;${wall}`;
    if (zoom) document.body.style.zoom = zoom;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    document.body.innerHTML = '<div id="stage" style="position:absolute;left:10.3px;top:6.7px;width:520px;height:340px"></div>';
    const surface = new RenderSurface({ mode: 'dom', worker: false, ...options });
    document.getElementById('stage').append(surface.element);
    await surface.ready;
    const host = surface.mount(document.createElement('div'));
    host.innerHTML = html;
    window.__surface = surface;
    const paint = eval(fill);
    for (const canvas of host.querySelectorAll('canvas[data-fill]')) {
        // The canvas's own pixels are device pixels, as an app sizes one
        const r = canvas.getBoundingClientRect();
        const w = Number(canvas.dataset.w) || r.width;
        const h = Number(canvas.dataset.h) || r.height;
        canvas.width = Math.round(w * devicePixelRatio);
        canvas.height = Math.round(h * devicePixelRatio);
        const [a, b] = canvas.dataset.fill.split(' ');
        paint(canvas, a, b);
    }
    for (const canvas of host.querySelectorAll('canvas[data-alpha]')) {
        const g = canvas.getContext('2d');
        g.fillStyle = '#e0e';
        g.fillRect(4, 4, canvas.width / 2, canvas.height / 2);
    }
    return true;
}"""

SETTLE = r"""async () => {
    const surface = window.__surface;
    await surface.ready;
    let same = 0;
    let frames = surface.stats.frames;
    for (let i = 0; i < 180 && same < 6; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        same = surface.stats.frames === frames && !surface.layoutDirty ? same + 1 : 0;
        frames = surface.stats.frames;
    }
    return {
        mode: surface.activeMode,
        wells: surface.wells.rects,
        opacity: surface.scene.style.opacity,
        sceneMask: surface.scene.style.maskImage,
        canvases: surface.element.querySelectorAll('.plauna-surface-canvas').length,
        glass: surface.element.querySelectorAll('.plauna-surface-glass').length,
    };
}"""

# Every shown underlay covers its box where the box is on screen (an AABB under a transform)
UNDERLAY_ON_BOX = r"""() => {
    const problems = [];
    const unders = [...document.querySelectorAll('.plauna-surface-glass')].filter((u) => u.getBoundingClientRect().width);
    const boxes = [...document.querySelectorAll('[data-plauna-glass]')];
    for (const [i, u] of unders.entries()) {
        const a = boxes[i].getBoundingClientRect();
        const b = u.getBoundingClientRect();
        const off = Math.max(Math.abs(a.left - b.left), Math.abs(a.top - b.top), Math.abs(a.width - b.width), Math.abs(a.height - b.height));
        if (off > 0.05) problems.push(`underlay ${off.toFixed(3)} px off its box`);
    }
    return problems;
}"""

SET_MODE = "async (mode) => { await window.__surface.setMode(mode); return window.__surface.activeMode; }"

# Feed window.__video a 120x40 stream (it has no size until its metadata comes),
# then compare where window.__next is in Plauna's layout and in the browser's
FEED_VIDEO = r"""async () => {
    const surface = window.__surface;
    const video = window.__video;
    const next = window.__next;
    const source = document.createElement('canvas');
    source.width = 120;
    source.height = 40;
    const g = source.getContext('2d');
    const draw = () => { g.fillStyle = `hsl(${performance.now() % 360} 80% 50%)`; g.fillRect(0, 0, 120, 40); };
    draw();
    const timer = setInterval(draw, 30);
    video.srcObject = source.captureStream(30);
    for (let i = 0; i < 200 && !video.videoWidth; i++) await new Promise((r) => setTimeout(r, 20));
    for (let i = 0; i < 12; i++) await new Promise((r) => requestAnimationFrame(r));
    clearInterval(timer);
    const dom = next.getBoundingClientRect().top - surface.element.getBoundingClientRect().top;
    const well = surface.wells.rects[0];
    return {
        width: video.videoWidth, dom, ours: surface.layout.boxes.get(next)?.absY ?? null,
        playing: !video.paused, wellHeight: well ? (well[3] - well[1]) / devicePixelRatio : null,
        height: video.getBoundingClientRect().height,
    };
}"""


def check_video_follows(test, result):
    test.assertEqual(result["width"], 120)
    test.assertIsNotNone(result["ours"], f"no box after the video: {result}")
    test.assertAlmostEqual(result["ours"], result["dom"], delta=0.02, msg=f"Plauna did not follow the video's size: {result}")
    test.assertAlmostEqual(result["wellHeight"], result["height"], delta=1, msg=str(result))
    test.assertTrue(result["playing"], result)


@dataclass(frozen=True)
class Case:
    name: str
    html: str
    wells: int = 1              # wells in view in GPU mode
    glass: int = 0              # glass underlays in GPU mode
    css: str = ""
    zoom: str = ""
    worker: bool = False        # painted in a worker rather than on the main thread
    text_limit: int = TEXT_LIMIT
    scales: tuple = SCALES
    blurs: bool = True          # a glass case: the page shows blurred


CANVAS = 'data-fill="#123 #fe8"'
PANEL = "background:rgba(255,255,255,.55);border-radius:10px;font:bold 15px Arial;color:#102040;padding:6px 10px"

WELL_CASES = [
    Case("canvas", f'<canvas {CANVAS} style="display:block;margin:21.4px 0 0 33.6px;width:200.7px;height:120.3px"></canvas>'),
    Case("canvas in a rounded parent", (
        '<div style="width:240px;height:150px;margin:20px;overflow:hidden;border-radius:24px;background:#274;padding:10px">'
        f'<canvas {CANVAS} style="display:block;width:220px;height:130px"></canvas></div>')),
    Case("transparent canvas over its parent", (
        '<div style="width:220px;height:130px;margin:30px;background:linear-gradient(90deg,#fa0,#08f);border:3px solid #111">'
        '<canvas data-alpha style="display:block;width:220px;height:130px"></canvas></div>')),
    Case("translucent overlay with text across the edge", (
        f'<div style="position:relative;width:360px;height:180px;margin:24px;background:#345">'
        f'<canvas {CANVAS} style="position:absolute;left:30px;top:30px;width:200px;height:120px"></canvas>'
        f'<div style="position:absolute;left:150.5px;top:60.5px;width:170px;{PANEL}">HUD over the edge</div>'
        '</div>')),
    Case("backdrop blur over the canvas", (
        f'<div style="position:relative;width:300px;height:180px;margin:24px">'
        f'<canvas {CANVAS} style="position:absolute;left:0;top:0;width:300px;height:180px"></canvas>'
        '<div style="position:absolute;left:40px;top:40px;width:180px;height:80px;background:rgba(255,255,255,.2);'
        'backdrop-filter:blur(6px);border-radius:12px"></div>'
        '</div>')),
    Case("rotated canvas", f'<canvas {CANVAS} style="display:block;margin:60px;width:180px;height:90px;transform:rotate(17deg)"></canvas>'),
    Case("scaled and moved", (
        '<div style="width:300px;height:200px;margin:10px;transform:translate(12.5px,6.25px) scale(.8);background:#654">'
        f'<canvas {CANVAS} style="display:block;margin:20px;width:200px;height:100px"></canvas></div>')),
    Case("two canvases and a video poster", (
        f'<canvas {CANVAS} style="display:block;margin:10px;width:120px;height:60px"></canvas>'
        '<p style="font:14px Arial;margin:6px 12px;color:#fff;background:#222">between them</p>'
        '<canvas data-fill="#a22 #2a2" style="display:block;margin:10px;width:90px;height:50px"></canvas>'
        '<video style="display:block;margin:10px;width:90px;height:50px;background:#335"></video>'), wells=3),
    Case("clipped by a scroller", (
        '<div id="scroller" style="width:260px;height:120px;margin:20px;overflow:hidden;background:#222">'
        '<div style="height:70px;background:#384"></div>'
        f'<canvas {CANVAS} style="display:block;width:240px;height:140px"></canvas>'
        '<div style="height:90px;background:#843"></div></div>')),
    Case("iframe", (
        '<iframe srcdoc="<!doctype html><body style=&quot;margin:0;background:#1a6&quot;><div style=&quot;margin:18px;width:60px;height:30px;background:#ff0&quot;></div>" '
        'style="display:block;margin:30px;width:220px;height:120px;border:2px solid #eee"></iframe>')),
    Case("under CSS zoom", f'<canvas {CANVAS} style="display:block;margin:21.4px 0 0 33.6px;width:160px;height:90px"></canvas>',
         zoom="1.25", scales=(1, 2)),
    Case("in a worker-painted surface", (
        f'<div style="position:relative;width:300px;height:160px;margin:20px;background:#345">'
        f'<canvas {CANVAS} style="position:absolute;left:30px;top:20px;width:200px;height:100px"></canvas>'
        f'<div style="position:absolute;left:120.5px;top:40.5px;width:160px;{PANEL}">Worker HUD</div></div>'), worker=True),
]

GLASS_BOX = ("position:absolute;left:50.4px;top:40.6px;width:220.3px;height:120.7px;box-sizing:border-box;border-radius:14px;"
             "background:rgba(255,255,255,.25);backdrop-filter:blur(12px) saturate(1.4);font:14px Arial;color:#111;padding:10px")

GLASS_CASES = [
    Case("glass", f'<div data-plauna-glass style="{GLASS_BOX}">Glass</div>', wells=0, glass=1),
    Case("glass without a background", (
        '<div data-plauna-glass style="position:absolute;left:30px;top:30px;width:200px;height:100px;backdrop-filter:blur(8px)"></div>'),
        wells=0, glass=1),
    Case("glass moved by a transform", f'<div data-plauna-glass style="{GLASS_BOX};transform:translate(13px,7px)">Moved</div>', wells=0, glass=1),
    Case("glass under a transformed parent", (
        f'<div style="position:absolute;left:0;top:0;width:400px;height:300px;transform:translate(20px,10px)">'
        f'<div data-plauna-glass style="{GLASS_BOX}">Parent moved</div></div>'), wells=0, glass=1),
    # An allowance (a box mid-fade): the browser fades the sharp page back in under the box's
    # content too, which an underlay below the canvas cannot do (off by .24 of sharp against
    # blurred under opaque text, up to 38, and .06 under this background, up to 11)
    Case("glass with its own opacity", f'<div data-plauna-glass style="{GLASS_BOX};opacity:.6">Faded</div>', wells=0, glass=1, text_limit=40),
    Case("glass in a scroller's clip", (
        '<div style="position:absolute;left:30px;top:30px;width:240px;height:90px;overflow:hidden">'
        '<div data-plauna-glass style="position:absolute;left:-20px;top:20px;width:200px;height:200px;background:rgba(255,255,255,.2);backdrop-filter:blur(10px)"></div>'
        '</div>'), wells=0, glass=1),
    Case("glass inside a backdrop root reaches no page", (
        f'<div style="position:absolute;left:0;top:0;width:400px;height:300px;opacity:.7">'
        f'<div data-plauna-glass style="{GLASS_BOX}">In a group</div></div>'), wells=0, glass=1, blurs=False),
    # Backdrop roots that change nothing else on screen (GlassBackdropRoots has Chrome's full list)
    Case("glass under a clip-path", (
        f'<div style="position:absolute;left:0;top:0;width:400px;height:300px;clip-path:inset(0)">'
        f'<div data-plauna-glass style="{GLASS_BOX}">Clipped</div></div>'), wells=0, glass=1, blurs=False),
    Case("glass under will-change: opacity", (
        f'<div style="position:absolute;left:0;top:0;width:400px;height:300px;will-change:opacity">'
        f'<div data-plauna-glass style="{GLASS_BOX}">Promoted</div></div>'), wells=0, glass=1, blurs=False),
    Case("glass under will-change: filter", (
        f'<div style="position:absolute;left:0;top:0;width:400px;height:300px;will-change:filter">'
        f'<div data-plauna-glass style="{GLASS_BOX}">Promoted</div></div>'), wells=0, glass=1, blurs=False),
    # An allowance (decision 2): the painter draws its blur of the canvas source-over what it
    # drew (DisplayList.emitBackdrop), so the sharp block under the box shows where that blur
    # is translucent. At the ordinary limit: 1163 px off at 1x (max 73), 1896 at 1.25x (max 79),
    # 2585 at 1.5x (max 72), 4638 at 2x (max 76). Clearing the box's shape between the backdrop
    # capture and its image measured worse (2068 / 4299 / 4582 / 9608 px, max 95): the browser hides
    # the page under the block before it blurs, so only content drawn below the underlay (a canvas
    # split at the glass box) brings this back to TEXT_LIMIT
    Case("glass over GPU content and the page", (
        '<div style="position:absolute;left:10px;top:10px;width:120px;height:120px;background:#0a4"></div>'
        f'<div data-plauna-glass style="{GLASS_BOX}">Both</div>'), wells=0, glass=1, text_limit=80),
]


class Base(TestCase):
    maxDiff = None

    @classmethod
    def setUpClass(cls):
        try:
            from playwright.sync_api import sync_playwright
            import numpy  # noqa: F401
            from PIL import Image  # noqa: F401
            executable = chrome_path()
        except (ImportError, ValueError) as error:
            raise SkipTest(str(error)) from error
        cls.resources = ExitStack()
        try:
            cls.resources.enter_context(performance_run_lock(ROOT))
            cls.origin, _ = cls.resources.enter_context(sdk_server(ROOT))
            cls.playwright = sync_playwright().start()
            cls.resources.callback(cls.playwright.stop)
            cls.browsers = {}
            for scale in SCALES:
                args = ["--enable-unsafe-webgpu", "--disable-lcd-text", "--force-color-profile=srgb",
                        f"--force-device-scale-factor={scale}", "--window-size=640,420"]
                browser = cls.playwright.chromium.launch(executable_path=executable, headless=True, args=args)
                cls.resources.callback(browser.close)
                cls.browsers[scale] = browser
        except BaseException:
            cls.resources.close()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.resources.close()

    def open(self, scale=1):
        # The real scale factor (no emulated viewport)
        context = self.browsers[scale].new_context(no_viewport=True, service_workers="block")
        context.route(f"{self.origin}{PAGE}", lambda route: route.fulfill(body=HTML, content_type="text/html"))
        self.addCleanup(context.close)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto(f"{self.origin}{PAGE}")
        return page, errors

    @staticmethod
    def shot(page):
        import numpy as np
        from PIL import Image
        return np.asarray(Image.open(io.BytesIO(page.screenshot())).convert("RGB"), dtype=np.int16)

    def mount(self, page, html, css="", options=None, zoom="", wall=WALL):
        page.evaluate(MOUNT, [html, css, wall, options or {}, zoom, FILL])

    def require_gpu(self, page):
        if page.evaluate(SET_MODE, "gpu") != "gpu":
            raise SkipTest("WebGPU is not available in this Chrome")

    def compare(self, case, scale):
        import numpy as np
        page, errors = self.open(scale)
        self.mount(page, case.html, case.css, {"worker": True} if case.worker else None, case.zoom)
        dom = (page.evaluate(SETTLE), self.shot(page))
        self.require_gpu(page)
        state = page.evaluate(SETTLE)
        gpu = self.shot(page)
        problems = []
        if state["mode"] != "gpu":
            problems.append(f"mode {state['mode']}")
        if len(state["wells"]) != case.wells:
            problems.append(f"{len(state['wells'])} wells, expected {case.wells}")
        if state["glass"] != case.glass:
            problems.append(f"{state['glass']} glass underlays, expected {case.glass}")
        if case.wells == 0 and state["opacity"] != "0":
            problems.append(f"scene opacity {state['opacity']!r} with no well")
        if case.glass:
            problems += page.evaluate(UNDERLAY_ON_BOX)
            # What the underlay shows must matter, or this compares nothing (by the
            # ordinary limit: a case's allowance is no measure of what the blur changes)
            page.evaluate("document.querySelector('.plauna-surface-underlay').style.display = 'none'")
            page.wait_for_timeout(100)
            without = int((np.abs(self.shot(page) - gpu).max(axis=2) > TEXT_LIMIT).sum())
            page.evaluate("document.querySelector('.plauna-surface-underlay').style.display = ''")
            if case.blurs and without < 500:
                problems.append(f"the underlay changes only {without} px")
            if not case.blurs and without:
                problems.append(f"an underlay under a backdrop root changes {without} px")
        diff = np.abs(dom[1] - gpu).max(axis=2)
        inside = np.zeros(diff.shape, bool)
        for x0, y0, x1, y1 in state["wells"]:
            inside[y0:y1, x0:x1] = True
        off = int((diff > case.text_limit).sum())
        well_off = int((diff[inside] > WELL_LIMIT).sum())
        if off:
            ys, xs = np.nonzero(diff > case.text_limit)
            problems.append(f"{off} px off by more than {case.text_limit} (max {int(diff.max())}) in {int(xs.min())},{int(ys.min())}..{int(xs.max())},{int(ys.max())}")
        if well_off:
            problems.append(f"{well_off} px in wells off by more than {WELL_LIMIT} (max {int(diff[inside].max())})")
        # Back in DOM mode nothing of GPU mode is left
        page.evaluate(SET_MODE, "dom")
        after = page.evaluate(SETTLE)
        again = self.shot(page)
        back = int((np.abs(dom[1] - again).max(axis=2) > 2).sum())
        if back:
            problems.append(f"{back} px differ after going back to DOM mode")
        if after["sceneMask"] or after["opacity"] or after["glass"]:
            problems.append(f"DOM mode kept GPU mode's state: {after}")
        if errors:
            problems.append(f"errors: {errors[:3]}")
        return problems


class NativeWellPixels(Base):
    def test_wells_match_dom_mode(self):
        failures = []
        for case in WELL_CASES:
            for scale in case.scales:
                for problem in self.compare(case, scale):
                    failures.append(f"{scale}x {case.name}: {problem}")
        self.assertEqual(failures, [])


class GlassUnderlayPixels(Base):
    def test_glass_matches_dom_mode(self):
        failures = []
        for case in GLASS_CASES:
            for scale in case.scales:
                for problem in self.compare(case, scale):
                    failures.append(f"{scale}x {case.name}: {problem}")
        self.assertEqual(failures, [])

    def test_glass_follows_a_moving_box_and_its_attribute(self):
        page, errors = self.open()
        self.mount(page, f'<div id="g" style="{GLASS_BOX}">Glass</div>')
        self.require_gpu(page)
        self.assertEqual(page.evaluate(SETTLE)["glass"], 0, "a box that is not marked has no underlay")
        page.evaluate("document.getElementById('g').setAttribute('data-plauna-glass', '')")
        self.assertEqual(page.evaluate(SETTLE)["glass"], 1, "marking a box gives it an underlay")
        rects = r"""() => {
            const a = document.getElementById('g').getBoundingClientRect();
            const b = document.querySelector('.plauna-surface-glass').getBoundingClientRect();
            return [a.left, a.top, a.width, a.height, b.left, b.top, b.width, b.height];
        }"""
        r = page.evaluate(rects)
        self.assertTrue(all(abs(r[i] - r[i + 4]) < 0.02 for i in range(4)), f"the underlay is not on the box: {r}")
        # A transition: the underlay is on the box in the frames it runs
        page.evaluate("""() => {
            const g = document.getElementById('g');
            g.style.transition = 'transform 400ms linear';
            g.style.transform = 'translate(60px, 30px) scale(.8)';
        }""")
        off = page.evaluate(r"""async () => {
            const g = document.getElementById('g');
            const under = document.querySelector('.plauna-surface-glass');
            let worst = 0, frames = 0;
            for (let i = 0; i < 40; i++) {
                await new Promise((r) => requestAnimationFrame(r));
                await new Promise((r) => requestAnimationFrame(r));
                const a = g.getBoundingClientRect();
                const b = under.getBoundingClientRect();
                worst = Math.max(worst, Math.abs(a.left - b.left), Math.abs(a.top - b.top));
                frames++;
            }
            return { worst, frames, end: [g.getBoundingClientRect().left, under.getBoundingClientRect().left] };
        }""")
        self.assertLess(abs(off["end"][0] - off["end"][1]), 0.05, f"not on the box when it stopped: {off}")
        # One frame behind at most: 60 px in 400 ms is under 3 px a frame
        self.assertLess(off["worst"], 8, f"fell behind the moving box: {off}")
        page.evaluate("document.getElementById('g').removeAttribute('data-plauna-glass')")
        self.assertEqual(page.evaluate(SETTLE)["glass"], 0, "unmarking a box removes its underlay")
        page.evaluate("document.getElementById('g').setAttribute('data-plauna-glass', '')")
        self.assertEqual(page.evaluate(SETTLE)["glass"], 1)
        page.evaluate("document.getElementById('g').remove()")
        self.assertEqual(page.evaluate(SETTLE)["glass"], 0, "a removed box leaves no underlay")
        self.assertEqual(errors, [])

    def test_a_scene_added_box_brings_its_underlay(self):
        page, errors = self.open()
        self.mount(page, "<div id='holder'></div>")
        self.require_gpu(page)
        page.evaluate(f"""() => {{
            const holder = document.getElementById('holder');
            holder.innerHTML = '<div><div data-plauna-glass style="{GLASS_BOX}">Late</div></div>';
        }}""")
        self.assertEqual(page.evaluate(SETTLE)["glass"], 1)
        self.assertEqual(errors, [])


# Ancestor styles: Chrome decides which keep the page from a glass box below (backdrop roots)
ROOT_STYLES = (
    "", "opacity:.99", "filter:brightness(1)", "clip-path:inset(0)", "mask-image:linear-gradient(#000,#000)",
    "-webkit-mask-image:linear-gradient(#000,#000)", "mask:linear-gradient(#000,#000)", "mix-blend-mode:multiply",
    "view-transition-name:glass-root", "will-change:opacity", "will-change:filter", "will-change:-webkit-filter",
    "will-change:backdrop-filter", "will-change:-webkit-backdrop-filter", "will-change:clip-path",
    "will-change:-webkit-clip-path", "will-change:mask", "will-change:mask-image", "will-change:-webkit-mask-image",
    "will-change:mix-blend-mode", "will-change:transform, filter",
    "will-change:transform", "will-change:isolation", "will-change:view-transition-name", "will-change:mask-border",
    "isolation:isolate", "contain:paint", "overflow:hidden", "transform:translateZ(0)",
)

UNDERLAY_SHOWN = "[...window.__surface.underlay.entries.values()].some((entry) => entry.shown)"
FRAMES = "async (n) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)); }"


class GlassBackdropRoots(Base):
    def test_the_underlay_shows_where_chrome_blurs_the_page(self):
        import numpy as np
        failures = []
        seen = set()
        for style in ROOT_STYLES:
            page, errors = self.open()
            self.mount(page, (f'<div id="w" style="position:absolute;left:0;top:0;width:400px;height:300px;{style}">'
                              f'<div id="g" data-plauna-glass style="{GLASS_BOX}">Glass</div></div>'))
            page.evaluate(SETTLE)
            blurred = self.shot(page)
            page.evaluate("window.__was = document.getElementById('g').style.backdropFilter; document.getElementById('g').style.backdropFilter = 'none'")
            page.evaluate(FRAMES, 3)
            sharp = self.shot(page)
            page.evaluate("document.getElementById('g').style.backdropFilter = window.__was")
            # Chrome: the page blurs under the box (some 25000 px) or not at all
            changed = int((np.abs(blurred - sharp).max(axis=2) > TEXT_LIMIT).sum())
            chrome = changed > 500
            seen.add(chrome)
            if 0 < changed <= 500:
                failures.append(f"{style!r}: the blur changes {changed} px, neither the page nor nothing")
            self.require_gpu(page)
            page.evaluate(SETTLE)
            shown = page.evaluate(UNDERLAY_SHOWN)
            if shown != chrome:
                failures.append(f"{style!r}: Chrome {'blurs' if chrome else 'does not blur'} the page, the underlay is {'shown' if shown else 'hidden'}")
            if errors:
                failures.append(f"{style!r}: errors {errors[:2]}")
        self.assertEqual(seen, {True, False}, "the list must hold roots and non-roots")
        self.assertEqual(failures, [])


class NativeWellBehaviour(Base):
    def test_input_reaches_native_elements_and_overlays(self):
        page, errors = self.open(1.5)
        self.mount(page, (
            '<div id="stage-box" style="position:relative;width:360px;height:220px;margin:20px;background:#345">'
            f'<canvas id="c" {CANVAS} style="position:absolute;left:0;top:0;width:200px;height:120px"></canvas>'
            '<iframe id="f" srcdoc="<!doctype html><body style=&quot;margin:0;height:100vh;background:#1a6&quot;>'
            '<script>addEventListener(&quot;pointerdown&quot;,()=>parent.postMessage(&quot;iframe-down&quot;,&quot;*&quot;))</script>" '
            'style="position:absolute;left:210px;top:0;width:140px;height:120px;border:0"></iframe>'
            f'<button id="b" style="position:absolute;left:100px;top:40px;width:60px;height:30px">Hit</button>'
            '</div>'))
        page.evaluate("""() => {
            window.__hits = [];
            const note = (name) => (event) => window.__hits.push(name + ':' + (event.target.id || event.target.tagName));
            document.getElementById('c').addEventListener('pointerdown', note('canvas'));
            document.getElementById('stage-box').addEventListener('pointerdown', note('delegate'));
            document.getElementById('b').addEventListener('click', note('button'));
            addEventListener('message', (event) => window.__hits.push(event.data));
        }""")
        page.wait_for_timeout(200)
        self.require_gpu(page)
        self.assertEqual(len(page.evaluate(SETTLE)["wells"]), 2)
        at = page.evaluate("""() => {
            const centre = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
            const c = document.getElementById('c').getBoundingClientRect();
            return { canvas: [c.left + 20, c.top + 100], frame: centre('f'), button: centre('b') };
        }""")
        page.mouse.click(*at["canvas"])
        page.mouse.click(*at["button"])
        page.mouse.click(*at["frame"])
        page.wait_for_timeout(300)
        hits = page.evaluate("window.__hits")
        self.assertIn("canvas:c", hits, "the canvas did not get the press")
        self.assertIn("delegate:c", hits, "a listener on the canvas's parent did not see it")
        self.assertIn("button:b", hits, "the overlay above the canvas did not get the click")
        self.assertIn("iframe-down", hits, "the iframe did not get the press")
        self.assertFalse([e for e in errors if "favicon" not in e], errors)

    def test_elements_that_show_nothing_get_no_well(self):
        page, errors = self.open()
        self.mount(page, (
            '<p style="font:14px Arial">Text</p>'
            '<video style="position:absolute;width:2px;height:2px;opacity:0"></video>'
            '<div style="opacity:0"><canvas style="width:50px;height:50px"></canvas></div>'
            '<iframe style="position:fixed;right:0;bottom:0;width:0;height:0;border:0"></iframe>'
            '<iframe style="position:absolute;left:-10000px;top:0;width:100px;height:100px"></iframe>'
            '<iframe style="display:none"></iframe>'
            '<canvas style="visibility:hidden;width:50px;height:50px"></canvas>'
            '<audio></audio>'))
        self.require_gpu(page)
        state = page.evaluate(SETTLE)
        self.assertEqual(state["mode"], "gpu")
        self.assertEqual(state["wells"], [], "a hidden helper got a well")
        self.assertEqual(state["opacity"], "0", "the scene was revealed for elements that show nothing")
        self.assertEqual(state["sceneMask"], "")
        self.assertFalse(page.evaluate("Boolean(window.__surface.gpu.clip.style.maskImage)"), "the canvas was cut for elements that show nothing")
        self.assertEqual(errors, [])

    def test_object_embed_and_audio_controls_get_wells(self):
        page, errors = self.open()
        self.mount(page, (
            '<object data="data:text/plain,x" style="display:block;width:100px;height:40px"></object>'
            '<embed src="data:text/plain,y" style="display:block;width:100px;height:40px">'
            '<audio controls style="display:block;width:200px;height:40px"></audio>'))
        self.require_gpu(page)
        self.assertEqual(len(page.evaluate(SETTLE)["wells"]), 3)
        self.assertEqual(errors, [])

    def test_wells_follow_scroll_layout_transform_and_animation(self):
        import numpy as np
        page, errors = self.open(1.25)
        self.mount(page, (
            '<div id="spacer" style="height:10px"></div>'
            '<div id="scroller" style="width:300px;height:140px;overflow:auto;background:#222">'
            f'<canvas id="c" {CANVAS} style="display:block;margin:40px 0;width:260px;height:120px"></canvas>'
            '<div style="height:200px;background:#843"></div></div>'))
        self.require_gpu(page)
        page.evaluate(SETTLE)
        steps = [
            ("layout", "document.getElementById('spacer').style.height = '37px'"),
            ("scroll", "document.getElementById('scroller').scrollTop = 53"),
            ("own transform", "document.getElementById('c').style.transform = 'translate(11px,5px) rotate(4deg)'"),
            ("parent transform", "document.getElementById('scroller').style.transform = 'translateX(30.5px)'"),
            ("resize", "document.getElementById('c').style.width = '180px'"),
        ]
        for name, change in steps:
            page.evaluate(change)
            state = page.evaluate(SETTLE)
            self.assertEqual(state["mode"], "gpu")
            shown = self.shot(page)
            # The same in DOM mode
            page.evaluate(SET_MODE, "dom")
            page.evaluate(SETTLE)
            dom = self.shot(page)
            self.require_gpu(page)
            page.evaluate(SETTLE)
            diff = np.abs(dom - shown).max(axis=2)
            self.assertEqual(int((diff > TEXT_LIMIT).sum()), 0, f"after {name}: {int((diff > TEXT_LIMIT).sum())} px off, max {int(diff.max())}")
        # A running animation: the well is around the element in the frames it runs
        off = page.evaluate(r"""async () => {
            const surface = window.__surface;
            const c = document.getElementById('c');
            c.style.transform = '';
            const animation = c.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(80px)' }], { duration: 500 });
            let worst = 0, frames = 0;
            const dpr = devicePixelRatio;
            while (animation.playState === 'running' && frames < 90) {
                await new Promise((r) => requestAnimationFrame(r));
                // (it jumps back as it ends, a frame before the well)
                if (animation.playState !== 'running') break;
                frames++;
                const r = c.getBoundingClientRect();
                const well = surface.wells.rects[0];
                if (well) worst = Math.max(worst, Math.abs(well[0] / dpr - Math.max(r.left, surface.visibleRect().client.left)));
            }
            return { worst, frames };
        }""")
        self.assertGreater(off["frames"], 5)
        self.assertLess(off["worst"], 12, f"the well fell behind the animation: {off}")
        self.assertEqual(errors, [])

    def test_auto_mode_stays_on_the_gpu_with_native_content(self):
        page, errors = self.open()
        self.mount(page, f'<canvas id="c" {CANVAS} style="display:block;width:100px;height:60px"></canvas>')
        self.require_gpu(page)
        self.assertEqual(page.evaluate(SET_MODE, "auto"), "gpu", "auto mode went to the DOM for native content")
        state = page.evaluate(SETTLE)
        self.assertEqual(state["mode"], "gpu")
        self.assertEqual(len(state["wells"]), 1)
        page.evaluate("document.getElementById('c').remove()")
        state = page.evaluate(SETTLE)
        self.assertEqual(state["wells"], [])
        self.assertEqual(state["opacity"], "0", "the scene stayed revealed after its only well left")
        self.assertEqual(state["sceneMask"], "")
        page.evaluate(f"""() => {{
            const video = document.createElement('video');
            video.style.cssText = 'display:block;width:100px;height:60px';
            window.__surface.mount(video);
        }}""")
        state = page.evaluate(SETTLE)
        self.assertEqual((state["mode"], len(state["wells"])), ("gpu", 1), "a video added later has its well")
        self.assertEqual(errors, [])

    def test_a_mode_switch_keeps_native_content_alive(self):
        page, errors = self.open()
        self.mount(page, (
            '<iframe id="f" srcdoc="<!doctype html><script>parent.postMessage(&quot;loaded&quot;,&quot;*&quot;)</script>" style="display:block;width:100px;height:60px"></iframe>'
            f'<canvas id="c" {CANVAS} style="display:block;width:100px;height:60px"></canvas>'))
        page.evaluate("""() => {
            window.__loads = 0;
            addEventListener('message', () => window.__loads++);
            const c = document.getElementById('c');
            window.__parent = c.parentElement;
            window.__stream = c.captureStream(10);
        }""")
        page.wait_for_timeout(300)
        before = page.evaluate("window.__loads")
        rect = "(() => { const r = document.getElementById('c').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()"
        dom_rect = page.evaluate(rect)
        for _ in range(2):
            self.require_gpu(page)
            page.evaluate(SETTLE)
            self.assertEqual(page.evaluate(rect), dom_rect, "the element moved with the mode")
            self.assertTrue(page.evaluate("document.getElementById('c').parentElement === window.__parent"), "the element was moved")
            self.assertEqual(page.evaluate(SET_MODE, "dom"), "dom")
            page.evaluate(SETTLE)
        page.wait_for_timeout(200)
        self.assertEqual(page.evaluate("window.__loads"), before, "the iframe reloaded")
        self.assertEqual(errors, [])

    def test_a_worker_surface_keeps_wells_and_glass_on_moving_elements(self):
        # A worker animates compositor layers with no main-thread frames: nothing would follow them
        page, errors = self.open()
        self.mount(page, (
            f'<canvas id="c" {CANVAS} style="position:absolute;left:10px;top:10px;width:100px;height:60px"></canvas>'
            f'<div id="g" data-plauna-glass style="{GLASS_BOX}">Glass</div>'
        ), options={"worker": True})
        self.require_gpu(page)
        page.evaluate(SETTLE)
        result = page.evaluate(r"""async () => {
            const surface = window.__surface;
            if (!surface.gpu.worker) return { skip: true };
            const c = document.getElementById('c');
            const g = document.getElementById('g');
            const under = document.querySelector('.plauna-surface-glass');
            const from = { transform: 'translateX(0)' }, to = { transform: 'translateX(120px)' };
            c.style.outlineWidth = '0px';
            const animations = [c, g].map((el) => el.animate([from, to], { duration: 500 }));
            const dpr = devicePixelRatio;
            let well = 0, glass = 0, frames = 0;
            const start = surface.stats.frames;
            while (animations[0].playState === 'running' && frames < 120) {
                await new Promise((r) => requestAnimationFrame(r));
                if (animations[0].playState !== 'running') break;
                frames++;
                well = Math.max(well, Math.abs(surface.wells.rects[0][0] / dpr - c.getBoundingClientRect().left));
                glass = Math.max(glass, Math.abs(under.getBoundingClientRect().left - g.getBoundingClientRect().left));
            }
            return { well, glass, frames, painted: surface.stats.frames - start, offload: surface.animations.offload };
        }""")
        if result.get("skip"):
            raise SkipTest("no paint worker in this Chrome")
        self.assertGreater(result["frames"], 5)
        self.assertGreater(result["painted"], 5, f"the main thread painted no frames as they moved: {result}")
        self.assertFalse(result["offload"])
        self.assertLess(result["well"], 16, f"the well fell behind: {result}")
        self.assertLess(result["glass"], 16, f"the underlay fell behind: {result}")
        self.assertEqual(errors, [])

    def test_a_video_sized_by_its_metadata_lays_out_again(self):
        page, errors = self.open()
        self.mount(page, '<video id="v" muted autoplay style="display:block"></video><div id="next" style="height:10px;background:#f00"></div>')
        self.require_gpu(page)
        page.evaluate(SETTLE)
        page.evaluate("window.__video = document.getElementById('v'); window.__next = document.getElementById('next')")
        check_video_follows(self, page.evaluate(FEED_VIDEO))
        self.assertEqual(errors, [])

    def test_many_elements_merge_into_a_few_wells(self):
        page, errors = self.open()
        items = "".join(f'<canvas style="display:block;float:left;width:10px;height:10px;margin:1px"></canvas>' for _ in range(100))
        self.mount(page, items)
        self.require_gpu(page)
        state = page.evaluate(SETTLE)
        self.assertEqual(len(state["wells"]), 32)
        self.assertEqual(errors, [])


class SurfaceFrames(Base):
    """Decision 11, and the frame scheduler hooks."""

    def test_render_mode_decisions(self):
        page, errors = self.open()
        result = page.evaluate(r"""async () => {
            const { decideRenderMode, isChromium } = await import('/plauna/render/RenderModes.js');
            const on = { gpu: true, chromium: true };
            return {
                domStaysDom: decideRenderMode('dom', on),
                gpuIsGpu: decideRenderMode('gpu', on),
                autoChromium: decideRenderMode('auto', on),
                autoElsewhere: decideRenderMode('auto', { gpu: true, chromium: false }),
                gpuElsewhere: decideRenderMode('gpu', { gpu: true, chromium: false }),
                noWebGpu: [decideRenderMode('gpu', { gpu: false, chromium: true }), decideRenderMode('auto', { gpu: false, chromium: true })],
                failed: [decideRenderMode('gpu', { ...on, failed: true }), decideRenderMode('auto', { ...on, failed: true })],
                lost: [decideRenderMode('gpu', { ...on, lost: true }), decideRenderMode('auto', { ...on, lost: true })],
                nonsense: decideRenderMode('nonsense', on),
                chrome: isChromium({ userAgentData: { brands: [{ brand: 'Chromium' }, { brand: 'Google Chrome' }] } }),
                edge: isChromium({ userAgent: 'Mozilla/5.0 Chrome/120.0 Safari/537 Edg/120.0' }),
                firefox: isChromium({ userAgent: 'Mozilla/5.0 Gecko/20100101 Firefox/120.0' }),
                safari: isChromium({ userAgent: 'Mozilla/5.0 AppleWebKit/605 Version/17 Safari/605' }),
                ios: isChromium({ userAgent: 'Mozilla/5.0 CriOS/120 Mobile Safari/604' }),
                brands: isChromium({ userAgentData: { brands: [{ brand: 'Not A Brand' }] }, userAgent: 'Chrome/120' }),
            };
        }""")
        self.assertEqual(result, {
            "domStaysDom": "dom", "gpuIsGpu": "gpu", "autoChromium": "gpu", "autoElsewhere": "dom", "gpuElsewhere": "gpu",
            "noWebGpu": ["dom", "dom"], "failed": ["dom", "dom"], "lost": ["gpu", "dom"], "nonsense": "dom",
            "chrome": True, "edge": True, "firefox": False, "safari": False, "ios": False, "brands": False,
        })
        self.assertEqual(errors, [])

    def test_auto_is_dom_outside_chromium(self):
        page, errors = self.open()
        self.mount(page, "<p>Text</p>")
        result = page.evaluate(r"""async () => {
            const surface = window.__surface;
            Object.defineProperty(navigator, 'userAgentData', { value: { brands: [{ brand: 'Firefox' }] }, configurable: true });
            const auto = await surface.setMode('auto');
            const gpu = await surface.setMode('gpu');
            await surface.setMode('dom');
            delete navigator.userAgentData;
            return { auto, gpu };
        }""")
        self.assertEqual(result["auto"], "dom")
        if result["gpu"] != "gpu":
            raise SkipTest("WebGPU is not available in this Chrome")
        self.assertEqual(errors, [])

    def fail_case(self, setup, options=None):
        page, errors = self.open()
        self.mount(page, "<p>Text</p>", options=options)
        self.require_gpu(page)
        page.evaluate(SETTLE)
        result = page.evaluate(setup)
        page.wait_for_timeout(200)
        state = page.evaluate(r"""() => ({
            mode: window.__surface.activeMode,
            opacity: window.__surface.scene.style.opacity,
            failed: window.__surface.gpuFailed,
            error: String(window.__surface.lastError?.message ?? window.__surface.lastError),
            canvases: window.__surface.element.querySelectorAll('canvas').length,
        })""")
        self.assertEqual(state["mode"], "dom", f"{state} {result}")
        self.assertEqual(state["opacity"], "", "the scene stayed hidden")
        self.assertEqual(state["canvases"], 0)
        self.assertTrue(state["failed"])
        # It stays there until the mode is requested again
        self.assertEqual(page.evaluate("window.__surface.evaluate()"), "dom")
        self.assertEqual(page.evaluate(SET_MODE, "gpu"), "gpu")
        self.assertEqual(page.evaluate(SETTLE)["mode"], "gpu")
        self.assertEqual([e for e in errors if "GPU rendering failed" not in e], [])
        self.assertTrue([e for e in errors if "GPU rendering failed" in e], "the failure was not reported")
        return state

    def test_a_frame_that_throws_shows_the_dom(self):
        state = self.fail_case(r"""async () => {
            const surface = window.__surface;
            surface.frame = function failing() { delete surface.frame; throw new Error('injected frame failure'); };
            surface.invalidate(false);
            for (let i = 0; i < 60 && surface.activeMode === 'gpu'; i++) await new Promise((r) => requestAnimationFrame(r));
        }""")
        self.assertIn("injected frame failure", state["error"])

    def test_a_gpu_validation_error_shows_the_dom(self):
        state = self.fail_case(r"""async () => {
            const surface = window.__surface;
            const painter = surface.painter;
            painter.render = function failing(...args) {
                delete painter.render;
                // MAP_READ with MAP_WRITE is a validation error
                painter.device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.MAP_WRITE });
                return painter.render(...args);
            };
            surface.invalidate(false);
            for (let i = 0; i < 60 && surface.activeMode === 'gpu'; i++) await new Promise((r) => requestAnimationFrame(r));
        }""")
        self.assertIn("usage", state["error"].lower())

    def test_a_worker_error_shows_the_dom(self):
        state = self.fail_case(r"""async () => {
            const surface = window.__surface;
            if (!surface.gpu.worker) throw new Error('not in a worker');
            surface.painter.receive({ type: 'error', message: 'injected worker failure' });
        }""", options={"worker": True})
        self.assertIn("injected worker failure", state["error"])

    def test_gpu_that_cannot_start_shows_the_dom(self):
        page, errors = self.open()
        page.evaluate(r"""async () => {
            const { RenderSurface } = await import('/plauna/render/RenderSurface.js');
            const surface = new RenderSurface({ mode: 'dom', getDevice: async () => null });
            document.body.append(surface.element);
            window.__surface = surface;
        }""")
        self.assertEqual(page.evaluate(SET_MODE, "gpu"), "dom")
        self.assertTrue(page.evaluate("window.__surface.gpuFailed"))
        self.assertEqual(errors, [])

    def test_the_host_runs_frames_through_the_hooks(self):
        page, errors = self.open()
        self.mount(page, "<p id='p'>Text</p>")
        result = page.evaluate(r"""async () => {
            const { RenderSurface } = await import('/plauna/render/RenderSurface.js');
            const asked = [];
            const cancelled = [];
            const surface = new RenderSurface({
                mode: 'gpu',
                requestFrame: (paint) => { asked.push(paint); return asked.length; },
                cancelFrame: (handle) => cancelled.push(handle),
            });
            document.body.append(surface.element);
            await surface.ready;
            if (surface.activeMode !== 'gpu') return { skip: true };
            const line = surface.mount(document.createElement('p'));
            line.textContent = 'hooked';
            const raf = () => new Promise((r) => requestAnimationFrame(r));
            for (let i = 0; i < 6; i++) await raf();
            const before = { asked: asked.length, frames: surface.stats.frames, handle: surface.frameHandle };
            // Asked once however often it is invalidated, until it runs
            surface.invalidate(); surface.invalidate(false);
            const stillOne = asked.length;
            asked.at(-1)(performance.now());
            const first = surface.stats.frames;
            // (a frame can ask for the next: text just rastered, say)
            for (let i = 0; i < 20 && surface.frameHandle; i++) {
                asked.at(-1)(performance.now());
                await raf();
            }
            const after = { frames: first, handle: surface.frameHandle };
            // A paint called again does nothing
            const painted = surface.stats.frames;
            asked.at(-1)(performance.now());
            const twice = surface.stats.frames - painted;
            // Another invalidation asks again; a stop cancels what is asked
            const settled = asked.length;
            surface.invalidate();
            const again = asked.length;
            const handle = surface.frameHandle;
            const cancelledPaint = asked.at(-1);
            await surface.setMode('dom');
            const out = { before, stillOne, after, twice, settled, again, handle, cancelled: [...cancelled], left: surface.frameHandle };
            // A paint the host calls after its request was cancelled paints nothing,
            // and does not take the place of the request asked since
            await surface.setMode('gpu');
            for (let i = 0; i < 2; i++) await raf();
            surface.invalidate();
            const pending = surface.frameHandle;
            const framesBefore = surface.stats.frames;
            cancelledPaint(performance.now());
            out.stale = { painted: surface.stats.frames - framesBefore, kept: surface.frameHandle === pending && Boolean(pending) };
            asked.at(-1)(performance.now());
            // Errors reach the host, which decides
            await surface.setMode('gpu');
            for (let i = 0; i < 2; i++) await raf();
            surface.frame = () => { throw new Error('injected'); };
            surface.frameHandle = null;
            surface.invalidate();
            let thrown = null;
            try { asked.at(-1)(); } catch (error) { thrown = error.message; }
            out.thrown = thrown;
            out.stillGpu = surface.activeMode;
            delete surface.frame;
            surface.failGpu(new Error('host says no'));
            out.afterFail = surface.activeMode;
            surface.destroy();
            return out;
        }""")
        if result.get("skip"):
            raise SkipTest("WebGPU is not available in this Chrome")
        self.assertEqual(result["before"]["frames"], 0, "the surface painted on its own animation frame")
        self.assertGreaterEqual(result["before"]["asked"], 1)
        self.assertEqual(result["stillOne"], result["before"]["asked"], "asked again while one was pending")
        self.assertEqual(result["after"]["frames"], 1)
        self.assertFalse(result["after"]["handle"])
        self.assertEqual(result["twice"], 0, "a paint called again painted")
        self.assertEqual(result["stale"], {"painted": 0, "kept": True}, "a cancelled request's paint painted or dropped the request asked since")
        self.assertEqual(result["again"], result["settled"] + 1)
        self.assertEqual(result["cancelled"], [result["handle"]])
        self.assertFalse(result["left"])
        self.assertEqual(result["thrown"], "injected")
        self.assertEqual(result["stillGpu"], "gpu")
        self.assertEqual(result["afterFail"], "dom")
        self.assertEqual([e for e in errors if "host says no" not in e], [])

    def test_a_request_frame_that_throws_shows_the_dom(self):
        # Held as pending, a request the host never took would stop every later one
        page, errors = self.open()
        result = page.evaluate(r"""async () => {
            const { RenderSurface } = await import('/plauna/render/RenderSurface.js');
            let fail = false;
            const asked = [];
            const surface = new RenderSurface({
                mode: 'gpu',
                requestFrame: (paint) => { if (fail) throw new Error('host cannot schedule'); asked.push(paint); return asked.length; },
                cancelFrame: () => {},
            });
            document.body.append(surface.element);
            await surface.ready;
            if (surface.activeMode !== 'gpu') return { skip: true };
            surface.mount(document.createElement('p')).textContent = 'scheduled';
            const raf = () => new Promise((r) => requestAnimationFrame(r));
            for (let i = 0; i < 20 && surface.frameHandle; i++) { asked.at(-1)(performance.now()); await raf(); }
            fail = true;
            let thrown = null;
            try { surface.invalidate(); } catch (error) { thrown = error.message; }
            const out = { thrown, mode: surface.activeMode, failed: surface.gpuFailed, held: Boolean(surface.frameHandle),
                          error: String(surface.lastError?.message) };
            // Asked again with a host that schedules: frames are asked for again
            fail = false;
            const before = asked.length;
            out.again = await surface.setMode('gpu');
            surface.invalidate();
            out.asked = asked.length - before;
            surface.destroy();
            return out;
        }""")
        if result.get("skip"):
            raise SkipTest("WebGPU is not available in this Chrome")
        self.assertIsNone(result["thrown"], "the host's error reached whoever invalidated")
        self.assertEqual((result["mode"], result["failed"], result["held"]), ("dom", True, False), str(result))
        self.assertEqual(result["error"], "host cannot schedule")
        self.assertEqual(result["again"], "gpu")
        self.assertGreaterEqual(result["asked"], 1, f"no frame was asked for again: {result}")
        self.assertEqual([e for e in errors if "host cannot schedule" not in e], [])


class NestedTrees(Base):
    """Shadow trees inside the scene are watched as the scene is."""

    SETUP = r"""async (options) => {
        const surface = window.__surface;
        const host = surface.scene.querySelector('#host');
        const shadow = host.attachShadow({ mode: 'open' });
        shadow.innerHTML = '<style>.inner { width: 60px; height: 40px; background: rgb(255, 0, 0); }</style><div class="inner"></div>';
        window.__shadow = shadow;
        window.__inner = shadow.querySelector('.inner');
        return true;
    }"""

    def painted(self, page):
        page.evaluate(SETTLE)
        return page.evaluate("window.__surface.layout.boxes.get(window.__inner)?.style.backgroundColor ?? null")

    def setup_tree(self):
        page, errors = self.open()
        self.mount(page, "<div id='host'></div>")
        page.evaluate(self.SETUP, {})
        self.require_gpu(page)
        self.assertEqual(self.painted(page)[:3], [1, 0, 0], "the shadow tree is not laid out")
        return page, errors

    def test_a_style_change_in_a_shadow_tree_restyles(self):
        page, errors = self.setup_tree()
        page.evaluate("""() => {
            const style = document.createElement('style');
            style.textContent = '.inner { background: rgb(0, 0, 255); }';
            window.__shadow.append(style);
        }""")
        self.assertEqual(self.painted(page)[:3], [0, 0, 1], "a sheet added in the shadow tree did not restyle")
        page.evaluate("window.__shadow.querySelector('style:last-of-type').textContent = '.inner { background: rgb(0, 255, 0); }'")
        self.assertEqual(self.painted(page)[:3], [0, 1, 0], "a sheet edited in the shadow tree did not restyle")
        self.assertEqual(errors, [])

    def test_a_mutation_in_a_shadow_tree_lays_out_again(self):
        page, errors = self.setup_tree()
        page.evaluate("window.__inner.style.width = '90px'")
        page.evaluate(SETTLE)
        self.assertAlmostEqual(page.evaluate("window.__surface.layout.boxes.get(window.__inner).width"), 90, delta=0.01)
        page.evaluate("window.__late = document.createElement('div'); window.__late.style.height = '17px'; window.__shadow.append(window.__late)")
        page.evaluate(SETTLE)
        self.assertAlmostEqual(page.evaluate("window.__surface.layout.boxes.get(window.__late)?.height ?? -1"), 17, delta=0.01)
        self.assertEqual(errors, [])

    def test_a_hover_rule_in_a_shadow_tree_restyles(self):
        page, errors = self.setup_tree()
        page.evaluate("""() => {
            const style = document.createElement('style');
            style.textContent = '.inner:hover { background: rgb(0, 128, 0); }';
            window.__shadow.append(style);
        }""")
        page.evaluate(SETTLE)
        self.assertTrue(page.evaluate("window.__surface.ruleFlag('interactive')"), "a nested tree's :hover rule is not seen")
        r = page.evaluate("(() => { const r = window.__inner.getBoundingClientRect(); return [r.left + 10, r.top + 10]; })()")
        page.mouse.move(*r)
        page.evaluate(SETTLE)
        colour = self.painted(page)
        self.assertLess(abs(colour[1] - 128 / 255), 0.01, f"hovering did not restyle: {colour}")
        self.assertEqual(errors, [])

    def test_a_routed_hover_reaches_a_rule_in_a_shadow_tree(self):
        # pointer() routes input for targets with no page DOM behind them: it
        # marks hover only while some tree's rules depend on it
        page, errors = self.setup_tree()
        page.evaluate("""() => {
            const style = document.createElement('style');
            style.textContent = '.inner:hover { background: rgb(0, 128, 0); }';
            window.__shadow.append(style);
        }""")
        page.evaluate(SETTLE)
        page.evaluate("""() => {
            const surface = window.__surface;
            const box = surface.layout.boxes.get(window.__inner);
            surface.pointer('move', box.absX + 5, box.absY + 5);
        }""")
        colour = self.painted(page)
        self.assertLess(abs(colour[1] - 128 / 255), 0.01, f"a routed hover did not restyle: {colour}")
        self.assertEqual(errors, [])

    def test_a_video_in_a_shadow_tree_sized_by_its_metadata_lays_out_again(self):
        # loadedmetadata and resize do not leave the shadow tree
        page, errors = self.setup_tree()
        page.evaluate("""() => {
            const video = document.createElement('video');
            video.muted = true;
            video.autoplay = true;
            video.style.display = 'block';
            const next = document.createElement('div');
            next.style.cssText = 'height:10px;background:#f00';
            window.__shadow.append(video, next);
            window.__video = video;
            window.__next = next;
        }""")
        page.evaluate(SETTLE)
        check_video_follows(self, page.evaluate(FEED_VIDEO))
        self.assertEqual(errors, [])

    def test_removed_shadow_hosts_are_no_longer_watched(self):
        page, errors = self.setup_tree()
        result = page.evaluate(r"""async () => {
            const surface = window.__surface;
            const raf = () => new Promise((r) => requestAnimationFrame(r));
            const settle = async () => { for (let i = 0; i < 4; i++) await raf(); };
            const holder = surface.scene.querySelector('#host').parentElement;
            const state = () => ({ trees: surface.trees.size, interactive: surface.ruleFlag('interactive') });
            const hosts = [];
            for (let i = 0; i < 20; i++) {
                const host = document.createElement('div');
                host.attachShadow({ mode: 'open' }).innerHTML = '<style>.x:hover { color: rgb(255, 0, 0); }</style><div class="x">x</div>';
                holder.append(host);
                hosts.push(host);
            }
            await settle();
            const added = state();
            for (const host of hosts) host.remove();
            await settle();
            const removed = state();
            // A sheet edited in a removed tree restyles nothing
            const layouts = surface.stats.layouts;
            hosts[1].shadowRoot.querySelector('style').textContent = '.x { color: rgb(0, 0, 255); }';
            await settle();
            const relaid = surface.stats.layouts - layouts;
            // A host put back is watched again
            holder.append(hosts[0]);
            await settle();
            const back = state();
            hosts[0].remove();
            await settle();
            return { added, removed, relaid, back, gone: state() };
        }""")
        self.assertEqual(result["added"], {"trees": 21, "interactive": True})
        self.assertEqual(result["removed"], {"trees": 1, "interactive": False}, f"removed trees still count: {result}")
        self.assertEqual(result["relaid"], 0, "a sheet in a removed tree laid the scene out again")
        self.assertEqual(result["back"], {"trees": 2, "interactive": True})
        self.assertEqual(result["gone"], {"trees": 1, "interactive": False})
        # The tree that stayed is still observed after the others were let go
        page.evaluate("window.__inner.style.width = '90px'")
        page.evaluate(SETTLE)
        self.assertAlmostEqual(page.evaluate("window.__surface.layout.boxes.get(window.__inner).width"), 90, delta=0.01)
        self.assertEqual(errors, [])

    def test_a_shadow_root_attached_late_is_laid_out(self):
        # attachShadow makes no mutation record
        page, errors = self.open()
        self.mount(page, "<div id='a'></div><div id='b'></div>")
        self.require_gpu(page)
        page.evaluate(SETTLE)
        page.evaluate("""() => {
            for (const id of ['a', 'b']) {
                document.getElementById(id).attachShadow({ mode: 'open' }).innerHTML = '<div class="inner" style="height:20px;background:#00f"></div>';
            }
        }""")
        page.evaluate(SETTLE)
        # A change to the host brings its tree by itself; nothing changes on the other, the page says so
        page.evaluate("document.getElementById('a').setAttribute('data-ready', '')")
        page.evaluate("window.__surface.watch(document.getElementById('b'))")
        page.evaluate(SETTLE)
        page.evaluate("for (const id of ['a', 'b']) document.getElementById(id).shadowRoot.querySelector('.inner').style.height = '77px'")
        page.evaluate(SETTLE)
        state = page.evaluate("""(() => {
            const surface = window.__surface;
            const out = {};
            for (const id of ['a', 'b']) {
                const host = document.getElementById(id);
                const inner = host.shadowRoot.querySelector('.inner');
                out[id] = { watched: surface.trees.has(host.shadowRoot), height: surface.layout.boxes.get(inner)?.height ?? null,
                            dom: inner.getBoundingClientRect().height };
            }
            return out;
        })()""")
        self.assertEqual(state, {"a": {"watched": True, "height": 77, "dom": 77}, "b": {"watched": True, "height": 77, "dom": 77}})
        self.assertEqual(errors, [])

    def test_a_routed_hover_matches_chrome_across_shadow_trees(self):
        # Chrome hovers up the flat tree: the shadow host above an element, and a
        # slotted element's slot; enter events reach each element once
        page, errors = self.open()
        self.mount(page, ("<div id='outer' style='padding:10px'><div id='host'>"
                          "<span id='light' style='display:block;width:50px;height:20px;background:#00f'>L</span></div></div>"),
                   css="#host:hover { background: rgb(0, 128, 0); }")
        page.evaluate(r"""() => {
            const host = document.getElementById('host');
            const shadow = host.attachShadow({ mode: 'open' });
            shadow.innerHTML = '<div id="wrap" style="padding:4px"><div id="inner" style="width:60px;height:40px;background:#f00"></div><slot id="slot"></slot></div>';
            window.__all = [document.getElementById('outer'), host, ...['wrap', 'inner', 'slot'].map((id) => shadow.getElementById(id)), document.getElementById('light')];
            window.__log = [];
            for (const el of window.__all) for (const type of ['pointerenter', 'mouseenter']) {
                el.addEventListener(type, (event) => { if (event.target === el) window.__log.push(`${type}:${el.id}`); });
            }
        }""")
        centre = "(id) => { const r = window.__all.find((el) => el.id === id).getBoundingClientRect(); return [r.left + 5, r.top + 5]; }"
        hovered = "window.__all.filter((el) => el.matches(':hover')).map((el) => el.id)"
        marked = "window.__all.filter((el) => el.hasAttribute('data-plauna-hover')).map((el) => el.id)"
        chrome = {}
        page.mouse.move(620, 400)
        for name in ("inner", "light"):
            page.evaluate("window.__log = []")
            page.mouse.move(*page.evaluate(centre, name))
            page.evaluate(FRAMES, 2)
            chrome[name] = {"hovered": page.evaluate(hovered), "entered": page.evaluate("window.__log.slice()")}
            page.mouse.move(620, 400)
            page.evaluate(FRAMES, 2)
        self.require_gpu(page)
        page.evaluate(SETTLE)
        routed = {}
        for name in ("inner", "light"):
            page.evaluate("window.__log = []")
            page.evaluate("""(id) => {
                const surface = window.__surface;
                const box = surface.layout.boxes.get(window.__all.find((el) => el.id === id));
                surface.pointer('move', box.absX + 5, box.absY + 5);
            }""", name)
            page.evaluate(SETTLE)
            routed[name] = {"hovered": page.evaluate(marked), "entered": page.evaluate("window.__log.slice()"),
                            "host": page.evaluate("window.__surface.layout.boxes.get(document.getElementById('host')).style.backgroundColor")}
            page.evaluate("window.__surface.pointer('move', -50, -50)")
        for name in ("inner", "light"):
            self.assertEqual(routed[name]["hovered"], chrome[name]["hovered"], f"{name}: hovered elements")
            # (Chrome sends every pointer event before the mouse events; each kind in its order)
            for kind in ("pointerenter", "mouseenter"):
                ours = [e for e in routed[name]["entered"] if e.startswith(kind)]
                self.assertEqual(ours, [e for e in chrome[name]["entered"] if e.startswith(kind)], f"{name}: {kind}")
            self.assertEqual([round(c, 3) for c in routed[name]["host"]], [0, 0.502, 0, 1], f"{name}: the host's :hover rule")
        self.assertEqual(errors, [])

    def test_native_content_in_a_shadow_tree_has_a_well(self):
        page, errors = self.setup_tree()
        page.evaluate("""() => {
            const canvas = document.createElement('canvas');
            canvas.style.cssText = 'display:block;width:60px;height:40px';
            window.__shadow.append(canvas);
        }""")
        self.assertEqual(len(page.evaluate(SETTLE)["wells"]), 1)
        self.assertEqual(errors, [])

    def test_selection_and_scrollbar_rules_alone_restyle_on_a_class_change(self):
        page, errors = self.open()
        # Only highlight and scrollbar rules: no ordinary rule could match. They
        # reach only #b, a level below the class change's child (which is
        # computed again with its parent, and keeps its style and its subtree)
        self.mount(page, "<div id='a'><div><div id='b' style='overflow:auto;width:50px;height:50px'>x</div></div></div>",
                   css=".on #b::selection { background: rgb(1, 2, 3); } .on #b::-webkit-scrollbar { width: 7px; }")
        self.require_gpu(page)
        page.evaluate(SETTLE)
        counts = page.evaluate("(() => { const r = window.__surface.resolver.rules; return [r.count, r.selectionCount, r.scrollbarCount]; })()")
        self.assertEqual(counts, [0, 1, 1], "this case is about highlight and scrollbar rules alone")
        page.evaluate("document.getElementById('a').className = 'on'")
        page.evaluate(SETTLE)
        style = page.evaluate("""(() => {
            const s = window.__surface.layout.boxes.get(document.getElementById('b')).style;
            return { selection: s.selection?.backgroundColor ?? s.selection?.background ?? null, scrollbar: s.webkitScrollbar?.width ?? null };
        })()""")
        self.assertIsNotNone(style["scrollbar"], f"the class change did not restyle below it: {style}")
        self.assertIsNotNone(style["selection"], f"the class change did not restyle below it: {style}")
        self.assertEqual(errors, [])


if __name__ == "__main__":
    main()
