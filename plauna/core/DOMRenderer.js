// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * ============================================================================
 * DOMRenderer - the one UINode → DOM renderer
 * ============================================================================
 *
 * Every Plauna surface renders through this class: PlaunaApp's visual tree,
 * standalone widgets (widgets/WidgetRenderer.js is a thin subclass of it), the
 * showcase and the tests.
 *
 * MODEL:
 * - One element per UINode. The element is created once and kept on
 *   `node.element`; `element._plaunaNode` points back at the node.
 * - Child lists hold only UINodes. Raw DOM content arrives as ElementNode
 *   children (UINode.appendElement) and is placed as-is.
 * - After the first render the node remembers its renderer, and every
 *   markDirty() schedules a microtask sync of that node: styles, attributes,
 *   text and children are reconciled against the element. render(node) and
 *   updateNode(node) sync immediately.
 * - Only values that changed since the last sync are written, so user input
 *   in native fields is never overwritten by a re-sync.
 *
 * ENTRY POINTS:
 * - render(visualTree | {root})  clears the container, renders root into it
 * - render(node)                 returns the node's element (no container)
 * - renderNode(node)             same as render(node)
 * - updateNode(node)             synchronous re-sync of one node
 * - unmount(nodeOrElement), clear(), destroy()
 *
 * EVENTS:
 * - DOM event types registered with node.addEventListener() get one native
 *   listener on the element. Handlers receive a synthetic event whose
 *   `target` is the node and `originalEvent` the native event; any other
 *   property (key, clientX, button, ...) reads through to the native event,
 *   and `domTarget` is the native target element.
 * - Types the node dispatches itself (its class's `static emits`, e.g. a
 *   widget's own 'change') are never forwarded: native events of those types
 *   bubbling up from inner parts do not reach the node's listeners.
 *
 * TEXT:
 * - A node without children shows `textContent` (or legacy `innerHTML`,
 *   always as literal text). With a text service and `usePretext`, 'text' and
 *   'button' nodes are laid out line by line through PlaunaTextService.
 */
import { DIRTY, NODE_STATE } from './UINode.js';
import { tokens } from '../style/DesignTokens.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Numbers on these properties stay unitless; every other numeric style gets px
const UNITLESS_PROPERTIES = new Set([
    'opacity', 'zIndex', 'flex', 'flexGrow', 'flexShrink', 'fontWeight', 'lineHeight', 'order',
    'zoom', 'orphans', 'widows', 'columnCount', 'gridRow', 'gridColumn', 'gridRowStart',
    'gridRowEnd', 'gridColumnStart', 'gridColumnEnd', 'tabSize', 'aspectRatio', 'scale',
    'animationIterationCount', 'fillOpacity', 'strokeOpacity', 'stopOpacity', 'strokeWidth'
]);

// Token words some nodes write straight into styles ('spacing.sm', 'radius.md', ...)
const STYLE_TOKEN_WORD = /\b(?:spacing|radius|borderRadius|fontSizes|fontWeights|shadows|typography\.(?:fontWeight|fontSize|lineHeight))\.[A-Za-z0-9]+\b/g;
const STYLE_COLOR_TOKEN = /color\(([A-Za-z0-9.]+)\)/g;

const SVG_TAGS = new Set([
    'svg', 'circle', 'clipPath', 'defs', 'ellipse', 'g', 'line', 'linearGradient', 'mask',
    'path', 'pattern', 'polygon', 'polyline', 'radialGradient', 'rect', 'stop', 'symbol',
    'text', 'tspan', 'use'
]);

const HTML_TAGS = new Set([
    'a', 'abbr', 'article', 'aside', 'audio', 'b', 'blockquote', 'br', 'button', 'canvas', 'caption',
    'code', 'col', 'colgroup', 'dd', 'details', 'dialog', 'div', 'dl', 'dt', 'em', 'fieldset',
    'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr',
    'i', 'img', 'input', 'kbd', 'label', 'legend', 'li', 'main', 'mark', 'menu', 'meter', 'nav',
    'ol', 'optgroup', 'option', 'output', 'p', 'picture', 'pre', 'progress', 'section', 'select',
    'small', 'source', 'span', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td',
    'textarea', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul', 'video'
]);

// Plauna node types that are not tag names
const TYPE_TAGS = {
    text: 'div',
    image: 'img',
    link: 'a',
    panel: 'div',
    container: 'div'
};

// Elements that never show renderer-managed text
const NO_TEXT_TAGS = new Set(['input', 'img', 'br', 'hr', 'textarea', 'select', 'canvas', 'video', 'audio', 'source', 'col']);

const DOM_EVENTS = new Set([
    'click', 'dblclick', 'contextmenu', 'auxclick',
    'mousedown', 'mouseup', 'mouseenter', 'mouseleave', 'mouseover', 'mouseout', 'mousemove',
    'pointerdown', 'pointerup', 'pointermove', 'pointerenter', 'pointerleave', 'pointercancel',
    'pointerover', 'pointerout', 'gotpointercapture', 'lostpointercapture',
    'touchstart', 'touchmove', 'touchend', 'touchcancel', 'wheel',
    'focus', 'blur', 'focusin', 'focusout',
    'keydown', 'keyup', 'keypress',
    'input', 'change', 'beforeinput', 'submit', 'reset', 'invalid', 'select',
    'scroll', 'load', 'error',
    'dragstart', 'drag', 'dragend', 'dragenter', 'dragover', 'dragleave', 'drop',
    'copy', 'cut', 'paste', 'animationend', 'transitionend'
]);

// UINode property → ARIA attribute. Null or undefined removes the attribute.
const ARIA_PROPERTIES = [
    ['role', 'role'],
    ['ariaLabel', 'aria-label'],
    ['ariaDescription', 'aria-description'],
    ['ariaLabelledBy', 'aria-labelledby'],
    ['ariaLabelledby', 'aria-labelledby'],
    ['ariaDescribedBy', 'aria-describedby'],
    ['ariaDescribedby', 'aria-describedby'],
    ['ariaExpanded', 'aria-expanded'],
    ['ariaSelected', 'aria-selected'],
    ['ariaChecked', 'aria-checked'],
    ['ariaPressed', 'aria-pressed'],
    ['ariaDisabled', 'aria-disabled'],
    ['ariaRequired', 'aria-required'],
    ['ariaReadOnly', 'aria-readonly'],
    ['ariaInvalid', 'aria-invalid'],
    ['ariaHidden', 'aria-hidden'],
    ['ariaLive', 'aria-live'],
    ['ariaAtomic', 'aria-atomic'],
    ['ariaBusy', 'aria-busy'],
    ['ariaModal', 'aria-modal'],
    ['ariaMultiSelectable', 'aria-multiselectable'],
    ['ariaOrientation', 'aria-orientation'],
    ['ariaControls', 'aria-controls'],
    ['ariaHasPopup', 'aria-haspopup'],
    ['ariaCurrent', 'aria-current'],
    ['ariaValueNow', 'aria-valuenow'],
    ['ariaValueMin', 'aria-valuemin'],
    ['ariaValueMax', 'aria-valuemax'],
    ['ariaValueText', 'aria-valuetext'],
    ['ariaLevel', 'aria-level'],
    ['ariaPosInSet', 'aria-posinset'],
    ['ariaSetSize', 'aria-setsize'],
    ['ariaActiveDescendant', 'aria-activedescendant'],
    ['ariaAutocomplete', 'aria-autocomplete'],
    ['ariaRoleDescription', 'aria-roledescription']
];

// userData keys written as DOM properties instead of data-* attributes
const USERDATA_PROPERTIES = {
    src: (element, value) => { element.src = value; },
    alt: (element, value) => { element.alt = value; },
    href: (element, value) => { element.href = value; },
    value: (element, value) => { if ('value' in element) element.value = value ?? ''; },
    checked: (element, value) => { if ('checked' in element) element.checked = Boolean(value); },
    disabled: (element, value) => { if ('disabled' in element) element.disabled = Boolean(value); },
    placeholder: (element, value) => { if ('placeholder' in element) element.placeholder = value ?? ''; },
    type: (element, value) => { if (element.tagName === 'INPUT' || element.tagName === 'BUTTON') element.type = value; },
    name: (element, value) => { if ('name' in element) element.name = value; },
    required: (element, value) => { if ('required' in element) element.required = Boolean(value); },
    readonly: (element, value) => { if ('readOnly' in element) element.readOnly = Boolean(value); },
    for: (element, value) => { if (element.tagName === 'LABEL') element.htmlFor = value; }
};

// Theme-aware replacements for legacy color(...) style tokens
const COLOR_TOKENS = {
    'color(text.primary)': 'var(--text-primary, #ffffff)',
    'color(text.secondary)': 'var(--text-secondary, #a0a0a0)',
    'color(background.primary)': 'var(--bg-primary, #07111d)',
    'color(background.secondary)': 'var(--bg-secondary, #1a2332)',
    'color(background.tertiary)': 'var(--bg-tertiary, #2a3442)',
    'color(border.primary)': 'var(--border-medium, #333333)',
    'color(primary.500)': 'var(--color-primary-500, #3b82f6)',
    'color(background.info)': 'var(--color-info, #3b82f6)',
    'color(background.success)': 'var(--color-success, #10b981)',
    'color(background.warning)': 'var(--color-warning, #f59e0b)',
    'color(background.error)': 'var(--color-error, #ef4444)',
    'color(background.accent)': 'var(--color-accent, #8b5cf6)'
};

const DOM_NODE = typeof Node === 'undefined' ? null : Node;

function isDomNode(value) {
    return DOM_NODE !== null && value instanceof DOM_NODE;
}

function isTreeLike(value) {
    return value !== null && typeof value === 'object' && 'root' in value && !Array.isArray(value.children);
}

function resolveTag(node) {
    for (const candidate of [node.tag, TYPE_TAGS[node.type], node.type]) {
        if (typeof candidate === 'string' && (HTML_TAGS.has(candidate) || SVG_TAGS.has(candidate))) {
            return candidate;
        }
    }
    return 'div';
}

function toKebab(property) {
    return property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function createSyntheticEvent(type, node, native) {
    const event = {
        type,
        target: node,
        currentTarget: node,
        originalEvent: native,
        nativeEvent: native,
        domTarget: native.target,
        preventDefault() { native.preventDefault(); },
        stopPropagation() { native.stopPropagation(); },
        stopImmediatePropagation() { native.stopImmediatePropagation(); },
        get defaultPrevented() { return native.defaultPrevented; }
    };
    return new Proxy(event, {
        get(target, key, receiver) {
            if (key in target) return Reflect.get(target, key, receiver);
            const value = native[key];
            return typeof value === 'function' ? value.bind(native) : value;
        },
        has(target, key) {
            return key in target || key in native;
        }
    });
}

// Per-element bookkeeping of what the renderer last wrote
function stateOf(element) {
    let state = element.__plaunaRender;
    if (!state) {
        state = {
            created: false,
            styles: new Map(),
            attributes: new Map(),
            properties: new Map(),
            events: new Set(),
            text: null,
            textNode: null,
            textSpans: []
        };
        Object.defineProperty(element, '__plaunaRender', { value: state, configurable: true });
    }
    return state;
}

export class DOMRenderer {
    constructor(options = {}) {
        this.container = options.container === undefined
            ? (typeof document === 'undefined' ? null : document.body)
            : options.container;
        this.textService = options.textService || null;
        this.usePretext = options.usePretext !== false;
        this.debugMode = options.debug || false;
        this.nodeToDOM = new Map();
        this.domToNode = new Map();
        this.renderedNodes = new Set();
        this._pending = new Set();
        this._flushQueued = false;
        this._destroyed = false;
    }

    /**
     * Render a visual tree into the container (`{root}` or a VisualTree), or
     * render a single node and return its element.
     */
    render(target) {
        if (!target) return null;
        if (isDomNode(target)) return target;
        if (isTreeLike(target)) {
            if (!target.root) {
                console.warn('[DOMRenderer] No visual tree or root node to render');
                return null;
            }
            this.clear();
            const rootElement = this.renderNode(target.root);
            if (rootElement && this.container) {
                this.container.appendChild(rootElement);
            }
            if (this.debugMode) {
                console.log('[DOMRenderer] Rendered visual tree with', this.nodeToDOM.size, 'nodes');
            }
            return rootElement;
        }
        return this.renderNode(target);
    }

    /** Return the node's element, creating it on first render; always syncs it. */
    renderNode(node) {
        if (!node) return null;
        if (isDomNode(node)) return node;
        const alreadyBound = Boolean(node.element) && this.nodeToDOM.get(node) === node.element;
        const element = this.bind(node);
        if (alreadyBound && !node.isElementHost) this.sync(node);
        return element;
    }

    /**
     * Make sure the node has an element registered with this renderer. A new
     * binding gets a full sync; an existing one is returned untouched.
     */
    bind(node) {
        if (node.element && this.nodeToDOM.get(node) === node.element) {
            return node.element;
        }
        const element = node.element || this.createElement(node);
        node.element = element;
        node._renderer = this;
        if (!node.isElementHost) {
            element._plaunaNode = node;
        }
        this.nodeToDOM.set(node, element);
        this.domToNode.set(element, node);
        this.renderedNodes.add(node);
        if (!node.isElementHost) {
            this.sync(node);
        }
        return element;
    }

    // Kept for existing callers: creates (or reuses) and syncs the node's element
    createDOMElement(node) {
        return this.bind(node);
    }

    createElement(node) {
        const tag = resolveTag(node);
        const element = SVG_TAGS.has(tag)
            ? document.createElementNS(SVG_NS, tag)
            : document.createElement(tag);
        stateOf(element).created = true;
        if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') {
            // Keep the node's value in step with what the user types
            const syncValue = () => {
                node.value = element.value;
                stateOf(element).properties.set('value', element.value);
            };
            element.addEventListener('input', syncValue);
            element.addEventListener('change', syncValue);
        }
        return element;
    }

    /** Synchronously re-apply a node to its element. */
    updateNode(node) {
        if (!node || !this.nodeToDOM.has(node)) {
            console.warn('[DOMRenderer] Node not rendered:', node?.id ?? node);
            return;
        }
        this.sync(node);
    }

    /** Called by UINode.markDirty(); batches syncs into one microtask. */
    schedule(node) {
        if (this._destroyed || !this.nodeToDOM.has(node)) return;
        this._pending.add(node);
        if (!this._flushQueued) {
            this._flushQueued = true;
            queueMicrotask(() => this.flush());
        }
    }

    /** Apply every scheduled sync now. */
    flush() {
        this._flushQueued = false;
        let passes = 0;
        while (this._pending.size > 0 && passes++ < 8) {
            const batch = [...this._pending];
            this._pending.clear();
            for (const node of batch) {
                if (!this.nodeToDOM.has(node)) continue;
                try {
                    this.sync(node);
                } catch (error) {
                    console.error(`[DOMRenderer] Sync failed for ${node.type}#${node.id}:`, error);
                }
            }
        }
    }

    /** Called by UINode.addEventListener() after render, so late listeners still attach. */
    listen(node, eventType) {
        const element = this.nodeToDOM.get(node);
        if (element && !node.isElementHost) {
            this.attachEventListeners(element, node, [eventType]);
        }
    }

    sync(node) {
        const element = this.nodeToDOM.get(node);
        if (!element || node.isElementHost) return;
        this._pending.delete(node);
        const state = stateOf(element);

        if (node.id && element.id !== String(node.id)) {
            element.id = node.id;
        }
        if (state.created || node.className) {
            const className = node.className || '';
            if (element.getAttribute('class') !== className && !(className === '' && !element.hasAttribute('class'))) {
                element.setAttribute('class', className);
            }
        }
        this.applyStyles(element, node);
        this.applyAccessibility(element, node);
        this.applyUserData(element, node);
        this.applyNodeProperties(element, node);
        this.attachEventListeners(element, node);
        if (state.created) {
            this.applyText(element, node);
        }
        this.reconcileChildren(element, node, state);
        node.clearDirty(DIRTY.ALL);
    }

    applyStyles(element, node) {
        const state = stateOf(element);
        const next = { ...(node.computedStyle || {}), ...(node.style || {}) };
        for (const [property, raw] of Object.entries(next)) {
            const value = this.resolveStyleValue(property, raw);
            if (state.styles.get(property) === value) continue;
            this.writeStyle(element, property, value);
            state.styles.set(property, value);
        }
        for (const property of [...state.styles.keys()]) {
            if (!(property in next)) {
                this.writeStyle(element, property, '');
                state.styles.delete(property);
            }
        }
    }

    writeStyle(element, property, value) {
        if (!element.style) return;
        if (property.startsWith('--') || property.includes('-')) {
            if (value === '') element.style.removeProperty(property);
            else element.style.setProperty(property, value);
            return;
        }
        if (property in element.style) {
            element.style[property] = value;
        } else if (value === '') {
            element.style.removeProperty(toKebab(property));
        } else {
            element.style.setProperty(toKebab(property), value);
        }
    }

    /**
     * Turn a node style value into CSS: numbers get px unless the property is
     * unitless, and token references (color(text.primary), spacing.md,
     * radius.sm, ...) resolve to theme variables through tokens.css().
     */
    resolveStyleValue(property, raw) {
        if (raw === undefined || raw === null || raw === false) return '';
        if (typeof raw === 'number') {
            return Number.isFinite(raw) && !UNITLESS_PROPERTIES.has(property) && raw !== 0 ? `${raw}px` : String(raw);
        }
        let value = String(raw);
        if (value.includes('color(')) {
            value = value.replace(STYLE_COLOR_TOKEN, (match, path) => COLOR_TOKENS[match] || tokens.css(`colors.${path}`) || match);
        }
        if (value.includes('.')) {
            value = value.replace(STYLE_TOKEN_WORD, (match) => {
                const resolved = tokens.css(match.startsWith('radius.') ? `borderRadius.${match.slice(7)}` : match);
                return resolved || match;
            });
        }
        return value;
    }

    // Kept for callers that resolve legacy color(...) tokens themselves
    resolveColorToken(token) {
        return COLOR_TOKENS[token] || (token.startsWith('color(') ? this.resolveStyleValue('color', token) : token);
    }

    applyAccessibility(element, node) {
        const desired = new Map();
        for (const [property, attribute] of ARIA_PROPERTIES) {
            const value = node[property];
            if (value !== null && value !== undefined && value !== '') {
                desired.set(attribute, String(value));
            }
        }
        if (node.tabIndex !== null && node.tabIndex !== undefined) {
            desired.set('tabindex', String(node.tabIndex));
        }
        const state = stateOf(element);
        if (Number.isInteger(node.stateFlags)) {
            const formElement = element.tagName === 'INPUT' || element.tagName === 'TEXTAREA'
                || element.tagName === 'SELECT' || element.tagName === 'BUTTON';
            const disabled = (node.stateFlags & NODE_STATE.DISABLED) !== 0
                || node.userData?.disabled === true
                || (formElement && node.disabled === true);
            if ('disabled' in element && state.properties.get('disabled:state') !== disabled) {
                state.properties.set('disabled:state', disabled);
                element.disabled = disabled;
            }
            if (disabled && !desired.has('aria-disabled')) desired.set('aria-disabled', 'true');
            if (!(node.stateFlags & NODE_STATE.VISIBLE) && !desired.has('aria-hidden')) desired.set('aria-hidden', 'true');
        }
        if (node.hidden !== null && node.hidden !== undefined && element.hidden !== Boolean(node.hidden)) {
            element.hidden = Boolean(node.hidden);
        }
        if (node.attributes instanceof Map) {
            for (const [name, value] of node.attributes) desired.set(name, value);
        }
        for (const [name, value] of desired) {
            if (state.attributes.get(name) === value && element.getAttribute(name) === value) continue;
            try {
                element.setAttribute(name, value);
                state.attributes.set(name, value);
            } catch {
                // Attribute names come from widget data; skip names the DOM rejects.
            }
        }
        for (const name of [...state.attributes.keys()]) {
            if (!desired.has(name)) {
                element.removeAttribute(name);
                state.attributes.delete(name);
            }
        }
    }

    applyUserData(element, node) {
        if (!node.userData || typeof node.userData !== 'object') return;
        const state = stateOf(element);
        const svg = element.namespaceURI === SVG_NS;
        for (const [key, value] of Object.entries(node.userData)) {
            if (typeof value === 'function' || (value !== null && typeof value === 'object')) continue;
            const marker = `userData:${key}`;
            if (state.properties.has(marker) && Object.is(state.properties.get(marker), value)) continue;
            state.properties.set(marker, value);
            if (svg) {
                if (value === null || value === undefined) element.removeAttribute(key);
                else element.setAttribute(key, String(value));
            } else if (USERDATA_PROPERTIES[key]) {
                USERDATA_PROPERTIES[key](element, value);
            } else {
                try {
                    if (value === null || value === undefined) element.removeAttribute(`data-${key}`);
                    else element.setAttribute(`data-${key}`, String(value));
                } catch {
                    // Skip keys that are not valid attribute names.
                }
            }
        }
    }

    // Native field properties read straight off the node (value, placeholder, ...)
    applyNodeProperties(element, node) {
        const tag = element.tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') return;
        const state = stateOf(element);
        const write = (key, value, apply) => {
            if (value === undefined || value === null) return;
            if (Object.is(state.properties.get(key), value)) return;
            state.properties.set(key, value);
            apply(value);
        };
        write('value', node.value, (value) => { if (element.value !== String(value)) element.value = value; });
        write('placeholder', node.placeholder, (value) => { element.placeholder = value; });
        write('maxLength', node.maxLength, (value) => { element.maxLength = value; });
        write('minLength', node.minLength, (value) => { element.minLength = value; });
        write('pattern', node.pattern, (value) => { if ('pattern' in element) element.pattern = value; });
        write('required', node.required, (value) => { element.required = Boolean(value); });
        write('readonly', node.readonly, (value) => { if ('readOnly' in element) element.readOnly = Boolean(value); });
    }

    attachEventListeners(element, node, types = null) {
        if (!node.eventHandlers) return;
        const state = stateOf(element);
        for (const type of types ?? node.eventHandlers.keys()) {
            if (!DOM_EVENTS.has(type) || state.events.has(type)) continue;
            // The node's own events of this type are its dispatchEvent() calls
            if (node.constructor?.emits?.includes(type)) continue;
            state.events.add(type);
            element.addEventListener(type, (nativeEvent) => {
                const handlers = node.eventHandlers.get(type);
                if (!handlers || handlers.length === 0) return;
                const syntheticEvent = createSyntheticEvent(type, node, nativeEvent);
                for (const handler of [...handlers]) {
                    try {
                        handler.call(node, syntheticEvent);
                    } catch (error) {
                        console.error(`[DOMRenderer] Error in ${type} handler of ${node.type}#${node.id}:`, error);
                    }
                }
            });
        }
    }

    applyText(element, node) {
        const state = stateOf(element);
        const tag = element.tagName.toLowerCase();
        const hasChildren = node.children.length > 0;
        const text = hasChildren || NO_TEXT_TAGS.has(tag)
            ? ''
            : String(node.innerHTML ? node.innerHTML : (node.textContent ?? ''));

        // Measured line layout needs a known width; otherwise the browser wraps natively
        const usePretext = Boolean(text) && this.usePretext && this.textService
            && (node.type === 'text' || node.type === 'button')
            && this.getTextLayoutWidth(node) !== null;
        const key = usePretext ? `pretext:${text}` : text;
        if (state.text === key) return;
        state.text = key;

        for (const span of state.textSpans) span.remove();
        state.textSpans = [];
        if (usePretext) {
            state.textNode?.remove();
            state.textNode = null;
            this.renderTextNode(element, node, text);
            return;
        }
        if (!text) {
            state.textNode?.remove();
            state.textNode = null;
            return;
        }
        if (!state.textNode) {
            state.textNode = document.createTextNode(text);
            element.insertBefore(state.textNode, element.firstChild);
        } else {
            state.textNode.data = text;
            if (state.textNode.parentNode !== element) element.insertBefore(state.textNode, element.firstChild);
        }
    }

    getTextStyle(node) {
        const styles = { ...(node.computedStyle || {}), ...(node.style || {}) };
        const fontSize = Number.parseFloat(styles.fontSize) || 14;
        const numericLineHeight = Number.parseFloat(styles.lineHeight);
        const fontWeight = Number.parseInt(styles.fontWeight, 10) || 400;
        // Small unitless line heights (1.5) are multipliers of the font size
        const lineHeight = Number.isFinite(numericLineHeight)
            ? (numericLineHeight < 4 ? Math.round(fontSize * numericLineHeight) : numericLineHeight)
            : Math.round(fontSize * 1.45);
        return {
            fontFamily: styles.fontFamily || 'Inter',
            fontSize,
            fontWeight,
            lineHeight,
            color: typeof styles.color === 'string' ? this.resolveColorToken(styles.color) : styles.color
        };
    }

    getTextLayoutWidth(node) {
        const styles = { ...(node.computedStyle || {}), ...(node.style || {}) };
        const explicitWidth = Number.parseFloat(styles.width);
        if (Number.isFinite(explicitWidth) && explicitWidth > 0) {
            return explicitWidth;
        }
        if (node.layoutBox && Number.isFinite(node.layoutBox.width) && node.layoutBox.width > 0) {
            return node.layoutBox.width;
        }
        return null;
    }

    // Pretext line layout: one block span per measured line
    renderTextNode(element, node, text = node.textContent || '') {
        const state = stateOf(element);
        const style = this.getTextStyle(node);
        const width = this.getTextLayoutWidth(node);
        const handle = this.textService.prepare(text, style);
        const layout = this.textService.layout(handle, width, style.lineHeight);

        element.dataset.pretext = '1';
        element.style.display = 'inline-flex';
        element.style.flexDirection = 'column';
        element.style.alignItems = 'flex-start';
        element.style.whiteSpace = 'normal';
        element.style.lineHeight = `${style.lineHeight}px`;
        if (width) {
            element.style.width = `${width}px`;
        }
        element.style.minHeight = `${layout.height}px`;

        let reference = element.firstChild;
        for (const line of layout.lines) {
            const lineElement = document.createElement('span');
            lineElement.textContent = line;
            lineElement.style.display = 'block';
            lineElement.style.lineHeight = `${style.lineHeight}px`;
            lineElement.style.fontFamily = style.fontFamily;
            lineElement.style.fontSize = `${style.fontSize}px`;
            lineElement.style.fontWeight = String(style.fontWeight);
            if (style.color) {
                lineElement.style.color = style.color;
            }
            element.insertBefore(lineElement, reference);
            state.textSpans.push(lineElement);
        }
    }

    reconcileChildren(element, node, state) {
        const desired = [];
        for (const child of node.children) {
            // Widgets often assign a child's text or style and mark only the
            // parent dirty, so a parent sync re-syncs its rendered children too
            const alreadyBound = Boolean(child.element) && this.nodeToDOM.get(child) === child.element;
            const childElement = this.bind(child);
            if (alreadyBound && !child.isElementHost) this.sync(child);
            if (childElement) desired.push(childElement);
        }
        const wanted = new Set(desired);

        // Drop elements of children that left this node
        for (const existing of [...element.childNodes]) {
            const owner = this.domToNode.get(existing);
            if (owner && !wanted.has(existing) && owner.parent !== node) {
                existing.remove();
            }
        }

        if (state.created) {
            // Renderer-made element: children follow the renderer's own text in order
            let reference = state.textNode && state.textNode.parentNode === element
                ? state.textNode.nextSibling
                : element.firstChild;
            while (reference && state.textSpans.includes(reference)) reference = reference.nextSibling;
            for (const childElement of desired) {
                if (reference === childElement) {
                    reference = reference.nextSibling;
                    continue;
                }
                element.insertBefore(childElement, reference);
            }
            return;
        }

        // Adopted element: keep the widget's own content, append children in order
        let ordered = true;
        let previous = null;
        for (const childElement of desired) {
            if (childElement.parentNode !== element) {
                ordered = false;
                break;
            }
            if (previous && previous.compareDocumentPosition(childElement) & Node.DOCUMENT_POSITION_PRECEDING) {
                ordered = false;
                break;
            }
            previous = childElement;
        }
        if (!ordered) {
            for (const childElement of desired) element.appendChild(childElement);
        }
    }

    // Add a child node to DOM
    addChild(parentNode, childNode) {
        if (parentNode.children.includes(childNode) && this.nodeToDOM.has(parentNode)) {
            this.sync(parentNode);
            return this.nodeToDOM.get(childNode) ?? null;
        }
        const parentDOM = this.nodeToDOM.get(parentNode);
        const childDOM = this.renderNode(childNode);
        if (parentDOM && childDOM) {
            parentDOM.appendChild(childDOM);
        }
        return childDOM;
    }

    // Remove a child node from DOM
    removeChild(parentNode, childNode) {
        const childDOM = this.nodeToDOM.get(childNode);
        childDOM?.remove();
        this.forget(childNode);
    }

    /** Remove a node's element from the page and forget the binding. */
    unmount(nodeOrElement) {
        const node = isDomNode(nodeOrElement) ? this.domToNode.get(nodeOrElement) : nodeOrElement;
        const element = isDomNode(nodeOrElement) ? nodeOrElement : this.nodeToDOM.get(nodeOrElement);
        element?.remove();
        if (node) this.forget(node);
        else if (element) this.domToNode.delete(element);
    }

    /** Called by UINode.destroy(): remove the element and drop every mapping. */
    release(node) {
        const element = this.nodeToDOM.get(node) ?? node.element;
        element?.remove?.();
        this.forget(node);
    }

    forget(node) {
        const element = this.nodeToDOM.get(node);
        this.nodeToDOM.delete(node);
        if (element) this.domToNode.delete(element);
        this.renderedNodes.delete(node);
        this._pending.delete(node);
        if (node._renderer === this) node._renderer = null;
    }

    // Clear all rendered content
    clear() {
        if (this.container) {
            this.container.innerHTML = '';
        }
        for (const node of this.nodeToDOM.keys()) {
            if (node._renderer === this) node._renderer = null;
        }
        this.nodeToDOM.clear();
        this.domToNode.clear();
        this.renderedNodes.clear();
        this._pending.clear();
    }

    // Get DOM element for a node
    getDOMElement(node) {
        return this.nodeToDOM.get(node);
    }

    // Get UINode for a DOM element
    getUINode(domElement) {
        return this.domToNode.get(domElement) || domElement?._plaunaNode || null;
    }

    // Find a node by ID
    findNode(id) {
        for (const node of this.nodeToDOM.keys()) {
            if (node.id === id) {
                return node;
            }
        }
        return null;
    }

    // Find a DOM element by ID
    findDOMElement(id) {
        for (const [node, domElement] of this.nodeToDOM) {
            if (node.id === id) {
                return domElement;
            }
        }
        return null;
    }

    // Get statistics
    getStats() {
        return {
            renderedNodes: this.renderedNodes.size,
            nodeToDOMMappings: this.nodeToDOM.size,
            domToNodeMappings: this.domToNode.size
        };
    }

    // Destroy renderer
    destroy() {
        this.clear();
        this.container = null;
        this._destroyed = true;
    }
}
