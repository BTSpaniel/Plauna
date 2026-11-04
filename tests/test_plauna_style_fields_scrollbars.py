# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""StyleResolver's scrollbar fields against the scrollbars Chrome lays out.

Headless Chrome with classic scrollbars visible (Playwright's --hide-scrollbars
dropped) at real device scale factors 1, 1.25, 1.5 and 2 (no emulated
viewport). Each case styles a scroll container with ::-webkit-scrollbar rules
(or with rules Chrome ignores) and measures the room its scrollbars take: an
absolutely positioned child pinned to all four edges fills the padding box,
so the container's border box minus that child's rect is the bar's exact
thickness in layout units.

webkitScrollbar.width / .height must give that thickness as Chrome rounds it:
floor(thickness x scale) device pixels (7.5px is 9 device px at 1.25x, so
7.2 CSS px; measured); the field itself is the CSS thickness before that
flooring. A case whose webkitScrollbar is null must take the room of a plain
scroller with the same scrollbar-width (Chrome draws standard bars then:
scrollbar-width thin or none, scrollbar-color set on it or above it, or no
non-empty ::-webkit-scrollbar rule without a scrollbar state).
"""

import math
import sys
from contextlib import ExitStack
from pathlib import Path
from unittest import SkipTest, TestCase, main

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from plauna_browser_support import chrome_path, sdk_server  # noqa: E402

PAGE = "/__plauna_style_fields_scrollbars__.html"
HTML = "<!doctype html><meta charset=utf-8><body style=margin:0></body>"
SCALES = (1, 1.25, 1.5, 2)

# (id, rules for #id, whether webkitScrollbar is set)
CASES = [
    ("px", "#px::-webkit-scrollbar { width: 8px; height: 6px }", True),
    ("half", "#half::-webkit-scrollbar { width: 7.5px; height: 7.3px }", True),
    ("var", "#var { --w: 11px } #var::-webkit-scrollbar { width: var(--w); height: var(--w) }", True),
    ("em", "#em { font-size: 20px } #em::-webkit-scrollbar { width: 0.5em; height: 0.45em }", True),
    ("limits", "#limits::-webkit-scrollbar { width: 20px; max-width: 12px; height: 2px; min-height: 9px }", True),
    ("percent", "#percent::-webkit-scrollbar { width: 10%; height: 9px }", True),
    ("hidden", "#hidden::-webkit-scrollbar { display: none }", True),
    ("states", "#states::-webkit-scrollbar { width: 8px; height: 10px } #states::-webkit-scrollbar:horizontal { height: 4px }"
               " #states::-webkit-scrollbar:vertical { width: 3px }", True),
    ("important", "#important::-webkit-scrollbar { width: 5px !important; height: 5px } #important::-webkit-scrollbar { width: 9px }", True),
    ("thin", "#thin { scrollbar-width: thin } #thin::-webkit-scrollbar { width: 8px }", False),
    ("none", "#none { scrollbar-width: none } #none::-webkit-scrollbar { width: 8px }", False),
    ("coloured", "#coloured { scrollbar-color: red blue } #coloured::-webkit-scrollbar { width: 8px }", False),
    ("inherits", ".parent { scrollbar-color: red blue } #inherits::-webkit-scrollbar { width: 8px }", False),
    ("thumbonly", "#thumbonly::-webkit-scrollbar-thumb { background: red }", False),
    # Rules with a scrollbar state alone leave native bars; once a stateless
    # rule matches, the state rules apply
    ("honly", "#honly::-webkit-scrollbar:horizontal { height: 4px }", False),
    ("vonly", "#vonly::-webkit-scrollbar:vertical { width: 4px }", False),
    ("enabledonly", "#enabledonly::-webkit-scrollbar:enabled { width: 6px; height: 6px }", False),
    ("thumbstate", "#thumbstate::-webkit-scrollbar-thumb { background: red } #thumbstate::-webkit-scrollbar:horizontal { height: 4px }", False),
    ("emptystate", "#emptystate::-webkit-scrollbar { } #emptystate::-webkit-scrollbar:horizontal { height: 4px }", False),
    ("switched", "#switched::-webkit-scrollbar { background: red } #switched::-webkit-scrollbar:vertical { width: 4px }", True),
    ("plain", "", False),
]
REFERENCES = {"thin": "scrollbar-width: thin", "none": "scrollbar-width: none"}

RUN = r"""async (cases) => {
    const { StyleResolver, inheritedStyleFromHost } = await import('/plauna/render/css/StyleResolver.js');
    const style = document.createElement('style');
    style.textContent = cases.map((c) => c[1]).join('\n')
        + '\n.s { position: relative; overflow: scroll; width: 120px; height: 80px; box-sizing: border-box }'
        + '\n.pin { position: absolute; inset: 0 } .tall { width: 400px; height: 400px }';
    document.head.appendChild(style);
    const box = (id, extra = '') => `<div class="s" id="${id}" style="${extra}"><div class="pin"></div><div class="tall"></div></div>`;
    const refs = { thin: 'scrollbar-width: thin', none: 'scrollbar-width: none' };
    document.body.innerHTML = '<div id="scene">' + cases.map(([id]) => (id === 'inherits' ? `<div class="parent">${box(id)}</div>` : box(id))).join('')
        + box('ref-auto') + Object.entries(refs).map(([id, decl]) => box(`ref-${id}`, decl)).join('') + '</div>';
    const scene = document.getElementById('scene');
    const resolver = new StyleResolver();
    resolver.beginPass();
    const host = inheritedStyleFromHost(scene);
    const styles = new Map();
    const walk = (el, parent) => { const s = resolver.compute(el, parent, host); styles.set(el, s); for (const c of el.children) walk(c, s); };
    for (const c of scene.children) walk(c, null);
    const measure = (el) => {
        const outer = el.getBoundingClientRect();
        const inner = el.querySelector('.pin').getBoundingClientRect();
        return [outer.width - inner.width, outer.height - inner.height];
    };
    const out = {};
    for (const el of scene.querySelectorAll('.s')) {
        const bar = styles.get(el).webkitScrollbar;
        out[el.id] = { measured: measure(el), field: bar ? [bar.width, bar.height] : null, scrollbarWidth: styles.get(el).scrollbarWidth };
    }
    return { dpr: devicePixelRatio, out };
}"""


class PlaunaStyleFieldScrollbarTests(TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            from playwright.sync_api import sync_playwright
            executable = chrome_path()
        except (ImportError, ValueError) as error:
            raise SkipTest(str(error)) from error
        cls.resources = ExitStack()
        try:
            cls.origin, _ = cls.resources.enter_context(sdk_server(ROOT))
            cls.playwright = sync_playwright().start()
            cls.resources.callback(cls.playwright.stop)
            cls.results = {}
            for scale in SCALES:
                browser = cls.playwright.chromium.launch(
                    executable_path=executable, headless=True, ignore_default_args=["--hide-scrollbars"],
                    args=[f"--force-device-scale-factor={scale}", "--window-size=700,500"])
                try:
                    context = browser.new_context(no_viewport=True, service_workers="block")
                    context.route(f"{cls.origin}{PAGE}", lambda route: route.fulfill(body=HTML, content_type="text/html"))
                    page = context.new_page()
                    errors = []
                    page.on("pageerror", lambda error: errors.append(str(error)))
                    page.goto(f"{cls.origin}{PAGE}")
                    cls.results[scale] = (page.evaluate(RUN, [list(case) for case in CASES]), errors)
                finally:
                    browser.close()
        except BaseException:
            cls.resources.close()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.resources.close()

    def test_scale_factors_are_real(self):
        for scale, (result, errors) in self.results.items():
            self.assertEqual(errors, [])
            self.assertAlmostEqual(result["dpr"], scale, places=3)
            # Classic scrollbars really are on: a plain scroller loses room to them
            self.assertGreater(result["out"]["ref-auto"]["measured"][0], 5, f"{scale}x: scrollbars hidden")

    def test_custom_scrollbar_thickness(self):
        failures = []
        for scale, (result, _) in self.results.items():
            for case_id, _, custom in CASES:
                if not custom:
                    continue
                entry = result["out"][case_id]
                if entry["field"] is None:
                    failures.append(f"{scale}x {case_id}: webkitScrollbar is null")
                    continue
                for axis, (field, measured) in enumerate(zip(entry["field"], entry["measured"])):
                    expected = result["out"]["ref-auto"]["measured"][axis] if field == "auto" else math.floor(field * scale + 1e-6) / scale
                    if abs(expected - measured) > 1 / 64:
                        failures.append(f"{scale}x {case_id} axis {axis}: field {field} -> {expected:.4f}, Chrome lays out {measured:.4f}")
        self.assertEqual(failures, [])

    def test_standard_scrollbars_where_the_field_is_null(self):
        failures = []
        for scale, (result, _) in self.results.items():
            for case_id, _, custom in CASES:
                if custom:
                    continue
                entry = result["out"][case_id]
                if entry["field"] is not None:
                    failures.append(f"{scale}x {case_id}: webkitScrollbar {entry['field']}, Chrome ignores these rules")
                reference = result["out"][f"ref-{case_id}" if case_id in REFERENCES else "ref-auto"]["measured"]
                if any(abs(a - b) > 1 / 64 for a, b in zip(entry["measured"], reference)):
                    failures.append(f"{scale}x {case_id}: Chrome lays out {entry['measured']}, standard bars take {reference}")
        self.assertEqual(failures, [])


if __name__ == "__main__":
    main()
