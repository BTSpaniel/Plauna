# SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
# SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha
"""Exercise an isolated Plauna distribution through its source and compiled APIs.

Run only after storage admission, under the project producer lock/supervisor:
    python -B bundler/tests/test_plauna_distribution_browser.py --root EXPORT --temp SCRATCH

The existing native-well tests supply the assertions and fixtures. The adapter
changes their RenderSurface import to the public API loaded for this run; it
does not replace any production implementation. Profiles and downloads use the
supplied scratch root, browsers run serially, and screenshots remain in memory.
"""
import argparse
import json
import os
import re
import secrets
import sys
import tempfile
import time
import unittest
from contextlib import ExitStack
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tests'))
from plauna_browser_support import SDKHandler, chrome_path, performance_run_lock, sdk_server
import test_plauna_native_well as native


@dataclass(frozen=True)
class Configuration:
    root: Path
    scratch: Path
    chrome: str
    mode: str
    mount: str
    scale: float


class DistributionHandler(SDKHandler):
    """Serve the real distribution and its blank harness document over persistent connections."""
    protocol_version = 'HTTP/1.1'
    timeout = 15
    disable_nagle_algorithm = True
    blank = b'<!doctype html><meta charset=utf-8><link rel="icon" href="data:,"><body></body>'

    def do_GET(self):
        if self.path != self.mount + '__plauna_distribution__.html':
            return super().do_GET()
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(self.blank)))
        self.end_headers()
        self.wfile.write(self.blank)


class PublicApiPage:
    """Bind the existing fixture's deep import to the selected real public API."""
    def __init__(self, page, drain_requests):
        self.page = page
        self.drain_requests = drain_requests

    def __getattr__(self, name):
        return getattr(self.page, name)

    def evaluate(self, expression, arg=None):
        expression = expression.replace(
            "await import('/plauna/render/RenderSurface.js')", 'globalThis.Plauna')
        return self.page.evaluate(expression, arg)


class DistributionCases(native.NativeWellBehaviour, native.SurfaceFrames):
    configuration = None
    public_exports = None

    @classmethod
    def setUpClass(cls):
        if cls.configuration is None:
            raise unittest.SkipTest('Use the admitted distribution browser CLI')
        from playwright.sync_api import sync_playwright
        cls.resources = ExitStack()
        try:
            cfg = cls.configuration
            cls.origin, cls.requests = cls.resources.enter_context(
                sdk_server(cfg.root, cfg.mount, handler_class=DistributionHandler))
            cls.playwright = sync_playwright().start()
            cls.resources.callback(cls.playwright.stop)
            cls.browser = cls.playwright.chromium.launch(
                executable_path=cfg.chrome, headless=True,
                downloads_path=str(cfg.scratch), traces_dir=str(cfg.scratch),
                args=['--enable-unsafe-webgpu', '--disable-lcd-text',
                      '--force-color-profile=srgb', '--window-size=900,700',
                      '--disk-cache-size=16777216', '--media-cache-size=16777216',
                      f'--force-device-scale-factor={cfg.scale}'])
            cls.resources.callback(cls.browser.close)
        except BaseException:
            cls.resources.close()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.resources.close()

    def open(self, scale=None, *, example=None):
        # The matrix owns the real launch scale, including methods originally
        # written against one scale. There is no emulated deviceScaleFactor.
        cfg = self.configuration
        context = self.browser.new_context(no_viewport=True, service_workers='block')
        self.addCleanup(context.close)
        page = context.new_page()
        page.set_default_timeout(15000)
        errors, failed, escaped, transport = [], [], [], []
        pending = {}
        base = self.origin + cfg.mount
        fixture_url = base + '__plauna_distribution__.html'

        def reject(route):
            escaped.append(route.request.url)
            route.abort('blockedbyclient')

        def broken(request):
            pending.pop(request, None)
            transport.append((request.failure, request.url))

        def drain_requests():
            # Wait for completion of the actual requests this context issued.
            # A global networkidle event also depends on unrelated future work.
            deadline = time.monotonic() + 15
            while pending and not transport:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    self.fail(f'Distribution requests did not complete: {list(pending.values())[:8]}')
                from playwright.sync_api import TimeoutError as BrowserTimeout
                try:
                    context.wait_for_event('requestfinished', timeout=max(1, int(remaining * 1000)))
                except BrowserTimeout:
                    if pending or transport:
                        self.fail(f'Distribution request deadline: pending={list(pending.values())[:8]}, failed={transport[:8]}')
            self.assertEqual(transport, [], 'A distribution request failed before receiving its response')

        # The real server supplies in-mount traffic. Only escaping requests are intercepted.
        context.route(re.compile(r'^(?!' + re.escape(base) + r'|data:|blob:).+'), reject)
        context.on('request', lambda request: pending.__setitem__(request, request.url))
        context.on('requestfinished', lambda request: pending.pop(request, None))
        context.on('requestfailed', broken)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
        context.on('response', lambda response: failed.append((response.status, response.url)) if response.status >= 400 else None)
        self.addCleanup(self.assertEqual, failed, [], 'A distribution asset returned HTTP failure')
        self.addCleanup(self.assertEqual, escaped, [], 'A request escaped the isolated distribution mount')
        self.addCleanup(drain_requests)
        if example:
            page.goto(base + 'examples/' + example)
            return PublicApiPage(page, drain_requests), errors
        page.goto(fixture_url)
        page.evaluate("globalThis.__peSentinel = {}; globalThis.__engineSentinel = {};"
                      "globalThis.PE = __peSentinel; globalThis.ParticleEngine = __engineSentinel")
        if cfg.mode == 'source':
            page.evaluate('async url => { globalThis.Plauna = await import(url); }', base + 'index.js')
        else:
            page.add_script_tag(url=base + 'dist/plauna.js')
        self.assertTrue(page.evaluate('Boolean(globalThis.Plauna?.RenderSurface)'), 'Public API did not load')
        self.assertTrue(page.evaluate('PE === __peSentinel && ParticleEngine === __engineSentinel'),
                        'Loading Plauna replaced an engine global')
        return PublicApiPage(page, drain_requests), errors

    def require_gpu(self, page):
        self.assertEqual(page.evaluate(native.SET_MODE, 'gpu'), 'gpu',
                         'This acceptance run requires real working WebGPU')

    def test_public_api_version_and_names(self):
        page, errors = self.open()
        actual = page.evaluate('({names: Object.keys(Plauna).sort(), version: Plauna.PLAUNA_VERSION, full: Plauna.PLAUNA_FULL})')
        self.assertEqual(actual['version'], '0.3.0')
        self.assertEqual(actual['full'], 'v0.3.0-alpha')
        for name in ('createPlaunaApp', 'UINode', 'Button', 'RenderSurface', 'LayoutEngine', 'TextShaper'):
            self.assertIn(name, actual['names'])
        if self.configuration.mode == 'source':
            deep = page.evaluate('async url => { const api = await import(url); return {names: Object.keys(api).sort(), '
                                 'identical: Object.keys(api).every(key => api[key] === Plauna[key])}; }',
                                 self.origin + self.configuration.mount + 'plauna/index.js')
            self.assertEqual(deep, {'names': actual['names'], 'identical': True})
            if DistributionCases.public_exports is None:
                DistributionCases.public_exports = actual['names']
            self.assertEqual(actual['names'], DistributionCases.public_exports)
        else:
            self.assertIsNotNone(DistributionCases.public_exports, 'Source API must be checked first')
            self.assertEqual(actual['names'], DistributionCases.public_exports)
        self.assertEqual(errors, [])

    def test_shipped_examples_and_showcase_cleanup(self):
        mode = self.configuration.mode
        page, errors = self.open(example=f'{mode}.html')
        page.wait_for_function("document.querySelector('#status')?.textContent.includes('ready.')")
        self.assertEqual(page.locator('#version').inner_text(), 'v0.3.0-alpha')
        page.get_by_role('button', name='Add an interaction', exact=True).click()
        page.get_by_text('1 interaction', exact=True).wait_for()
        page.locator('#release').click()
        self.assertEqual(page.locator('#active-mode').inner_text(), 'Released')
        self.assertEqual(page.locator('#plauna-host > *').count(), 0)
        self.assertEqual(errors, [])

        gallery, diagnostics = self.open(example=f'showcase.html?runtime={mode}')
        gallery.locator('html[data-plauna-showcase=ready]').wait_for()
        gallery.locator('a[data-widget=button]').click()
        gallery.locator('#plauna-gallery-content[data-route="widget/button"]').wait_for()
        nonce = secrets.token_hex(16)
        destination = self.origin + self.configuration.mount + 'examples/index.html'
        with gallery.expect_popup(timeout=10000) as opened:
            gallery.evaluate("url => { window.__plaunaReleaseObserver = window.open(url, '_blank'); }", destination)
        observer = opened.value
        observer.wait_for_url(destination, wait_until='domcontentloaded', timeout=10000)
        observer.evaluate("""({origin, nonce}) => {
            const sender = window.opener;
            if (!sender || sender.location.origin !== origin || sender.__plaunaReleaseObserver !== window)
                throw new Error('The showcase and observer do not share the expected origin and WindowProxy');
            const owner = sender.plaunaShowcase, gallery = owner.gallery;
            const surface = gallery.surface, app = owner.shell.app;
            if (surface.destroyed || !app.initialized || !owner.root.childElementCount)
                throw new Error('The showcase is not live before navigation');
            sender.__plaunaReceiptNonce = nonce;
            window.__plaunaReceipt = null;
            // This listener belongs to the surviving observer document. It runs
            // after the production listener, synchronously in the real pagehide.
            sender.addEventListener('pagehide', event => {
                window.__plaunaReceipt = {nonce, origin: sender.location.origin,
                    sourceMatches: event.currentTarget === sender && sender === window.opener,
                    nonceMatches: sender.__plaunaReceiptNonce === nonce, trusted: event.isTrusted,
                    persisted: event.persisted, globalReleased: !sender.plaunaShowcase,
                    galleryReleased: !owner.gallery && !gallery.surface, shellReleased: !owner.shell,
                    rootEmpty: owner.root.childElementCount === 0, surfaceDestroyed: surface.destroyed,
                    appStopped: !app.initialized};
            }, {once: true});
        }""", {'origin': self.origin, 'nonce': nonce})
        gallery.bring_to_front()
        gallery.drain_requests()
        gallery.goto(destination, wait_until='domcontentloaded')
        self.assertEqual(gallery.url, destination)
        observer.wait_for_function('window.__plaunaReceipt !== null', timeout=10000)
        receipt = observer.evaluate('window.__plaunaReceipt')
        self.assertEqual(receipt, {'nonce': nonce, 'origin': self.origin, 'sourceMatches': True,
            'nonceMatches': True, 'trusted': True,
            'persisted': False, 'globalReleased': True, 'galleryReleased': True, 'shellReleased': True,
            'rootEmpty': True, 'surfaceDestroyed': True, 'appStopped': True})
        self.assertEqual(diagnostics, [])

    def test_app_button_pointer_keyboard_theme_and_teardown(self):
        page, errors = self.open()
        page.evaluate("""async () => {
            const root = document.createElement('main'); document.body.append(root);
            const app = await Plauna.createPlaunaApp({ root, theme: 'dark', enableSmartContextMenu: false });
            const events = globalThis.__buttonEvents = {clicks: 0, callbacks: [], activations: 0};
            const button = new Plauna.Button('distribution-button', {
                text: 'Activate Plauna', onClick: event => events.callbacks.push(event.type)
            });
            button.addEventListener('click', () => events.clicks++);
            button.addEventListener('button-click', () => events.activations++);
            root.append(app.render(button)); app.domRenderer.flush();
            globalThis.__app = app; globalThis.__root = root;
        }""")
        button = page.get_by_role('button', name='Activate Plauna', exact=True)
        button.click()
        callbacks = ['click']
        self.assertEqual(page.evaluate('__buttonEvents'),
                         {'clicks': 1, 'callbacks': callbacks, 'activations': 1}, 'Pointer activation')
        button.focus()
        for key in ('Enter', 'Space'):
            page.keyboard.press(key)
            callbacks.append('button-click')
            self.assertEqual(page.evaluate('__buttonEvents'),
                             {'clicks': 1, 'callbacks': callbacks, 'activations': len(callbacks)}, key)
        page.evaluate("async () => { await __app.setTheme('light'); await __app.setTheme('dark'); }")
        self.assertEqual(page.evaluate("""() => {
            const app = __app; app.destroy(); app.visualTree.destroy(); __root.remove();
            return { rootConnected: __root.isConnected, initialized: app.initialized };
        }"""), {'rootConnected': False, 'initialized': False})
        self.assertEqual(errors, [])

    def test_borrowed_device_and_texture_surface_release(self):
        page, errors = self.open()
        result = page.evaluate("""async () => {
            const adapter = await navigator.gpu.requestAdapter();
            if (!adapter) throw new Error('A real GPU adapter is required');
            const device = await adapter.requestDevice();
            const surface = new Plauna.RenderSurface({mode: 'gpu', device, present: false});
            surface.element.style.width = '64px';
            document.body.append(surface.element);
            const block = document.createElement('div');
            block.style.cssText = 'width:64px;height:64px;background:rgb(255,0,0)';
            surface.mount(block);
            await surface.ready;
            const mode = surface.activeMode;
            const borrowed = surface.device === device;
            const texture = device.createTexture({size: [64, 64], format: surface.painter.format,
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC});
            surface.renderTo(texture.createView(), {viewport: {x: 0, y: 0, width: 64, height: 64}, target: texture});
            const readback = device.createBuffer({size: 256 * 64,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ});
            const encoder = device.createCommandEncoder();
            encoder.copyTextureToBuffer({texture}, {buffer: readback, bytesPerRow: 256}, [64, 64]);
            device.queue.submit([encoder.finish()]); await readback.mapAsync(GPUMapMode.READ);
            const offset = 32 * 256 + 32 * 4;
            const pixel = new Uint8Array(readback.getMappedRange()).slice(offset, offset + 4);
            const red = pixel[surface.painter.format.startsWith('bgra') ? 2 : 0];
            const painted = red === 255 && pixel[1] === 0 && pixel[3] === 255;
            readback.unmap(); readback.destroy(); texture.destroy();
            surface.destroy(); surface.destroy();
            const buffer = device.createBuffer({size: 16, usage: GPUBufferUsage.COPY_DST});
            device.queue.writeBuffer(buffer, 0, new Uint32Array([1, 2, 3, 4]));
            await device.queue.onSubmittedWorkDone(); buffer.destroy();
            const state = {mode, borrowed, painted, destroyed: surface.destroyed,
                frame: Boolean(surface.frameHandle), gpu: Boolean(surface.gpu),
                canvases: surface.element.querySelectorAll('canvas').length};
            surface.element.remove(); device.destroy(); return state;
        }""")
        self.assertEqual(result, {'mode': 'gpu', 'borrowed': True, 'painted': True, 'destroyed': True,
                                  'frame': False, 'gpu': False, 'canvases': 0})
        self.assertEqual(errors, [])

    def test_hot_reload_nested_urls_and_relative_stylesheet(self):
        page, errors = self.open()
        base = self.origin + self.configuration.mount
        result = page.evaluate("""async base => {
            const {HotReload} = await import(base + 'plauna/editor/HotReload.js');
            const hot = new HotReload({enabled: false}); const paths = [];
            hot.checkFileChange = async (url, kind) => { paths.push({url, kind}); };
            await hot.checkStyleChanges(); await hot.checkComponentChanges();
            const link = document.createElement('link'); link.rel = 'stylesheet';
            link.setAttribute('href', './plauna/styles/plauna.css'); document.head.append(link);
            hot.reloadCSS(base + 'plauna/styles/plauna.css');
            return {paths, replaced: !link.isConnected,
                count: document.querySelectorAll('link[rel=stylesheet]').length};
        }""", base)
        self.assertEqual(len(result['paths']), 10)
        self.assertEqual(sum(item['kind'] == 'style' for item in result['paths']), 4)
        self.assertTrue(all(item['url'].startswith(base + 'plauna/') for item in result['paths']))
        self.assertTrue(result['replaced'])
        self.assertEqual(result['count'], 1)
        self.assertEqual(errors, [])


METHODS = (
    'test_public_api_version_and_names',
    'test_shipped_examples_and_showcase_cleanup',
    'test_app_button_pointer_keyboard_theme_and_teardown',
    'test_hot_reload_nested_urls_and_relative_stylesheet',
    'test_borrowed_device_and_texture_surface_release',
    'test_input_reaches_native_elements_and_overlays',
    'test_auto_mode_stays_on_the_gpu_with_native_content',
    'test_a_mode_switch_keeps_native_content_alive',
    'test_a_worker_surface_keeps_wells_and_glass_on_moving_elements',
    'test_gpu_that_cannot_start_shows_the_dom',
    'test_a_frame_that_throws_shows_the_dom',
    'test_a_worker_error_shows_the_dom',
    'test_the_host_runs_frames_through_the_hooks',
)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=os.environ.get('PLAUNA_DISTRIBUTION_ROOT'))
    parser.add_argument('--temp', type=Path, default=os.environ.get('PLAUNA_VALIDATION_TEMP'))
    parser.add_argument('--chrome')
    parser.add_argument('--scales', default='1,1.25,1.5,2')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args(argv)
    if not args.root or not args.temp:
        parser.error('--root and --temp (or corresponding PLAUNA_* environment variables) are required')
    root, scratch = args.root.resolve(), args.temp.resolve()
    for relative in ('index.js', 'plauna/index.js', 'dist/plauna.js', 'engine/version.js',
                     'examples/source.html', 'examples/compiled.html', 'examples/showcase.html'):
        if not (root / relative).is_file():
            parser.error(f'Incomplete distribution: {relative}')
    if not scratch.is_dir():
        parser.error('The admitted scratch directory must already exist')
    scales = tuple(float(value) for value in args.scales.split(','))
    if not scales or any(value not in (1, 1.25, 1.5, 2) for value in scales):
        parser.error('--scales must select from 1,1.25,1.5,2')
    executable = chrome_path(args.chrome)
    suite = unittest.TestSuite()
    for mode in ('source', 'compiled'):
        for mount in ('/', '/nested/plauna/'):
            for scale in scales:
                name = f'Distribution_{mode}_{"root" if mount == "/" else "nested"}_{scale}'
                cls = type(name, (DistributionCases,), {'configuration': Configuration(
                    root, scratch, executable, mode, mount, scale)})
                # HotReload is an authored development module, not part of the
                # public compiled API. Only count cases which actually execute.
                suite.addTests(cls(method) for method in METHODS if mode == 'source'
                               or method != 'test_hot_reload_nested_urls_and_relative_stylesheet')
    previous_temp = tempfile.tempdir
    previous_env = {key: os.environ.get(key) for key in ('TMP', 'TEMP', 'TMPDIR')}
    try:
        tempfile.tempdir = str(scratch)
        os.environ.update({key: str(scratch) for key in previous_env})
        with performance_run_lock(ROOT):
            result = unittest.TextTestRunner(verbosity=2).run(suite)
    finally:
        tempfile.tempdir = previous_temp
        for key, value in previous_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
    summary = {'tests': result.testsRun, 'failures': len(result.failures),
               'errors': len(result.errors), 'skipped': len(result.skipped),
               'scales': scales, 'root': str(root), 'public_exports': len(DistributionCases.public_exports or ())}
    if args.report:
        args.report.write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(summary, sort_keys=True))
    return 0 if result.wasSuccessful() and not result.skipped else 1


if __name__ == '__main__':
    raise SystemExit(main())
