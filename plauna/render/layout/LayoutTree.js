// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Layout boxes for Plauna's own layout pass.
 *
 * buildTree() turns an element tree (what DOMRenderer renders) into boxes:
 * one per displayed element, text items for text nodes, and anonymous boxes
 * where CSS creates them (mixed block and inline content, text directly in a
 * flex or grid container). Each box records how it takes part in layout:
 * its outer display (block or inline level) and inner display (flow, flex,
 * grid, table parts, replaced content). The tree is the flat tree: open
 * shadow roots and slots are walked as the browser renders them.
 */

// Elements whose content the layout pass does not lay out
export const REPLACED_TAGS = new Set(['img', 'input', 'textarea', 'select', 'canvas', 'video', 'iframe',
    'progress', 'meter', 'object', 'embed', 'audio']);

export class TextItem {
    constructor(node, text, parent) {
        this.isText = true;
        this.node = node;
        this.text = text;
        this.parent = parent;
    }
}

export class LayoutBox {
    constructor(element, style, parent = null) {
        this.element = element;
        this.style = style;
        this.parent = parent;
        this.children = [];
        this.anonymous = false;
        this.outer = 'block';
        this.inner = 'flow';
        this.atomic = false;
        this.outOfFlow = false;
        this.absolutes = [];
        this.x = 0;
        this.y = 0;
        this.width = 0;
        this.height = 0;
        this.margin = [0, 0, 0, 0];
        this.border = [0, 0, 0, 0];
        this.padding = [0, 0, 0, 0];
        this.lines = null;
        this.runs = null;
        this.fragments = null;
        this.baseline = null;
        this.lastBaseline = null;
        this.staticPos = null;
        this.scrollWidth = 0;
        this.scrollHeight = 0;
        this.intrinsicCache = null;
        this.intrinsicUnseen = null;
    }

    get isPositioned() {
        return this.style.position && this.style.position !== 'static';
    }

    get blockLevel() {
        return this.outer === 'block';
    }

    // An inline-start scrollbar gutter (scrollbar-gutter: stable both-edges,
    // or the vertical bar of a right-to-left box) sits between border and padding
    get contentX() { return this.border[3] + (this.scrollbar?.[2] || 0) + this.padding[3]; }
    get contentY() { return this.border[0] + this.padding[0]; }
    get contentWidth() { return Math.max(0, this.width - this.border[1] - this.border[3] - this.padding[1] - this.padding[3]); }
    get contentHeight() { return Math.max(0, this.height - this.border[0] - this.border[2] - this.padding[0] - this.padding[2]); }

    /** Boxes in normal flow (excludes absolutely positioned children and text). */
    get flowChildren() {
        return this.children.filter((child) => !child.isText && !child.outOfFlow);
    }
}

const BLANK = /^[ \t\n\r\f]*$/;
/** An element marked with this is one box: what is inside it is the browser's (NativeWell). */
export const WELL_ATTRIBUTE = 'data-plauna-well';

/**
 * The children of `element` in the flat tree, as the browser renders it: an
 * element with an open shadow root shows its shadow tree, and a <slot> shows
 * the nodes assigned to it, else its own children (fallback content). A
 * closed shadow root cannot be read, so its host shows its own children.
 */
export function flatChildren(element) {
    if (element.shadowRoot) return element.shadowRoot.childNodes;
    if (element.localName === 'slot' && typeof element.assignedNodes === 'function') {
        const assigned = element.assignedNodes();
        if (assigned.length) return assigned;
    }
    return element.childNodes;
}

/**
 * Whether <slot> `element` is display: contents (its UA default) although
 * its computed style says otherwise: the style tables may lack the slot's
 * default, so the browser's own computed display decides.
 */
function slotContents(element, style) {
    if (element.localName !== 'slot' || style.display !== 'inline' || !element.isConnected) return false;
    return typeof getComputedStyle === 'function' && getComputedStyle(element).display === 'contents';
}

/** The parent of `node` in the flat tree (its slot, or a shadow root's host), or null. */
export function flatParent(node) {
    if (node.assignedSlot) return node.assignedSlot;
    if (node.parentElement) return node.parentElement;
    const parent = node.parentNode;
    return parent?.nodeType === 11 ? parent.host ?? null : null;
}

/** Style for an anonymous box: inherited properties from the parent, everything else initial. */
export function anonymousStyle(parentStyle, display = 'block') {
    return {
        ...parentStyle,
        display,
        position: 'static',
        top: 'auto', right: 'auto', bottom: 'auto', left: 'auto',
        zIndex: 'auto',
        boxSizing: 'content-box',
        width: 'auto', height: 'auto', minWidth: 'auto', minHeight: 'auto', maxWidth: 'none', maxHeight: 'none',
        margin: [{ px: 0 }, { px: 0 }, { px: 0 }, { px: 0 }],
        padding: [{ px: 0 }, { px: 0 }, { px: 0 }, { px: 0 }],
        borderWidth: [0, 0, 0, 0],
        borderStyle: ['none', 'none', 'none', 'none'],
        borderRadius: [[{ px: 0 }, { px: 0 }], [{ px: 0 }, { px: 0 }], [{ px: 0 }, { px: 0 }], [{ px: 0 }, { px: 0 }]],
        backgroundColor: [0, 0, 0, 0],
        backgroundImage: [],
        boxShadow: [],
        dropShadows: [],
        opacity: 1,
        overflowX: 'visible',
        overflowY: 'visible',
        transform: 'none',
        // None of these inherit; an anonymous box must not repeat its parent's
        // clamp, scrollbars or containing block
        lineClamp: null,
        scrollbarWidth: 'auto',
        scrollbarGutter: 'auto',
        webkitScrollbar: null,
        perspective: 'none',
        transformStyle: 'flat',
        filter: 'none',
        backdropFilter: 'none',
        willChange: 'auto',
        contain: 'none',
        contentVisibility: 'visible',
        flexGrow: 0,
        flexShrink: 1,
        flexBasis: 'auto',
        alignSelf: 'auto',
        order: 0,
        outlineWidth: 0,
        outlineStyle: 'none',
        textDecorationLine: 'none',
        transitions: [],
        animationName: 'none',
        verticalAlign: 'baseline',
        gridColumnStart: { auto: true }, gridColumnEnd: { auto: true },
        gridRowStart: { auto: true }, gridRowEnd: { auto: true },
        element: null,
        anonymous: true
    };
}

function classify(box, parentInner) {
    const style = box.style;
    const tag = box.element?.localName || '';
    let display = style.display;
    const replaced = REPLACED_TAGS.has(tag) || tag === 'svg';
    box.outOfFlow = style.position === 'absolute' || style.position === 'fixed';
    // Absolutely positioned boxes and flex/grid items are blockified
    const blockify = box.outOfFlow || parentInner === 'flex' || parentInner === 'grid';
    if (blockify) {
        if (display === 'inline' || display === 'inline-block') display = 'block';
        else if (display === 'inline-flex') display = 'flex';
        else if (display === 'inline-grid') display = 'grid';
        else if (display === 'inline-table') display = 'table';
        else if (display.startsWith('table-') && parentInner !== 'table') display = 'block';
    }
    box.display = display;
    switch (display) {
        case 'block':
        case 'list-item':
        case 'flow-root':
        case '-webkit-box':
            box.outer = 'block';
            box.inner = replaced ? (tag === 'svg' ? 'svg' : 'replaced') : 'flow';
            break;
        case 'inline':
            box.outer = 'inline';
            box.inner = replaced ? (tag === 'svg' ? 'svg' : 'replaced') : 'flow';
            box.atomic = replaced || tag === 'button';
            break;
        case 'inline-block':
            box.outer = 'inline';
            box.inner = replaced ? (tag === 'svg' ? 'svg' : 'replaced') : 'flow';
            box.atomic = true;
            break;
        case 'flex':
            box.outer = 'block';
            box.inner = replaced ? 'replaced' : 'flex';
            break;
        case 'inline-flex':
            box.outer = 'inline';
            box.inner = replaced ? 'replaced' : 'flex';
            box.atomic = true;
            break;
        case 'grid':
            box.outer = 'block';
            box.inner = 'grid';
            break;
        case 'inline-grid':
            box.outer = 'inline';
            box.inner = 'grid';
            box.atomic = true;
            break;
        case 'table':
            box.outer = 'block';
            box.inner = 'table';
            break;
        case 'inline-table':
            box.outer = 'inline';
            box.inner = 'table';
            box.atomic = true;
            break;
        case 'table-row-group':
        case 'table-header-group':
        case 'table-footer-group':
            box.outer = 'table-part';
            box.inner = 'table-row-group';
            break;
        case 'table-row':
            box.outer = 'table-part';
            box.inner = 'table-row';
            break;
        case 'table-cell':
            box.outer = 'table-part';
            box.inner = 'table-cell';
            break;
        case 'table-caption':
            box.outer = 'block';
            box.inner = 'flow';
            box.caption = true;
            break;
        default:
            box.outer = 'block';
            box.inner = replaced ? 'replaced' : 'flow';
    }
    // Buttons lay out as a block container whose content centres vertically
    if (tag === 'button' && box.inner === 'flow') box.isButton = true;
    if (display === 'list-item') box.listItem = true;
}

/**
 * Build the box tree for `element`. Returns null for elements that are not
 * displayed. `ctx.resolver` computes styles; `ctx.rootInherited` is the
 * inherited style at the scene root; `ctx.boxes` maps elements to boxes.
 *
 * Incremental layout: with `ctx.previous` (the last layout's boxes), an
 * element outside `ctx.rebuild` (changed elements and their ancestors) whose
 * computed style is the same object keeps its previous box subtree, and with
 * it the layout results LayoutEngine memoizes per box. The kept root gets
 * `adopted = ctx.pass`; `ctx.boxes` is then the previous map, so the entries
 * of a kept subtree stay as they are.
 */
export function buildTree(element, parentBox, parentStyle, ctx, forced = false) {
    const style = ctx.resolver.compute(element, parentStyle, ctx.rootInherited);
    if (style.display === 'none' || style.display === 'svg-child') return null;
    const contents = style.display === 'contents' || slotContents(element, style);
    // Inside a changed subtree (attribute or structural change) nothing is kept
    const rebuildAll = forced || Boolean(ctx.subtrees?.has(element));
    const previous = rebuildAll ? null : ctx.previous?.get(element);
    if (previous && !ctx.rebuild.has(element) && previous.style === style
        && previous.classifiedIn === parentBox?.inner && !previous.listItem) {
        previous.parent = parentBox;
        previous.adopted = ctx.pass;
        return previous;
    }
    if (contents) {
        const fragment = [];
        for (const child of flatChildren(element)) {
            if (child.nodeType === 1) {
                const built = buildTree(child, parentBox, style, ctx, rebuildAll);
                // (A display: contents child, or a slot forwarded through this one, is a fragment too)
                if (Array.isArray(built)) fragment.push(...built);
                else if (built) fragment.push(built);
            } else if (child.nodeType === 3 && child.data) {
                // Its text takes this element's style (a slot's from its shadow tree's rules), not its box's
                const text = new TextItem(child, child.data, parentBox);
                text.style = style;
                fragment.push(text);
            }
        }
        return fragment;
    }
    const box = new LayoutBox(element, style, parentBox);
    classify(box, parentBox?.inner);
    box.classifiedIn = parentBox?.inner;
    ctx.boxes.set(element, box);

    if (box.inner === 'replaced' || box.inner === 'svg' || element.hasAttribute(WELL_ATTRIBUTE)) return box;

    if (box.listItem && style.listStyleType !== 'none') {
        box.marker = listMarker(element, style);
    }
    const before = generatedBox(element, 'before', box, style, ctx);
    if (before) box.children.push(before);

    // A closed <details> shows only its first <summary>, as the browser does
    const summary = element.localName === 'details' && !element.open
        ? [...element.children].find((child) => child.localName === 'summary') ?? null
        : undefined;
    for (const child of flatChildren(element)) {
        if (summary !== undefined && child !== summary) continue;
        if (child.nodeType === 1) {
            const built = buildTree(child, box, style, ctx, rebuildAll);
            if (Array.isArray(built)) {
                for (const item of built) { item.parent = box; box.children.push(item); }
            } else if (built) {
                box.children.push(built);
            }
        } else if (child.nodeType === 3 && child.data) {
            box.children.push(new TextItem(child, child.data, box));
        }
    }
    if (summary !== undefined) {
        // ...while its content slot stays laid out, empty and isolated, so the
        // summary's bottom margin stays inside the details
        const slot = new LayoutBox(null, anonymousStyle(style, 'flow-root'), box);
        slot.anonymous = true;
        classify(slot, box.inner);
        box.children.push(slot);
    }
    const after = generatedBox(element, 'after', box, style, ctx);
    if (after) box.children.push(after);
    normalizeChildren(box);
    return box;
}

/** The box for `element`'s ::before or ::after when a rule gives it content. */
function generatedBox(element, which, parentBox, parentStyle, ctx) {
    const style = ctx.resolver.computePseudo?.(element, which, parentStyle);
    if (!style || style.content == null || style.display === 'none') return null;
    const box = new LayoutBox(style.element, style, parentBox);
    classify(box, parentBox.inner);
    box.classifiedIn = parentBox.inner;
    box.generated = which;
    ctx.boxes.set(style.element, box);
    if (style.content) box.children.push(new TextItem(null, style.content, box));
    normalizeChildren(box);
    return box;
}

/**
 * Paint frames. DisplayListBuilder reuses what it drew for a box's subtree
 * while `box.changed` is not later than the frame it drew it in. Layout,
 * animation and focus changes set `changed` to the next frame on the box
 * and its ancestors, and `selfChanged` on the box itself.
 */
export const paintClock = { frame: 0 };

export function markChanged(box) {
    const next = paintClock.frame + 1;
    box.selfChanged = next;
    for (let b = box; b && b.changed !== next; b = b.parent) b.changed = next;
}

function listMarker(element, style) {
    const type = style.listStyleType;
    if (type === 'disc') return '• ';
    if (type === 'circle') return '◦ ';
    if (type === 'square') return '▪ ';
    if (type === 'disclosure-closed') return '▸ ';
    if (type === 'disclosure-open') return '▾ ';
    if (type === 'decimal' || type === 'decimal-leading-zero' || type === 'lower-alpha' || type === 'upper-alpha' || type === 'lower-roman' || type === 'upper-roman') {
        let index = 1;
        let sibling = element.previousElementSibling;
        while (sibling) { index++; sibling = sibling.previousElementSibling; }
        if (type === 'lower-alpha') return `${String.fromCharCode(96 + index)}. `;
        if (type === 'upper-alpha') return `${String.fromCharCode(64 + index)}. `;
        return `${index}. `;
    }
    return null;
}

function isInlineLevel(child) {
    return child.isText || child.outer === 'inline';
}

/** Whether `box` has a disclosure marker laid out inside, as inline content (InlineLayout). */
function hasInsideMarker(box) {
    const type = box.style.listStyleType;
    return Boolean(box.marker) && box.style.listStylePosition === 'inside'
        && (type === 'disclosure-closed' || type === 'disclosure-open');
}

/** An anonymous block that will hold `box`'s inside marker (and the inline content after it). */
function anonymousBlock(box) {
    const anon = new LayoutBox(null, anonymousStyle(box.style), box);
    anon.anonymous = true;
    anon.outer = 'block';
    anon.inner = 'flow';
    anon.establishesInline = true;
    return anon;
}

// Wrap content the way CSS does: text in flex/grid containers becomes
// anonymous items; mixed block/inline content gets anonymous block boxes.
export function normalizeChildren(box) {
    if (box.inner === 'flex' || box.inner === 'grid') {
        const out = [];
        let pending = [];
        const flush = () => {
            if (pending.length && !pending.every((item) => item.isText && BLANK.test(item.text))) {
                const anon = new LayoutBox(null, anonymousStyle(box.style), box);
                anon.anonymous = true;
                anon.outer = 'block';
                anon.inner = 'flow';
                anon.establishesInline = true;
                for (const item of pending) { item.parent = anon; anon.children.push(item); }
                out.push(anon);
            }
            pending = [];
        };
        for (const child of box.children) {
            if (child.isText) pending.push(child);
            else { flush(); out.push(child); }
        }
        flush();
        box.children = out;
        return;
    }
    if (box.inner !== 'flow' && box.inner !== 'table-cell') return;
    const inFlow = box.children.filter((child) => child.isText || !child.outOfFlow);
    const hasBlock = inFlow.some((child) => !isInlineLevel(child) && child.outer !== 'table-part');
    const hasInline = inFlow.some((child) => isInlineLevel(child) && !(child.isText && BLANK.test(child.text) && box.style.whiteSpace !== 'pre' && box.style.whiteSpace !== 'pre-wrap'));
    box.establishesInline = hasInline && !hasBlock;
    if (!hasBlock) {
        // (An inside marker with nothing else still takes a line: InlineLayout)
        box.establishesInline = true;
        return;
    }
    // Before block content, an inside marker (inline content at the very
    // start) goes in the anonymous block of the inline content before the
    // first block, or in one of its own
    let marker = hasInsideMarker(box) ? box.marker : null;
    const placeMarker = (anon) => {
        anon.marker = marker;
        box.marker = null;
        marker = null;
    };
    if (!hasInline) {
        // Whitespace between blocks does not render
        box.children = box.children.filter((child) => !child.isText);
        if (marker) {
            // Out-of-flow boxes before the first block stay on the marker's line
            const anon = anonymousBlock(box);
            placeMarker(anon);
            const lead = [];
            while (box.children.length && box.children[0].outOfFlow) lead.push(box.children.shift());
            for (const item of lead) { item.parent = anon; anon.children.push(item); }
            box.children.unshift(anon);
        }
        return;
    }
    const out = [];
    let pending = [];
    const flush = () => {
        const meaningful = pending.some((item) => !(item.isText && BLANK.test(item.text)) && !item.outOfFlow);
        if (meaningful) {
            const anon = anonymousBlock(box);
            if (marker) placeMarker(anon);
            for (const item of pending) { item.parent = anon; anon.children.push(item); }
            out.push(anon);
        } else if (marker) {
            // Out-of-flow boxes before the first block share the marker's line
            const anon = anonymousBlock(box);
            placeMarker(anon);
            for (const item of pending) if (!item.isText) { item.parent = anon; anon.children.push(item); }
            out.push(anon);
        } else {
            for (const item of pending) if (!item.isText) out.push(item);
        }
        pending = [];
    };
    for (const child of box.children) {
        if (isInlineLevel(child) || (child.outOfFlow && (pending.length || marker))) pending.push(child);
        else { flush(); out.push(child); }
    }
    flush();
    box.children = out;
}
