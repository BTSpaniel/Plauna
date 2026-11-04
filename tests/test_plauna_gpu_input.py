# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Real mouse, keyboard and wheel input on Plauna widgets painted by WebGPU.

In GPU mode the scene stays in the page at opacity 0 and receives native
input; the canvas on top paints Plauna's own layout. Screenshots therefore
show only what the GPU painted, so every visual assertion here checks that a
real input both reached the widget and changed the painted frame.
"""

import hashlib
import sys
from contextlib import ExitStack, contextmanager
from pathlib import Path
from unittest import SkipTest, TestCase, main

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from plauna_browser_support import chrome_path, performance_run_lock, sdk_server

PAGE = "/tests/plauna-gpu-input.html"


class PlaunaGpuInputTests(TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            from playwright.sync_api import sync_playwright
            executable = chrome_path()
        except (ImportError, ValueError) as error:
            raise SkipTest(str(error)) from error
        cls.resources = ExitStack()
        try:
            cls.resources.enter_context(performance_run_lock(ROOT))
            cls.origin, _ = cls.resources.enter_context(sdk_server(ROOT))
            cls.playwright = sync_playwright().start()
            cls.resources.callback(cls.playwright.stop)
            cls.browser = cls.playwright.chromium.launch(
                executable_path=executable, headless=True,
                args=["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebGPU"])
            cls.resources.callback(cls.browser.close)
        except BaseException:
            cls.resources.close()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.resources.close()

    @contextmanager
    def visit(self, mode="gpu"):
        diagnostics = {"page": [], "console": [], "http": [], "escaped": []}
        context = self.browser.new_context(viewport={"width": 800, "height": 600}, service_workers="block")
        try:
            def admit(route):
                url = route.request.url
                if url.startswith(self.origin + "/") or url.startswith("data:") or url.startswith("blob:"):
                    route.continue_()
                else:
                    diagnostics["escaped"].append(url)
                    route.abort("blockedbyclient")
            context.route("**/*", admit)
            page = context.new_page()
            page.on("pageerror", lambda error: diagnostics["page"].append(str(error)))
            page.on("console", lambda message: diagnostics["console"].append(message.text) if message.type == "error" else None)
            page.on("response", lambda response: diagnostics["http"].append(response.url) if response.status >= 400 else None)
            page.goto(f"{self.origin}{PAGE}?mode={mode}", wait_until="networkidle")
            page.wait_for_function("globalThis.fixture", timeout=20000)
            if page.evaluate("fixture.mode()") != "gpu":
                raise SkipTest("WebGPU is not available in this Chrome")
            yield page
            self.assertEqual(diagnostics, {"page": [], "console": [], "http": [], "escaped": []})
        finally:
            context.close()

    def shot(self, page, rect, pad=4):
        """Digest of the painted frame over a box (plus a margin for rings)."""
        page.evaluate("fixture.settle()")
        image = page.screenshot(clip={"x": max(0, rect["x"] - pad), "y": max(0, rect["y"] - pad),
                                      "width": rect["width"] + pad * 2, "height": rect["height"] + pad * 2})
        return hashlib.sha256(image).hexdigest()

    def test_scene_is_invisible_and_the_canvas_paints(self):
        with self.visit() as page:
            state = page.evaluate("""() => {
                const s = fixture.surface;
                return {opacity: getComputedStyle(s.scene).opacity, canvas: Boolean(s.gpu?.canvas?.isConnected),
                        pointerEvents: getComputedStyle(s.gpu.canvas).pointerEvents, frames: fixture.frames()};
            }""")
            self.assertEqual(state["opacity"], "0")
            self.assertTrue(state["canvas"])
            self.assertEqual(state["pointerEvents"], "none")
            self.assertGreater(state["frames"], 0)

    def test_real_click_toggles_checkbox_and_repaints(self):
        with self.visit() as page:
            box = page.evaluate("fixture.checkbox()")
            self.assertFalse(box["checked"])
            before = self.shot(page, box["rect"])
            page.mouse.click(box["centre"]["x"], box["centre"]["y"])
            self.assertTrue(page.evaluate("fixture.checkbox().checked"))
            self.assertNotEqual(self.shot(page, box["rect"]), before)
            page.mouse.click(box["centre"]["x"], box["centre"]["y"])
            self.assertFalse(page.evaluate("fixture.checkbox().checked"))

    def test_real_typing_reaches_the_input_and_paints_its_text(self):
        with self.visit() as page:
            field = page.evaluate("fixture.field()")
            page.mouse.click(field["centre"]["x"], field["centre"]["y"])
            self.assertTrue(page.evaluate("fixture.field().focused"))
            page.mouse.move(5, 5)
            empty = self.shot(page, field["rect"])
            page.keyboard.type("Atrium")
            self.assertEqual(page.evaluate("fixture.field().value"), "Atrium")
            self.assertNotEqual(self.shot(page, field["rect"]), empty)
            page.keyboard.press("Backspace")
            self.assertEqual(page.evaluate("fixture.field().value"), "Atriu")

    def test_tab_moves_focus_and_the_focus_ring_is_painted(self):
        with self.visit() as page:
            field = page.evaluate("fixture.field()")
            button = page.evaluate("fixture.button()")
            page.mouse.click(field["centre"]["x"], field["centre"]["y"])
            page.mouse.move(5, 5)
            unfocused = self.shot(page, button["rect"])
            page.keyboard.press("Tab")
            self.assertEqual(page.evaluate("fixture.active()"), "BUTTON")
            self.assertNotEqual(self.shot(page, button["rect"]), unfocused)

    def test_real_click_activates_the_button(self):
        with self.visit() as page:
            button = page.evaluate("fixture.button()")
            page.mouse.click(button["centre"]["x"], button["centre"]["y"])
            self.assertEqual(page.evaluate("fixture.button().clicks"), 1)

    def test_hover_restyles_through_style_sheet_rules(self):
        with self.visit() as page:
            chip = page.evaluate("fixture.chip()")
            page.mouse.move(5, 5)
            resting = self.shot(page, chip["rect"])
            page.mouse.move(chip["centre"]["x"], chip["centre"]["y"])
            self.assertTrue(page.evaluate("fixture.chip().hovered"))
            hovered = self.shot(page, chip["rect"])
            self.assertNotEqual(hovered, resting)
            page.mouse.move(5, 5)
            self.assertEqual(self.shot(page, chip["rect"]), resting)

    def test_circular_progress_paints_without_console_errors(self):
        # Chrome reports an SVG attribute it cannot parse itself, so console.error
        # hooks never see it; visit() collects the page's console events
        with self.visit() as page:
            self.assertTrue(page.evaluate("fixture.circularProgress()"))

    def test_wheel_scrolls_the_container_and_the_rows_move(self):
        with self.visit() as page:
            scroller = page.evaluate("fixture.scroller()")
            self.assertEqual(scroller["scrollTop"], 0)
            before = self.shot(page, scroller["rect"])
            page.mouse.move(scroller["centre"]["x"], scroller["centre"]["y"])
            page.mouse.wheel(0, 120)
            page.wait_for_function("fixture.scroller().scrollTop > 0")
            self.assertNotEqual(self.shot(page, scroller["rect"]), before)


if __name__ == "__main__":
    main()
