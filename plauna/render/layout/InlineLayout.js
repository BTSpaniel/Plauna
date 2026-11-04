// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Inline formatting: text, inline boxes and atomic inlines laid out into
 * line boxes.
 *
 * Follows CSS inline layout closely enough to match the DOM for UI text:
 * white-space collapsing across element boundaries, break opportunities at
 * spaces, after hyphens and around atomic inlines, forced breaks, nowrap and
 * pre modes, overflow-wrap and word-break splitting, the strut, per-box line
 * heights with half-leading, vertical-align, text-align (including justify),
 * text-indent, outside list markers, inside disclosure markers (a summary's
 * triangle), text-overflow: ellipsis and the ellipsis of the last line a
 * -webkit-line-clamp keeps (clampLineEllipsis).
 *
 * As in the browser, each text item (the text of one text node on a line) is
 * as wide as its shaped width rounded up to a layout unit (LayoutUnits).
 */

import { applyTextTransform, graphemes, canvasKerning } from '../text/TextShaper.js';

const WS_COLLAPSE = new Set(['normal', 'nowrap', 'pre-line']);
const WS_NOWRAP = new Set(['nowrap', 'pre']);
const WS_NEWLINES = new Set(['pre', 'pre-wrap', 'pre-line', 'break-spaces']);
const ELLIPSIS = '…';

function edgeWidth(box, side) {
    // side 'start' = left edge (margin + border + padding), 'end' = right edge
    return side === 'start'
        ? box.margin[3] + box.border[3] + box.padding[3]
        : box.margin[1] + box.border[1] + box.padding[1];
}

/** Flatten the container's inline content into items. */
function collectItems(engine, container, contentWidth) {
    const items = [];
    const walk = (children, owner) => {
        for (const child of children) {
            if (child.isText) {
                // (Text of a display: contents element or slot has that element's style)
                items.push({ type: 'text', text: child.text, owner, style: child.style || (owner ? owner.style : container.style), node: child.node });
                continue;
            }
            if (child.outOfFlow) {
                items.push({ type: 'abs', box: child, owner });
                continue;
            }
            const tag = child.element?.localName;
            if (tag === 'br') {
                items.push({ type: 'break', owner, box: child });
                continue;
            }
            if (child.outer === 'inline' && !child.atomic && child.inner === 'flow') {
                engine.resolveEdges(child, contentWidth);
                items.push({ type: 'open', box: child, owner });
                walk(child.children, child);
                items.push({ type: 'close', box: child, owner });
                continue;
            }
            items.push({ type: 'atomic', box: child, owner });
        }
    };
    walk(container.children, null);
    return items;
}

/** Turn items into tokens with whitespace processing applied. */
function tokenize(engine, container, items) {
    const tokens = [];
    let prevSpace = true;
    for (const item of items) {
        switch (item.type) {
            case 'text': {
                const style = item.style;
                const ws = style.whiteSpace || 'normal';
                let text = applyTextTransform(item.text, style.textTransform);
                if (WS_COLLAPSE.has(ws)) {
                    if (ws === 'pre-line') text = text.replace(/[ \t\r\f]*\n[ \t\r\f]*/g, '\n').replace(/[ \t\r\f]+/g, ' ');
                    else text = text.replace(/[ \t\n\r\f]+/g, ' ');
                } else {
                    text = text.replace(/\r\n?/g, '\n').replace(/\t/g, '        ');
                }
                const parts = text.match(/\n| +|[^ \n]+/g) || [];
                for (const part of parts) {
                    if (part === '\n') {
                        if (WS_NEWLINES.has(ws)) {
                            tokens.push({ kind: 'break', owner: item.owner });
                            prevSpace = true;
                        }
                        continue;
                    }
                    if (part[0] === ' ') {
                        if (WS_COLLAPSE.has(ws)) {
                            if (prevSpace) continue;
                            tokens.push({ kind: 'space', text: ' ', style, owner: item.owner, collapsible: true, node: item.node });
                        } else {
                            tokens.push({ kind: 'space', text: part, style, owner: item.owner, collapsible: false, node: item.node });
                        }
                        prevSpace = true;
                        continue;
                    }
                    // Break after hyphens inside a word
                    const pieces = part.split(/(?<=-)(?=[^-])/);
                    pieces.forEach((piece, index) => {
                        tokens.push({ kind: 'word', text: piece, style, owner: item.owner, hyphenBreak: index > 0, node: item.node });
                    });
                    prevSpace = false;
                }
                break;
            }
            case 'open':
                tokens.push({ kind: 'open', box: item.box, owner: item.owner, width: edgeWidth(item.box, 'start') });
                break;
            case 'close':
                tokens.push({ kind: 'close', box: item.box, owner: item.owner, width: edgeWidth(item.box, 'end') });
                break;
            case 'atomic':
                tokens.push({ kind: 'atomic', box: item.box, owner: item.owner });
                prevSpace = false;
                break;
            case 'abs':
                tokens.push({ kind: 'abs', box: item.box, owner: item.owner, width: 0 });
                break;
            case 'break':
                tokens.push({ kind: 'break', owner: item.owner, box: item.box });
                prevSpace = true;
                break;
            default:
                break;
        }
    }
    // A collapsible space at the end of the block does not render
    for (let i = tokens.length - 1; i >= 0; i--) {
        const t = tokens[i];
        if (t.kind === 'space' && t.collapsible) { tokens.splice(i, 1); break; }
        if (t.kind !== 'close' && t.kind !== 'abs') break;
    }
    return tokens;
}

function wrapsAt(token) {
    const ws = token.style?.whiteSpace || token.owner?.style?.whiteSpace;
    return !WS_NOWRAP.has(ws || 'normal');
}

/**
 * The kerning neighbouring text forms, added to the first of each pair as
 * the browser's shaping assigns it: the browser shapes a formatting
 * context's text in one font as a whole, so pairs across a space (" A",
 * "T ") and across inline box edges count. Measured from the pair's two
 * characters; a change of font, spacing or kerning, or an atomic inline or
 * line break between them, ends it.
 */
/** Whether an inline box's edge on `side` (3 start, 1 end) breaks text shaping. */
function breaksShaping(box, side) {
    if (!box) return false;
    const s = box.style;
    const set = (length) => Boolean(length && typeof length === 'object' && Object.entries(length).some(([key, value]) => key !== 'auto' && typeof value === 'number' && value !== 0));
    if (box.margin[side] || box.border[side] || box.padding[side]) return true;
    if (set(s.margin?.[side]) || set(s.padding?.[side])) return true;
    const align = s.verticalAlign;
    return Boolean(align && align !== 'baseline');
}

function addPairKerning(shaper, tokens) {
    const isText = (token) => token.kind === 'word' || token.kind === 'space';
    const font = (style) => `${shaper.font(style)}|${style.letterSpacing || 0}|${style.wordSpacing || 0}|${canvasKerning(style)}`;
    let previous = null;
    for (const token of tokens) {
        if (token.kind === 'abs') continue;
        if (token.kind === 'open' || token.kind === 'close') {
            // The browser shapes across an inline box's edge only when the
            // edge has no margin, border or padding (each of them, as
            // specified) and the box sits on the baseline
            // (ShouldBreakShapingBeforeBox / AfterBox)
            if (breaksShaping(token.box, token.kind === 'open' ? 3 : 1)) previous = null;
            continue;
        }
        if (!isText(token) || !token.text) {
            previous = null;
            continue;
        }
        if (previous && font(previous.style) === font(token.style)) {
            const last = Array.from(previous.text).pop();
            const first = Array.from(token.text)[0];
            const kern = shaper.measure(last + first, previous.style) - shaper.measure(last, previous.style) - shaper.measure(first, previous.style);
            previous.width += kern;
            // A line end between the two drops it (endKerning)
            previous.kernAfter = kern;
        }
        previous = token;
    }
}

/**
 * The kerning a unit's last glyph forms with the next unit's first where no
 * space lies between them (a break after a hyphen), as { token, kern }, or
 * null. The browser reshapes a line end that is not safe to break, so a line
 * ending after the unit does not keep it: it fits and measures unkerned
 * (measured). Min-content does not reshape and keeps it.
 */
function endKerning(unit) {
    if (unit.spaces.length) return null;
    for (let i = unit.tokens.length - 1; i >= 0; i--) {
        const token = unit.tokens[i];
        if (token.kind === 'word' || token.kind === 'space') return token.kernAfter ? { token, kern: token.kernAfter } : null;
        if (token.kind !== 'open' && token.kind !== 'close' && token.kind !== 'abs') return null;
    }
    return null;
}

/**
 * Group tokens into unbreakable units. Each unit is { tokens, width, spaces,
 * spaceWidth, forced }. Spaces after a unit hang at line ends.
 */
function buildUnits(engine, container, tokens, measureAtomic) {
    const shaper = engine.shaper;
    const units = [];
    let current = { tokens: [], width: 0, spaces: [], spaceWidth: 0 };
    let canBreakAfterSpaces = false;
    const containerWraps = !WS_NOWRAP.has(container.style.whiteSpace || 'normal');
    const push = () => {
        if (current.tokens.length || current.spaces.length) units.push(current);
        current = { tokens: [], width: 0, spaces: [], spaceWidth: 0 };
    };
    let prev = null;
    for (const token of tokens) {
        if (token.kind === 'word' || token.kind === 'space') token.width = shaper.measure(token.text, token.style);
    }
    addPairKerning(shaper, tokens);
    for (const token of tokens) {
        if (token.kind === 'atomic') token.width = measureAtomic(token.box);
        if (token.kind === 'break') {
            push();
            units.push({ tokens: [token], width: 0, spaces: [], spaceWidth: 0, forced: true });
            canBreakAfterSpaces = false;
            prev = token;
            continue;
        }
        if (token.kind === 'space') {
            current.spaces.push(token);
            current.spaceWidth += token.width;
            canBreakAfterSpaces = wrapsAt(token) || (token.style?.whiteSpace === 'break-spaces');
            prev = token;
            continue;
        }
        if (current.spaces.length) {
            if (canBreakAfterSpaces) push();
            else {
                // Spaces that cannot break become part of the unit
                for (const space of current.spaces) { current.tokens.push(space); current.width += space.width; }
                current.spaces = [];
                current.spaceWidth = 0;
            }
        } else if (prev && current.tokens.length) {
            const wraps = containerWraps && wrapsAt(token) && (prev.kind === 'word' || prev.kind === 'atomic' ? wrapsAt(prev) : true);
            const opportunity = wraps && (
                (token.kind === 'word' && token.hyphenBreak) ||
                token.kind === 'atomic' ||
                (prev.kind === 'atomic' && token.kind !== 'close')
            );
            if (opportunity && token.kind !== 'close') push();
        }
        current.tokens.push(token);
        current.width += token.width || 0;
        prev = token;
    }
    push();
    return units;
}

/**
 * Width of a token sequence with each text item (consecutive text of one
 * text node) rounded up to a layout unit.
 */
function itemsWidth(engine, tokens) {
    let total = 0;
    let open = 0;
    let node;
    let inItem = false;
    for (const token of tokens) {
        const text = token.kind === 'word' || token.kind === 'space';
        if (inItem && (!text || token.node !== node)) {
            total += engine.ceilUnit(open);
            open = 0;
            inItem = false;
        }
        if (text) {
            if (!inItem) { inItem = true; node = token.node; }
            open += token.width || 0;
        } else {
            total += token.width || 0;
        }
    }
    return inItem ? total + engine.ceilUnit(open) : total;
}

/** Note on each text token where it starts in its text item (consecutive text of one node). */
function markItemOffsets(tokens) {
    let node = null;
    let offset = 0;
    for (const token of tokens) {
        const text = token.kind === 'word' || token.kind === 'space';
        if (!text || token.node !== node) {
            node = text ? token.node : null;
            offset = 0;
        }
        if (text) {
            token.itemOffset = offset;
            offset += token.width || 0;
        }
    }
}

/**
 * Width of a token sequence as the browser measures a min-content line: a
 * slice of a text item spans from its rounded-up start position to its
 * rounded-up end position in the item (markItemOffsets), so a word after the
 * first can round down; other tokens add their widths.
 */
function sliceWidth(engine, tokens) {
    let total = 0;
    let run = null;
    const close = () => {
        if (run) total += engine.ceilUnit(run.start + run.width) - engine.ceilUnit(run.start);
        run = null;
    };
    for (const token of tokens) {
        const text = token.kind === 'word' || token.kind === 'space';
        if (run && (!text || token.node !== run.node)) close();
        if (text) {
            run ??= { node: token.node, start: token.itemOffset ?? 0, width: 0 };
            run.width += token.width || 0;
        } else {
            total += token.width || 0;
        }
    }
    close();
    return total;
}

/** Split a unit made of one word into pieces no wider than `available`. */
function splitUnit(engine, unit, available) {
    const words = unit.tokens.filter((t) => t.kind === 'word');
    if (words.length !== 1 || unit.tokens.length > 3) return [unit];
    const word = words[0];
    const pieces = [];
    let text = '';
    for (const g of graphemes(word.text)) {
        const candidate = text + g;
        if (text && engine.shaper.measure(candidate, word.style) > available) {
            pieces.push(text);
            text = g;
        } else {
            text = candidate;
        }
    }
    if (text) pieces.push(text);
    if (pieces.length < 2) return [unit];
    const before = unit.tokens.slice(0, unit.tokens.indexOf(word));
    const after = unit.tokens.slice(unit.tokens.indexOf(word) + 1);
    return pieces.map((piece, index) => {
        // Only the last piece meets the next token; its width keeps that kern (kernAfter)
        const last = index === pieces.length - 1;
        const kern = last ? word.kernAfter || 0 : 0;
        const token = { ...word, text: piece, width: engine.shaper.measure(piece, word.style) + kern, kernAfter: kern };
        const tokens = [...(index === 0 ? before : []), token, ...(index === pieces.length - 1 ? after : [])];
        const width = tokens.reduce((sum, t) => sum + (t.width || 0), 0);
        return index === pieces.length - 1
            ? { tokens, width, spaces: unit.spaces, spaceWidth: unit.spaceWidth }
            : { tokens, width, spaces: [], spaceWidth: 0 };
    });
}

function breaksWords(style) {
    return style.overflowWrap === 'break-word' || style.overflowWrap === 'anywhere' || style.wordBreak === 'break-all' || style.wordBreak === 'break-word';
}

/** Distribute units into lines. */
function breakLines(engine, container, units, available, indent) {
    const lines = [];
    let line = { units: [], width: indent };
    const wraps = !WS_NOWRAP.has(container.style.whiteSpace || 'normal');
    const finish = (forced = false, next = null) => {
        line.forced = forced;
        // A line ending where the next line's first glyph was kerned to its last drops the kern
        const end = next && !next.forced && line.units.length ? endKerning(line.units[line.units.length - 1]) : null;
        if (end) {
            line.width -= end.kern;
            line.endToken = end.token;
            line.endKern = end.kern;
        }
        lines.push(line);
        line = { units: [], width: 0 };
    };
    const queue = [...units];
    while (queue.length) {
        const unit = queue.shift();
        if (unit.forced) {
            line.units.push(unit);
            finish(true);
            continue;
        }
        const prevSpaces = line.units.length ? line.units[line.units.length - 1].spaceWidth : 0;
        const needed = line.width + prevSpaces + unit.width;
        // The line can end after the unit only without its kern against the next one
        const end = queue.length && !queue[0].forced ? endKerning(unit) : null;
        if (wraps && line.units.length && needed - (end ? end.kern : 0) > available + 0.01) {
            finish(false, unit);
            queue.unshift(unit);
            continue;
        }
        if (wraps && !line.units.length && unit.width > available + 0.01 && breaksWords(container.style)) {
            const split = splitUnit(engine, unit, Math.max(1, available - line.width));
            if (split.length > 1) {
                queue.unshift(...split);
                continue;
            }
        }
        line.width = line.units.length ? needed : line.width + unit.width;
        line.units.push(unit);
    }
    if (line.units.length) finish();
    return lines;
}

/** Metrics an inline box contributes around its baseline. */
function boxMetrics(engine, style) {
    const lineHeight = engine.shaper.lineHeight(style);
    const above = engine.shaper.baselineIn(style, lineHeight);
    return { above, below: lineHeight - above, lineHeight };
}

/**
 * The baseline shift of vertical-align sub and super, as the browser sets it
 * from the parent's font size in layout units (zoomed, rounded to 1/64):
 * down size / 5 + 1 layout px, up size / 3 + 1, each quotient truncated.
 */
function subSuperShift(engine, va, parentStyle) {
    if (va !== 'sub' && va !== 'super') return 0;
    const zoom = engine.zoom || 1;
    const fixed = Math.round((parentStyle.fontSize || 16) * zoom * 64);
    const shift = (Math.trunc(fixed / (va === 'sub' ? 5 : 3)) + 64) / (64 * zoom);
    return va === 'sub' ? -shift : shift;
}

function verticalShift(engine, style, parentStyle) {
    const va = style.verticalAlign;
    if (!va || va === 'baseline') return 0;
    if (typeof va === 'object') return engine.unit(va.px || 0);
    const parentMetrics = engine.shaper.fontMetrics(parentStyle);
    switch (va) {
        case 'sub':
        case 'super': return subSuperShift(engine, va, parentStyle);
        case 'middle': {
            const own = engine.shaper.fontMetrics(style);
            return parentMetrics.xHeight / 2 - (own.ascent - own.descent) / 2;
        }
        case 'text-top': {
            const own = engine.shaper.fontMetrics(style);
            return parentMetrics.ascent - own.ascent;
        }
        case 'text-bottom': {
            const own = engine.shaper.fontMetrics(style);
            return own.descent - parentMetrics.descent;
        }
        default: return 0;
    }
}

/**
 * Lay out the inline content of `container` within `contentWidth`.
 * Sets container.lines, container.runs and inline box fragments, positions
 * atomic inlines, and returns the content height.
 */
export function layoutInline(engine, container, contentWidth) {
    const items = collectItems(engine, container, contentWidth);
    const tokens = tokenize(engine, container, items);
    // Atomic inlines are laid out first (shrink-to-fit) so their widths are known
    for (const token of tokens) {
        if (token.kind === 'atomic') {
            engine.layoutAtomic(token.box, contentWidth);
        }
    }
    const measureAtomic = (box) => box.width + box.margin[1] + box.margin[3];
    const units = buildUnits(engine, container, tokens, measureAtomic);
    const style = container.style;
    const textIndent = engine.unit(style.textIndent || 0);
    // An inside marker is the first line's first content, after the indent
    const insideMarker = insideMarkerWidth(engine, container);
    const indent = textIndent + insideMarker;
    const lines = breakLines(engine, container, units, contentWidth, indent);
    // An inside marker is content: with nothing else it still makes a line
    if (insideMarker && !lines.length) lines.push({ units: [], width: indent });
    let markerShift = 0;

    const shaper = engine.shaper;
    const strut = boxMetrics(engine, style);
    const ox = container.contentX;
    const oy = container.contentY;
    const runs = [];
    const fragments = new Map();
    let y = 0;
    let firstBaseline = null;
    let lastBaseline = null;
    const outLines = [];
    const ellipsis = style.textOverflow === 'ellipsis' && style.overflowX !== 'visible';

    lines.forEach((line, lineIndex) => {
        // Place parts horizontally
        const parts = [];
        let x = lineIndex === 0 ? indent : 0;
        // The open text item: its last part takes the rounding up
        let item = null;
        const closeItem = () => {
            if (!item) return;
            const end = item.x + engine.ceilUnit(x - item.x);
            item.last.width += end - x;
            x = end;
            item = null;
        };
        const place = (token, hanging = false) => {
            const text = token.kind === 'word' || token.kind === 'space';
            if (item && (!text || token.node !== item.node)) closeItem();
            const part = { token, x, width: (token.width || 0) - (token === line.endToken ? line.endKern : 0) };
            if (hanging) part.hanging = true;
            parts.push(part);
            if (text) {
                item ??= { node: token.node, x };
                item.last = part;
            }
            x += part.width;
        };
        line.units.forEach((unit, unitIndex) => {
            for (const token of unit.tokens) {
                if (token.kind !== 'break') place(token);
            }
            if (unitIndex < line.units.length - 1) {
                for (const space of unit.spaces) place(space);
            } else if (unit.spaces.length && unit.spaces.some((s) => !s.collapsible)) {
                // Preserved trailing spaces hang; keep them for caret placement
                for (const space of unit.spaces) place(space, true);
            }
        });
        closeItem();
        const hasContent = parts.some((p) => p.token.kind !== 'abs') || (lineIndex === 0 && insideMarker > 0);
        if (!hasContent && !line.forced) {
            for (const part of parts) {
                if (part.token.kind === 'abs') part.token.box.staticPos = { x: ox + part.x, y: oy + y };
            }
            return;
        }
        let lineWidth = parts.filter((p) => !p.hanging).reduce((max, p) => Math.max(max, p.x + p.width), lineIndex === 0 ? indent : 0);

        // Ellipsis: trim the overflowing tail and append …
        if (ellipsis && lineWidth > contentWidth + 0.5) {
            const textParts = parts.filter((p) => p.token.kind === 'word' || p.token.kind === 'space');
            const lastStyle = (textParts[textParts.length - 1] || {}).token?.style || style;
            const ellipsisWidth = shaper.measure(ELLIPSIS, lastStyle);
            const limit = contentWidth - ellipsisWidth;
            for (let i = parts.length - 1; i >= 0; i--) {
                const part = parts[i];
                if (part.x + part.width <= limit) break;
                if (part.token.kind === 'word' && part.x < limit) {
                    let text = '';
                    for (const g of graphemes(part.token.text)) {
                        if (shaper.measure(text + g, part.token.style) > limit - part.x) break;
                        text += g;
                    }
                    part.token = { ...part.token, text };
                    part.width = shaper.measure(text, part.token.style);
                } else if (part.token.kind === 'word' || part.token.kind === 'space') {
                    parts.splice(i, 1);
                }
            }
            const tail = parts.filter((p) => p.token.kind === 'word' || p.token.kind === 'space');
            const end = tail.length ? tail[tail.length - 1].x + tail[tail.length - 1].width : 0;
            parts.push({ token: { kind: 'word', text: ELLIPSIS, style: lastStyle, owner: tail[tail.length - 1]?.token.owner ?? null }, x: end, width: ellipsisWidth });
            lineWidth = end + ellipsisWidth;
        }

        // Horizontal alignment
        const free = contentWidth - lineWidth;
        let shift = 0;
        let justifyGap = 0;
        const align = style.textAlign;
        if (align === 'right') shift = free;
        else if (align === 'center') shift = engine.unit(free / 2);
        else if (align === 'justify' && !line.forced && lineIndex < lines.length - 1 && free > 0) {
            const gaps = parts.filter((p) => p.token.kind === 'space' && !p.hanging).length;
            if (gaps) justifyGap = free / gaps;
        }
        if (!outLines.length) markerShift = Math.max(0, shift);
        if (shift > 0 || justifyGap) {
            let extra = 0;
            for (const part of parts) {
                part.x += Math.max(0, shift) + extra;
                if (justifyGap && part.token.kind === 'space' && !part.hanging) {
                    part.width += justifyGap;
                    extra += justifyGap;
                }
            }
        }

        // Vertical metrics: strut, inline boxes on the line, atomics
        let maxAbove = strut.above;
        let maxBelow = strut.below;
        const boxShift = new Map();
        const ownerShift = (owner) => {
            if (!owner) return 0;
            if (boxShift.has(owner)) return boxShift.get(owner);
            const parentStyle = owner.parent && owner.parent !== container && owner.parent.outer === 'inline' ? owner.parent.style : style;
            const value = ownerShift(owner.parent && owner.parent !== container && owner.parent.outer === 'inline' && !owner.parent.atomic ? owner.parent : null)
                + verticalShift(engine, owner.style, parentStyle);
            boxShift.set(owner, value);
            return value;
        };
        const ownersOnLine = new Set();
        const deferred = [];
        for (const part of parts) {
            const token = part.token;
            let owner = token.kind === 'open' || token.kind === 'close' ? token.box : token.owner;
            while (owner) {
                ownersOnLine.add(owner);
                owner = owner.parent && owner.parent !== container && owner.parent.outer === 'inline' && !owner.parent.atomic ? owner.parent : null;
            }
        }
        for (const owner of ownersOnLine) {
            const m = boxMetrics(engine, owner.style);
            const s = ownerShift(owner);
            maxAbove = Math.max(maxAbove, m.above + s);
            maxBelow = Math.max(maxBelow, m.below - s);
        }
        // Text with a style of its own (a display: contents element's or a
        // slot's) has no box, but its font and line height count as a box's
        for (const part of parts) {
            const token = part.token;
            if (token.kind !== 'word' || !token.style || token.style === (token.owner ? token.owner.style : style)) continue;
            const m = boxMetrics(engine, token.style);
            const s = ownerShift(token.owner);
            maxAbove = Math.max(maxAbove, m.above + s);
            maxBelow = Math.max(maxBelow, m.below - s);
        }
        // Text set in a fallback font (emoji) can make a normal line taller
        for (const part of parts) {
            const token = part.token;
            if (token.kind !== 'word' || !token.style?.lineHeight?.normal) continue;
            const fallback = shaper.fallbackLine(token.style, token.text);
            if (!fallback) continue;
            const s = ownerShift(token.owner);
            maxAbove = Math.max(maxAbove, fallback.baseline + s);
            maxBelow = Math.max(maxBelow, fallback.height - fallback.baseline - s);
        }
        for (const part of parts) {
            if (part.token.kind !== 'atomic') continue;
            const box = part.token.box;
            const height = box.height + box.margin[0] + box.margin[2];
            const parentStyle = part.token.owner ? part.token.owner.style : style;
            const s = ownerShift(part.token.owner);
            const va = box.style.verticalAlign;
            let baseline = engine.atomicBaseline(box);
            baseline = baseline == null ? height : baseline + box.margin[0];
            let above;
            let below;
            if (va === 'top' || va === 'bottom') {
                deferred.push({ part, height, va });
                part.atomicHeight = height;
                continue;
            } else if (va === 'middle') {
                const xh = shaper.fontMetrics(parentStyle).xHeight;
                above = height / 2 + xh / 2;
                below = height / 2 - xh / 2;
            } else if (va === 'text-top') {
                const m = shaper.fontMetrics(parentStyle);
                above = m.ascent;
                below = height - m.ascent;
            } else if (va === 'text-bottom') {
                const m = shaper.fontMetrics(parentStyle);
                below = m.descent;
                above = height - m.descent;
            } else {
                const offset = typeof va === 'object' ? engine.unit(va.px || 0) : subSuperShift(engine, va, parentStyle);
                above = baseline + offset;
                below = height - baseline - offset;
            }
            above += s;
            below -= s;
            part.atomicAbove = above;
            maxAbove = Math.max(maxAbove, above);
            maxBelow = Math.max(maxBelow, below);
        }
        let lineHeight = maxAbove + maxBelow;
        for (const d of deferred) {
            if (d.height > lineHeight) {
                if (d.va === 'top') maxBelow += d.height - lineHeight;
                else maxAbove += d.height - lineHeight;
                lineHeight = d.height;
            }
        }
        const baselineY = y + maxAbove;

        // Emit runs, atomics, fragments
        let run = null;
        const flush = () => { if (run) { runs.push(run); run = null; } };
        for (const part of parts) {
            const token = part.token;
            if (token.kind === 'word' || token.kind === 'space') {
                const owner = token.owner;
                const s = ownerShift(owner);
                const runBaseline = baselineY - s;
                if (run && run.style === token.style && run.owner === owner && Math.abs(run.x + run.width - part.x) < 0.01) {
                    run.text += token.text;
                    run.width += part.width;
                    if (token.node && !run.nodes.includes(token.node)) run.nodes.push(token.node);
                } else {
                    flush();
                    const m = shaper.fontMetrics(token.style);
                    run = {
                        text: token.text,
                        style: token.style,
                        owner,
                        x: ox + part.x,
                        width: part.width,
                        baseline: oy + runBaseline,
                        top: oy + runBaseline - m.ascent,
                        height: m.ascent + m.descent,
                        line: outLines.length,
                        nodes: token.node ? [token.node] : []
                    };
                }
                continue;
            }
            flush();
            if (token.kind === 'atomic') {
                const box = token.box;
                const marginTop = part.atomicHeight != null
                    ? (deferredTop(deferred, part) ? y : y + lineHeight - part.atomicHeight)
                    : baselineY - part.atomicAbove;
                box.x = ox + part.x + box.margin[3];
                box.y = oy + marginTop + box.margin[0];
                box.lineIndex = outLines.length;
                // In the container's coordinates, even inside an inline box
                box.ifc = container;
            } else if (token.kind === 'abs') {
                token.box.staticPos = { x: ox + part.x, y: oy + y };
            }
        }
        flush();

        // Inline box fragments for this line
        for (const owner of ownersOnLine) {
            const own = parts.filter((p) => partBelongsTo(p, owner, container));
            if (!own.length) continue;
            const openPart = parts.find((p) => p.token.kind === 'open' && p.token.box === owner);
            const closePart = parts.find((p) => p.token.kind === 'close' && p.token.box === owner);
            const x0 = openPart ? openPart.x + owner.margin[3] : Math.min(...own.map((p) => p.x));
            const x1 = closePart ? closePart.x + closePart.width - owner.margin[1] : Math.max(...own.map((p) => p.x + p.width));
            const m = shaper.fontMetrics(owner.style);
            const b = baselineY - ownerShift(owner);
            const top = b - m.ascent - owner.padding[0] - owner.border[0];
            const bottom = b + m.descent + owner.padding[2] + owner.border[2];
            if (!fragments.has(owner)) fragments.set(owner, []);
            fragments.get(owner).push({
                x: ox + x0, y: oy + top, width: Math.max(0, x1 - x0), height: bottom - top,
                first: Boolean(openPart), last: Boolean(closePart), line: outLines.length
            });
        }

        if (firstBaseline == null) firstBaseline = oy + baselineY;
        lastBaseline = oy + baselineY;
        outLines.push({ top: oy + y, height: lineHeight, baseline: oy + baselineY, width: lineWidth, x: ox, shift: Math.max(0, shift) });
        y += lineHeight;
    });

    // Inside marker at the start of the first line: painted as a symbol
    if (insideMarker && outLines.length) {
        const m = shaper.fontMetrics(style);
        runs.push({
            text: container.marker, style, owner: null, marker: true, symbol: style.listStyleType,
            x: ox + textIndent + markerShift, width: insideMarker, baseline: outLines[0].baseline,
            top: outLines[0].baseline - m.ascent, height: m.ascent + m.descent, line: 0, nodes: []
        });
    } else if (container.marker && outLines.length) {
        // Outside list marker beside the first line
        const width = shaper.measure(container.marker, style);
        const m = shaper.fontMetrics(style);
        runs.push({
            text: container.marker, style, owner: null, marker: true,
            x: ox - width, width, baseline: outLines[0].baseline,
            top: outLines[0].baseline - m.ascent, height: m.ascent + m.descent, line: 0, nodes: []
        });
    }

    container.lines = outLines;
    container.runs = runs;
    for (const [owner, list] of fragments) {
        owner.fragments = list;
        owner.ifc = container;
    }
    container.baseline = firstBaseline;
    container.lastBaseline = lastBaseline;
    container.inlineWidth = outLines.reduce((max, l) => Math.max(max, l.width), 0);
    // Inside a -webkit-line-clamp container, count the lines in block order
    // (a block past the clamped line counts its own: `root` is the container's)
    const clamp = engine.lineClamp;
    if (clamp && outLines.length) {
        if (clamp.root) clamp.root.more = true;
        if (clamp.at) clamp.more = true;
        else if (clamp.count + outLines.length >= clamp.limit) {
            const line = clamp.limit - clamp.count - 1;
            clamp.at = { container, line };
            clamp.more = line < outLines.length - 1;
        }
        clamp.count += outLines.length;
    }
    return y;
}

/**
 * End line `lineIndex` of `container` in an ellipsis, as Chrome ends the
 * last line a -webkit-line-clamp keeps (measured): the ellipsis follows the
 * line's last glyph where it fits in the content box, else the line's text
 * is cut grapheme by grapheme until text and ellipsis fit. Both are decided
 * where the line would sit unaligned; text-align then shifts it as much as
 * it shifted the whole line, ellipsis left out, so a right-aligned line that
 * is not cut puts its ellipsis past the edge, where the clip hides it. It is
 * set in the container's own font. Edits container.runs in place (the clamp
 * lays the container out again whenever it lays out).
 */
export function clampLineEllipsis(engine, container, lineIndex) {
    const line = container.lines?.[lineIndex];
    if (!line) return;
    const shaper = engine.shaper;
    const style = container.style;
    const ellipsisWidth = shaper.measure(ELLIPSIS, style);
    const contentRight = line.x + (container.layoutContentWidth ?? container.contentWidthWithScrollbar());
    const onLine = container.runs.filter((run) => run.line === lineIndex && !run.marker);
    const end = () => onLine.reduce((max, run) => Math.max(max, run.x + run.width), line.x);
    const limit = contentRight - ellipsisWidth + (line.shift || 0);
    for (let i = onLine.length - 1; i >= 0 && end() > limit + 1e-6; i--) {
        const run = onLine[i];
        if (run.x >= limit) {
            container.runs.splice(container.runs.indexOf(run), 1);
            onLine.splice(i, 1);
            continue;
        }
        let text = '';
        for (const g of graphemes(run.text)) {
            if (shaper.measure(text + g, run.style) > limit - run.x) break;
            text += g;
        }
        run.text = text;
        run.width = shaper.measure(text, run.style);
    }
    const m = shaper.fontMetrics(style);
    container.runs.push({
        text: ELLIPSIS, style, owner: null, ellipsis: true,
        x: end(), width: ellipsisWidth, baseline: line.baseline,
        top: line.baseline - m.ascent, height: m.ascent + m.descent, line: lineIndex, nodes: []
    });
}

// Markers laid out in the first line when list-style-position is inside
const INSIDE_MARKERS = new Set(['disclosure-closed', 'disclosure-open']);

/** Inline size of `container`'s inside marker, or 0. */
function insideMarkerWidth(engine, container) {
    const style = container.style;
    if (!container.marker || style.listStylePosition !== 'inside' || !INSIDE_MARKERS.has(style.listStyleType)) return 0;
    return engine.shaper.insideMarkerWidth(style.listStyleType, style);
}

function deferredTop(deferred, part) {
    return deferred.some((d) => d.part === part && d.va === 'top');
}

function partBelongsTo(part, owner, container) {
    const token = part.token;
    if ((token.kind === 'open' || token.kind === 'close') && token.box === owner) return true;
    let o = token.kind === 'open' || token.kind === 'close' ? token.box.parent : token.owner;
    while (o && o !== container) {
        if (o === owner) return true;
        o = o.parent;
    }
    return false;
}

/**
 * Min-content and max-content widths of the inline content
 * (without the container's own padding and border).
 */
export function intrinsicInline(engine, container) {
    const items = collectItems(engine, container, 0);
    const tokens = tokenize(engine, container, items);
    const result = { min: 0, max: 0 };
    for (const kind of ['min', 'max']) {
        const measureAtomic = (box) => engine.contribution(box, kind);
        const units = buildUnits(engine, container, tokens, measureAtomic);
        if (kind === 'min') {
            const wraps = !WS_NOWRAP.has(container.style.whiteSpace || 'normal');
            if (!wraps) {
                result.min = sumLines(engine, units);
            } else {
                markItemOffsets(tokens);
                let min = 0;
                for (const unit of units) {
                    let w = sliceWidth(engine, unit.tokens);
                    if (breaksWords(container.style) && container.style.overflowWrap === 'anywhere') {
                        w = Math.min(w, ...unit.tokens.filter((t) => t.kind === 'word').map((t) => Math.max(...graphemes(t.text).map((g) => engine.shaper.measure(g, t.style)))));
                    }
                    min = Math.max(min, w);
                }
                result.min = min;
            }
        } else {
            result.max = sumLines(engine, units);
        }
    }
    const indent = engine.unit(container.style.textIndent || 0) + insideMarkerWidth(engine, container);
    result.min += indent;
    result.max += indent;
    if (container.marker) {
        // Outside markers do not take space
    }
    return result;
}

/** Widest line when lines break only where forced. */
function sumLines(engine, units) {
    let best = 0;
    let line = [];
    let first = true;
    for (let i = 0; i < units.length; i++) {
        const unit = units[i];
        if (unit.forced) {
            best = Math.max(best, itemsWidth(engine, line));
            line = [];
            first = true;
            continue;
        }
        if (!first && !units[i - 1]?.forced) line.push(...(units[i - 1]?.spaces || []));
        line.push(...unit.tokens);
        first = false;
    }
    return Math.max(best, itemsWidth(engine, line));
}
