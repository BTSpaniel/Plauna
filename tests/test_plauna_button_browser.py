# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Real mouse and keyboard Button contracts through source and minified DOMRenderer."""

import shutil
import sys
from contextlib import ExitStack, contextmanager
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import SkipTest, TestCase, main
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
from bundler import builder
from bundler.graph import ModuleGraph
from plauna_browser_support import chrome_path, performance_run_lock, sdk_server

ENTRIES = ("plauna/widgets/Primitive/Button.js", "plauna/core/DOMRenderer.js")
HARNESS = """// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
const mode = new URL(location.href).searchParams.get('mode');
if (mode === 'compiled') await import('./button.min.js');
const { Button } = mode === 'compiled' ? PE.requireModule('plauna/widgets/Primitive/Button.js')
    : await import('./plauna/widgets/Primitive/Button.js');
const { DOMRenderer } = mode === 'compiled' ? PE.requireModule('plauna/core/DOMRenderer.js')
    : await import('./plauna/core/DOMRenderer.js');
let defaults = 0, clicks = 0, callbacks = [], activations = [], keys = [];
let cancellation = null;
class ObservedButton extends Button {
    handleClick() { defaults++; super.handleClick(); }
}
const button = new ObservedButton('button-under-test', {text: 'Activate'});
button.setContent('');
button.textContent = 'Activate';
button.onClick = event => {
    callbacks.push(event);
    if (cancellation === 'callback') event.preventDefault();
};
button.addEventListener('button-click', event => {
    activations.push(event);
    if (cancellation === 'retained') event.preventDefault();
});
button.addEventListener('click', () => clicks++);
document.addEventListener('keydown', event => keys.push({key:event.key, prevented:event.defaultPrevented}));
const renderer = new DOMRenderer({container:document.querySelector('#root'), usePretext:false});
renderer.render({root:button});
globalThis.fixture = {
    button, renderer,
    reset(nextCancellation = null) {
        defaults = 0; clicks = 0; callbacks = []; activations = []; keys = [];
        cancellation = nextCancellation;
    },
    snapshot() {
        return { defaults, clicks, keys, callbackCount:callbacks.length, activationCount:activations.length,
            callbacks:callbacks.map(event => ({type:event.type, correctTarget:event.target === button,
                nativeMouse:event.originalEvent instanceof MouseEvent,
                nativePrevented:Boolean(event.originalEvent?.defaultPrevented),
                prevented:Boolean(event.defaultPrevented),
                sameActivation:activations.includes(event)})),
            activations:activations.map(event => ({type:event.type, correctTarget:event.target === button,
                nativeMouse:event.originalEvent instanceof MouseEvent,
                nativePrevented:Boolean(event.originalEvent?.defaultPrevented), prevented:event.defaultPrevented})) };
    },
    cleanup() {
        renderer.destroy(); renderer.destroy(); button.destroy(); button.destroy();
        return {domNodes:document.querySelector('#root').childElementCount,
            mappings:renderer.nodeToDOM.size + renderer.domToNode.size + renderer.renderedNodes.size,
            handlers:button.eventHandlers.size, children:button.children.length};
    }
};
"""


class PlaunaButtonBrowserTests(TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            from playwright.sync_api import sync_playwright
            executable = chrome_path()
        except (ImportError, ValueError) as error:
            raise SkipTest(str(error)) from error
        cls.resources = ExitStack()
        try:
            # Resolve and compile before joining the reference-machine queue.
            temporary = cls.resources.enter_context(TemporaryDirectory(prefix="plauna-button-"))
            cls.fixture_root = Path(temporary)
            graph = ModuleGraph(ROOT)
            for entry in ENTRIES:
                graph.walk(entry)
            # The compiler exposes this bridge even for a small CPU-only entry.
            # Include the real implementation; the test never creates a device.
            graph.walk("engine/core/gpu/VirtualGPU.js")
            if graph.errors:
                raise AssertionError(graph.errors)
            for source in graph.order:
                destination = cls.fixture_root / graph.mod_id(source)
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, destination)
                if destination.read_bytes() != Path(source).read_bytes():
                    raise AssertionError(f"Source copy changed: {source}")
            runtime = builder.build_bundle(graph, ROOT, entry_ids=list(ENTRIES))
            with patch.object(builder, "HAS_ESBUILD", False):
                runtime, _ = builder.shorten_module_ids(runtime)
                runtime = builder.minify_source(runtime)
            (cls.fixture_root / "button.min.js").write_text(runtime, encoding="utf-8")
            (cls.fixture_root / "harness.js").write_text(HARNESS, encoding="utf-8")
            (cls.fixture_root / "index.html").write_text(
                '<!doctype html><link rel="icon" href="data:,"><body><main id="root"></main>'
                '<script type="module" src="harness.js"></script>',
                encoding="utf-8")
            cls.resources.enter_context(performance_run_lock(ROOT))
            cls.playwright = sync_playwright().start()
            cls.resources.callback(cls.playwright.stop)
            cls.browser = cls.playwright.chromium.launch(executable_path=executable, headless=True)
            cls.resources.callback(cls.browser.close)
        except BaseException:
            cls.resources.close()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.resources.close()

    @contextmanager
    def visit(self, mode):
        diagnostics = {"page": [], "console": [], "http": [], "escaped": []}
        with sdk_server(self.fixture_root) as (origin, requests):
            context = self.browser.new_context(service_workers="block")
            try:
                def admit(route):
                    if route.request.url.startswith(origin + "/") or route.request.url.startswith("data:"):
                        route.continue_()
                    else:
                        diagnostics["escaped"].append(route.request.url)
                        route.abort("blockedbyclient")
                context.route("**/*", admit)
                page = context.new_page()
                # The real compiled bridge queries the preferred canvas format
                # during import. Allow that native query, forbid device creation.
                page.add_init_script("""globalThis.__BUTTON_GPU_REQUESTS__ = 0;
                    for (const [prototype, method] of [
                        [globalThis.GPU?.prototype, 'requestAdapter'],
                        [globalThis.GPUAdapter?.prototype, 'requestDevice']
                    ]) {
                        if (prototype) Object.defineProperty(prototype, method, {value(){
                            globalThis.__BUTTON_GPU_REQUESTS__++;
                            throw new Error('Button contracts must not acquire WebGPU');
                        }});
                    }
                """)
                page.on("pageerror", lambda error: diagnostics["page"].append(str(error)))
                page.on("console", lambda message: diagnostics["console"].append(message.text) if message.type == "error" else None)
                page.on("response", lambda response: diagnostics["http"].append(response.url) if response.status >= 400 else None)
                page.goto(origin + "/index.html?mode=" + mode, wait_until="networkidle")
                page.wait_for_function("globalThis.fixture")
                # Give Chrome a real user gesture before testing programmatic haptics.
                page.click("#button-under-test")
                page.evaluate("fixture.reset()")
                yield page
                self.assertEqual(page.evaluate("fixture.cleanup()"),
                                 {"domNodes": 0, "mappings": 0, "handlers": 0, "children": 0})
                self.assertEqual(page.evaluate("globalThis.__BUTTON_GPU_REQUESTS__"), 0)
                self.assertEqual(diagnostics, {"page": [], "console": [], "http": [], "escaped": []})
                self.assertTrue(requests)
            finally:
                context.close()

    def test_real_mouse_dispatches_callback_and_retained_action_once(self):
        for mode in ("source", "compiled"):
            with self.subTest(mode=mode), self.visit(mode) as page:
                page.click("#button-under-test")
                result = page.evaluate("fixture.snapshot()")
                self.assertEqual((result["clicks"], result["callbackCount"], result["activationCount"], result["defaults"]), (1, 1, 1, 1))
                self.assertEqual(result["callbacks"][0], {"type": "click", "correctTarget": True, "nativeMouse": True,
                    "nativePrevented": False, "prevented": False, "sameActivation": False})
                self.assertEqual(result["activations"][0], {"type": "button-click", "correctTarget": True,
                    "nativeMouse": True, "nativePrevented": False, "prevented": False})

    def test_mouse_callback_prevention_reaches_retained_and_native_events(self):
        self.check_mouse_cancellation("callback")

    def test_retained_prevention_reaches_native_mouse_event(self):
        self.check_mouse_cancellation("retained")

    def check_mouse_cancellation(self, cancellation):
        for mode in ("source", "compiled"):
            with self.subTest(mode=mode), self.visit(mode) as page:
                page.evaluate("value => fixture.reset(value)", cancellation)
                page.click("#button-under-test")
                result = page.evaluate("fixture.snapshot()")
                self.assertEqual((result["clicks"], result["callbackCount"], result["activationCount"], result["defaults"]), (1, 1, 1, 0))
                self.assertTrue(result["callbacks"][0]["nativePrevented"])
                self.assertTrue(result["activations"][0]["prevented"])
                self.assertTrue(result["activations"][0]["nativePrevented"])

    def test_programmatic_activation_has_one_cancelable_public_callback(self):
        for mode in ("source", "compiled"):
            with self.subTest(mode=mode), self.visit(mode) as page:
                for cancellation in (None, "callback", "retained"):
                    page.evaluate("value => {fixture.reset(value); fixture.button.activate();}", cancellation)
                    result = page.evaluate("fixture.snapshot()")
                    self.assertEqual((result["clicks"], result["callbackCount"], result["activationCount"]), (0, 1, 1))
                    self.assertEqual(result["defaults"], 1 if cancellation is None else 0)
                    self.assertTrue(result["callbacks"][0]["sameActivation"])
                    self.assertEqual(result["callbacks"][0]["type"], "button-click")
                    self.assertEqual(result["activations"][0]["prevented"], cancellation is not None)

    def test_disabled_and_loading_suppress_native_and_programmatic_actions(self):
        for mode in ("source", "compiled"):
            with self.subTest(mode=mode), self.visit(mode) as page:
                for state in ("disabled", "loading"):
                    result = page.evaluate("""state => {
                        fixture.reset();
                        const button = fixture.button;
                        if (state === 'disabled') button.setDisabled(true); else button.setLoading(true);
                        fixture.renderer.updateNode(button);
                        const native = new MouseEvent('click', {bubbles:true, cancelable:true});
                        fixture.renderer.getDOMElement(button).dispatchEvent(native);
                        button.activate();
                        button.dispatchEvent({type:'keydown', key:'Enter', preventDefault(){}});
                        const result = {...fixture.snapshot(), nativePrevented:native.defaultPrevented};
                        if (state === 'disabled') button.setDisabled(false); else button.setLoading(false);
                        fixture.renderer.updateNode(button);
                        return result;
                    }""", state)
                    self.assertEqual((result["callbackCount"], result["activationCount"], result["defaults"]), (0, 0, 0))
                    self.assertTrue(result["nativePrevented"])
                    page.evaluate("fixture.reset()")
                    self.assertFalse(page.evaluate("fixture.renderer.getDOMElement(fixture.button).disabled"))
                    # The unchanged renderer retains aria-disabled after clearing
                    # native disabled. Exercise the actual user mouse path rather
                    # than Playwright's additional ARIA-based locator guard.
                    box = page.locator("#button-under-test").bounding_box()
                    self.assertIsNotNone(box)
                    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                    self.assertEqual(page.evaluate("fixture.snapshot().defaults"), 1)

    def test_real_keyboard_enter_and_space_activate_once_without_extra_click(self):
        for mode in ("source", "compiled"):
            with self.subTest(mode=mode), self.visit(mode) as page:
                page.focus("#button-under-test")
                for key, value in (("Enter", "Enter"), ("Space", " ")):
                    page.evaluate("fixture.reset()")
                    page.keyboard.press(key)
                    result = page.evaluate("fixture.snapshot()")
                    self.assertEqual((result["clicks"], result["callbackCount"], result["activationCount"], result["defaults"]), (0, 1, 1, 1))
                    self.assertEqual(result["keys"], [{"key": value, "prevented": True}])
                    self.assertTrue(result["callbacks"][0]["sameActivation"])
                page.evaluate("fixture.reset()")
                page.keyboard.press("ArrowRight")
                result = page.evaluate("fixture.snapshot()")
                self.assertEqual((result["callbackCount"], result["activationCount"], result["defaults"]), (0, 0, 0))
                self.assertEqual(result["keys"], [{"key": "ArrowRight", "prevented": False}])

    def test_retained_click_contract_preserves_prevention_without_redispatch(self):
        for mode in ("source", "compiled"):
            with self.subTest(mode=mode), self.visit(mode) as page:
                result = page.evaluate("""() => {
                    fixture.reset('callback');
                    const event = {type:'click', target:fixture.button, defaultPrevented:false,
                        preventDefault(){this.defaultPrevented = true;}};
                    const accepted = fixture.button.dispatchEvent(event);
                    return {...fixture.snapshot(), accepted, eventPrevented:event.defaultPrevented};
                }""")
                self.assertEqual((result["clicks"], result["callbackCount"], result["activationCount"], result["defaults"]), (1, 1, 1, 0))
                self.assertFalse(result["accepted"])
                self.assertTrue(result["eventPrevented"])
                self.assertTrue(result["activations"][0]["prevented"])


if __name__ == "__main__":
    main()
