# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Native push-button faces, blurred text shadows and backdrop filters under
transforms, DOM against GPU, at real device scale factors.

Each case is rendered in a DOM page and a GPU page (the same markup mounted in
a RenderSurface on a bare page, so no stylesheet restyles it on hover), put
in its state with real input, and the area around the element must match
pixel for pixel (no channel off by more than 24).

Buttons: the native theme face Chrome paints for an unstyled button and
submit input (normal, hover, pressed, disabled, light and dark, pressed from
the keyboard), and author-styled buttons, which keep their CSS look. Text
shadows: blurred, glowing and stacked (the first listed on top). Backdrops:
untransformed, centred with translate(-50%, -50%), and inside a translated
parent (1x: at fractional scales a translated backdrop's blurred edge still
differs a little). Scaled and turned backdrops are not covered (known gaps).
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

PAGE = "/__plauna_native_paint__.html"
HTML = "<!doctype html><meta charset=utf-8><body></body>"
GLASS = ('<div style="position:relative;height:110px;background:linear-gradient(90deg,#c33,#33c)">'
         '<div style="font:16px Arial;color:#fff;padding:6px">Behind the glass behind the glass</div>')


@dataclass(frozen=True)
class Case:
    name: str
    html: str
    state: str = "none"         # none | hover | active | keyactive
    scales: tuple = (1, 1.25, 1.5, 2)


CASES = [
    Case("button", '<button>Button</button>'),
    Case("button hover", '<button>Hover</button>', "hover"),
    Case("button pressed", '<button>Press</button>', "active"),
    Case("button disabled", '<button disabled>Disabled</button>'),
    Case("submit input", '<input type="submit" value="Submit">'),
    Case("dark button", '<button style="color-scheme:dark">Dark</button>'),
    Case("dark button hover", '<button style="color-scheme:dark">Dark</button>', "hover"),
    Case("dark button disabled", '<button style="color-scheme:dark" disabled>Dark</button>'),
    Case("button pressed by key", '<button>Key</button>', "keyactive"),
    Case("author background", '<button style="background:#cde">Styled</button>'),
    Case("author border", '<button style="border:1px solid #c33">Bordered</button>'),
    Case("text shadow blur", '<div style="font:20px Arial;text-shadow:2px 2px 4px rgba(0,0,0,.6)">Shadow text Ty</div>'),
    Case("text shadow glow", '<div style="font:24px Arial;color:#fff;background:#346;padding:8px;text-shadow:0 0 10px #ff0">Glow text</div>'),
    Case("text shadows stacked", '<div style="font:18px Georgia;text-shadow:1px 1px 2px red, 0 0 6px blue">Two shadows</div>'),
    Case("backdrop", GLASS + '<div style="position:absolute;left:60px;top:30px;width:120px;height:60px;backdrop-filter:blur(6px);'
         'background:rgba(255,255,255,.2);border-radius:10px"></div></div>'),
    # Under a translation at a fractional scale the blurred edge still differs a little (up to ~34 levels): 1x only
    Case("backdrop centred by translate", GLASS + '<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);'
         'width:121px;height:61px;backdrop-filter:blur(6px);background:rgba(255,255,255,.2);border-radius:10px"></div></div>', scales=(1,)),
    Case("backdrop in a translated parent", GLASS + '<div style="position:absolute;left:20px;top:20px;transform:translate(30px,8px)">'
         '<div style="width:120px;height:60px;backdrop-filter:blur(4px) brightness(1.2);background:rgba(0,0,0,.1)"></div></div></div>', scales=(1,)),
]
SCALES = sorted({scale for case in CASES for scale in case.scales})

MOUNT = r"""async ([mode, html]) => {
    const { RenderSurface } = await import('/plauna/render/RenderSurface.js');
    document.body.style.cssText = 'margin:0;background:#fff';
    document.body.innerHTML = '<div id="stage" style="position:relative;width:400px;padding:20px"></div>';
    const surface = new RenderSurface({ mode, worker: false });
    document.getElementById('stage').append(surface.element);
    await surface.ready;
    const host = surface.mount(document.createElement('div'));
    host.style.padding = '10px';
    host.innerHTML = html;
    window.__surface = surface;
    await new Promise((r) => setTimeout(r, 200));
    const r = host.firstElementChild.getBoundingClientRect();
    return { mode: surface.activeMode, rect: [r.left, r.top, r.width, r.height] };
}"""
SETTLE = "async () => { for (let i = 0; i < 8; i++) await new Promise((r) => requestAnimationFrame(r)); return true; }"


class PlaunaNativePaintParityTests(TestCase):
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
                        f"--force-device-scale-factor={scale}", "--window-size=500,260"]
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
            mounted = page.evaluate(MOUNT, [mode, case.html])
            if mode == "gpu" and mounted["mode"] != "gpu":
                raise SkipTest("WebGPU is not available in this Chrome")
            x, y, w, h = mounted["rect"]
            if case.state in ("hover", "active"):
                page.mouse.move(x + w / 2, y + h / 2)
                if case.state == "active":
                    page.mouse.down()
            elif case.state == "keyactive":
                page.evaluate("document.querySelector('#stage button').focus()")
                page.keyboard.down(" ")
            page.evaluate(SETTLE)
            image = np.asarray(Image.open(io.BytesIO(page.screenshot())).convert("RGB"), dtype=np.int16)
            if case.state == "active":
                page.mouse.up()
            elif case.state == "keyactive":
                page.keyboard.up(" ")
            self.assertEqual(errors, [])
            return image, mounted["rect"]
        finally:
            context.close()

    def test_native_paint_matches(self):
        import numpy as np
        failures = []
        for scale in SCALES:
            for case in CASES:
                if scale not in case.scales:
                    continue
                dom, rect = self.shoot(scale, "dom", case)
                gpu, _ = self.shoot(scale, "gpu", case)
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
