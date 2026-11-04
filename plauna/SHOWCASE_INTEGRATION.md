# Plauna Showcase

## Overview

`plauna.html` at the repository root is the interactive widget showcase. An
overview shows a live card for every registered widget; each widget has a
page with a playground (pick a story, change its options, watch the events
it fires, copy the code) and every story below it. It switches themes and
render modes, and opens the app's smart context menu on any preview. It uses
the same `PlaunaApp`, renderer and theme pipeline as the OS and the editor,
so what you see there is what those surfaces get.

## Boot Chain

```
plauna.html
  └── createPlaunaConsole()                 console for the page
  └── mountShowcaseApp({ root, statusElement, logger })   plauna/lab/showcase-app.js
        └── PlaunaDevShell.boot(root, { logger, enableSmartContextMenu: true })   plauna/boot.js
              └── createPlaunaApp(...)      renderer, console, text service, themes, context menu
              └── restores the saved theme  (ThemePreference)
        └── Toast.initialize(), Notify.initialize()
        └── new WidgetGallery(shell).mount(root)   plauna/ui/WidgetGallery.js
```

After boot the page exposes `window.plaunaShowcase` (the `ShowcaseApp`) and
`window.plaunaDemoConsole`.

## Components

### ShowcaseApp (`plauna/lab/showcase-app.js`)
- `boot()`: boots the shell, initializes toasts and notifications, mounts the gallery
- `smartContextMenu`: the app's context menu
- `destroy()`: tears down the gallery, toasts and shell

### PlaunaDevShell (`plauna/boot.js`)
A thin layer over `PlaunaApp`. The app owns the renderer, console, text
service, smart context menu and theme API; the shell adds the saved theme
preference, the widget registry for the gallery, and optional GPU workspaces.

- `getAllCategories()`, `getAllWidgets()`, `getWidget(id)`
- `setTheme(id)`, `getTheme()`, `getAvailableThemes()`, `toggleTheme()`, `onThemeChange(fn)`
- `render(node)`, `destroy()`

### WidgetGallery (`plauna/ui/WidgetGallery.js`)
- **Top bar**: search (`/` focuses it, Enter opens the first match, Escape
  clears), the render mode switch (DOM, GPU, Auto) with a fixed-width label
  of the mode in use, and the theme picker (`#plauna-theme-select`, listing
  `plauna/themes/index.json`). Switching modes never changes the page's
  layout: in GPU mode the last layout and paint times and item count float in
  a corner readout (`#plauna-render-stats`).
- **Sidebar**: every widget by category with its story count; on a phone it
  is a drawer behind the menu button.
- **Overview** (`#/`): counts and a live card per widget (its first story).
- **Widget page** (`#/widget/<id>`, or `#/widget/<id>/<story>` to open a
  story): the widget's id, category and tags, then the **playground**:
  - a story picker, a preview background (surface or grid) and width
    (fill, 768 px, 390 px) and Reset;
  - **Controls**: the widget's hand-written schema
    (`plauna/ui/gallery/schemas.js`, applied live through setters) plus
    fields inferred from its stories' options (`plauna/ui/gallery/controls.js`:
    booleans become switches, numbers number fields, enum-like strings
    option buttons, other strings text fields, arrays and objects JSON),
    which build the widget again; every control is a Plauna widget;
  - **Actions**: the click, input and change events the preview fired;
  - **Code**: what creates the widget with the current options through
    `createPlaunaApp` and `widgetRegistry` (`plauna/ui/gallery/snippet.js`).
  Every story follows as a live preview with an "Open in playground" button.
- The page content lives in a `RenderSurface`, so the render mode applies
  to the whole page; the choice is remembered in `localStorage`
  (`plauna.gallery.renderMode`). Page changes run through a `PageTransition`.
- Styles: one style sheet (`plauna/ui/gallery/styles.js`) using the theme's
  CSS variables, so the showcase follows the theme too.
- `open(id, story)`, `showOverview()`, `setRenderMode(mode)`, `destroy()`
  (destroys every preview and control).

## Themes

The picker calls `shell.setTheme(id)`, which applies `themes/<id>/theme.json`
as CSS variables on `:root` through `ThemeLoader`. Widgets style themselves
with `tokens.css()`, so a theme switch restyles every preview without
re-rendering. A theme that fails to load falls back to `dark`, and the picker
shows the theme actually applied.

## Usage

### Start the showcase

```bash
python start_server.py
```

Then open `http://127.0.0.1:9001/plauna.html`.

### Access from JavaScript

```javascript
const showcase = window.plaunaShowcase;
await showcase.shell.setTheme('light');
const categories = showcase.shell.getAllCategories();
```

## Testing

`tests/plauna-showcase-smoke.html` (suite `browser:plauna-showcase-smoke`)
boots `plauna.html` in a frame in the requested render mode, checks the
overview has a live card per widget, opens every widget page from the
sidebar, selects every story and drives every playground control, then
checks search, a deep link, every theme, every render mode and that three
navigation cycles do not grow the page. Any uncaught error, rejection,
`console.error`, story render error or page growth fails it. `?mode=gpu` and
`?mode=auto` run all of it in those modes (suites
`gpu:plauna-showcase-smoke-gpu` and `gpu:plauna-showcase-smoke-auto`), and
there each category's pages also check the incremental layout and display
list against a full relayout and rebuild.

```bash
python tests/navi/run_browser_status_page.py --page tests/plauna-showcase-smoke.html --expected 16
```

```bash
python tests/navi/run_browser_status_page.py --page tests/plauna-showcase-smoke.html --expected 16 --query mode=gpu
```

Widget-level behaviour is covered by `tests/plauna-widget-contracts.html`.
