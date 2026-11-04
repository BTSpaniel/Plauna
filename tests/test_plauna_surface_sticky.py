# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Sticky boxes that stick within a scroll container above the scene, or the viewport.

A sticky box with no scroll container between it and the scene sticks where
the browser makes it stick: in the content box, less scrollbars, of the
nearest scroll container up the containing-block chain above the scene, or
in the viewport (RenderSurface.stickyView, LayoutEngine.stickyViewport). The
surface's boxes must match the browser's rects as that container or the page
scrolls, in GPU frames painted as it scrolls (not only after a mode switch),
and the pixels must match DOM mode. Real scale factors 1, 1.25, 1.5 and 2,
with classic scrollbars shown (headless Chrome hides them unless told not to).
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

PAGE = "/__plauna_surface_sticky__.html"
HTML = "<!doctype html><meta charset=utf-8><body></body>"
SCALES = (1, 1.25, 1.5, 2)
# Box edges GPU mode paints itself, as in the other parity tests
PIXEL_LIMIT = 24
# Scene px: the browser's rects are single precision
POSITION_LIMIT = 0.02

STRIPES = "".join(f'<div style="height:35px;background:{c}"></div>' for c in ["#357", "#b84", "#486", "#a4a"] * 6)
SCENE = (
    '<div style="height:60px;background:#ccc"></div>'
    '<div id="st" style="position:sticky;top:6px;height:12px;margin:0 4px;background:#d22"></div>'
    '<div style="width:640px;height:30px;background:#246"><div id="sl" style="position:sticky;left:5px;width:50px;height:30px;background:#2c2"></div></div>'
    + STRIPES
    + '<div id="sb" style="position:sticky;bottom:5px;height:10px;background:#22d"></div>'
)
OUTER = "position:absolute;left:20.5px;top:15.25px;width:400px;height:220px;padding:7px 9px;border:3px solid #000;background:#fff"

MOUNT = r"""async ([body, zoom, options]) => {
    const { RenderSurface } = await import('/plauna/render/RenderSurface.js');
    document.body.style.margin = '0';
    if (zoom) document.body.style.zoom = zoom;
    document.body.innerHTML = body;
    const surface = new RenderSurface({ mode: 'gpu', worker: false, ...options });
    document.getElementById('stage').append(surface.element);
    surface.mount(document.createElement('div')).innerHTML = window.__scene;
    await surface.ready;
    window.__surface = surface;
    return surface.activeMode;
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
    return surface.activeMode;
}"""

SCROLL = r"""async ([which, top, left]) => {
    const el = which === 'doc' ? document.scrollingElement : document.getElementById(which);
    el.scrollTop = top;
    el.scrollLeft = left;
    return [el.scrollTop, el.scrollLeft];
}"""

# The surface's box of each sticky element against the browser's rect, in scene px
POSITIONS = r"""() => {
    const surface = window.__surface;
    const scene = surface.scene.getBoundingClientRect();
    const z = surface.scene.currentCSSZoom || 1;
    const out = {};
    for (const id of ['st', 'sl', 'sb']) {
        const el = document.getElementById(id);
        const r = el.getBoundingClientRect();
        const box = surface.layout.boxes.get(el);
        out[id] = { dom: [(r.left - scene.left) / z, (r.top - scene.top) / z], ours: box ? [box.absX, box.absY] : null };
    }
    return out;
}"""

SET_MODE = "async (mode) => { await window.__surface.setMode(mode); return window.__surface.activeMode; }"


@dataclass(frozen=True)
class Case:
    name: str
    body: str
    steps: tuple                # (element id or 'doc', scrollTop, scrollLeft)
    zoom: str = ""
    options: tuple = ()         # RenderSurface options as pairs


def stage(width=300, style=""):
    return f'<div id="stage" style="width:{width}px;{style}"></div>'


CASES = [
    Case("outer scroller", f'<div id="outer" style="{OUTER};overflow:auto"><div style="height:23px"></div>{stage()}<div style="height:900px"></div></div>',
         (("outer", 0, 0), ("outer", 37.5, 0), ("outer", 140, 60.25), ("outer", 400, 120))),
    Case("overflow hidden scroller", f'<div id="outer" style="{OUTER};overflow:hidden"><div style="height:23px"></div>{stage()}<div style="height:900px"></div></div>',
         (("outer", 140, 30), ("outer", 400, 120))),
    Case("outer scroller under body zoom", f'<div id="outer" style="{OUTER};overflow:auto"><div style="height:23px"></div>{stage()}<div style="height:900px"></div></div>',
         (("outer", 37.5, 0), ("outer", 140, 60.25)), zoom="1.25"),
    Case("worker-painted surface", f'<div id="outer" style="{OUTER};overflow:auto"><div style="height:23px"></div>{stage()}<div style="height:900px"></div></div>',
         (("outer", 140, 60.25), ("outer", 400, 0)), options=(("worker", True),)),
    Case("the page", f'<div style="height:31px"></div>{stage(style="margin-left:13.5px")}<div style="height:1500px"></div>',
         (("doc", 0, 0), ("doc", 37.5, 0), ("doc", 140, 30), ("doc", 400, 60))),
    # An absolutely positioned box skips the static scroller it sits in: the page scrolls it
    Case("absolute box in a static scroller", (
        '<div style="position:relative;height:2000px"><div id="outer" style="overflow:auto;height:220px;width:400px;background:#fff">'
        f'{stage(style="position:absolute;top:0;left:0")}<div style="height:900px"></div></div></div>'),
         (("outer", 140, 0), ("doc", 140, 0))),
    # A fixed box sticks within the transformed scroller that contains it
    Case("fixed box in a transformed scroller", (
        '<div style="height:2000px"><div id="outer" style="overflow:auto;height:220px;width:400px;transform:translateX(0);background:#fff">'
        f'{stage(style="position:fixed;top:30px;left:0")}<div style="height:900px"></div></div></div>'),
         (("outer", 140, 0), ("doc", 140, 0))),
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
                # Classic scrollbars shown: they come off the view sticky boxes stick within
                browser = cls.playwright.chromium.launch(executable_path=executable, headless=True, args=args,
                                                         ignore_default_args=["--hide-scrollbars"])
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
        page.evaluate("(scene) => { window.__scene = scene; }", SCENE)
        return page, errors

    @staticmethod
    def shot(page):
        import numpy as np
        from PIL import Image
        return np.asarray(Image.open(io.BytesIO(page.screenshot())).convert("RGB"), dtype=np.int16)

    def mount(self, page, case):
        mode = page.evaluate(MOUNT, [case.body, case.zoom, dict(case.options)])
        if mode != "gpu":
            raise SkipTest("WebGPU is not available in this Chrome")
        page.evaluate(SETTLE)


class StickyViewParity(Base):
    def check(self, case, scale):
        import numpy as np
        page, errors = self.open(scale)
        self.mount(page, case)
        problems = []
        for which, top, left in case.steps:
            # Scrolled in GPU mode: the frames painted as it scrolls must follow
            page.evaluate(SCROLL, [which, top, left])
            mode = page.evaluate(SETTLE)
            if mode != "gpu":
                problems.append(f"{which} {top},{left}: mode {mode}")
                continue
            for name, at in page.evaluate(POSITIONS).items():
                if at["ours"] is None:
                    problems.append(f"{which} {top},{left}: #{name} has no box")
                    continue
                off = max(abs(a - b) for a, b in zip(at["ours"], at["dom"]))
                if off > POSITION_LIMIT:
                    problems.append(f"{which} {top},{left}: #{name} at {at['ours']}, the browser's at {at['dom']}")
            gpu = self.shot(page)
            page.evaluate(SET_MODE, "dom")
            page.evaluate(SETTLE)
            dom = self.shot(page)
            if page.evaluate(SET_MODE, "gpu") != "gpu":
                problems.append("could not go back to GPU mode")
                break
            page.evaluate(SETTLE)
            diff = np.abs(dom - gpu).max(axis=2)
            off = int((diff > PIXEL_LIMIT).sum())
            if off:
                ys, xs = np.nonzero(diff > PIXEL_LIMIT)
                problems.append(f"{which} {top},{left}: {off} px off by more than {PIXEL_LIMIT} (max {int(diff.max())}) in "
                                f"{int(xs.min())},{int(ys.min())}..{int(xs.max())},{int(ys.max())}")
        if errors:
            problems.append(f"errors: {errors[:3]}")
        return problems

    def test_sticky_boxes_follow_what_scrolls_above_the_scene(self):
        failures = []
        for case in CASES:
            for scale in SCALES:
                failures += [f"{scale}x {case.name}: {problem}" for problem in self.check(case, scale)]
        self.assertEqual(failures, [])


class StickyViewBehaviour(Base):
    def test_a_scroll_above_lays_out_only_with_a_box_that_sticks_there(self):
        page, errors = self.open()
        # The sticky box sticks within a scroller in the scene, not above it
        page.evaluate("""() => { window.__scene = '<div style="height:80px;overflow:auto"><div style="position:sticky;top:0;height:10px;background:#d22"></div>'
            + '<div style="height:300px;background:#357"></div></div><div style="height:700px;background:#b84"></div>'; }""")
        self.mount(page, CASES[0])
        layouts = page.evaluate("window.__surface.stats.layouts")
        page.evaluate(SCROLL, ["outer", 140, 0])
        page.evaluate(SETTLE)
        self.assertEqual(page.evaluate("window.__surface.stats.layouts"), layouts, "a scroll above the scene laid it out again")
        self.assertFalse(page.evaluate("window.__surface.viewSticky"))
        # A box that sticks within the view above: a scroll lays out again
        page.evaluate("""() => {
            const box = document.createElement('div');
            box.id = 'late';
            box.style.cssText = 'position:sticky;top:3px;height:8px;background:#2c2';
            // (first: scrolled past, it sticks to the top of the view)
            window.__surface.scene.firstElementChild.prepend(box);
        }""")
        page.evaluate(SETTLE)
        self.assertTrue(page.evaluate("window.__surface.viewSticky"))
        page.evaluate(SCROLL, ["outer", 500, 0])
        page.evaluate(SETTLE)
        at = page.evaluate("""() => {
            const surface = window.__surface;
            const el = document.getElementById('late');
            return [surface.layout.boxes.get(el).absY, el.getBoundingClientRect().top - surface.scene.getBoundingClientRect().top];
        }""")
        self.assertGreater(at[1], 100, f"the late box does not stick in this case: {at}")
        self.assertAlmostEqual(at[0], at[1], delta=POSITION_LIMIT, msg=f"the late sticky box did not follow the scroll: {at}")
        self.assertEqual(errors, [])

    def test_a_scroll_elsewhere_lays_out_nothing(self):
        # One surface per window: a list scrolled in one window moves nothing in another
        page, errors = self.open()
        body = (f'<div id="outer" style="{OUTER};overflow:auto"><div style="height:23px"></div>{stage()}<div style="height:900px"></div></div>'
                '<div id="other" style="position:absolute;left:470px;top:10px;width:150px;height:200px;overflow:auto">'
                '<div style="height:2000px;background:linear-gradient(#fff,#000)"></div></div>')
        self.mount(page, Case("beside another scroller", body, ()))
        self.assertTrue(page.evaluate("window.__surface.viewSticky"), "the scene must hold a box that sticks within the view above")
        counts = "[window.__surface.stats.layouts, window.__surface.stats.frames]"
        before = page.evaluate(counts)
        for step in range(1, 11):
            page.evaluate(SCROLL, ["other", 37 * step, 0])
            page.evaluate("new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))")
        page.evaluate(SETTLE)
        self.assertEqual(page.evaluate(counts), before, "a scroll that does not move the surface laid it out or painted it")
        # A scroll above it still lays out
        page.evaluate(SCROLL, ["outer", 140, 0])
        page.evaluate(SETTLE)
        self.assertGreater(page.evaluate(counts)[0], before[0])
        self.assertEqual(errors, [])

    def test_a_scroll_above_in_a_shadow_tree_is_heard(self):
        # Scroll events do not leave a shadow tree: a scroller there above the scene is heard in it
        page, errors = self.open()
        mode = page.evaluate(r"""async (outer) => {
            const { RenderSurface } = await import('/plauna/render/RenderSurface.js');
            document.body.style.margin = '0';
            document.body.innerHTML = '<div id="shadow-host"></div>';
            const shadow = document.getElementById('shadow-host').attachShadow({ mode: 'open' });
            shadow.innerHTML = `<div id="outer" style="${outer};overflow:auto"><div style="height:23px"></div>`
                + '<div id="stage" style="width:300px"></div><div style="height:900px"></div></div>';
            const surface = new RenderSurface({ mode: 'gpu', worker: false });
            shadow.getElementById('stage').append(surface.element);
            surface.mount(document.createElement('div')).innerHTML = window.__scene;
            await surface.ready;
            window.__surface = surface;
            window.__outer = shadow.getElementById('outer');
            return surface.activeMode;
        }""", OUTER)
        if mode != "gpu":
            raise SkipTest("WebGPU is not available in this Chrome")
        page.evaluate(SETTLE)
        problems = []
        for top in (37.5, 140, 400):
            page.evaluate("(top) => { window.__outer.scrollTop = top; }", top)
            page.evaluate(SETTLE)
            at = page.evaluate("""() => {
                const surface = window.__surface;
                const el = surface.scene.querySelector('#st');
                return [surface.layout.boxes.get(el).absY, el.getBoundingClientRect().top - surface.scene.getBoundingClientRect().top];
            }""")
            if abs(at[0] - at[1]) > POSITION_LIMIT:
                problems.append(f"scrolled to {top}: #st at {at[0]}, the browser's at {at[1]}")
        self.assertEqual(problems, [])
        self.assertEqual(errors, [])

    def test_a_texture_only_surface_has_no_sticky_view(self):
        page, errors = self.open()
        result = page.evaluate(r"""async () => {
            const { RenderSurface } = await import('/plauna/render/RenderSurface.js');
            const shown = new RenderSurface({ mode: 'dom' });
            const texture = new RenderSurface({ mode: 'dom', present: false });
            document.body.append(shown.element, texture.element);
            const out = { shown: shown.stickyView(), texture: texture.stickyView() };
            shown.destroy();
            texture.destroy();
            return out;
        }""")
        self.assertIsNone(result["texture"])
        self.assertIsNotNone(result["shown"])
        self.assertEqual(errors, [])


if __name__ == "__main__":
    main()
