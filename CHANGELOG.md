<!-- SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel> -->
<!-- SPDX-License-Identifier: MIT -->

# Changelog

## v0.3.0-alpha

This release ports the Particle Engine implementation into the standalone Plauna repository and advances Plauna from 0.2.0 to **0.3.0**. The build channel remains **alpha**.

- Packages Plauna's retained UI, widgets, themes, workspaces, state/bindings, text, and rendering modules with the support files they import.
- Exposes source imports through `index.js` and the compiled API through `dist/plauna.js` / `globalThis.Plauna`.
- Includes `RenderSurface` with DOM, GPU, and automatic mode selection, native input retention, GPU failure fallback, native-content wells, worker painting, and host rendering hooks.
- Provides source and compiled examples sharing one application, with interactive widgets, render-mode controls, theme switching, and explicit resource release.
- Includes the Particle Engine widget showcase, with browsable widget stories, interactive controls, and source or compiled runtime loading.
- Records selected files and provenance in `plauna-manifest.json` and documents the Plauna MIT / engine alpha license boundary.
- Replaces stale 0.2.0 release labeling with v0.3.0-alpha in the standalone release's current version metadata and documentation.

The 0.3.0 showcase capture recorded 91 widgets in seven categories, with 329 stories. The gallery was captured in dark and light themes. The compiled Chart playground reported GPU rendering and two painted frames at capture time.
