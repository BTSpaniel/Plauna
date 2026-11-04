// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Flexbox layout for Plauna's own layout pass.
 *
 * Implements the CSS flexible box algorithm: flex base sizes, automatic
 * minimum sizes, line breaking for flex-wrap, resolving flexible lengths with
 * min/max freezing, cross sizes with stretch, auto margins, justify-content,
 * align-items/align-self (including baseline), align-content, reverse
 * directions and gaps.
 */

import { UnitDiffuser } from './LayoutUnits.js';

function resolveGap(engine, gap, base) {
    return engine.len(gap, base, 0) || 0;
}

function isRow(style) {
    return !String(style.flexDirection || 'row').startsWith('column');
}

function alignOf(item, container) {
    const self = item.style.alignSelf;
    const value = !self || self === 'auto' ? container.style.alignItems : self;
    if (!value || value === 'normal') return 'stretch';
    if (value === 'start' || value === 'self-start') return 'flex-start';
    if (value === 'end' || value === 'self-end') return 'flex-end';
    if (value.startsWith('safe ') || value.startsWith('unsafe ')) return value.split(' ')[1];
    if (value === 'first baseline') return 'baseline';
    return value;
}

function sizeProp(row) {
    return row ? 'width' : 'height';
}

/** Main-axis min/max of an item, in border-box px. */
function mainLimits(engine, item, row, mainSize, crossSize, container) {
    const s = item.style;
    const pb = row ? engine.pbWidth(item) : engine.pbHeight(item);
    // Lengths size the content box; scrollbars come out of it
    const bp = row ? engine.bpWidth(item) : engine.bpHeight(item);
    const toBorder = (px) => (s.boxSizing === 'border-box' ? Math.max(px, bp) : px + bp);
    const minSpec = row ? s.minWidth : s.minHeight;
    const maxSpec = row ? s.maxWidth : s.maxHeight;
    let max = Infinity;
    if (maxSpec !== 'none' && maxSpec != null) {
        const v = engine.len(maxSpec, mainSize);
        if (v != null) max = toBorder(v);
    }
    let min = pb;
    if (minSpec !== 'auto' && typeof minSpec === 'object') {
        const v = engine.len(minSpec, mainSize);
        if (v != null) min = toBorder(v);
    } else {
        // Automatic minimum size: content-based unless the item is a scroll
        // container (hidden, auto or scroll; clip, as inputs have, is not one)
        const scrolls = (value) => value === 'hidden' || value === 'auto' || value === 'scroll';
        const scroll = scrolls(s.overflowX) || scrolls(s.overflowY);
        if (!scroll) {
            let content;
            if (row) content = engine.contentMin(item);
            else content = item.contentMinMain ?? pb;
            const specified = row ? engine.specifiedWidth(item, mainSize) : engine.specifiedHeight(item, mainSize);
            if (specified != null) content = Math.min(content, specified);
            min = Math.max(pb, Math.min(content, max));
        }
    }
    return { min, max };
}

/** Lay out a flex container's items; returns the content height. */
export function layoutFlex(engine, box, contentWidth, contentHeight) {
    const s = box.style;
    const row = isRow(s);
    const reverse = String(s.flexDirection || '').endsWith('reverse');
    const wrap = s.flexWrap && s.flexWrap !== 'nowrap';
    const wrapReverse = s.flexWrap === 'wrap-reverse';
    const cb = { width: contentWidth, height: contentHeight };
    let mainSize = row ? contentWidth : contentHeight;
    const crossSize = row ? contentHeight : contentWidth;
    const gapMain = resolveGap(engine, row ? s.columnGap : s.rowGap, row ? contentWidth : contentHeight);
    const gapCross = resolveGap(engine, row ? s.rowGap : s.columnGap, row ? contentHeight : contentWidth);
    const ox = box.contentX;
    const oy = box.contentY;

    const items = [];
    box.children.forEach((child, index) => {
        if (child.isText) return;
        if (child.outOfFlow) {
            child.staticPos = { x: ox, y: oy, alignIn: box };
            return;
        }
        child.flexItem = true;
        child.flexIndex = index;
        child.barsOnce = row && contentHeight == null;
        items.push(child);
    });
    items.sort((a, b) => (a.style.order || 0) - (b.style.order || 0) || a.flexIndex - b.flexIndex);

    // Flex base sizes and hypothetical main sizes
    for (const item of items) {
        engine.resolveEdges(item, contentWidth);
        const st = item.style;
        const basis = st.flexBasis;
        let base = null;
        const pbMain = row ? engine.pbWidth(item) : engine.pbHeight(item);
        if (basis && typeof basis === 'object') {
            const v = engine.len(basis, mainSize);
            const bpMain = row ? engine.bpWidth(item) : engine.bpHeight(item);
            if (v != null) base = st.boxSizing === 'border-box' ? Math.max(v, bpMain) : v + bpMain;
        }
        if (base == null && (basis === 'auto' || basis == null || typeof basis === 'object')) {
            base = row ? engine.specifiedWidth(item, contentWidth) : engine.specifiedHeight(item, contentHeight);
        }
        item.contentMinMain = null;
        if (!row) {
            // Column: lay the item out at its cross size to learn its content height
            const w = columnItemWidth(engine, item, box, crossSize);
            engine.layoutBox(item, cb, { forcedWidth: w, availableWidth: crossSize ?? contentWidth, autoHeight: true });
            item.contentMinMain = item.height;
            if (base == null) {
                engine.layoutBox(item, cb, { forcedWidth: w, availableWidth: crossSize ?? contentWidth });
                base = item.height;
            }
        } else if (base == null) {
            base = engine.intrinsic(item).max;
        }
        item.flexBase = base;
        item.pbMain = pbMain;
        const limits = mainLimits(engine, item, row, mainSize, crossSize, box);
        item.minMain = limits.min;
        item.maxMain = limits.max;
        item.hypoMain = Math.min(Math.max(base, limits.min), limits.max);
        item.mainMargins = row ? item.margin[1] + item.margin[3] : item.margin[0] + item.margin[2];
    }

    // Column containers with an auto height size to their content, clamped
    if (mainSize == null) {
        const total = items.reduce((sum, item) => sum + item.hypoMain + item.mainMargins, 0) + Math.max(0, items.length - 1) * gapMain;
        const clamped = engine.clampHeight(box, total + engine.pbHeight(box), null) - engine.pbHeight(box);
        mainSize = clamped;
        box.flexAutoMain = true;
    }

    // Lines
    const lines = [];
    if (!wrap) {
        lines.push({ items: [...items] });
    } else {
        let line = { items: [] };
        let used = 0;
        for (const item of items) {
            const outer = item.hypoMain + item.mainMargins;
            if (line.items.length && used + gapMain + outer > mainSize + 0.01) {
                lines.push(line);
                line = { items: [] };
                used = 0;
            }
            used += (line.items.length ? gapMain : 0) + outer;
            line.items.push(item);
        }
        if (line.items.length) lines.push(line);
    }

    // Resolve flexible lengths
    for (const line of lines) {
        resolveFlexibleLengths(engine, line.items, mainSize, gapMain);
    }

    // Cross sizes
    for (const line of lines) {
        for (const item of line.items) {
            if (row) {
                engine.layoutBox(item, cb, { forcedWidth: item.mainUsed, availableWidth: contentWidth });
            } else {
                const w = columnItemWidth(engine, item, box, crossSize);
                engine.layoutBox(item, cb, { forcedWidth: w, forcedHeight: item.mainUsed, availableWidth: crossSize ?? contentWidth });
            }
            item.crossOuter = row ? item.height + item.margin[0] + item.margin[2] : item.width + item.margin[1] + item.margin[3];
        }
        // Baseline alignment (row only)
        let maxAscent = 0;
        let maxDescent = 0;
        let baselineItems = 0;
        for (const item of line.items) {
            if (row && alignOf(item, box) === 'baseline') {
                const b = (item.baseline ?? item.height) + item.margin[0];
                maxAscent = Math.max(maxAscent, b);
                maxDescent = Math.max(maxDescent, item.crossOuter - b);
                baselineItems++;
            }
        }
        line.baselineAscent = maxAscent;
        let cross = 0;
        for (const item of line.items) {
            if (!(row && alignOf(item, box) === 'baseline')) cross = Math.max(cross, item.crossOuter);
        }
        if (baselineItems) cross = Math.max(cross, maxAscent + maxDescent);
        line.cross = cross;
    }
    if (!wrap && crossSize != null && lines.length === 1) lines[0].cross = crossSize;
    else if (!wrap && lines.length === 1) {
        // A single line takes the container's min/max cross size
        if (row) {
            lines[0].cross = engine.clampHeight(box, lines[0].cross + engine.pbHeight(box), null) - engine.pbHeight(box);
        } else {
            lines[0].cross = engine.clampWidth(box, lines[0].cross + engine.pbWidth(box), null) - engine.pbWidth(box);
        }
    }

    // Stretch
    for (const line of lines) {
        for (const item of line.items) {
            const align = alignOf(item, box);
            const crossAuto = row ? item.style.height === 'auto' : item.style.width === 'auto';
            const autoMargins = row ? (item.marginAuto[0] || item.marginAuto[2]) : (item.marginAuto[1] || item.marginAuto[3]);
            if (align !== 'stretch' || !crossAuto || autoMargins) continue;
            if (row) {
                let target = line.cross - item.margin[0] - item.margin[2];
                target = engine.clampHeight(item, target, crossSize);
                // A stretched size is definite, so percentages inside resolve against it
                engine.layoutBox(item, cb, { forcedWidth: item.mainUsed, forcedHeight: target, availableWidth: contentWidth });
            } else {
                let target = line.cross - item.margin[1] - item.margin[3];
                target = engine.clampWidth(item, target, contentWidth);
                engine.layoutBox(item, cb, { forcedWidth: target, forcedHeight: item.mainUsed, availableWidth: contentWidth });
            }
            item.crossOuter = row ? item.height + item.margin[0] + item.margin[2] : item.width + item.margin[1] + item.margin[3];
        }
    }

    // Container cross size and align-content
    const totalCross = lines.reduce((sum, l) => sum + l.cross, 0) + Math.max(0, lines.length - 1) * gapCross;
    // An auto cross size is the lines' total clamped by min/max; the clamp can leave free space
    const clampedCross = row
        ? engine.clampHeight(box, totalCross + engine.pbHeight(box), null) - engine.pbHeight(box)
        : engine.clampWidth(box, totalCross + engine.pbWidth(box), null) - engine.pbWidth(box);
    const containerCross = crossSize ?? (wrap ? clampedCross : totalCross);
    let crossStart = 0;
    const crossGap = gapCross;
    // Free cross space goes to the lines in whole layout units, as on the main axis
    let lineSpaces = null;
    if (wrap) {
        const free = containerCross - totalCross;
        const ac = s.alignContent && s.alignContent !== 'normal' ? s.alignContent : 'stretch';
        if (free > 0) {
            if (ac === 'flex-end' || ac === 'end') crossStart = free;
            else if (ac === 'center') crossStart = engine.unit(free / 2);
            else if (ac === 'space-between' && lines.length > 1) lineSpaces = new UnitDiffuser(free, lines.length - 1, engine.zoom);
            else if (ac === 'space-around') { lineSpaces = new UnitDiffuser(free, lines.length, engine.zoom); crossStart = engine.unit(free / (2 * lines.length)); }
            else if (ac === 'space-evenly') { lineSpaces = new UnitDiffuser(free, lines.length + 1, engine.zoom); crossStart = engine.unit(free / (lines.length + 1)); }
            else if (ac === 'stretch') {
                const extra = new UnitDiffuser(free, lines.length, engine.zoom);
                for (const line of lines) line.cross += extra.next();
            }
        }
    }

    // Main axis positions and cross alignment
    let crossPos = crossStart;
    const orderedLines = wrapReverse ? [...lines].reverse() : lines;
    for (const line of orderedLines) {
        const used = line.items.reduce((sum, item) => sum + item.mainUsed + item.mainMargins, 0) + Math.max(0, line.items.length - 1) * gapMain;
        let free = mainSize - used;
        const autoCount = line.items.reduce((n, item) => n + (row ? (item.marginAuto[1] ? 1 : 0) + (item.marginAuto[3] ? 1 : 0) : (item.marginAuto[0] ? 1 : 0) + (item.marginAuto[2] ? 1 : 0)), 0);
        let start = 0;
        const between = gapMain;
        // Free space goes to auto margins, or to the spaces justify-content
        // puts between items, in whole layout units with the remainder
        // spread over them, as the browser hands it out
        const autoShares = new UnitDiffuser(autoCount && free > 0 ? free : 0, autoCount, engine.zoom);
        let spaces = null;
        if (!autoCount) {
            const jc = s.justifyContent && s.justifyContent !== 'normal' ? s.justifyContent : 'flex-start';
            const n = line.items.length;
            if (jc === 'flex-end' || jc === 'end' || (jc === 'right' && row)) start = free;
            else if (jc === 'center') start = engine.unit(free / 2);
            else if (jc === 'space-between') { if (n > 1 && free > 0) spaces = new UnitDiffuser(free, n - 1, engine.zoom); }
            else if (jc === 'space-around') { if (free > 0) { spaces = new UnitDiffuser(free, n, engine.zoom); start = engine.unit(free / (2 * n)); } else start = engine.unit(free / 2); }
            else if (jc === 'space-evenly') { if (free > 0) { spaces = new UnitDiffuser(free, n + 1, engine.zoom); start = engine.unit(free / (n + 1)); } else start = engine.unit(free / 2); }
            if (reverse && (jc === 'flex-start' || jc === 'normal' || jc === 'start')) start = 0;
        }
        let pos = start;
        const sequence = line.items;
        for (const item of sequence) {
            const mStart = row ? item.margin[3] + (item.marginAuto[3] ? autoShares.next() : 0) : item.margin[0] + (item.marginAuto[0] ? autoShares.next() : 0);
            const mEnd = row ? item.margin[1] + (item.marginAuto[1] ? autoShares.next() : 0) : item.margin[2] + (item.marginAuto[2] ? autoShares.next() : 0);
            let mainPos = pos + mStart;
            if (reverse) mainPos = mainSize - (pos + mStart) - item.mainUsed;
            pos += mStart + item.mainUsed + mEnd + between + (spaces ? spaces.next() : 0);

            // Cross axis
            const align = alignOf(item, box);
            const crossMarginStart = row ? item.margin[0] : item.margin[3];
            const crossMarginEnd = row ? item.margin[2] : item.margin[1];
            const outerCross = item.crossOuter;
            let crossOffset = 0;
            const crossAutoStart = row ? item.marginAuto[0] : item.marginAuto[3];
            const crossAutoEnd = row ? item.marginAuto[2] : item.marginAuto[1];
            const freeCross = line.cross - outerCross;
            if (crossAutoStart || crossAutoEnd) {
                if (crossAutoStart && crossAutoEnd) crossOffset = engine.unit(Math.max(0, freeCross) / 2);
                else if (crossAutoStart) crossOffset = Math.max(0, freeCross);
            } else if (align === 'flex-end') crossOffset = freeCross;
            else if (align === 'center') crossOffset = engine.unit(freeCross / 2);
            else if (align === 'baseline' && row) crossOffset = line.baselineAscent - ((item.baseline ?? item.height) + item.margin[0]);
            let crossPosItem = crossPos + crossOffset + crossMarginStart;
            if (wrapReverse) crossPosItem = crossPos + (line.cross - crossOffset - outerCross) + crossMarginStart;
            void crossMarginEnd;
            if (row) {
                item.x = ox + mainPos;
                item.y = oy + crossPosItem;
            } else {
                item.x = ox + crossPosItem;
                item.y = oy + mainPos;
            }
        }
        line.crossStart = crossPos;
        crossPos += line.cross + crossGap + (lineSpaces ? lineSpaces.next() : 0);
    }

    // Baselines
    box.baseline = null;
    const firstLine = lines[0];
    if (firstLine?.items.length) {
        const first = row
            ? firstLine.items.find((item) => alignOf(item, box) === 'baseline') || firstLine.items[0]
            : items[0];
        box.baseline = first.y + (first.baseline ?? first.height);
        box.lastBaseline = box.baseline;
    }

    return row ? (contentHeight ?? containerCross) : mainSize;
}

function columnItemWidth(engine, item, container, crossSize) {
    const specified = engine.specifiedWidth(item, crossSize);
    if (specified != null) return engine.clampWidth(item, specified, crossSize);
    const align = alignOf(item, container);
    const autoMargins = item.marginAuto?.[1] || item.marginAuto?.[3];
    if (align === 'stretch' && !autoMargins && crossSize != null) {
        return engine.clampWidth(item, crossSize - item.margin[1] - item.margin[3], crossSize);
    }
    const available = (crossSize ?? Infinity) - item.margin[1] - item.margin[3];
    const intrinsic = engine.intrinsic(item);
    const w = Number.isFinite(available) ? Math.min(Math.max(intrinsic.min, available), intrinsic.max) : intrinsic.max;
    return engine.clampWidth(item, w, crossSize);
}

/**
 * CSS "resolve the flexible lengths" with min/max freezing. Free space is
 * shared out as the browser does in layout units: from the last item back,
 * each share rounded and taken off the space the items before it divide.
 */
function resolveFlexibleLengths(engine, items, mainSize, gap) {
    if (!items.length) return;
    const gaps = Math.max(0, items.length - 1) * gap;
    const outerHypo = items.reduce((sum, item) => sum + item.hypoMain + item.mainMargins, 0) + gaps;
    const growing = outerHypo < mainSize;
    for (const item of items) {
        item.frozen = false;
        item.target = item.flexBase;
        const factor = growing ? item.style.flexGrow : item.style.flexShrink;
        if (!factor || (growing && item.flexBase > item.hypoMain) || (!growing && item.flexBase < item.hypoMain)) {
            item.frozen = true;
            item.target = item.hypoMain;
        }
    }
    const initialFree = () => mainSize - gaps - items.reduce((sum, item) => sum + item.mainMargins + (item.frozen ? item.target : item.flexBase), 0);
    const startFree = initialFree();
    for (let guard = 0; guard < items.length + 2; guard++) {
        const unfrozen = items.filter((item) => !item.frozen);
        if (!unfrozen.length) break;
        let free = initialFree();
        const sumFactors = unfrozen.reduce((sum, item) => sum + (growing ? item.style.flexGrow : item.style.flexShrink), 0);
        if (sumFactors < 1) {
            const scaled = engine.unit(startFree * sumFactors);
            if (Math.abs(scaled) < Math.abs(free)) free = scaled;
        }
        // Shrinking weighs each item by its inner (content-box) base size
        const weight = growing
            ? (item) => item.style.flexGrow
            : (item) => item.style.flexShrink * Math.max(0, item.flexBase - (item.pbMain || 0));
        let weights = unfrozen.reduce((sum, item) => sum + weight(item), 0);
        let left = free;
        for (let k = unfrozen.length - 1; k >= 0; k--) {
            const item = unfrozen[k];
            const w = weight(item);
            const share = weights > 0 ? engine.roundUnit(left * w / weights) : 0;
            item.target = item.flexBase + share;
            left -= share;
            weights -= w;
        }
        let totalViolation = 0;
        for (const item of unfrozen) {
            const clamped = Math.min(Math.max(item.target, item.minMain), item.maxMain);
            item.violation = clamped - item.target;
            totalViolation += item.violation;
            item.target = clamped;
        }
        if (Math.abs(totalViolation) < 0.001) {
            for (const item of unfrozen) item.frozen = true;
        } else if (totalViolation > 0) {
            for (const item of unfrozen) if (item.violation > 0) item.frozen = true;
        } else {
            for (const item of unfrozen) if (item.violation < 0) item.frozen = true;
        }
    }
    for (const item of items) item.mainUsed = Math.max(0, item.target);
}

/** Intrinsic content widths of a flex container. */
export function intrinsicFlex(engine, box) {
    const s = box.style;
    const row = isRow(s);
    const wrap = s.flexWrap && s.flexWrap !== 'nowrap';
    const gap = row ? resolveGap(engine, s.columnGap, null) : 0;
    let min = 0;
    let max = 0;
    let count = 0;
    for (const child of box.children) {
        if (child.isText || child.outOfFlow) continue;
        engine.resolveEdges(child, null);
        child.flexItem = true;
        const cmin = engine.contribution(child, 'min');
        const cmax = engine.contribution(child, 'max');
        if (row) {
            max += cmax;
            min = wrap ? Math.max(min, cmin) : min + cmin;
        } else {
            min = Math.max(min, cmin);
            max = Math.max(max, cmax);
        }
        count++;
    }
    if (row && count > 1) {
        max += gap * (count - 1);
        if (!wrap) min += gap * (count - 1);
    }
    return { min, max };
}
