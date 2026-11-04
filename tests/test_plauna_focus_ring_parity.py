# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Keyboard focus rings, DOM against GPU, at real device scale factors.

Each case is focused with real input on a DOM page and on a GPU page (the
same markup mounted in a RenderSurface), and the area around the focused
element must match pixel for pixel (no channel off by more than 24). Each case
brings only the style rules it needs; a case marked bare has no :hover,
:focus or :focus-visible rule at all (checked in the page), so its ring can
only come from the surface's own focus and key restyles, not from a state rule.
The page is mid-grey so both contrast rings (white, and #101010 in a dark
scheme) differ from it by far more than the threshold.

Covers the UA ring (rounded, offset, coloured, bordered, dark scheme, native
textarea and colour-well radii), negative offsets down to an empty rect (also
at a half pixel at 1.5x), author outlines that transition on :focus-visible
(directly, and through currentcolor), a key press after mouse focus (which
turns :focus-visible on), also when the target's key handler stops
propagation and after a spell in DOM mode, and a color-scheme change while
focused. Native buttons are author-styled: Chrome's themed push-button face is
not what these checks compare.
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

PAGE = "/__plauna_focus_ring__.html"
HTML = "<!doctype html><meta charset=utf-8><body></body>"
BASE_CSS = "#stage button{appearance:none;border:1px solid #666;background:#ddd;padding:2px 8px;font:13px Arial}"
BOX = "width:100px;height:40px;background:#808080"
SMALL = "width:20px;height:20px;background:#808080"


@dataclass(frozen=True)
class Case:
    name: str
    html: str
    how: str = "tab"            # tab | click-key | mode-cycle | tab-scheme
    wait: int = 0               # ms after focusing (transitions)
    css: str = ""               # rules this case needs, on top of BASE_CSS
    bare: bool = True           # no state rules: checked in the page
    visible: bool = True        # the element matches :focus-visible
    scales: tuple = (1, 2)


CASES = [
    Case("div", f'<div tabindex="0" style="{BOX}"></div>'),
    Case("button", '<button>Focus me</button>'),
    Case("radius", f'<div tabindex="0" style="{BOX};border-radius:8px"></div>'),
    Case("offset", f'<div tabindex="0" style="{BOX};outline-offset:4px"></div>'),
    Case("author colour", f'<div tabindex="0" class="red" style="{BOX}"></div>', css=".red:focus-visible{outline-color:red}", bare=False),
    Case("outline none", f'<div tabindex="0" class="none" style="{BOX}"></div>', css=".none:focus{outline:none}", bare=False),
    Case("bordered", f'<div tabindex="0" style="{BOX};border:2px solid #333"></div>'),
    Case("dark scheme", f'<div tabindex="0" style="{BOX};color-scheme:dark"></div>'),
    # No caret (it blinks) and no resize grip (drawn a device pixel off at 2x)
    Case("textarea", '<textarea style="resize:none;caret-color:transparent">text</textarea>'),
    Case("colour well", '<input type="color" value="#3366cc">'),
    Case("offset -9px", f'<div tabindex="0" style="{SMALL};outline-offset:-9px"></div>'),
    Case("offset -10px", f'<div tabindex="0" style="{SMALL};outline-offset:-10px"></div>'),
    Case("offset -12px", f'<div tabindex="0" style="{SMALL};outline-offset:-12px"></div>'),
    Case("offset -10px bordered", f'<div tabindex="0" style="{SMALL};border:2px solid #333;outline-offset:-10px"></div>'),
    # At 1.5x this half-pixel position leaves +1e-14 of float noise in the snapped width
    Case("offset -10px at a half pixel", '<div tabindex="0" style="width:20px;height:40px;margin-left:30.5px;background:#808080;outline-offset:-10px"></div>', scales=(1.5,)),
    Case("transition", '<button class="tr">Transition</button>', wait=600, bare=False,
         css=".tr{transition:outline-offset .15s,outline-color .15s}.tr:focus-visible{outline:2px solid blue;outline-offset:4px}"),
    # The outline follows a transitioning color through currentcolor
    Case("currentcolor transition", '<button class="cc">Colour</button>', wait=600, bare=False,
         css=".cc{transition:color .3s}.cc:focus-visible{color:red;outline:2px solid currentcolor}"),
    Case("key after click", '<button>Pressed</button>', how="click-key"),
    Case("key after click, handler stops propagation", '<button onkeydown="event.stopPropagation()">Stops</button>', how="click-key"),
    # Keyboard focus in GPU mode, mouse focus during a spell in DOM mode, then a key press back in GPU mode
    Case("key after a DOM-mode spell", '<button>Spell</button>', how="mode-cycle"),
    Case("scheme change", f'<div class="panel"><div tabindex="0" style="{BOX}"></div></div>', how="tab-scheme", css=".panel.dark{color-scheme:dark}"),
]
SCALES = sorted({scale for case in CASES for scale in case.scales})

MOUNT = r"""async ([mode, html, css]) => {
    const { RenderSurface } = await import('/plauna/render/RenderSurface.js');
    document.body.style.cssText = 'margin:0;background:#5a5a5a';
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    document.body.innerHTML = '<div id="stage" style="position:relative;width:400px;padding:30px"></div>';
    const surface = new RenderSurface({ mode, worker: false });
    document.getElementById('stage').append(surface.element);
    await surface.ready;
    const host = surface.mount(document.createElement('div'));
    host.style.padding = '20px';
    host.innerHTML = html;
    window.__surface = surface;
    await new Promise((r) => setTimeout(r, 200));
    return { mode: surface.activeMode, interactive: Boolean(surface.resolver.rules?.interactive) };
}"""
SETTLE = r"""async () => {
    for (let i = 0; i < 11; i++) await new Promise((r) => requestAnimationFrame(r));
    const el = document.activeElement;
    const r = el.getBoundingClientRect();
    return { visible: el.matches(':focus-visible'), rect: [r.left, r.top, r.width, r.height] };
}"""
BUTTON_CENTRE = ("(() => { const r = document.querySelector('#stage button').getBoundingClientRect();"
                 " return [r.left + r.width / 2, r.top + r.height / 2]; })()")


class PlaunaFocusRingParityTests(TestCase):
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
                        f"--force-device-scale-factor={scale}", "--window-size=600,300"]
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
        # The real scale factor (no emulated viewport): Plauna lays out at the display's zoom
        context = self.browsers[scale].new_context(no_viewport=True, service_workers="block")
        try:
            context.route(f"{self.origin}{PAGE}", lambda route: route.fulfill(body=HTML, content_type="text/html"))
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(f"{self.origin}{PAGE}")
            mounted = page.evaluate(MOUNT, [mode, case.html, BASE_CSS + case.css])
            if mode == "gpu" and mounted["mode"] != "gpu":
                raise SkipTest("WebGPU is not available in this Chrome")
            if mode == "gpu" and case.bare:
                self.assertFalse(mounted["interactive"], f"{case.name}: the page has state rules, so a state restyle could bring the ring")
            if case.how == "click-key":
                page.mouse.click(*page.evaluate(BUTTON_CENTRE))
                page.wait_for_timeout(150)
                page.mouse.move(1, 1)
                page.keyboard.press("a")
            elif case.how == "mode-cycle":
                page.keyboard.press("Tab")
                page.wait_for_timeout(150)
                page.evaluate("window.__surface.setMode('dom')")
                page.wait_for_timeout(150)
                page.mouse.click(5, 5)
                page.mouse.click(*page.evaluate(BUTTON_CENTRE))
                page.wait_for_timeout(150)
                page.evaluate(f"window.__surface.setMode('{mode}')")
                page.wait_for_timeout(300)
                page.mouse.move(1, 1)
                page.keyboard.press("Shift")
            else:
                page.keyboard.press("Tab")
            if case.how == "tab-scheme":
                page.wait_for_timeout(150)
                page.evaluate("document.querySelector('.panel').classList.add('dark')")
            if case.wait:
                page.wait_for_timeout(case.wait)
            info = page.evaluate(SETTLE)
            image = np.asarray(Image.open(io.BytesIO(page.screenshot())).convert("RGB"), dtype=np.int16)
            self.assertEqual(errors, [])
            return image, info
        finally:
            context.close()

    def test_focus_rings_match(self):
        import numpy as np
        failures = []
        for scale in SCALES:
            for case in CASES:
                if scale not in case.scales:
                    continue
                dom, info = self.shoot(scale, "dom", case)
                gpu, _ = self.shoot(scale, "gpu", case)
                x, y, w, h = info["rect"]
                x0, y0 = max(0, int((x - 12) * scale)), max(0, int((y - 12) * scale))
                x1, y1 = int((x + w + 12) * scale) + 1, int((y + h + 12) * scale) + 1
                diff = np.abs(dom[y0:y1, x0:x1] - gpu[y0:y1, x0:x1]).max(axis=2)
                off = int((diff > 24).sum())
                if info["visible"] != case.visible:
                    failures.append(f"{scale}x {case.name}: :focus-visible is {info['visible']}, expected {case.visible}")
                if off:
                    failures.append(f"{scale}x {case.name}: {off} pixels differ (max {int(diff.max())})")
        self.assertEqual(failures, [])


if __name__ == "__main__":
    main()
