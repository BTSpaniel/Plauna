# Plauna Architecture Documentation

This document provides a comprehensive overview of the Plauna UI system architecture, patterns, and relationships. It's intended to help AI agents and developers understand how the codebase is structured.

## Table of Contents

1. [Overview](#overview)
2. [Core Architecture](#core-architecture)
3. [Rendering Pipeline](#rendering-pipeline)
4. [Widget System](#widget-system)
5. [Theme System](#theme-system)
6. [Workspace System](#workspace-system)
7. [Notification System](#notification-system)
8. [Development Tools](#development-tools)
9. [File Structure](#file-structure)
10. [Render Modes and the GPU Path](#render-modes-and-the-gpu-path)
11. [Key Patterns](#key-patterns)

---

## Overview

Plauna is a retained-mode UI system built for the Particle Engine. It provides a widget library, theme system, virtual desktops, and GPU panel support. Widgets render through one DOM renderer; a surface then shows them in DOM, GPU or auto mode (see [Render modes and the GPU path](#render-modes-and-the-gpu-path)).

### Key Design Principles

- **Retained Mode**: UI tree persists in memory and is incrementally updated (unlike virtual DOM)
- **Dirty Flags**: Bits track what parts of the tree need re-rendering
- **Modular**: Widgets, themes, and workspaces are independent modules
- **One renderer**: every UINode tree renders through `DOMRenderer`
- **GPU panels**: workspaces can host WebGPU texture panels
- **Developer-Friendly**: Built-in inspector, hot reload, and context menu

### Technology Stack

- **Core**: Vanilla JavaScript (ES modules)
- **Rendering**: DOM (DOMRenderer); WebGPU texture panels via WorkspaceCompositor
- **Styling**: CSS variables (custom properties)
- **Themes**: File-based JSON manifests
- **Animation**: TransitionEngine with CSS transitions
- **Text**: Pretext internationalization service

---

## Core Architecture

### PlaunaApp

The main application class that integrates Plauna with the Particle Engine.

**Location**: `plauna/core/app.js`

**Responsibilities**:
- Manages VisualTree (retained-mode UI tree)
- Manages DOMRenderer (renders tree to DOM)
- Manages PlaunaEventSystem (event handling)
- Manages ThemeManager (theme application)
- Manages development tools (inspector, hot reload, etc.)

**Usage**:
```javascript
const app = await createPlaunaApp({
    root: document.body,
    getVGPU: () => vgpuInstance,
    engine: particleEngine,
    theme: 'dark'
});
document.body.appendChild(app.render(myWidget));
```

### VisualTree

Retained-mode UI tree that holds UINode instances.

**Location**: `plauna/core/VisualTree.js`

**Responsibilities**:
- Maintains root UINode reference
- Provides traversal methods (pre-order, post-order, etc.)
- Processes dirty flags for incremental updates
- Manages node lifecycle

**Key Methods**:
- `getRoot()`: Get root UINode
- `setRoot(node)`: Set root UINode
- `traverse(callback, node)`: Traverse tree recursively
- `processStyleDirty(nodes)`: Process style dirty flags

### UINode

Base class for all UI nodes in the retained visual tree.

**Location**: `plauna/core/UINode.js`

**Responsibilities**:
- Tree structure (parent, children, siblings)
- Dirty flag tracking
- Layout box (position, size, margins, padding)
- Event handlers
- Accessibility (ARIA attributes)

**Dirty Flags** (bitmask):
- `STYLE`: CSS styles changed
- `LAYOUT`: Position/size changed
- `PAINT`: Visual appearance changed
- `TEXT`: Text content changed
- `ACCESSIBILITY`: ARIA attributes changed
- `CHILDREN`: Child nodes added/removed
- `FOCUS`: Focus state changed
- `VALUE`: Form value changed
- `STATE`: Node state bits changed
- `ALL`: Every flag

**Node State** (bitmask):
- `VISIBLE`: Node is visible
- `FOCUSED`: Node has keyboard focus
- `HOVERED`: Mouse is over the node
- `ACTIVE`: Node is being pressed
- `DISABLED`: Node is disabled
- `FOCUSABLE`: Node can receive focus
- `CHECKED`, `SELECTED`, `LOADING`, `ERROR`: control states

**Children**: child lists hold only UINodes. Raw DOM content is wrapped with
`node.appendElement(element)` (an `ElementNode`) and placed as-is.

---

## Rendering Pipeline

### One Renderer

Every UINode tree renders through one class, `DOMRenderer`.

**Location**: `plauna/core/DOMRenderer.js`

`plauna/widgets/WidgetRenderer.js` is a thin subclass with no container and
exports the shared `widgetRenderer` instance that standalone widgets, the
showcase and the tests use. `PlaunaApp` owns its own instance for the visual
tree.

**Model**:
1. A node's element is created once and kept on `node.element`;
   `element._plaunaNode` points back at the node
2. After the first render the node remembers its renderer; every
   `markDirty()` schedules a microtask sync of that node
3. A sync reconciles styles, attributes, text and children against the
   element, writing only values that changed since the last sync, so user
   input in native fields is never overwritten
4. `render(node)` and `updateNode(node)` sync immediately; `destroy()` on a
   node releases its element and listeners

**Entry points**:
- `render(node)`: returns the node's element
- `render(visualTree | { root })`: clears the container and renders the root into it
- `updateNode(node)`: synchronous re-sync of one node
- `flush()`: run pending syncs now
- `unmount(nodeOrElement)`, `clear()`, `destroy()`

**Events**: DOM event types registered with `node.addEventListener()` get one
native listener on the element. Handlers receive a synthetic event whose
`target` is the node and `originalEvent` the native event; other properties
(`key`, `clientX`, ...) read through to the native event, and `domTarget` is
the native target element.

**Styles**: unitless numbers become pixels, and token words resolve through
the theme's CSS variables.

**Special handling**:
- SVG elements use `createElementNS`
- With a text service and `usePretext`, text and button nodes of known width
  are laid out line by line through `PlaunaTextService`

### Rendering Flow Diagram

```
UINode tree (widget or VisualTree root)
    ↓  markDirty() → microtask
DOMRenderer.sync(node)  (styles, attributes, text, children)
    ↓
DOM elements in a RenderSurface scene
    ↓                                   ↓
DOM mode: browser display    GPU mode: StyleResolver → LayoutEngine
                                     → DisplayListBuilder → GpuPainter → canvas
```

---

## Widget System

### Widget Registry

Central registry for all Plauna widgets.

**Location**: `plauna/widgets/index.js`

**Exports**:
- `widgets`: Flat array of all widget classes
- `widgetRegistry`: Map of widget.id → widget class
- `categories`: Map of category name → array of widgets
- Helper functions: `getWidget()`, `getWidgetsByCategory()`, `searchWidgets()`

**Widget Categories**:
- **Primitive**: Button, Badge, Avatar, Chip, etc.
- **Input**: Search, Color, Date, File, etc.
- **Form**: Checkbox, Radio, Switch, Select, etc.
- **Layout**: Card, Grid, Panel, Divider, etc.
- **Navigation**: Menu, Tabs, Sidebar, etc.
- **DataViews**: List, Table, Tree, etc.
- **Feedback**: Alert, Toast, Spinner, etc.

### Widget Pattern

Each widget class must have:

**Static Properties**:
- `id`: Unique string identifier (e.g., 'button')
- `name`: Display name (e.g., 'Button')
- `category`: Category name (e.g., 'primitive')
- `icon`: Emoji or icon for UI display
- `description`: Short description
- `tags`: Array of searchable tags
- `dependencies`: Array of required widget IDs

**Static Methods**:
- `getDefaultOptions()`: Returns default configuration
- `stories()`: Returns named story configurations for showcase

**Instance Methods**:
- `constructor(id, options)`: Initializes the widget and builds its UINode tree
- Setters such as `setVariant()`, `setDisabled()`, `setValue()` update state and mark the node dirty
- `destroy()`: Releases the element and its listeners; safe to call twice

Instantiate directly and render, or use the static `create(container, options)`:
```javascript
const button = new Button('my-button', { variant: 'primary' });
container.appendChild(widgetRenderer.render(button));

const other = Button.create(container, { text: 'Save' });
```

Every registered widget and story is checked by `tests/plauna-widget-contracts.html`.

### WidgetGallery

The widget showcase (`plauna.html`), for widget development and documentation.

**Location**: `plauna/ui/WidgetGallery.js`, with `plauna/ui/gallery/`
(`controls.js`, `schemas.js`, `snippet.js`, `styles.js`)

**Features**:
- Top bar: search, render mode (DOM, GPU, Auto, with GPU timings), theme
- Sidebar of every widget by category; an overview page with a live card per widget
- A page per widget (`#/widget/<id>[/<story>]`) with a playground: story
  picker, preview background and width, controls (hand-written schema plus
  fields inferred from the stories' options), an actions log and a live
  code snippet; then every story as a live preview
- The page content renders through a `RenderSurface`, so the render mode
  applies to the whole showcase

**Special Handling**:
- Tooltips appended to `document.body` for correct positioning
- Toasts shown immediately for visible demos

---

## Modern Primitive Design Patterns

Plauna's primitive widgets (Button, Avatar, Chip, Badge, etc.) follow modern UI design patterns inspired by Material Design 3, Apple Human Interface Guidelines, and contemporary web design systems.

### Surface Patterns

Modern surfaces use subtle elevation and depth rather than flat colors:

- **Soft shadows**: `var(--shadow-sm)` for base elevation, `var(--shadow-md)` for hover
- **Backdrop filters**: `saturate(1.05) blur(8px)` for glassy layered effects
- **Subtle borders**: Low-opacity borders (e.g., `rgba(148, 163, 184, 0.18)`) for definition
- **Larger border-radius**: `var(--border-radius-lg)` for buttons, `var(--border-radius-full)` for pills/chips
- **Preserved base shadow**: Base shadow is maintained across hover/focus states for consistent depth

### Accessibility Patterns

All primitives follow WCAG 2.1 guidelines for keyboard navigation and screen reader support:

- **Focus rings**: Dual-layer shadows with outer ring (3px primary color) and inner shadow for visibility
- **Outline offset**: 2px spacing between focus ring and element for clear separation
- **Keyboard focusable**: `NODE_STATE.FOCUSABLE` set when not disabled
- **ARIA labels**: Generated with fallback chains (name → alt → initials) for avatars
- **Role assignment**: Semantic roles (button, status, presentation) based on widget type
- **ariaLive**: "polite" for status badges to announce changes

### Touch Target Patterns

Touch targets meet or exceed WCAG 2.1 minimum 44x44px recommendation:

- **Button sizes**: sm (36px), md (44px), lg (52px) minimum widths
- **Chip height**: 32px minimum height for better touch targets
- **Padding**: Generous padding (5px 12px for md chips) for comfortable tapping
- **Spacing**: Gap between elements using `var(--spacing-xs)` for visual separation

### Variant Patterns

Semantic color variants use alpha transparency for theme compatibility:

- **Alpha-transparent backgrounds**: RGBA values (e.g., `rgba(14, 165, 233, 0.12)`) work across light/dark themes
- **Stronger borders**: Higher opacity borders (e.g., `rgba(14, 165, 233, 0.24)`) for definition
- **Semantic colors**: Primary (actions), Success (confirmation), Warning (caution), Error (destructive)
- **Disabled state**: Reduced opacity (0.6), neutral background, removed shadow

### State Management

Interaction states use NODE_STATE bitmasks for efficient updates:

- **HOVERED**: Scale transform (1.05x) and elevated shadow for tactile feedback
- **FOCUSED**: Dual-layer focus ring with primary color
- **ACTIVE**: Press state with subtle scale or shadow change
- **DISABLED**: Reduced opacity, not-allowed cursor, flat appearance
- **Dirty flags**: DIRTY.PAINT, DIRTY.STYLE, DIRTY.ACCESSIBILITY trigger re-renders

### Interaction Patterns

Modern interactions provide clear feedback and smooth transitions:

- **Scale transforms**: 1.05x scale on hover/focus for tactile feedback
- **Shadow elevation**: Base shadow → elevated shadow on hover → focus ring on focus
- **Smooth transitions**: 150-160ms ease transitions on transform, shadow, background, border
- **Border preservation**: Borders maintained across states (not cleared on blur)
- **State restoration**: All states restored to base values on mouseleave/blur

### Progressive Enhancement

Widgets gracefully degrade when resources fail:

- **Image loading**: Async loading with error handling and fallbacks (initials → icon → placeholder)
- **Text fallback**: Alt text, initials, or placeholder when images fail
- **Content structure**: Flexible DOM structure supports optional elements (avatars, icons, remove buttons)

## Theme System

### ThemeLoader

File-based theme discovery and loading system. It is the one theme pipeline:
`PlaunaApp.setTheme()`, the showcase theme picker and the OS all apply themes
through it.

**Location**: `plauna/themes/ThemeLoader.js`

**Theme Structure**:
```
plauna/themes/
├── _base/theme.json          # Base theme with all defaults
├── dark/theme.json           # Dark theme (extends _base)
├── light/theme.json          # Light theme (extends _base)
├── high-contrast/theme.json  # High contrast (extends dark)
├── custom/theme.json         # User template (extends dark)
└── index.json                # Registry of discoverable themes
```

**Theme Manifest** (theme.json):
```json
{
  "name": "Theme Name",
  "description": "Theme description",
  "extends": "parent-theme-id",
  "variables": {
    "color-primary": "#3b82f6",
    "spacing-md": "16px",
    "null-values-inherit-from-parent": null
  }
}
```

**Resolution Cascade** (highest priority wins):
1. _base theme defaults
2. Parent theme variables (if `extends` is set)
3. Current theme variables
4. Runtime overrides (`applyOverrides()`)

**CSS Variable Application**:
- Variables written to `<style data-plauna-theme="1">` on `:root`
- Format: `--variable-name: value;`
- Overrides use separate `<style data-plauna-overrides="1">` tag

### ThemeManager

Token-object theme manager kept on `PlaunaApp.themeManager`.

**Location**: `plauna/style/ThemeManager.js`

The workbench lab reads token objects from it. It does not apply page themes;
use `app.setTheme()` (ThemeLoader) for that.

### DesignTokens

Central design system token management.

**Location**: `plauna/style/DesignTokens.js`

**Token Categories**:
- `spacing`: Size tokens (xs, sm, md, lg, xl, 2xl, etc.)
- `typography`: Font families, sizes, weights, line heights
- `colors`: Color palettes (primary, secondary, success, warning, error)
- `motion`: Animation durations, easings
- `borderRadius`: Border radius values
- `shadows`: Shadow definitions
- `zIndex`: Z-index layer values

**Access Pattern**:
```javascript
tokens.css('spacing.md')            // 'var(--spacing-md, 16px)' - what widgets use
tokens.css('colors.primary.500')    // 'var(--color-primary, #0ea5e9)'
tokens.css('colors.primary.100')    // color-mix() of the primary toward the theme background
tokens.get('spacing.md')            // Raw token value (numbers are unitless)
```

Widgets style themselves with `tokens.css()`, so the active theme's CSS
variables decide every colour and size, and a theme switch needs no re-render.

**Observer Pattern**:
- Observers subscribe to token changes
- Used by WidgetStyleManager to regenerate styles on theme changes

---

## Workspace System

### WorkspaceManager

Virtual desktop management for multi-panel layouts.

**Location**: `plauna/workspace/WorkspaceManager.js`

**Workspace Concept**:
- A Workspace is a virtual desktop that holds panels
- Each workspace has its own layout mode
- Workspaces are DOM layers stacked over the canvas
- Only one workspace is active/visible at a time

**Panel Types**:
- **DOMPanel**: Wrapper for Plauna widgets (div-based)
- **GPUPanel**: WebGPU texture panel (for GPU-accelerated content)

**Layout Modes**:
- **fullscreen**: One panel fills the entire workspace
- **float**: Draggable, resizable windows with z-order
- **split**: Recursive binary tree layout (like tmux/VS Code)
- **tile**: Auto-arranged grid layout

**Single Constraint**:
- Only one WebGPU canvas context allowed per page
- Only one GPUDevice instance shared across all workspaces
- GPU panels share the same device and canvas

**Public API**:
- `createWorkspace({ name, layout })`: Create new workspace
- `switchTo(id)`: Switch active workspace
- `createPanel(type, options)`: Create panel in active workspace
- `list()`: List all workspaces
- `activeWorkspace`: Get currently active workspace

**Keyboard Shortcuts**:
- `Ctrl+``: Open workspace switcher
- Arrow keys: Navigate switcher
- Enter: Switch to selected workspace
- Escape: Close switcher

### WorkspaceCompositor

GPU blit pipeline for GPU panels.

**Location**: `plauna/workspace/WorkspaceCompositor.js`

**Responsibilities**:
- Blits GPU panel textures to canvas swap chain
- Iterates visible GPU panels in z-order
- Required for GPU panel support

### WorkspaceSwitcher

HUD overlay for workspace switching.

**Location**: `plauna/workspace/WorkspaceSwitcher.js`

**Features**:
- Shows thumbnails of all workspaces
- Keyboard navigation with arrow keys
- Enter to switch workspace

---

## Notification System

### NotificationSystem

Centralized notification management.

**Location**: `plauna/notifications/NotificationSystem.js`

**Notification Channels**:
1. **Toasts**: UI notifications via ToastManager
2. **Console**: Browser console.log/error/warn
3. **Sounds**: Optional audio feedback (Web Audio API)

**Notification Levels** (priority order):
- `debug` (0): Development debugging
- `info` (1): General information
- `success` (2): Success confirmations
- `warning` (3): Warning messages
- `error` (4): Error messages
- `critical` (5): Critical errors

**Notification Types**:
- `system`: System-level notifications
- `action`: User action feedback
- `validation`: Form validation errors
- `performance`: Performance metrics
- `security`: Security-related alerts
- `network`: Network request status

**Convenience Methods**:
- `debug(message, type, data)`
- `info(message, type, data)`
- `success(message, type, data)`
- `warning(message, type, data)`
- `error(message, type, data)`
- `critical(message, type, data)`

### ToastManager

Unified toast notification system.

**Location**: `plauna/ui/ToastManager.js`

**Toast Positions**:
- `top-right` (default)
- `top-left`
- `top-center`
- `bottom-right`
- `bottom-left`
- `bottom-center`

**Toast Types**:
- `success`: Green checkmark, 3s duration
- `error`: Red X, 5s duration
- `warning`: Yellow warning, 4s duration
- `info`: Blue info, 3s duration
- `loading`: Gray spinner, indefinite

**Toast Lifecycle**:
1. `show(options)`: Creates toast element
2. Animate in: Slide-in animation
3. Display: Shows for duration (or indefinite)
4. Animate out: Slide-out animation
5. Remove: Element removed from DOM

**Global Singleton**:
```javascript
Toast.initialize();
Toast.show('Hello world', 'info');
```

---

## Development Tools

### PlaunaSmartContextMenu

Context-aware right-click menu for UI inspection.

**Location**: `plauna/ui/SmartContextMenu.js`

**Scanning Algorithm**:
1. On right-click, scans visual tree around cursor
2. Uses adaptive radius based on node density
3. Scores each node based on type, role, text content, distance
4. Returns top N nodes within scan radius

**Node Scoring**:
- Inside node: +1000 + inset depth
- Has role: +22
- Has text content: +10
- Has className: +8
- Button type: +25
- Input type: +18
- Menu type: +15
- Small area: +6

**Adaptive Radius**:
- Base radius: 140px (configurable)
- Density >= 8: 48% of base (72px min)
- Density >= 6: 55% of base (80px min)
- Density >= 4: 65% of base (90px min)
- Density >= 2: 80% of base (112px min)
- Density < 2: 100% of base (140px)

**DOM Fallback**:
- If visualTree is unavailable (e.g., in showcase shell), falls back to DOM scanning
- Uses `element._plaunaNode` back-reference set by WidgetRenderer

### Tree and Style Inspectors

Visual tree and style inspectors for debugging, built inline by
`PlaunaApp.initializeDeveloperTools()` when the app is created with
`enableDeveloperTools: true` (off by default).

**Location**: `plauna/core/app.js` (`treeInspector`, `styleInspector`)

**Features**:
- Lists the UINode tree and highlights the selected node
- Shows the selected node's styles

### HotReload

Hot module replacement for development.

**Location**: `plauna/editor/HotReload.js`

**Features**:
- Watches for module changes
- Reloads modules without full page refresh
- Preserves app state where possible

---

## File Structure

```
plauna/
├── boot.js                      # Engine bootstrap (PlaunaDevShell)
├── index.js                     # Package exports
├── core/
│   ├── app.js                   # PlaunaApp (main application)
│   ├── UINode.js                # UINode, ElementNode, DIRTY, NODE_STATE
│   ├── VisualTree.js            # Retained-mode UI tree
│   ├── DOMRenderer.js           # The one UINode → DOM renderer
│   ├── StateStore.js            # App state
│   ├── BindingEngine.js         # State bindings
│   ├── ModuleTester.js          # Widget and story self-checks
│   ├── events.js                # Event system
│   └── registry.js              # Component registry
├── widgets/
│   ├── index.js                 # Widget registry
│   ├── WidgetRenderer.js        # Shared DOMRenderer for standalone widgets
│   ├── WidgetStyleManager.js    # Theme-aware style generation (workbench lab)
│   ├── Primitive/               # Primitive widgets
│   │   ├── Button.js
│   │   ├── Badge.js
│   │   ├── Avatar.js
│   │   ├── Chip.js
│   │   ├── Progress.js
│   │   ├── Tooltip.js
│   │   └── ...
│   ├── Input/                   # Input widgets
│   ├── Form/                    # Form widgets
│   ├── Layout/                  # Layout widgets
│   ├── Navigation/              # Navigation widgets
│   ├── DataViews/               # Data view widgets
│   └── Feedback/                # Feedback widgets
│       ├── Toast.js
│       ├── Alert.js
│       └── ...
├── style/
│   ├── ThemeManager.js          # Token-object theme manager
│   └── DesignTokens.js          # Design tokens and tokens.css()
├── themes/
│   ├── ThemeLoader.js           # Theme discovery/loading
│   ├── _base/theme.json         # Base theme defaults
│   ├── dark/theme.json          # Dark theme
│   ├── light/theme.json         # Light theme
│   ├── high-contrast/theme.json # High contrast theme
│   ├── custom/theme.json        # User template
│   └── index.json               # Theme registry
├── workspace/
│   ├── WorkspaceManager.js      # Virtual desktop manager
│   ├── Workspace.js             # Single workspace
│   ├── Panel.js                 # Panel types (DOM/GPU)
│   ├── PanelLayout.js           # Layout engine
│   ├── WorkspaceCompositor.js   # GPU blit pipeline
│   └── WorkspaceSwitcher.js     # Workspace switcher HUD
├── notifications/
│   └── NotificationSystem.js    # Centralized notifications
├── ui/
│   ├── ToastManager.js          # Toast notification system
│   ├── WidgetGallery.js         # Widget showcase (plauna.html)
│   ├── gallery/                 # Showcase controls, schemas, snippets, styles
│   └── SmartContextMenu.js      # Context-aware menu
├── text/
│   └── pretext-service.js       # DOM-free text measurement
├── motion/
│   ├── TransitionEngine.js      # Property animation
│   └── PageTransition*.js       # Page transitions
├── render/
│   ├── RenderSurface.js         # DOM / GPU / auto surface
│   ├── RenderModes.js           # Modes, WebGPU detection, shared device
│   ├── AnimationController.js   # Browser-animated values for GPU frames
│   ├── css/                     # CssValues, UserAgentStyles, StyleRules, StyleResolver
│   ├── layout/                  # LayoutTree, LayoutEngine, Inline/Flex/Grid/Table layout
│   ├── text/                    # TextShaper
│   └── gpu/                     # GpuPainter, DisplayList, Rasterizer, BlurPass, SurfaceCompositor, shaders
├── surface/
│   └── surface-manager.js       # Surface descriptors, hit testing, surface renderer
├── particle/
│   └── bridge.js                # GPU bridge: surfaces, labels, anchors in a host frame
├── editor/
│   └── HotReload.js             # Hot module replacement
├── ecs/
│   └── components.js            # UI ECS components
├── lab/
│   ├── showcase-app.js          # Showcase application
│   └── workbench-lab.js         # Development workbench
└── console/
    └── PlaunaConsole.js         # Console utilities
```

---

## Render Modes and the GPU Path

**Location**: `plauna/render/`

A `RenderSurface` shows a scene (DOM content the DOMRenderer or anything else
put in `surface.scene`) in one of three modes:

- **dom**: the browser lays out and paints.
- **gpu**: Plauna lays the scene out and paints it with WebGPU on a canvas
  over the scene. The scene stays in the page at opacity 0, so native input,
  focus, text editing, IME and accessibility keep working; Plauna paints
  carets, selections and focus rings.
- **auto**: gpu unless WebGPU is missing, the device was lost, or the scene
  holds DOM-only content (video, iframe, canvas, object, embed); switches live.

The GPU path, all DOM-free after the first read of the page's style sheets:

1. **StyleRules** indexes the page's style rules by the key of each selector's
   rightmost compound and matches them with `element.matches()`
   (specificity, source order, `@media`, `@supports`, `@layer`, nesting,
   routed `:hover` / `:active`). `::before` / `::after` rules are indexed by
   their element part; LayoutTree turns their `content` into boxes.
2. **StyleResolver** cascades UA defaults, rules and inline styles
   (`!important` included), resolves `var()`, maps logical properties to
   physical ones, and returns layout-ready values.
   A computed style is reused while its inputs (parent style object, style
   attribute, matched rules, UA attributes, viewport, generation) are the same.
3. **LayoutEngine** builds boxes (`LayoutTree`) and runs block, inline, flex,
   grid (named lines, `grid-template-areas`) and table layout, `aspect-ratio`,
   positioning, overflow and transforms. It is
   incremental: RenderSurface records changed elements from its
   MutationObserver; untouched subtrees with the same style keep their boxes,
   and `layoutBox` skips a box already laid out with the same inputs. Flex and
   grid request an item's layout several times per pass (measure, size,
   stretch), so a box keeps the sizes of its last four requests: a repeated
   request reuses its size without laying the subtree out, and a box whose
   last request in a pass was such a reuse is laid out for real before
   `finalize`. Attribute changes rebuild the element's subtree (rule matches below may
   change); state selectors rebuild only below the element that changed state.
4. **DisplayListBuilder** walks stacking contexts in CSS paint order and packs
   items (boxes, borders, shadows, gradient and image background layers, text
   runs, images, form control parts), skipping what cannot reach the
   viewport. Colour `filter` functions compose per stacking context into a
   matrix every item of the context carries; `filter: blur()` and
   `backdrop-filter` become effect commands in the item stream.
5. **GpuPainter** draws all items with one instanced pipeline from atlas pages
   on a VirtualGPU lease. With effect commands it splits into passes: a
   blurred layer draws into its own texture, **BlurPass** blurs it and an item
   draws it back; a backdrop copies what is drawn under the element, blurs
   and filters it, and draws it under the element's background. Effect
   textures, uniforms and bind groups are pooled across frames, so a repeated
   frame creates no GPU objects.
   **AnimationController** applies animations between layout and paint: the
   browser keeps running every CSS transition, @keyframes animation and Web
   Animation on the invisible scene, so each frame reads the running
   animations (`getAnimations`) and paints the animated values the browser
   computes (`getComputedStyle`): opacity, colours, borders, outlines,
   shadows, filters and transforms. Width, height and offset transitions
   ease the geometry of leaf boxes between layouts.

Texture targets: `renderTo(view, options)` paints into any texture of the
painter's format, optionally into the host's command encoder over its content;
`present: false` makes a surface with no canvas of its own.

**PlaunaGPUBridge** (`plauna/particle/bridge.js`) puts Plauna into a host GPU
frame: textures for surface-manager surfaces (Plauna-painted elements and
RenderSurfaces, copied canvases/images/video, host textures), composited by
`SurfaceCompositor` with shape masks; text labels painted by an off-page
RenderSurface; `projectWorldAnchor` for UIAnchor entities; routed `pointer()`
input. Its GPU modules load on `initialize()`, so DOM-only apps do not load
them. **PlaunaSurfaceRenderer** (`createRenderer`) draws surfaces inside a
host's pass or a pass of its own, and can share the bridge's compositor.

**VisualTree** takes geometry from a layout source: PlaunaApp gives it the GPU
surface's layout, or a LayoutEngine pass in DOM mode, so every rendered node's
`layoutBox` is real; DOMRenderer uses those widths for Pretext line layout.

WebGPU texture panels in workspaces (`WorkspaceCompositor`) are separate.

---

## Key Patterns

### 1. Retained Mode with Dirty Flags

Instead of virtual DOM diffing, Plauna uses retained mode with dirty flags:

```javascript
// Mark node as dirty when state changes; the renderer syncs it on the next microtask
this.markDirty(DIRTY.STYLE | DIRTY.LAYOUT);

// Need the DOM updated right now (for a measurement, say)?
widgetRenderer.flush();
```

### 2. Widget Instantiation Pattern

Instantiate directly and render, or let `create()` mount into a container:

```javascript
const button = new Button('my-button', options);
container.appendChild(widgetRenderer.render(button));

const mounted = Button.create(container, options);
```

### 3. Story Pattern for Widgets

Define named story configurations for the gallery:

```javascript
static stories() {
    return {
        'Primary Button': { variant: 'primary', size: 'md' },
        'Disabled': { disabled: true },
        'Loading': { loading: true }
    };
}
```

### 4. Theme Extension Pattern

Themes extend parent themes and only override what's needed:

```json
{
  "extends": "dark",
  "variables": {
    "color-primary": "#3b82f6",
    "null-values-inherit": null
  }
}
```

### 5. Observer Pattern for Tokens

DesignTokens use observer pattern for change notifications:

```javascript
tokens.addObserver((path, value, oldValue) => {
    console.log(`${path} changed from ${oldValue} to ${value}`);
});
```

### 6. Back-Reference Pattern

DOM elements store reference to their UINode:

```javascript
element._plaunaNode = node;  // Set by DOMRenderer
```

Used by SmartContextMenu for DOM fallback scanning.

---

## Common Gotchas

1. **Child lists hold only UINodes**: `appendChild()` rejects raw DOM nodes. Wrap them with `node.appendElement(element)`.

2. **Toast positioning in showcase**: Tooltips must be appended to `document.body` for correct overlay positioning in the showcase environment.

3. **Updates land on the next microtask**: `setStyle()` and other setters mark the node dirty; the renderer writes the DOM in a microtask. Call `renderer.flush()` or `renderer.updateNode(node)` when you need it synchronously, instead of writing the element directly.

4. **ThemeLoader BASE_URL**: Must be `'./'` not `'./themes/'` because ThemeLoader lives inside themes/ directory.

5. **GPU panel constraint**: Only one WebGPU canvas context allowed per page. All GPU panels share the same device and canvas.

6. **Dirty flag propagation**: `appendChild()`, `removeChild()` and `clearChildren()` mark the parent `DIRTY.CHILDREN` themselves; code that edits `children` directly must do the same.

7. **Widget stories**: Use correct property names (e.g., `content` not `label` for Badge, `name` not `initials` for Avatar).

---

## Summary

Plauna is a retained-mode UI system with:
- **VisualTree** for retained-mode UI tree management
- **UINode** as base class for all UI elements
- **DOMRenderer** as the one renderer (WidgetRenderer is its shared instance)
- **WidgetRegistry** for widget discovery and instantiation
- **ThemeLoader** for file-based theme management
- **WorkspaceManager** for virtual desktops
- **NotificationSystem** and **ToastManager** for user feedback
- **SmartContextMenu** for context-aware inspection
- **Development tools** (inspector, hot reload) for debugging

The architecture is modular and designed for both production use and development workflows.
