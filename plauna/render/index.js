// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Plauna rendering: DOM, GPU and auto render modes.
 *
 * RenderSurface hosts a scene and shows it in the chosen mode. The layout
 * pass (LayoutEngine, StyleResolver, TextShaper) is DOM-free and can be used
 * on its own; the GPU painter loads on demand.
 */

export { RenderSurface } from './RenderSurface.js';
export { RENDER_MODES, normalizeRenderMode, gpuAvailable, domOnlyContent, sharedGpuDevice, resolveGpuDevice, DOM_ONLY_SELECTOR } from './RenderModes.js';
export { LayoutEngine, resolveRadii, transformRectBounds, probeScrollbarWidth } from './layout/LayoutEngine.js';
export { StyleResolver, inheritedStyleFromHost } from './css/StyleResolver.js';
export { userAgentStyles, UserAgentStyles } from './css/UserAgentStyles.js';
export { TextShaper, textShaper } from './text/TextShaper.js';
export { AnimationController } from './AnimationController.js';
