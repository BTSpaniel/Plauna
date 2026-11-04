<!-- SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel> -->
<!-- SPDX-License-Identifier: MIT -->

# Plauna - UI System for Particle Engine

Plauna is a browser-first UI runtime for Particle Engine: a retained tree of
UI nodes, one DOM renderer, a widget library, a theme pipeline built on CSS
variables, and DOM-free text measurement. The WebGPU OS, the editor, Stick and
the SDK all build their UI on it.

Plauna renders in three modes: DOM (the browser lays out and paints), GPU
(Plauna lays out with its own engine and paints with WebGPU) and auto (GPU
in Chromium with WebGPU, DOM otherwise). See [Rendering modes](#rendering-modes).

## Features

- **UINode tree**: every widget is a `UINode`; one renderer owns the elements
- **DOM renderer**: dirty-driven syncs, change-tracked style and attribute writes, synthetic events
- **Widget library**: 91 registered widgets across seven categories, each with stories and a shared look (tones, variants, sizes, shapes)
- **Themes**: `themes/*.json` applied as CSS variables; widgets reference them through `tokens.css()`
- **Render modes**: DOM, GPU and auto per surface, with the same widgets and input in all three
- **Own layout engine**: CSS cascade (inline styles and page style sheets), block, inline, flex, grid and table layout, incremental relayout
- **WebGPU painter**: instanced SDF boxes, borders, shadows, gradients, text and images from atlas pages
- **GPU bridge**: Plauna surfaces as textures in a host frame (editor viewport, OS, XR), text labels, world anchors
- **Text engine**: DOM-free text measurement and line breaking (Pretext-style)
- **ECS integration**: UI state in a dedicated ECS world
- **No npm dependencies**: browser ES modules and Python tooling; the standalone
  distribution includes the Particle Engine support modules Plauna imports

## Quick Start

### Create an app

```javascript
import { createPlaunaApp } from './plauna/index.js';

const root = document.createElement('main');
document.body.append(root);
const plauna = await createPlaunaApp({
    root,
    theme: 'dark',
    renderMode: 'dom',
    enableSmartContextMenu: false,
    consoleOptions: { showPanel: false }
});

addEventListener('pagehide', () => {
    plauna.destroy();
    plauna.visualTree.destroy();
    root.remove();
}, { once: true });
```

Serve over HTTP and await `createPlaunaApp()` before using its services.
The standalone Plauna export also reexports this API from its root `index.js`.
Developer tools are off by default; pages that want them opt in with
`enableDeveloperTools`, `enableModuleTester` and `enableHotReload`.

### Existing Particle Engine editor integration

Inside the full Particle Engine tree, `initializePlauna` from
`engine/EngineEditorBootstrap.js` remains an integration wrapper around
`createPlaunaApp`. Use the direct Plauna entry above for the standalone library;
the editor bootstrap is not a standalone package requirement.

### Render a widget

```javascript
import { Button } from './plauna/index.js';

let clicks = 0;
const button = new Button('counter', {
    text: 'Clicks: 0',
    onClick: () => button.setText(`Clicks: ${++clicks}`)
});
plauna.visualTree.setRoot(button);
plauna.domRenderer.render(plauna.visualTree);
```

Child lists hold only `UINode`s. Wrap a raw DOM node with `node.appendElement(element)`.
Widget changes mark the node dirty, and the renderer syncs its element. The app
and visual-tree cleanup above releases the owned widget and its listeners.

### Themes

```javascript
await plauna.setTheme('light');
plauna.onThemeChange((themeId) => console.log('theme', themeId));
const themes = await plauna.getAvailableThemes();
```

Widgets never hard-code theme colours. They write `tokens.css('colors.primary.500')`,
which resolves to `var(--color-primary, <fallback>)`; lighter and darker steps
mix that variable toward the theme's background or text colour with
`color-mix()`. A theme switch therefore restyles every widget without
re-rendering.

### The shared look

`widgets/shared/appearance.js` gives every widget the same vocabulary, built
from the theme's variables:

- **Tones**: `primary`, `accent`, `neutral`, `success`, `warning`, `danger`, `info`
  (`tone(name)` returns the base, hover, soft, border, text and on-colour mixes).
- **Variants**: `solid`, `soft`, `surface`, `outline`, `ghost`, `gradient` (`variantStyles(variant, tone, state)`
  for the rest, hover and active states; every variant keeps a 1px border, so
  switching variants never moves anything).
- **Sizes** `xs` to `xl` (`sizeScale(size)`), **shapes** `rounded`, `pill`, `square` and a radius scale `none` to `full` (`radiusFor`).
- `bindInteraction(node, apply)` for hover, press and keyboard focus rings,
  `ICONS` and `icon()` for stroked SVG icons, and `ensureKeyframes()`.

Themes add `--surface-card`, `--surface-raised`, `--surface-overlay`,
`--surface-sunken`, `--on-<tone>`, `--ring`, `--focus-ring`, `--font-sans`,
`--font-mono` and motion tokens (`--ease-out`, `--duration-*`). A widget lists
every value of its options in `static optionValues`, so the showcase offers
all of them, not just the ones its stories use. A widget that dispatches its
own event under a DOM name (`change`, `input`, `copy`, `select`) lists it in
`static emits`: the renderer then stops forwarding native events of that type
to the widget, so a listener on it gets only the widget's events.

```javascript
import { Button, Stat, tone } from './plauna/index.js';
const save = new Button('save', { text: 'Save', variant: 'soft', tone: 'success', shape: 'pill' });
const players = new Stat('players', { label: 'Players', value: '12,480', delta: 8.2, trend: [8, 9, 11, 12] });
```

### Text measurement

```javascript
const handle = plauna.textService.prepare('Hello, world!', {
    fontFamily: 'Inter',
    fontSize: 16,
    fontWeight: 400
});
const layout = plauna.textService.layout(handle, 300, 24);
console.log(`Lines: ${layout.lineCount}, Height: ${layout.height}px`);
```

Explicit newlines always break a line, and words longer than the width break
on grapheme boundaries, so emoji sequences and combining marks stay whole.

## File Structure

```
/plauna
  index.js              # Public exports
  boot.js               # PlaunaDevShell: thin showcase shell over PlaunaApp
  /core
    app.js              # PlaunaApp and createPlaunaApp
    UINode.js           # UINode, ElementNode, DIRTY and NODE_STATE flags
    DOMRenderer.js      # The renderer
    VisualTree.js       # Tree bookkeeping
    StateStore.js       # App state
    BindingEngine.js    # One-way, two-way and intent bindings
    registry.js         # View and surface registry
    events.js           # Event system
    ModuleTester.js     # Widget and story self-checks
  /widgets
    index.js            # Widget registry (91 widgets)
    WidgetRenderer.js   # Shared renderer instance for standalone widgets
    /shared/appearance.js # Tones, variants, sizes, interaction states, icons
    /Primitive /Input /Form /Layout /Navigation /Feedback /DataViews
  /themes               # Theme JSON, ThemeLoader, preference storage
  /style                # DesignTokens (tokens.css), ThemeManager, CSS generation
  /text
    pretext-service.js  # Text measurement service
  /motion               # TransitionEngine, page transitions
  /render
    RenderSurface.js    # One surface in DOM, GPU or auto mode
    RenderModes.js      # Mode names, WebGPU detection, shared device
    AnimationController.js # GPU frames paint the browser's animated values
    /css                # CssValues, UserAgentStyles, StyleRules (page style sheets), StyleResolver
    /layout             # LayoutTree, LayoutEngine, Inline/Flex/Grid/Table layout
    /text               # TextShaper (canvas measurement, font metrics)
    /gpu                # GpuPainter, DisplayList, Rasterizer, BlurPass, SurfaceCompositor, shaders
  /surface
    surface-manager.js  # Surface descriptors, hit testing, surface renderer
  /particle
    bridge.js           # PlaunaGPUBridge: surfaces, labels and anchors in a host frame
  /workspace            # Workspaces, panels, compositor
  /ui                   # SmartContextMenu, ToastManager, WidgetGallery
  /console              # PlaunaConsole
  /lab                  # Showcase and workbench lab pages
  /ecs
    components.js       # UI ECS components
  /styles
    plauna.css          # Base styles
```

## API Reference

### PlaunaApp

```javascript
const app = await createPlaunaApp(options);
```

**Options:**
- `root`: DOM element for the Plauna root
- `getVGPU`: function that returns the VGPU instance (used by surfaces)
- `engine`: Particle Engine helpers
- `editor`: EditorApp instance (optional)
- `useCSS`: load Plauna CSS (default: true)
- `textEngine`: text engine to use (default: 'pretext')
- `theme`: theme id to apply at startup
- `enableSmartContextMenu`: right-click inspector overlay (default: true)
- `enableDeveloperTools`, `enableModuleTester`, `enableHotReload`: development aids (default: false)
- `consoleOptions`: passed to the Plauna console (`showPanel: false` keeps it detached)
- `renderMode`: `'dom'` (default), `'gpu'` or `'auto'`

**Methods:**
- `render(node)`: render a `UINode` and return its element
- `setTheme(id)`, `getTheme()`, `getAvailableThemes()`, `onThemeChange(fn)`, `toggleTheme()`
- `registerView(id, config)`, `registerSurface(id, config)`, `createSurface(config)`
- `measureText(text, style)`: measure text without the DOM
- `bindOneWay`, `bindTwoWay`, `bindIntent`, `dispatchIntent`: state bindings
- `setRenderMode(mode)`: switch modes; resolves to the active mode (`'dom'` or `'gpu'`)
- `getRenderMode()`: `{ requested, active }`
- `enhanceExistingPanels(panels)`: draw Plauna surfaces and text labels over the editor viewport
- `destroy()`

### Text Service

- `prepare(text, style)`: prepare text for measurement
- `layout(handle, width, lineHeight)`: lay out text with line breaking
- `measureElement(element)`: measure an existing DOM element
- `invalidateFont(styleKey)`: clear the font cache

### Surface Manager

- `create(config)`: create a surface
- `updateSurface(id, updates)`: update surface properties
- `destroySurface(id)`: destroy a surface
- `hitTest(id, x, y)`: test whether a point hits a surface
- `createRenderer(vgpu, { all, format, compositor })`: draw surface textures into a host frame

## ECS Components

- `UIRoot`: root application state
- `UIWorkspace`: workspace configuration
- `UIZone`: layout zones (left, center, right, bottom)
- `UIView`: view instances
- `UILayout`: layout constraints
- `UISurface`: surface definitions
- `UIText`: text content and styling

## Rendering Modes

```javascript
import { RenderSurface } from './plauna/index.js';

const surface = new RenderSurface({ mode: 'auto' });   // 'dom' | 'gpu' | 'auto'
panel.appendChild(surface.element);
surface.mount(widgetRenderer.render(button));          // content lives in surface.scene
await surface.ready;                                   // resolves to the active mode
await surface.setMode('gpu');                          // switch at any time
```

### DOM
The browser lays out and paints the scene. Full CSS, nothing else involved.

### GPU
Plauna lays the scene out with its own engine and paints it with WebGPU onto a
canvas over the scene. The scene stays in the page at opacity 0, exactly where
the painted content is, so pointer input, focus, keyboard, text editing, IME
and screen readers keep working natively; Plauna paints carets, selections and
focus rings itself. The canvas covers only the visible part of the scene.

- **Style**: inline styles plus the page's style sheets (specificity, source
  order, `!important`, `@media`, `@supports`, `@layer`, nesting, `:hover` and
  other state selectors), UA defaults calibrated from the page, `var()`,
  `::before` / `::after` generated content (strings, `attr()`, quotes),
  logical properties (`margin-inline`, `inset-block`, `inline-size`, ...)
  mapped to physical ones. Computed styles are reused while their inputs are
  unchanged.
- **Layout**: block flow with margin collapsing, inline formatting, flex,
  grid (named lines and `grid-template-areas`), tables, replaced elements,
  `aspect-ratio`, positioning, overflow and transforms (`translate`, `rotate`
  and `scale` included), checked against the browser box by box. Relayout is
  incremental: untouched subtrees keep their boxes, and a box keeps the sizes
  of its last few layout requests (flex and grid ask several per pass), so a
  change re-lays out only the boxes it affects.
- **Paint**: one instanced pipeline (rounded boxes, solid/dashed/dotted
  borders, shadows, text runs, images); background layers: linear, radial and
  conic gradients (repeating too) and `url()` images with size, position and
  repeat, interpolated in premultiplied colour as CSS does; `filter` colour
  functions applied per stacking context; `filter: blur()` and
  `backdrop-filter` through offscreen passes; text is rasterised by the
  browser into atlas pages; only what reaches the viewport is drawn. CSS
  transitions and animations (and Web Animations) run in the browser on the
  invisible scene; each GPU frame paints the values the browser computes, so
  timing, easing and colours match DOM mode frame for frame. The canvas is
  sized in whole device pixels and the scene keeps its real origin, even a
  half pixel under a 90.5px header: box edges, border widths and text
  baselines each snap once to the canvas's device pixels at their page
  position, as the browser snaps them, and shadows are 2D Gaussian blurs.
- **Other targets**: `renderTo(textureView, { viewport, dpr, load, encoder, target })`
  paints into any texture (world-space panels, XR; pass the texture as
  `target` with COPY_SRC for `backdrop-filter`); `present: false` makes a
  texture-only surface; `pointer(type, x, y)` routes input by hit testing.

### Auto
GPU in a Chromium browser with WebGPU; DOM otherwise. Native content such as
video, iframes and canvases remains browser-rendered through wells in the GPU
surface. A GPU startup or frame error falls back to DOM until the mode is
requested again. Device loss has a separate retry path. Read `getRenderMode()`
on an app, or `activeMode` on a surface, to distinguish the requested mode from
the one currently in use.

### In a host GPU frame
`PlaunaGPUBridge` (created by PlaunaApp when `getVGPU` returns a device) gives
surface-manager surfaces textures: DOM elements and RenderSurfaces painted by
Plauna, canvases, images and video copied in, or host textures used as they
are. `renderUIPass(frameCtx)` draws them into the host frame cut to their
shapes, then text labels (`setLabel`), which can follow world anchors
(`projectWorldAnchor`). The editor viewport draws them after each frame.

### Visual tree geometry
Every rendered `UINode` gets its `layoutBox` from Plauna's layout (the GPU
surface's layout in GPU mode, a LayoutEngine pass in DOM mode), refreshed when
rendered content changes or the root resizes.

### In the WebGPU OS
`ui.createSurface({ mode })` gives an app a RenderSurface on the OS GPU
device; `ui.renderMode()` and `ui.setRenderMode(mode)` read and switch the
desktop's mode (the latter needs `theme.manage`), and
`ui.onRenderModeChange(cb)` reports switches so app surfaces can follow.
The mode is an appearance setting (`renderMode`, Theme Manager's Renderer):
ThemeEngine applies it, and the Plauna theme matching the palette on screen
(`ui.applyTheme`), on boot and on every preview, apply and revert. Theme
Manager (`webgpu-os/factory/apps/theme-manager/`) is built from Plauna widgets
on such a surface.

## Testing

Registered in `tools/testing_platform/suites.json` and run with
`tests/navi/run_browser_status_page.py`:

| Suite | Page | Covers |
|-------|------|--------|
| `browser:plauna-widget-contracts` | `tests/plauna-widget-contracts.html` | Every widget and story renders, creates and destroys; interaction, keyboard and ARIA contracts |
| `browser:plauna-showcase-smoke` | `tests/plauna-showcase-smoke.html` | Boots `plauna.html`: overview cards, every widget page, story and playground control, search, deep links, themes and render modes; no errors, no growth |
| `gpu:plauna-showcase-smoke-gpu`, `gpu:plauna-showcase-smoke-auto` | same page, `?mode=gpu` / `?mode=auto` | The whole smoke with the gallery in GPU or auto mode |
| `browser:plauna-layout-parity` | `tests/plauna-layout-parity.html` | Plauna's layout against the browser for every story at two widths, plus markup cases (cascade, flex, generated content, logical properties, aspect-ratio, grid areas and named lines, transforms) |
| `gpu:plauna-gpu-render` | `tests/plauna-gpu-render.html` | Painted pixels, routed input, cascade, auto fallbacks, device loss, animations, OS syscalls |
| `gpu:plauna-gpu-bridge` | `tests/plauna-gpu-bridge.html` | Surface compositor, bridge surfaces, labels, anchors, editor viewport hooks |
| `python:tests/test_plauna_gpu_input.py` | `tests/plauna-gpu-input.html` | Real mouse, keyboard, wheel and hover on GPU-painted widgets |
| `browser:plauna-workbench-harness` | `tests/plauna-test.html` | Workbench lab smoke tests and the module tester; any failure fails the run |
| `browser:plauna-workbench` | `tests/plauna-workbench-lifecycle.html` | Workbench boot fencing and teardown |

```bash
python tests/navi/run_browser_status_page.py --page tests/plauna-widget-contracts.html --expected 107
```

The interactive showcase is `plauna.html` at the repository root: an overview
of every widget, and a playground per widget (`plauna.html#/widget/<id>`) with
generated controls, an actions log and a code snippet. See
[SHOWCASE_INTEGRATION.md](SHOWCASE_INTEGRATION.md).

## Development

- **Browser first**: pure ES modules, no Node.js dependency
- **No npm dependencies**: no npm packages or Node.js build step; retain the
  packaged engine support modules and runtime assets
- **One component model**: widgets are `UINode`s drawn by one renderer
- **One theme pipeline**: theme JSON to CSS variables to `tokens.css()`
- **ECS driven**: UI state in ECS components

## License

Plauna is MIT-licensed. Included Particle Engine support modules retain the
Particle Realms source-available alpha license, and third-party components
retain their own terms. The standalone distribution's `LICENSE`, `LICENSES/`,
`NOTICE.md`, and per-file SPDX identifiers describe that boundary. Plauna's MIT
license does not relicense the engine dependencies.
