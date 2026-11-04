// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * ============================================================================
 * WidgetRenderer - standalone widget rendering
 * ============================================================================
 *
 * Plauna has one renderer, core/DOMRenderer.js. WidgetRenderer is that
 * renderer without a container: render(widget) returns the widget's element
 * for the caller to place, and the element keeps itself in sync with the
 * widget afterwards (see DOMRenderer for the model).
 *
 * `widgetRenderer` is the shared instance every widget's static create() and
 * the showcase use.
 */

import { DOMRenderer } from '../core/DOMRenderer.js';

export class WidgetRenderer extends DOMRenderer {
    constructor(options = {}) {
        super({ usePretext: false, ...options, container: options.container ?? null });
    }

    /**
     * Re-apply a node to its element. `element` is accepted for compatibility;
     * the node's own binding decides what is written.
     */
    updateDOMElement(node, element = null) {
        if (!this.nodeToDOM.has(node) && element) {
            node.element = element;
        }
        this.renderNode(node);
    }

    // Standalone widgets may already be bound to another renderer
    getDOMElement(node) {
        return this.nodeToDOM.get(node) ?? node?.element ?? null;
    }
}

// Global renderer instance
export const widgetRenderer = new WidgetRenderer();
