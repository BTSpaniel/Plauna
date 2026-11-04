# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""What the layout lane's rules look like, DOM against GPU, at real scale factors.

Each case is mounted in a RenderSurface in a DOM page and in a GPU page: a
shadow host (the Control Panel's blocker: its box must have its size and its
shadow tree must paint), slots, sticky boxes at scroll offsets, absolute and
fixed boxes in contained parents, -webkit-line-clamp with its ellipsis (aligned
lines, padded or sized blocks round the clamped line, a formatting context
root past it), text in a styled slot or a
display: contents element, and spans as containing blocks. The
surface's box of each probed element must match its DOM rect, and the pixels
must match (no channel off by more than 24), with Playwright's default hidden
scrollbars, so bars are not at stake here (tests/test_plauna_layout_scrollbars.py
checks where they go).
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

PAGE = "/__plauna_layout_paint__.html"
HTML = "<!doctype html><meta charset=utf-8><body></body>"
SCALES = (1, 1.25, 1.5, 2)
TEXT = "one two three four five six seven eight nine ten eleven twelve"
SCROLLER = "position:relative;overflow:auto;width:200px;height:90px;border:2px solid #444;background:#eef;font:13px Arial"
CLAMP = "display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;width:150px;font:13px Arial;background:#eef"
LONG = TEXT + " thirteen fourteen fifteen"


@dataclass(frozen=True)
class Case:
    name: str
    html: str
    scroll: tuple = (0, 0)
    size: tuple = (0, 0)    # the host's (0: from its rect)


CASES = [
    Case("shadow host", '<div id="probe" style="width:360px"><template shadowrootmode="open"><style>:host { display: block; padding: 4px; background: #dde; font: 13px Arial }'
         ' .panel { height: 120px; border: 1px solid #333; display: grid; grid-template-columns: 80px 1fr; background: #fff } .side { background: #889; color: #fff; padding: 4px } h2 { margin: 0 0 6px; font-size: 15px }</style>'
         '<div class="panel"><nav class="side">nav</nav><main><h2>Title</h2><p style="margin:0">Body text in the shadow tree</p></main></div></template>light text never shown</div>'),
    Case("slots and fallback", '<div id="probe" style="font:13px Arial;background:#fff"><template shadowrootmode="open"><style>:host { display: block; border: 2px solid #666 } ::slotted(p) { margin: 3px 0; color: #a22 }'
         ' slot[name=title] { display: block; padding: 5px; background: #eed } main { display: flex; gap: 4px }</style><header><slot name="title">fallback title</slot></header><main><slot></slot></main>'
         '<footer><slot name="none"><b style="color:#262">fallback footer</b></slot></footer></template><p slot="title">Titled</p><p>one</p><p>two</p>text node</div>'),
    Case("nested shadow trees", '<div id="probe" style="font:13px Arial;background:#fff"><template shadowrootmode="open"><style>.inner { padding: 6px; border: 1px solid #333; background: #efe }</style>'
         '<div class="inner"><template shadowrootmode="open"><style>:host { display: block } div { height: 14px; background: #fcc }</style><div>inner</div><slot></slot></template><slot></slot></div></template>'
         '<span style="display:inline-block;width:50px;height:12px;background:#88f">slotted</span></div>'),
    Case("sticky at rest", f'<div id="probe" style="{SCROLLER}"><div style="height:40px">above</div><div style="position:sticky;top:0;background:#fda">sticky header</div><div style="height:300px">below</div></div>'),
    Case("sticky scrolled", f'<div id="probe" style="{SCROLLER}"><div style="height:40px">above</div><div style="position:sticky;top:0;background:#fda">sticky header</div><div style="height:300px">below</div></div>', (0, 90)),
    Case("sticky held by its block", f'<div id="probe" style="{SCROLLER}"><div style="height:60px;background:#dfd"><div style="position:sticky;top:0;background:#fda">sticky</div></div><div style="height:300px">below</div></div>', (0, 50)),
    Case("sticky table header", f'<div id="probe" style="{SCROLLER}"><table style="border-spacing:0;width:100%"><thead><tr><th style="position:sticky;top:0;background:#fda">Head</th><th style="position:sticky;top:0;background:#fda">H2</th></tr></thead>'
         f'<tbody>{"".join(f"<tr><td>row {i}</td><td>v</td></tr>" for i in range(20))}</tbody></table></div>', (0, 75)),
    Case("fixed in a contained parent", '<div id="probe" style="position:relative;contain:layout;width:300px;height:100px;background:#eef;margin-left:20px"><div style="position:fixed;left:10px;top:15px;width:60px;height:30px;background:#c55"></div>'
         '<div style="position:absolute;right:10px;bottom:15px;width:60px;height:30px;background:#5c5"></div></div>'),
    Case("fixed in a filtered parent", '<div id="probe" style="filter:brightness(1);width:300px;height:100px;background:#eef;margin-left:20px"><div style="position:fixed;left:10px;top:15px;width:60px;height:30px;background:#c55"></div></div>'),
    Case("line clamp", f'<div id="probe" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;width:150px;font:13px Arial;background:#eef">{TEXT}</div>'),
    Case("line clamp over blocks", '<div id="probe" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;width:150px;font:13px Arial;background:#eef"><p style="margin:0">first para</p><p style="margin:0">second para here and more words after</p><p style="margin:0">third</p></div>'),
    # Aligned clamped lines: cut and ellipsis where the line would sit
    # unaligned, so a right-aligned line hides its ellipsis past the edge
    Case("line clamp aligned right", f'<div id="probe" style="{CLAMP};text-align:right">{TEXT}</div>'),
    Case("line clamp aligned right and cut", f'<div id="probe" style="{CLAMP};text-align:right;width:118px">{LONG}</div>'),
    Case("line clamp centred, ellipsis at the edge", f'<div id="probe" style="{CLAMP};text-align:center;width:130px">{LONG}</div>'),
    # The blocks around the clamped line keep their padding and border
    Case("line clamp in padded blocks", f'<div id="probe" style="{CLAMP}"><div style="padding:3px;border-bottom:2px solid #444"><div style="padding:5px;border:2px solid #844;margin-bottom:9px">{TEXT}</div></div></div><div style="height:6px;width:150px;background:#c88"></div>'),
    Case("line clamp with nothing after", f'<div id="probe" style="{CLAMP}"><div style="padding-bottom:3px;background:#dde"><div style="padding:5px;border-bottom:2px solid #844;margin-bottom:9px">one two three four five six</div></div></div><div style="height:6px;width:150px;background:#c88"></div>'),
    Case("line clamp, then an empty block", f'<div id="probe" style="{CLAMP}"><div style="padding:5px;margin-bottom:9px">one two three four five six</div>'
         '<div style="height:10px;background:#c88"></div></div>'),
    # A formatting context root past the line makes the clamp cut too, and
    # the block holding the line keeps its own height
    Case("line clamp, then a flex block", f'<div id="probe" style="{CLAMP}"><div style="padding:5px;background:#dde;margin-bottom:6px">one two three four five six</div>'
         '<div style="display:flex;background:#c88">footer</div></div><div style="height:6px;width:150px;background:#88c"></div>'),
    Case("line clamp in a block of fixed height", f'<div id="probe" style="{CLAMP}"><div style="height:50px;padding:5px;border-bottom:2px solid #844;background:#dde">{TEXT}</div>'
         '<div>x</div></div><div style="height:6px;width:150px;background:#88c"></div>'),
    # Text in a styled slot or a display: contents element
    Case("styled slot text", '<div id="probe" style="font:13px Arial;background:#fff"><template shadowrootmode="open"><style>slot { font-size: 24px; line-height: 34px; color: #239 }'
         ' .wrap { border: 1px solid #444 }</style><div class="wrap">before <slot></slot> after</div></template>slotted words</div>'),
    Case("display contents text", '<div id="probe" style="font:13px Arial;width:200px;background:#eef">x <span style="display:contents;font-size:22px;line-height:30px;color:#a22">contents words that wrap</span> tail</div>'),
    # Inline boxes as containing blocks
    Case("spans as containing blocks", '<div id="probe" style="position:relative;font:13px Arial;width:220px;background:#eef;padding:10px">text before <span style="position:relative;padding:0 4px;border:2px solid #444">relative words that wrap'
         '<i style="position:absolute;left:0;top:0;width:100%;height:100%;background:rgba(200,80,80,.4)"></i><i style="position:absolute;right:2px;bottom:1px;width:6px;height:6px;background:#22a"></i> onto the next line</span> tail'
         ' <span style="filter:brightness(1);border:1px solid #484">filtered<i style="position:fixed;left:3px;top:2px;width:8px;height:5px;background:#2a2"></i></span>'
         ' <span style="transform:translateX(0)">no block<i style="position:absolute;right:0;top:0;width:5px;height:5px;background:#a2a"></i></span></div>'),
]

MOUNT = r"""async ([mode, html, scroll]) => {
    const { RenderSurface } = await import('/plauna/render/RenderSurface.js');
    document.body.style.cssText = 'margin:0;background:#fff';
    document.body.innerHTML = '<div id="stage" style="position:relative;width:500px;padding:20px"></div>';
    const surface = new RenderSurface({ mode, worker: false });
    document.getElementById('stage').append(surface.element);
    await surface.ready;
    const host = surface.mount(document.createElement('div'));
    host.style.padding = '10px';
    host.setHTMLUnsafe(html);
    const probe = host.querySelector('#probe');
    probe.scrollLeft = scroll[0];
    probe.scrollTop = scroll[1];
    window.__surface = surface;
    window.__probe = probe;
    await new Promise((r) => setTimeout(r, 200));
    for (let i = 0; i < 8; i++) await new Promise((r) => requestAnimationFrame(r));
    const r = host.getBoundingClientRect();
    return { mode: surface.activeMode, rect: [r.left, r.top, r.width, r.height] };
}"""

# Each element of the flat tree below the surface's scene against its box
BOXES = r"""() => {
    const surface = window.__surface;
    surface.relayout();
    const boxes = surface.layout.boxes;
    const scene = surface.scene.getBoundingClientRect();
    const out = [];
    const walk = (el) => {
        const box = boxes.get(el);
        const r = el.getBoundingClientRect();
        if (box && box.outer !== 'inline') {
            const err = Math.max(Math.abs(box.absX - (r.left - scene.left)), Math.abs(box.absY - (r.top - scene.top)), Math.abs(box.width - r.width), Math.abs(box.height - r.height));
            if (err > 0.02) out.push([el.localName, +(r.left - scene.left).toFixed(2), +(r.top - scene.top).toFixed(2), +r.width.toFixed(2), +r.height.toFixed(2), +box.absX.toFixed(2), +box.absY.toFixed(2), +box.width.toFixed(2), +box.height.toFixed(2)]);
        } else if (!box && getComputedStyle(el).display !== 'contents' && el.getClientRects().length && !['style', 'template', 'option'].includes(el.localName)) {
            out.push([el.localName, 'not laid out']);
        }
        let children = el.shadowRoot ? [...el.shadowRoot.children] : [...el.children];
        if (el.localName === 'slot' && el.assignedNodes().length) children = el.assignedElements();
        for (const child of children) walk(child);
    };
    walk(window.__probe);
    return out;
}"""


class PlaunaLayoutPaintParityTests(TestCase):
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
                        f"--force-device-scale-factor={scale}", "--window-size=620,300"]
                browser = cls.playwright.chromium.launch(executable_path=executable, headless=True, args=args)
                cls.resources.callback(browser.close)
                cls.browsers[scale] = browser
        except BaseException:
            cls.resources.close()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.resources.close()

    def shoot(self, scale, mode, case):
        import numpy as np
        from PIL import Image
        context = self.browsers[scale].new_context(no_viewport=True, service_workers="block")
        try:
            context.route(f"{self.origin}{PAGE}", lambda route: route.fulfill(body=HTML, content_type="text/html"))
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(f"{self.origin}{PAGE}")
            mounted = page.evaluate(MOUNT, [mode, case.html, list(case.scroll)])
            if mode == "gpu" and mounted["mode"] != "gpu":
                raise SkipTest("WebGPU is not available in this Chrome")
            boxes = page.evaluate(BOXES) if mode == "gpu" else []
            image = np.asarray(Image.open(io.BytesIO(page.screenshot())).convert("RGB"), dtype=np.int16)
            self.assertEqual(errors, [])
            return image, mounted["rect"], boxes
        finally:
            context.close()

    def test_layout_and_pixels_match(self):
        import numpy as np
        failures = []
        for scale in SCALES:
            for case in CASES:
                dom, rect, _ = self.shoot(scale, "dom", case)
                gpu, _, boxes = self.shoot(scale, "gpu", case)
                if boxes:
                    failures.append(f"{scale:g}x {case.name}: boxes differ {boxes[:3]}")
                x, y, w, h = rect
                x0, y0 = max(0, int((x - 6) * scale)), max(0, int((y - 6) * scale))
                x1, y1 = int((x + w + 6) * scale) + 1, int((y + h + 6) * scale) + 1
                diff = np.abs(dom[y0:y1, x0:x1] - gpu[y0:y1, x0:x1]).max(axis=2)
                off = int((diff > 24).sum())
                if off:
                    failures.append(f"{scale:g}x {case.name}: {off} pixels differ (max {int(diff.max())})")
        self.assertEqual(failures, [])


if __name__ == "__main__":
    main()
