<!-- SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel> -->
<!-- SPDX-License-Identifier: MIT -->

<div align="center">

# Plauna

### Browser UI, from DOM to WebGPU.

Retained widgets, layouts, themes, and GPU surfaces from **Particle Engine**.

[![Version](https://img.shields.io/badge/version-{{PLAUNA_VERSION}}--alpha-8b5cf6)](CHANGELOG.md)
[![Runtime](https://img.shields.io/badge/runtime-browser_ES_modules-22d3ee)](#quick-start)
[![Tooling](https://img.shields.io/badge/tooling-Python-3776ab)](#source-and-compiled-runtime)
[![License](https://img.shields.io/badge/Plauna-MIT-34d399)](#licensing)

[Quick start](#quick-start) · [Widget showcase](examples/showcase.html) · [Examples](examples/) · [Render modes](#one-ui-three-render-modes) · [API](#public-api) · [Changelog](CHANGELOG.md) · [Particle Engine](https://github.com/BTSpaniel/particlerealms.engine)

</div>

Plauna is a browser UI library extracted from the Particle Realms engine. Build with a retained visual tree, compose existing widgets, or give a `RenderSurface` ordinary DOM content. Choose browser rendering or let Plauna lay out and paint the surface with WebGPU while the page keeps native input and accessibility.

**Native browser ES modules. Python tooling. No Node.js, npm, or front-end framework required.**

This release is **{{PLAUNA_FULL}}**. It includes Plauna source, a compiled API, runtime assets, and the engine support modules that Plauna imports. The public version is `{{PLAUNA_VERSION}}`, with the `alpha` build tag.

<!-- plauna-release-media -->

## What is included

| Area | Capabilities |
| --- | --- |
| **Retained UI** | `UINode`, `VisualTree`, DOM rendering, dirty updates, state stores, and bindings. |
| **Widgets and workspaces** | Buttons, forms, navigation, data views, notifications, panels, workspaces, and development tools. |
| **Styling and motion** | Design tokens, file-based themes, CSS, layout, text measurement, transitions, and page transitions. |
| **RenderSurface** | DOM, GPU, and automatic rendering; scene layout, GPU painting, text, focus, selection, and caret rendering. |
| **Native content** | Browser-rendered canvas, video, iframe, and other native content can remain visible through GPU surface wells. |
| **Host integration** | Shared GPU devices, frame scheduling hooks, texture targets, and hit-tested pointer routing for hosted surfaces. |

GPU rendering implements Plauna's layout and painting behavior; it is not a claim of complete browser CSS equivalence. The example displays the requested and active modes so a DOM fallback is visible.

## Quick start

```powershell
git clone https://github.com/BTSpaniel/Plauna.git
cd Plauna
python -B -m http.server 9002 --bind 127.0.0.1
```

Open **[the examples](http://127.0.0.1:9002/examples/)** and choose source or compiled mode. Both load the same interactive example: retained widgets, a counter, theme switching, and DOM/GPU/auto controls. **Release resources** destroys the app and its owned visual tree.

Open **[the widget showcase](http://127.0.0.1:9002/examples/showcase.html)** for the real Particle Engine gallery. Search widgets, choose stories, change their properties, and switch themes and render modes. The page uses `mountShowcaseApp()` and also runs on the [compiled runtime](http://127.0.0.1:9002/examples/showcase.html?runtime=compiled). Widget pages support deep links such as [the button playground](http://127.0.0.1:9002/examples/showcase.html#/widget/button).

Serve over HTTP. ES modules and runtime fetches do not work correctly when the HTML is opened with `file://`. Localhost provides a secure context; public WebGPU hosting requires HTTPS. DOM mode does not require a GPU adapter. GPU mode needs browser WebGPU support and a working adapter.

### A small application

Create `app.html` at the repository root:

```html
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>My Plauna app</title>
<main id="app"></main>
<script type="module">
  import { createPlaunaApp, UINode, Button, Text } from './index.js';

  const host = document.querySelector('#app');
  const app = await createPlaunaApp({
    root: host,
    renderMode: 'dom',
    theme: 'dark',
    enableSmartContextMenu: false,
    consoleOptions: { showPanel: false }
  });
  let clicks = 0;
  const panel = new UINode('counter', 'section');
  panel.setStyles({ display: 'flex', gap: '16px', padding: '24px' });
  const count = new Text('count', { content: 'Clicks: 0' });
  const button = new Button('increment', {
    text: 'Add one',
    onClick: () => count.setText(`Clicks: ${++clicks}`)
  });
  panel.appendChild(count);
  panel.appendChild(button);
  app.visualTree.setRoot(panel);
  app.domRenderer.render(app.visualTree);

  addEventListener('pagehide', () => {
    app.destroy();
    app.visualTree.destroy();
    host.replaceChildren();
  }, { once: true });
</script>
</html>
```

Open [http://127.0.0.1:9002/app.html](http://127.0.0.1:9002/app.html). `createPlaunaApp()` is asynchronous: await it before using the app. Keep the packaged directory structure intact so styles, theme files, workers, and dynamic modules resolve correctly.

## One UI, three render modes

| Requested mode | Behavior |
| --- | --- |
| `dom` | The browser lays out and paints the scene. This is the default. |
| `gpu` | Requests WebGPU painting. Missing WebGPU or a GPU startup/frame error falls back to DOM. |
| `auto` | Selects GPU in a Chromium browser with WebGPU, and DOM otherwise. GPU failure falls back to DOM. |

```javascript
const active = await app.setRenderMode('auto');
console.log(active, app.getRenderMode());
// getRenderMode() returns { requested, active }.
```

GPU mode retains the scene in the page for native pointer input, keyboard handling, text editing, IME, and accessibility. Plauna paints the visible surface, including text selection and focus feedback. A GPU failure keeps DOM content available; requesting the mode again retries it. Device loss has a separate retry path.

Use a surface directly when your app already creates DOM elements:

```javascript
import { RenderSurface } from './index.js';

const surface = new RenderSurface({ mode: 'dom' });
document.body.append(surface.element);
const button = document.createElement('button');
button.textContent = 'A native button inside a Plauna surface';
surface.scene.append(button);
await surface.setMode('auto');

addEventListener('pagehide', () => {
  surface.destroy();
  surface.element.remove();
}, { once: true });
```

Standalone presented surfaces can paint in an `OffscreenCanvas` worker when supported. A supplied device or device getter uses the host's device on the main thread. Advanced hosts can provide `requestFrame`/`cancelFrame`, use `present: false` with `renderTo()` for texture targets, and route input with `pointer()`.

## Source and compiled runtime

| Mode | Load it | Example |
| --- | --- | --- |
| **Source** | Import exports from `./index.js`, which reexports `./plauna/index.js`. | [`examples/source.html`](examples/source.html) |
| **Compiled** | Load `./dist/plauna.js` as a classic script, then use `globalThis.Plauna`. | [`examples/compiled.html`](examples/compiled.html) |

The compiled runtime still uses packaged assets and support files. Deploy the exported tree together; `dist/plauna.js` is not a promise of a single-file, asset-free application.

```html
<script src="./dist/plauna.js"></script>
<script type="module">
  const { createPlaunaApp, PLAUNA_VERSION, PLAUNA_FULL } = globalThis.Plauna;
  console.log(PLAUNA_VERSION, PLAUNA_FULL);
  const host = document.createElement('main');
  document.body.append(host);
  const app = await createPlaunaApp({ root: host, enableSmartContextMenu: false });
  addEventListener('pagehide', () => {
    app.destroy();
    app.visualTree.destroy();
    host.remove();
  }, { once: true });
</script>
```

### Rebuild a standalone copy

Serving the examples needs no rebuild. To regenerate the distribution from its included source and Python tooling, run these commands at the checkout root. Use a new or empty **sibling** directory, outside the source tree:

```powershell
python -B -m bundler.plauna --source-root . --output-root ../plauna-candidate --max-output-bytes 100000000
python -B -m bundler.plauna --output-root ../plauna-candidate --verify-only
```

The exporter enforces the specified output-byte ceiling and writes `plauna-manifest.json`. Verification checks the listed output files against their recorded sizes and SHA-256 digests. Use your project's storage admission and producer lock when building in a managed workspace.

When rebuilding a release that contains verified showcase media in `assets/`, append `--media-root ./assets` to the export command to retain those release assets and their README links. Omit the option for a source-only candidate.

### Validate a checkout

The exporter tests use Python's standard library. Run them from the checkout root.

```powershell
python -B -m unittest bundler.tests.test_plauna_export
```

The browser harness compares the source and compiled APIs at both the origin root and a nested URL. It loads the examples, checks real input and rendering, and verifies teardown. Use an installed Chrome or Chromium browser with Python Playwright, Pillow, and NumPy. Create a scratch directory outside the checkout and pass its path to the harness. This example checks a device scale factor of 1. Omit `--scales 1` to run the full set of supported scale factors.

```powershell
New-Item -ItemType Directory -Force ../plauna-checks | Out-Null
python -B bundler/tests/test_plauna_distribution_browser.py --root . --temp ../plauna-checks --scales 1 --report ../plauna-checks/browser.json
```

The checkout also includes twelve rendering and input regression suites. They cover button and GPU input, focus rings, native wells and native paint, text features, real scaling, sticky surfaces, layout and scrollbar behavior, and pixel comparisons for widget faces and bars. Run them sequentially from the checkout root.

```powershell
python -B -m unittest discover -s tests -p 'test_plauna_*.py'
```

Review the test runner's skipped cases as well as its failures. Pixel comparisons need a working WebGPU browser and the image-analysis libraries. The release manifest records every test module and its browser fixtures under `validation_files`.

## Public API

Start with [`index.js`](index.js) and [`plauna/index.js`](plauna/index.js). These are the public export lists.

| Export | Purpose |
| --- | --- |
| `createPlaunaApp(options)` | Initializes an app, its visual tree, renderer, themes, state, and services. Returns a promise. |
| `UINode`, `VisualTree`, `DOMRenderer` | Compose retained UI, manage the tree, and render it. |
| `Button`, `Text`, and widget exports | Build interactive controls and content. |
| `StateStore`, `BindingEngine` | Connect application state to UI updates. |
| `RenderSurface` | Paint a DOM scene in DOM/GPU/auto mode, or integrate with a host render target. |
| `PLAUNA_VERSION`, `PLAUNA_FULL`, `BUILD_TAG` | Read numeric version, display version, and release channel. |

An application owns its lifecycle. Destroy the app, destroy the visual tree it owns, and remove its DOM container when closing it. The examples keep these actions together and stop using the app after release.

## Release provenance

This standalone distribution is ported from the Particle Engine implementation. Its [`plauna-manifest.json`](plauna-manifest.json) records the selected source files and release provenance. Source digest: `{{SOURCE_DIGEST}}`.

The included engine support files satisfy Plauna's imports; this package is not the complete Particle Engine SDK, editor, or WebGPU OS distribution. For that stack, see [Particle Realms Engine](https://github.com/BTSpaniel/particlerealms.engine).

## Licensing

**Plauna is MIT-licensed.** The included Particle Engine support code retains the **Particle Realms source-available alpha license**. Other included components retain their own notices and licenses. The engine alpha terms restrict redistribution and commercial production without the copyright holder's written permission; the MIT grant for Plauna does not relicense those dependencies.

Read [`LICENSE`](LICENSE), [`LICENSES/`](LICENSES/), [`NOTICE.md`](NOTICE.md), and [`AUTHORS`](AUTHORS) before redistributing the combined package. Per-file SPDX identifiers and the license inventory identify which terms apply.

---

Built by [Jake Wehmeier / BTSpaniel](https://github.com/BTSpaniel), as part of [Particle Realms](https://particlerealms.online/).
