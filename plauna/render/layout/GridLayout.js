// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * CSS grid layout for Plauna's own layout pass.
 *
 * Supports explicit track lists (px, %, fr, auto, min-content, max-content,
 * minmax(), repeat() including auto-fill/auto-fit), implicit tracks from
 * grid-auto-rows/columns, line-based and span placement, named lines and
 * grid-template-areas, row and column auto-placement, gaps, and
 * stretch/start/center/end alignment of items.
 */

import { hasPercent } from '../css/CssValues.js';

function trackList(engine, spec, available, gap) {
    if (!spec) return [];
    const out = [];
    out.endNames = spec.endNames;
    for (const track of spec) {
        if (track.type === 'repeat-auto') {
            const fixed = track.tracks.map((t) => fixedSize(engine, t, available));
            const one = fixed.reduce((sum, v) => sum + (v ?? 0), 0) + gap * (track.tracks.length - 1);
            let count = 1;
            if (available != null && one > 0) count = Math.max(1, Math.floor((available + gap) / (one + gap)));
            for (let i = 0; i < count; i++) out.push(...track.tracks.map((t) => ({ ...t, autoRepeat: track.mode })));
        } else {
            out.push(track);
        }
    }
    return out;
}

function fixedSize(engine, track, available) {
    if (track.type === 'length') {
        // min()/max()/clamp(): resolved whole, against the available size
        // (null while a percentage inside them has no base)
        if (track.length.min || track.length.max || track.length.clamp) return engine.len(track.length, available ?? null, null);
        if (track.length.pct != null && available == null) return null;
        let px = track.length.px || 0;
        if (track.length.pct) px += track.length.pct / 100 * available;
        return engine.unit(px);
    }
    if (track.type === 'minmax') {
        const min = fixedSize(engine, track.min, available);
        const max = fixedSize(engine, track.max, available);
        return max ?? min;
    }
    return null;
}

function minOf(track) {
    return track.type === 'minmax' ? track.min : track;
}

/**
 * Whether sizing row `track` lays `item` out to measure its height, as
 * Chrome 155 does (measured with scrollbars visible): an intrinsic maximum
 * (auto, min-content, max-content, fit-content) or a flexible one while the
 * grid's height is indefinite needs its max-content contribution; an
 * intrinsic minimum needs its min-content contribution, except that an auto
 * minimum of an item whose height is auto or a percentage takes its
 * automatic minimum (zero for the scroll containers this matters to)
 * without a layout. A fixed row, or minmax(0, 1fr) in a definite grid,
 * needs neither.
 */
function measuresItem(engine, track, item, available) {
    const min = minOf(track);
    const max = maxOf(track);
    if (max.type === 'fr' ? available == null : max.type !== 'length' || fixedSize(engine, max, available) == null) return true;
    if (min.type === 'length' && fixedSize(engine, min, available) != null) return false;
    if (min.keyword === 'min-content' || min.keyword === 'max-content') return true;
    const height = item.style.height;
    return Boolean(height) && height !== 'auto' && !hasPercent(height);
}

function maxOf(track) {
    return track.type === 'minmax' ? track.max : track;
}

/**
 * Line names of one axis: explicit [names] from the track list, plus the
 * name-start / name-end lines each template area implies.
 */
function namedLines(tracks, areas, axis) {
    const lines = new Map();
    const add = (name, index) => { if (!lines.has(name)) lines.set(name, index); };
    tracks.forEach((track, index) => { for (const name of track.lineNames || []) add(name, index); });
    for (const name of tracks.endNames || []) add(name, tracks.length);
    for (const [name, area] of areas?.named || []) {
        add(`${name}-start`, axis === 'column' ? area.c0 : area.r0);
        add(`${name}-end`, axis === 'column' ? area.c1 : area.r1);
    }
    return lines;
}

function lineOf(spec, count, names, end) {
    if (spec.line != null) return spec.line > 0 ? spec.line - 1 : count + spec.line + 1;
    if (spec.name != null) return names.get(`${spec.name}-${end ? 'end' : 'start'}`) ?? names.get(spec.name) ?? null;
    return null;
}

/** Place items on the grid; returns { columns, rows } counts. */
function placeItems(items, columnCount, rowCount, flow, names) {
    const occupied = new Set();
    const key = (r, c) => `${r},${c}`;
    const fits = (r, c, rs, cs, cols) => {
        if (c + cs > cols) return false;
        for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) if (occupied.has(key(i, j))) return false;
        return true;
    };
    const mark = (r, c, rs, cs) => { for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) occupied.add(key(i, j)); };
    let cols = Math.max(1, columnCount);
    let rows = rowCount;
    const column = flow.startsWith('column');
    // Definite placements first
    const auto = [];
    for (const item of items) {
        const s = item.style;
        const cStart = lineOf(s.gridColumnStart, cols, names.column, false);
        const cEnd = lineOf(s.gridColumnEnd, cols, names.column, true);
        const rStart = lineOf(s.gridRowStart, rows, names.row, false);
        const rEnd = lineOf(s.gridRowEnd, rows, names.row, true);
        const cs = s.gridColumnStart.span || s.gridColumnEnd.span || (cStart != null && cEnd != null ? Math.max(1, cEnd - cStart) : 1);
        const rs = s.gridRowStart.span || s.gridRowEnd.span || (rStart != null && rEnd != null ? Math.max(1, rEnd - rStart) : 1);
        item.gridSpan = { cs, rs };
        if (cStart != null && rStart != null) {
            item.gridPos = { c: cStart, r: rStart };
            cols = Math.max(cols, cStart + cs);
            rows = Math.max(rows, rStart + rs);
            mark(rStart, cStart, rs, cs);
        } else {
            item.gridLock = { c: cStart, r: rStart };
            auto.push(item);
        }
    }
    let cursorR = 0;
    let cursorC = 0;
    for (const item of auto) {
        const { cs, rs } = item.gridSpan;
        const lock = item.gridLock;
        if (!column) {
            if (lock.c != null) {
                let r = lock.r ?? cursorR;
                while (!fits(r, lock.c, rs, cs, Math.max(cols, lock.c + cs))) r++;
                item.gridPos = { c: lock.c, r };
                cols = Math.max(cols, lock.c + cs);
            } else {
                let r = lock.r ?? cursorR;
                let c = lock.r != null ? 0 : cursorC;
                for (;;) {
                    if (c + cs > cols) { r++; c = 0; if (cs > cols) cols = cs; continue; }
                    if (fits(r, c, rs, cs, cols)) break;
                    c++;
                }
                item.gridPos = { c, r };
                if (lock.r == null) { cursorR = r; cursorC = c + cs; }
            }
        } else {
            let c = lock.c ?? cursorC;
            let r = lock.c != null ? 0 : cursorR;
            const rowLimit = Math.max(rows, 1);
            for (;;) {
                if (r + rs > rowLimit && rows > 0) { c++; r = 0; continue; }
                if (fits(r, c, rs, cs, Infinity)) break;
                r++;
            }
            item.gridPos = { c, r };
            cols = Math.max(cols, c + cs);
            if (lock.c == null) { cursorC = c; cursorR = r + rs; }
        }
        mark(item.gridPos.r, item.gridPos.c, rs, cs);
        rows = Math.max(rows, item.gridPos.r + rs);
    }
    return { columns: cols, rows };
}

/**
 * Size tracks. `contributions(item, kind)` gives an item's size contribution
 * for 'min' or 'max'. Returns an array of sizes. With no available space the
 * grid is sized under a max-content constraint, or a min-content one when
 * `minContent` is set.
 */
function sizeTracks(engine, tracks, items, axis, available, gap, contributions, stretch, minContent = false) {
    const n = tracks.length;
    const base = new Array(n).fill(0);
    const limit = new Array(n).fill(0);
    const flex = new Array(n).fill(0);
    tracks.forEach((track, i) => {
        const min = minOf(track);
        const max = maxOf(track);
        const fixedMin = min.type === 'length' ? fixedSize(engine, min, available) : null;
        const fixedMax = max.type === 'length' ? fixedSize(engine, max, available) : null;
        base[i] = fixedMin ?? 0;
        limit[i] = fixedMax ?? (max.type === 'fr' ? Infinity : (fixedMin ?? 0));
        if (max.type === 'fr') flex[i] = max.value;
        track.intrinsicMin = fixedMin == null;
        track.intrinsicMax = fixedMax == null && max.type !== 'fr';
    });
    // Single-span items size intrinsic tracks
    const startKey = axis === 'column' ? 'c' : 'r';
    const spanKey = axis === 'column' ? 'cs' : 'rs';
    const sorted = [...items].sort((a, b) => a.gridSpan[spanKey] - b.gridSpan[spanKey]);
    // Items spanning several tracks, one of them flexible, come last and grow
    // only the flexible tracks (css-grid 11.5 step 4)
    const crossingFlex = [];
    for (const item of sorted) {
        const start = item.gridPos[startKey];
        const span = item.gridSpan[spanKey];
        const idx = Array.from({ length: span }, (_, k) => start + k).filter((k) => k < n);
        if (!idx.length) continue;
        if (span > 1 && idx.some((i) => flex[i])) {
            crossingFlex.push({ item, idx });
            continue;
        }
        const minC = contributions(item, 'min');
        const maxC = contributions(item, 'max');
        if (span === 1) {
            const i = idx[0];
            const track = tracks[i];
            if (track.intrinsicMin) {
                const minKind = minOf(track).keyword === 'max-content' ? maxC : minC;
                base[i] = Math.max(base[i], minKind);
            }
            if (track.intrinsicMax) {
                const maxKind = maxOf(track).keyword === 'min-content' ? minC : maxC;
                limit[i] = Math.max(limit[i], maxKind);
            }
        } else {
            const gaps = gap * (span - 1);
            const current = idx.reduce((sum, i) => sum + base[i], 0) + gaps;
            const extra = minC - current;
            const growable = idx.filter((i) => tracks[i].intrinsicMin && !flex[i]);
            if (extra > 0 && growable.length) for (const i of growable) base[i] += extra / growable.length;
            const currentMax = idx.reduce((sum, i) => sum + Math.max(base[i], Number.isFinite(limit[i]) ? limit[i] : base[i]), 0) + gaps;
            const extraMax = maxC - currentMax;
            const growMax = idx.filter((i) => tracks[i].intrinsicMax);
            if (extraMax > 0 && growMax.length) for (const i of growMax) limit[i] = Math.max(limit[i], base[i]) + extraMax / growMax.length;
        }
    }
    // Together, not by span: each item's excess goes to the flexible tracks
    // with an intrinsic minimum in proportion to their flex factors (also when
    // the factors sum to less than 1, measured); each track takes the largest
    // increase any item asks of it
    if (crossingFlex.length) {
        const planned = new Array(n).fill(0);
        for (const { item, idx } of crossingFlex) {
            const grow = idx.filter((i) => flex[i] && tracks[i].intrinsicMin);
            const extra = contributions(item, 'min') - idx.reduce((sum, i) => sum + base[i], 0) - gap * (idx.length - 1);
            if (extra <= 0 || !grow.length) continue;
            const sumFlex = grow.reduce((sum, i) => sum + flex[i], 0);
            for (const i of grow) planned[i] = Math.max(planned[i], sumFlex > 0 ? extra * flex[i] / sumFlex : extra / grow.length);
        }
        for (let i = 0; i < n; i++) base[i] += planned[i];
    }
    for (let i = 0; i < n; i++) if (limit[i] < base[i]) limit[i] = base[i];
    const sizes = [...base];
    const gaps = gap * Math.max(0, n - 1);
    if (available == null) {
        // Min-content constraint: there is no free space to grow into and the
        // fr size is zero, so every track keeps its base size
        if (minContent) return sizes;
        // Max-content constraint: tracks grow to their limits; flexible
        // tracks take the used flex fraction (css-grid §12.7): the largest of
        // each flexible track's base size (over its flex factor when that is
        // above 1) and, for each item crossing a flexible track, the fr size
        // that fills the item's max-content contribution
        for (let i = 0; i < n; i++) sizes[i] = Number.isFinite(limit[i]) ? limit[i] : base[i];
        const frTracks = sizes.map((_, i) => i).filter((i) => flex[i]);
        if (frTracks.length) {
            let fraction = 0;
            for (const i of frTracks) fraction = Math.max(fraction, flex[i] > 1 ? base[i] / flex[i] : base[i]);
            for (const item of items) {
                const start = item.gridPos[startKey];
                const idx = Array.from({ length: item.gridSpan[spanKey] }, (_, k) => start + k).filter((k) => k < n);
                if (!idx.some((i) => flex[i])) continue;
                const space = contributions(item, 'max') - gap * (idx.length - 1);
                fraction = Math.max(fraction, frSize(idx, flex, base, sizes, space));
            }
            distributeFr(engine, frTracks, flex, fraction, sizes, base);
        }
        return sizes;
    }
    // Grow non-flexible intrinsic tracks toward their limits
    let free = available - gaps - sizes.reduce((a, b) => a + b, 0);
    const growable = sizes.map((_, i) => i).filter((i) => !flex[i] && Number.isFinite(limit[i]) && limit[i] > sizes[i]);
    if (free > 0 && growable.length) {
        const want = growable.reduce((sum, i) => sum + (limit[i] - sizes[i]), 0);
        const share = Math.min(1, free / want);
        for (const i of growable) sizes[i] += (limit[i] - sizes[i]) * share;
        free = available - gaps - sizes.reduce((a, b) => a + b, 0);
    }
    // Flexible tracks
    const frIdx = sizes.map((_, i) => i).filter((i) => flex[i]);
    if (frIdx.length) {
        let pool = available - gaps - sizes.reduce((sum, s, i) => sum + (flex[i] ? 0 : s), 0);
        let active = [...frIdx];
        for (let guard = 0; guard < frIdx.length + 1; guard++) {
            // Flex factors are single precision and so is their sum, as in the browser
            const sumFr = active.reduce((sum, i) => Math.fround(sum + Math.fround(flex[i])), 0);
            const unit = Math.max(0, pool) / Math.max(1, sumFr);
            const tooSmall = active.filter((i) => unit * flex[i] < base[i]);
            if (!tooSmall.length || sumFr < 1 && false) {
                distributeFr(engine, active, flex, unit, sizes, base);
                break;
            }
            for (const i of tooSmall) { sizes[i] = base[i]; pool -= base[i]; }
            active = active.filter((i) => !tooSmall.includes(i));
            if (!active.length) break;
        }
        free = available - gaps - sizes.reduce((a, b) => a + b, 0);
    }
    // Stretch auto tracks into remaining space
    // (also beside flexible tracks that left space: below their base sizes, or flex factors under 1)
    if (stretch && free > 0) {
        const autos = tracks.map((t, i) => i).filter((i) => maxOf(tracks[i]).type === 'auto');
        if (autos.length) for (const i of autos) sizes[i] += engine.unit(free / autos.length);
    }
    return sizes;
}

/**
 * The size of an fr that fills `space` over tracks `idx` (css-grid §12.7.1):
 * what is left after the inflexible tracks, over the flex factors' sum (at
 * least 1, in single precision); a flexible track the result would shrink
 * below its base size is treated as inflexible and the size found again.
 */
function frSize(idx, flex, base, sizes, space) {
    const inflexible = new Set(idx.filter((i) => !flex[i]));
    for (;;) {
        const leftover = space - idx.reduce((sum, i) => sum + (inflexible.has(i) ? (flex[i] ? base[i] : sizes[i]) : 0), 0);
        const sumFr = idx.reduce((sum, i) => (inflexible.has(i) ? sum : Math.fround(sum + Math.fround(flex[i]))), 0);
        const size = Math.max(0, leftover) / Math.max(1, sumFr);
        const below = idx.filter((i) => !inflexible.has(i) && size * flex[i] < base[i]);
        if (!below.length) return size;
        for (const i of below) inflexible.add(i);
    }
}

/**
 * Flexible track sizes as the browser computes them: in single precision
 * layout pixels (the fr size, each share of it and the remainder carried),
 * each track truncated to a layout unit in order with the remainder carried
 * to the next. A product kept in double precision can land a hair under a
 * unit the browser reaches (minmax(310px, .92fr) at 2x: 67221 units, not 67222).
 */
function distributeFr(engine, tracks, flex, unit, sizes, base) {
    const zoom = engine.zoom || 1;
    const fraction = Math.fround(unit * zoom);
    let leftover = 0;
    for (const i of tracks) {
        const share = Math.fround(Math.fround(fraction * Math.fround(flex[i])) + leftover);
        const size = Math.floor(share * 64) / 64;
        // A track grows only past its base size, and only then carries the remainder
        if (size / zoom > base[i]) {
            leftover = Math.fround(share - size);
            sizes[i] = size / zoom;
        } else {
            sizes[i] = base[i];
        }
    }
}

function alignValue(value, fallback) {
    if (!value || value === 'normal' || value === 'auto') return fallback;
    if (value === 'start' || value === 'self-start' || value === 'flex-start' || value === 'left') return 'start';
    if (value === 'end' || value === 'self-end' || value === 'flex-end' || value === 'right') return 'end';
    return value;
}

/**
 * repeat(auto-fit, ...): the repeated columns no item occupies collapse, and
 * the gaps beside them with them, as the browser lays them out. Items keep
 * their places, renumbered over the columns that remain.
 */
function collapseAutoFit(cols, items) {
    if (!cols.some((track) => track.autoRepeat === 'auto-fit')) return cols;
    const used = new Array(cols.length).fill(false);
    for (const item of items) {
        for (let k = item.gridPos.c; k < item.gridPos.c + item.gridSpan.cs && k < cols.length; k++) used[k] = true;
    }
    const keep = cols.map((track, i) => used[i] || track.autoRepeat !== 'auto-fit');
    if (keep.every(Boolean)) return cols;
    const index = [];
    let n = 0;
    for (let i = 0; i < cols.length; i++) { index.push(n); if (keep[i]) n++; }
    index.push(n);
    for (const item of items) {
        const c0 = index[item.gridPos.c];
        const c1 = index[Math.min(cols.length, item.gridPos.c + item.gridSpan.cs)];
        item.gridPos = { ...item.gridPos, c: c0 };
        item.gridSpan = { ...item.gridSpan, cs: Math.max(1, c1 - c0) };
    }
    const kept = cols.filter((_, i) => keep[i]);
    kept.endNames = cols.endNames;
    return kept;
}

/** Lay out a grid container; returns the content height. */
export function layoutGrid(engine, box, contentWidth, contentHeight, heightBounds = null) {
    const s = box.style;
    const colGap = engine.len(s.columnGap, contentWidth, 0) || 0;
    const rowGap = engine.len(s.rowGap, contentHeight, 0) || 0;
    const items = [];
    for (const child of box.children) {
        if (child.isText) continue;
        if (child.outOfFlow) { child.staticPos = { x: box.contentX, y: box.contentY, alignIn: box }; continue; }
        child.gridItem = true;
        engine.resolveEdges(child, contentWidth);
        items.push(child);
    }
    let cols = trackList(engine, s.gridTemplateColumns, contentWidth, colGap);
    let rows = trackList(engine, s.gridTemplateRows, contentHeight, rowGap);
    const autoCol = s.gridAutoColumns?.[0] || { type: 'auto', keyword: 'auto' };
    const autoRow = s.gridAutoRows?.[0] || { type: 'auto', keyword: 'auto' };
    const names = explicitGrid(s, cols, rows, autoCol, autoRow);
    const placed = placeItems(items, cols.length || 1, rows.length, s.gridAutoFlow || 'row', names);
    while (cols.length < placed.columns) cols.push({ ...autoCol });
    while (rows.length < placed.rows) rows.push({ ...autoRow });
    cols = collapseAutoFit(cols, items);
    cols = cols.map((t) => ({ ...t }));
    rows = rows.map((t) => ({ ...t }));
    // An item whose rows need its height is laid out to measure it, and that
    // layout decides its bars once (LayoutEngine: barsOnce); laid out again
    // at another height (stretched), it decides afresh
    for (const item of items) {
        item.barsOnce = false;
        for (let k = item.gridPos.r; k < item.gridPos.r + item.gridSpan.rs && !item.barsOnce; k++) {
            if (rows[k]) item.barsOnce = measuresItem(engine, rows[k], item, contentHeight);
        }
    }

    const colContribution = (item, kind) => engine.trackContribution(item, kind);
    const colSizes = sizeTracks(engine, cols, items, 'column', contentWidth, colGap, colContribution,
        !s.justifyContent || s.justifyContent === 'normal' || s.justifyContent === 'stretch');
    const colStart = [];
    let x = 0;
    for (let i = 0; i < colSizes.length; i++) { colStart.push(x); x += colSizes[i] + colGap; }

    // Lay items out in their column spans to learn heights
    const cb = { width: contentWidth, height: contentHeight };
    const spanWidth = (item) => {
        const { c } = item.gridPos;
        const { cs } = item.gridSpan;
        let w = 0;
        for (let k = c; k < c + cs && k < colSizes.length; k++) w += colSizes[k];
        return w + colGap * (cs - 1);
    };
    for (const item of items) {
        const area = spanWidth(item);
        const justify = alignValue(item.style.justifySelf, alignValue(s.justifyItems, 'stretch'));
        const replaced = item.inner === 'replaced' || item.inner === 'svg';
        const autoWidth = item.style.width === 'auto';
        let forcedWidth;
        if (justify === 'stretch' && autoWidth && !replaced && !item.marginAuto[1] && !item.marginAuto[3]) {
            forcedWidth = engine.clampWidth(item, area - item.margin[1] - item.margin[3], area);
            engine.layoutBox(item, { width: area, height: null }, { forcedWidth });
        } else {
            engine.layoutBox(item, { width: area, height: null }, { shrinkToFit: true, availableWidth: area });
        }
        item.gridArea = area;
    }
    // An item's outer height. Its minimum contribution assumes its used
    // minimum height when its height is auto (CSS Grid 11.5); a scroll
    // container's automatic minimum is zero (6.6), so a tall scroller does
    // not push its row past a definite grid height
    const rowContribution = (item, kind) => {
        const outer = item.height + item.margin[0] + item.margin[2];
        const s = item.style;
        if (kind !== 'min' || s.height !== 'auto') return outer;
        let used = null;
        if (s.minHeight !== 'auto' && typeof s.minHeight === 'object') used = engine.len(s.minHeight, contentHeight);
        else if ([s.overflowX, s.overflowY].some((v) => v === 'auto' || v === 'scroll' || v === 'hidden')) used = 0;
        if (used == null) return outer;
        const pb = engine.pbHeight(item);
        const border = s.boxSizing === 'border-box' ? Math.max(used, pb) : used + pb;
        return Math.min(outer, border + item.margin[0] + item.margin[2]);
    };
    const stretchRows = !s.alignContent || s.alignContent === 'normal' || s.alignContent === 'stretch';
    let rowSizes = sizeTracks(engine, rows, items, 'row', contentHeight, rowGap, rowContribution, contentHeight != null && stretchRows);
    // Rows sized by their content that leave the grid below its min-height (or
    // above its max-height) are sized again with that height as definite free
    // space: flexible rows fill it, and auto rows stretch into a min-height
    if (contentHeight == null && heightBounds) {
        const total = rowSizes.reduce((a, b) => a + b, 0) + rowGap * Math.max(0, rowSizes.length - 1);
        const target = heightBounds.min != null && total < heightBounds.min - 0.01 ? heightBounds.min
            : heightBounds.max != null && total > heightBounds.max + 0.01 ? heightBounds.max : null;
        if (target != null) rowSizes = sizeTracks(engine, rows, items, 'row', target, rowGap, rowContribution, stretchRows);
    }
    const rowStart = [];
    let y = 0;
    for (let i = 0; i < rowSizes.length; i++) { rowStart.push(y); y += rowSizes[i] + rowGap; }
    const totalHeight = rowSizes.reduce((a, b) => a + b, 0) + rowGap * Math.max(0, rowSizes.length - 1);

    // Position and align items
    box.baseline = null;
    for (const item of items) {
        const { c, r } = item.gridPos;
        const { cs, rs } = item.gridSpan;
        let areaH = 0;
        for (let k = r; k < r + rs && k < rowSizes.length; k++) areaH += rowSizes[k];
        areaH += rowGap * (rs - 1);
        const areaW = item.gridArea;
        const align = alignValue(item.style.alignSelf, alignValue(s.alignItems, 'stretch'));
        const justify = alignValue(item.style.justifySelf, alignValue(s.justifyItems, 'stretch'));
        const replaced = item.inner === 'replaced' || item.inner === 'svg';
        if (align === 'stretch' && item.style.height === 'auto' && !replaced && !item.marginAuto[0] && !item.marginAuto[2]) {
            const target = engine.clampHeight(item, areaH - item.margin[0] - item.margin[2], areaH);
            if (Math.abs(target - item.height) > 0.01) {
                item.barsOnce = false;
                engine.layoutBox(item, { width: areaW, height: areaH }, { forcedWidth: item.width, forcedHeight: target });
            }
        }
        let ix = colStart[c] + item.margin[3];
        const freeX = areaW - item.width - item.margin[1] - item.margin[3];
        if (justify === 'center') ix += engine.unit(freeX / 2);
        else if (justify === 'end') ix += freeX;
        let iy = rowStart[r] + item.margin[0];
        const freeY = areaH - item.height - item.margin[0] - item.margin[2];
        if (align === 'center') iy += engine.unit(freeY / 2);
        else if (align === 'end') iy += freeY;
        item.x = box.contentX + ix;
        item.y = box.contentY + iy;
        if (r === 0 && box.baseline == null) box.baseline = item.y + (item.baseline ?? item.height);
    }
    box.lastBaseline = box.baseline;
    return contentHeight ?? totalHeight;
}

/**
 * Grow the explicit grid to cover grid-template-areas (extra tracks are sized
 * by grid-auto-rows/columns) and collect each axis's line names.
 */
function explicitGrid(s, cols, rows, autoCol, autoRow) {
    const areas = s.gridTemplateAreas;
    const names = { column: namedLines(cols, areas, 'column'), row: namedLines(rows, areas, 'row') };
    if (areas) {
        while (cols.length < areas.columns) cols.push({ ...autoCol });
        while (rows.length < areas.rows) rows.push({ ...autoRow });
    }
    return names;
}

export function intrinsicGrid(engine, box) {
    const s = box.style;
    const colGap = engine.len(s.columnGap, null, 0) || 0;
    const items = box.children.filter((child) => !child.isText && !child.outOfFlow);
    for (const item of items) { item.gridItem = true; engine.resolveEdges(item, null); }
    let cols = trackList(engine, s.gridTemplateColumns, null, colGap);
    const rows = trackList(engine, s.gridTemplateRows, null, 0);
    const autoCol = s.gridAutoColumns?.[0] || { type: 'auto', keyword: 'auto' };
    const names = explicitGrid(s, cols, rows, autoCol, s.gridAutoRows?.[0] || { type: 'auto', keyword: 'auto' });
    const placed = placeItems(items, cols.length || 1, rows.length, s.gridAutoFlow || 'row', names);
    while (cols.length < placed.columns) cols.push({ ...autoCol });
    cols = cols.map((t) => ({ ...t }));
    const gaps = colGap * Math.max(0, cols.length - 1);
    const maxSizes = sizeTracks(engine, cols.map((t) => ({ ...t })), items, 'column', null, colGap, (item, kind) => engine.trackContribution(item, kind), false);
    const minSizes = sizeTracks(engine, cols.map((t) => ({ ...t })), items, 'column', null, colGap, (item, kind) => engine.trackContribution(item, kind), false, true);
    return {
        min: minSizes.reduce((a, b) => a + b, 0) + gaps,
        max: maxSizes.reduce((a, b) => a + b, 0) + gaps
    };
}
