// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Table layout for Plauna's own layout pass (the automatic table layout
 * algorithm, simplified): column widths from cell min/max content with
 * colspan distribution, separated or collapsed borders, row heights from
 * cells, vertical-align inside cells, captions above the table.
 */

function collect(table) {
    const groups = [];
    const captions = [];
    let looseRows = null;
    for (const child of table.children) {
        if (child.isText) continue;
        if (child.caption) { captions.push(child); continue; }
        if (child.inner === 'table-row-group') {
            groups.push({ box: child, rows: child.children.filter((r) => !r.isText && r.inner === 'table-row') });
            looseRows = null;
        } else if (child.inner === 'table-row') {
            if (!looseRows) { looseRows = { box: null, rows: [] }; groups.push(looseRows); }
            looseRows.rows.push(child);
        }
    }
    // Header groups come first, footers last
    const order = (g) => (g.box?.display === 'table-header-group' ? 0 : g.box?.display === 'table-footer-group' ? 2 : 1);
    groups.sort((a, b) => order(a) - order(b));
    const rows = [];
    for (const group of groups) for (const row of group.rows) rows.push({ row, group });
    return { groups, rows, captions };
}

function cellsOf(row) {
    return row.children.filter((c) => !c.isText && !c.outOfFlow);
}

function spanOf(cell) {
    const span = parseInt(cell.element?.getAttribute?.('colspan'), 10);
    return Number.isFinite(span) && span > 0 ? span : 1;
}

function columnMetrics(engine, table, rows) {
    const [hs] = spacingOf(engine, table, rows);
    const mins = [];
    const maxs = [];
    const fixed = [];
    // Max widths of the cells with a specified width, per column
    const constrained = [];
    // Columns some cell starts in; the others are mergeable (no width, no spacing)
    const starts = [];
    const spanning = [];
    let count = 0;
    for (const { row } of rows) {
        let col = 0;
        for (const cell of cellsOf(row)) {
            cell.tableCell = true;
            engine.resolveEdges(cell, null);
            const span = spanOf(cell);
            cell.tableCol = col;
            cell.tableSpan = span;
            starts[col] = true;
            const intrinsic = engine.cellIntrinsic(cell);
            const specified = cell.style.width && typeof cell.style.width === 'object' && cell.style.width.px != null
                ? engine.specifiedWidth(cell, null) : null;
            if (span === 1) {
                mins[col] = Math.max(mins[col] || 0, intrinsic.min);
                if (specified != null) {
                    fixed[col] = Math.max(fixed[col] || 0, specified);
                    constrained[col] = Math.max(constrained[col] || 0, specified, intrinsic.min);
                } else {
                    maxs[col] = Math.max(maxs[col] || 0, intrinsic.max, intrinsic.min);
                }
            } else {
                spanning.push({ col, span, min: intrinsic.min, max: specified ?? intrinsic.max, constrained: specified != null });
            }
            col += span;
        }
        count = Math.max(count, col);
    }
    // Once a column has a cell with a specified width, the other cells'
    // max-content no longer counts (Column::Encompass): its max is that width
    for (let i = 0; i < count; i++) {
        mins[i] = mins[i] || 0;
        maxs[i] = Math.max(constrained[i] ?? maxs[i] ?? 0, mins[i]);
    }
    const mergeable = Array.from({ length: count }, (_, i) => !starts[i]);
    // Spanning cells widen the columns they span the way the table's width is
    // shared (TablesNG DistributeColspanCellToColumnsAuto): the cell's min and
    // max, less the spacing between its non-mergeable columns, are spread by
    // distributeWidths over those columns, and each column keeps the larger;
    // narrower spans first, then by their first column
    spanning.sort((a, b) => a.span - b.span || a.col - b.col);
    for (const s of spanning) {
        const idx = Array.from({ length: s.span }, (_, k) => s.col + k).filter((i) => i < count);
        const open = idx.filter((i) => !mergeable[i]);
        if (!open.length) continue;
        const inner = hs * (open.length - 1);
        const part = { count: open.length, mins: open.map((i) => mins[i]), maxs: open.map((i) => maxs[i]), fixed: open.map((i) => fixed[i]), mergeable: open.map(() => false) };
        const minSizes = distributeWidths(engine, part, Math.max(0, s.min - inner), true);
        open.forEach((i, k) => { mins[i] = Math.max(mins[i], minSizes[k]); });
        part.mins = open.map((i) => mins[i]);
        const maxSizes = distributeWidths(engine, part, Math.max(0, s.max - inner), s.constrained);
        open.forEach((i, k) => { maxs[i] = Math.max(mins[i], maxs[i], maxSizes[k]); });
    }
    for (let i = 0; i < count; i++) maxs[i] = Math.max(maxs[i], mins[i]);
    return { count, mins, maxs, fixed, mergeable, open: mergeable.filter((m) => !m).length };
}

/**
 * Column widths for `available` as Chrome's automatic table layout shares
 * them (DistributeInlineSizeToComputedInlineSizeAuto), in layout units:
 * from the minimum widths, columns with a specified width grow towards it
 * first, then the others towards their maximum widths, each by a share of
 * the space in proportion to its growth; past the maximums the others (or,
 * with none, every column) grow in proportion to their maximum widths. Each
 * share is truncated (LayoutUnit::MulDiv) and the remainder goes to the last
 * column that took a share.
 */
function distributeWidths(engine, metrics, available) {
    const scale = 64 * (engine.zoom || 1);
    const units = (v) => Math.round(v * scale);
    const n = metrics.count;
    // Mergeable columns (no cell starts there) take no width
    const kept = (i) => !metrics.mergeable?.[i];
    const mins = metrics.mins.map((v, i) => (kept(i) ? units(v) : 0));
    const maxs = metrics.maxs.map((v, i) => (kept(i) ? units(v) : 0));
    const all = Array.from({ length: n }, (_, i) => i).filter(kept);
    const fixed = all.filter((i) => metrics.fixed[i] != null);
    const auto = all.filter((i) => metrics.fixed[i] == null);
    const sum = (list) => list.reduce((total, v) => total + v, 0);
    const growth = mins.map((min, i) => maxs[i] - min);
    const share = (base, columns, weights, space) => {
        const sizes = [...base];
        const total = sum(columns.map((i) => weights[i]));
        let remaining = space;
        let last = -1;
        for (const i of columns) {
            const delta = total > 0 ? Math.trunc(space * weights[i] / total) : Math.trunc(space / columns.length);
            sizes[i] += delta;
            remaining -= delta;
            last = i;
        }
        if (last >= 0) sizes[last] += remaining;
        return sizes;
    };
    const minGuess = sum(mins);
    const specified = mins.map((min, i) => (metrics.fixed[i] != null ? maxs[i] : min));
    const specifiedGuess = sum(specified);
    const maxGuess = sum(maxs);
    const target = Math.max(units(available), minGuess);
    let sizes;
    if (target === maxGuess) sizes = maxs;
    else if (target <= specifiedGuess) sizes = target === minGuess ? mins : share(mins, fixed, growth, target - minGuess);
    else if (target < maxGuess) sizes = share(specified, auto, growth, target - specifiedGuess);
    else sizes = share(maxs, auto.length ? auto : all, maxs, target - maxGuess);
    return sizes.map((v) => v / scale);
}

/**
 * Collapsed borders: each grid line takes the widest border that meets it;
 * cells own half of each line. Returns { cols, rows } line widths.
 */
function collapseBorders(engine, rows, columnCount) {
    const cols = new Array(columnCount + 1).fill(0);
    const rowLines = new Array(rows.length + 1).fill(0);
    rows.forEach(({ row }, r) => {
        let col = 0;
        for (const cell of cellsOf(row)) {
            cell.borderOverride = null;
            const span = spanOf(cell);
            const w = cell.style.borderWidth;
            cols[col] = Math.max(cols[col], w[3]);
            cols[Math.min(columnCount, col + span)] = Math.max(cols[Math.min(columnCount, col + span)], w[1]);
            rowLines[r] = Math.max(rowLines[r], w[0]);
            rowLines[r + 1] = Math.max(rowLines[r + 1], w[2]);
            col += span;
        }
    });
    rows.forEach(({ row }, r) => {
        let col = 0;
        for (const cell of cellsOf(row)) {
            const span = spanOf(cell);
            const right = Math.min(columnCount, col + span);
            cell.borderOverride = [rowLines[r] / 2, cols[right] / 2, rowLines[r + 1] / 2, cols[col] / 2];
            cell.collapsedBorder = {
                widths: [rowLines[r], cols[right], rowLines[r + 1], cols[col]],
                lastColumn: right >= columnCount,
                lastRow: r === rows.length - 1
            };
            cell.intrinsicCache = null;
            col += span;
        }
    });
    return { cols, rows: rowLines };
}

function countColumns(rows) {
    let count = 0;
    for (const { row } of rows) {
        let col = 0;
        for (const cell of cellsOf(row)) col += spanOf(cell);
        count = Math.max(count, col);
    }
    return count;
}

function spacingOf(engine, table, rows) {
    // A table with no columns takes no border spacing either way
    if (table.style.borderCollapse === 'collapse' || !countColumns(rows)) return [0, 0];
    // Chrome keeps border spacing in whole layout pixels: the default 2px is 1.6px at 125% (measured)
    const zoom = engine.zoom || 1;
    return (table.style.borderSpacing || [0, 0]).map((px) => Math.trunc(px * zoom + 1e-6) / zoom);
}

export function layoutTable(engine, table, contentWidth, contentHeight) {
    const { rows, captions, groups } = collect(table);
    const [hs, vs] = spacingOf(engine, table, rows);
    const collapse = table.style.borderCollapse === 'collapse';
    const lines = collapse ? collapseBorders(engine, rows, countColumns(rows)) : null;
    const metrics = columnMetrics(engine, table, rows);
    const n = metrics.count;
    // Outer half-borders of a collapsed table sit inside the table box
    const edgeX = lines ? (lines.cols[0] + lines.cols[n]) / 2 : 0;
    const spacingX = (metrics.open ? hs * (metrics.open + 1) : 0) + edgeX;
    const sumMin = metrics.mins.reduce((a, b) => a + b, 0);
    const sumMax = metrics.maxs.reduce((a, b) => a + b, 0);
    // A table is never narrower than its columns' minimum widths: it overflows its container
    if (sumMin + spacingX > contentWidth + 0.01) {
        table.width += sumMin + spacingX - contentWidth;
        contentWidth = sumMin + spacingX;
        table.layoutContentWidth = contentWidth;
    }
    const available = Math.max(0, contentWidth - spacingX);
    const widths = distributeWidths(engine, metrics, available);
    const colX = [];
    let x = hs + (lines ? lines.cols[0] / 2 : 0);
    for (let i = 0; i < n; i++) { colX.push(x); x += widths[i] + (metrics.mergeable[i] ? 0 : hs); }

    // Captions
    let y = 0;
    const ox = table.contentX;
    const oy = table.contentY;
    for (const caption of captions) {
        engine.layoutBox(caption, { width: contentWidth, height: null }, { availableWidth: contentWidth });
        caption.x = ox + caption.margin[3];
        caption.y = oy + y + caption.margin[0];
        y += caption.height + caption.margin[0] + caption.margin[2];
    }
    const tableTop = y;
    y += vs + (lines ? lines.rows[0] / 2 : 0);

    // Rows
    table.baseline = null;
    for (const { row } of rows) {
        engine.resolveEdges(row, contentWidth);
        let rowHeight = engine.len(row.style.height, null, 0) || 0;
        const cells = cellsOf(row);
        for (const cell of cells) {
            let w = 0;
            for (let k = cell.tableCol; k < cell.tableCol + cell.tableSpan && k < n; k++) w += widths[k];
            let open = 0;
            for (let k = cell.tableCol; k < cell.tableCol + cell.tableSpan && k < n; k++) if (!metrics.mergeable[k]) open++;
            w += hs * Math.max(0, open - 1);
            engine.layoutBox(cell, { width: w, height: null }, { forcedWidth: w });
            // vertical-align places the content, not the height the cell was given
            cell.tableContentHeight = cell.contentUsedHeight != null ? cell.contentUsedHeight + engine.pbHeight(cell) : cell.height;
            rowHeight = Math.max(rowHeight, cell.height, cell.tableContentHeight);
        }
        // Stretch cells to the row and apply vertical-align
        let rowBaseline = 0;
        for (const cell of cells) {
            if ((cell.style.verticalAlign || 'baseline') === 'baseline') rowBaseline = Math.max(rowBaseline, cell.baseline ?? cell.height);
        }
        for (const cell of cells) {
            const contentHeight = cell.tableContentHeight;
            const va = cell.style.verticalAlign || 'baseline';
            let shift = 0;
            if (va === 'middle') shift = (rowHeight - contentHeight) / 2;
            else if (va === 'bottom') shift = rowHeight - contentHeight;
            else if (va === 'baseline') shift = rowBaseline - (cell.baseline ?? cell.height);
            if (rowHeight !== cell.height || shift) {
                cell.height = rowHeight;
                if (shift) shiftContent(cell, shift);
                // Changed after its layout: the next layout of the cell must run
                cell.layoutKey = null;
                cell.sizeMemo = null;
            }
            cell.x = colX[cell.tableCol] - hs + hs;
            cell.y = 0;
        }
        row.x = ox;
        row.y = oy + y;
        row.width = contentWidth;
        row.height = rowHeight;
        // Cells are positioned relative to the row
        for (const cell of cells) cell.x = colX[cell.tableCol];
        if (table.baseline == null && cells.length) table.baseline = row.y + rowBaseline;
        y += rowHeight + vs;
    }
    // Row groups wrap their rows; rows become relative to their group. Both
    // sit inside the border spacing at the table's sides
    const rowLeft = hs + (lines ? lines.cols[0] / 2 : 0);
    const rowWidth = Math.max(0, contentWidth - edgeX - 2 * hs);
    for (const { row } of rows) {
        row.x += rowLeft;
        row.width = rowWidth;
        for (const cell of cellsOf(row)) cell.x -= rowLeft;
    }
    for (const group of groups) {
        if (!group.box || !group.rows.length) continue;
        engine.resolveEdges(group.box, contentWidth);
        const first = group.rows[0];
        const last = group.rows[group.rows.length - 1];
        group.box.x = ox + rowLeft;
        group.box.y = first.y;
        group.box.width = rowWidth;
        group.box.height = last.y + last.height - first.y;
        for (const row of group.rows) {
            row.x -= group.box.x;
            row.y -= group.box.y;
        }
    }
    table.lastBaseline = table.baseline;
    // Rows, groups and stretched cells were sized here, not through layoutBox
    for (const { row } of rows) {
        engine.touch(row);
        for (const cell of cellsOf(row)) engine.touch(cell);
    }
    for (const group of groups) if (group.box) engine.touch(group.box);
    if (lines) y += lines.rows[rows.length] / 2;
    const height = Math.max(y, tableTop + vs);
    return contentHeight != null ? Math.max(contentHeight, height) : height;
}

function shiftContent(cell, dy) {
    for (const child of cell.children) if (!child.isText && !child.outOfFlow) child.y += dy;
    if (cell.runs) for (const run of cell.runs) { run.top += dy; run.baseline += dy; }
    if (cell.lines) for (const line of cell.lines) { line.top += dy; line.baseline += dy; }
    const shiftFragments = (b) => {
        for (const child of b.children || []) {
            if (child.isText) continue;
            if (child.ifc === cell && child.fragments) for (const f of child.fragments) f.y += dy;
            if (b !== cell && child.atomic && child.ifc === cell) child.y += dy;
            if (child.outer === 'inline' && !child.atomic) shiftFragments(child);
        }
    };
    shiftFragments(cell);
    if (cell.baseline != null) cell.baseline += dy;
    if (cell.lastBaseline != null) cell.lastBaseline += dy;
}

export function intrinsicTable(engine, table) {
    const { rows } = collect(table);
    const [hs] = spacingOf(engine, table, rows);
    const lines = table.style.borderCollapse === 'collapse' ? collapseBorders(engine, rows, countColumns(rows)) : null;
    const metrics = columnMetrics(engine, table, rows);
    const spacing = (metrics.open ? hs * (metrics.open + 1) : 0) + (lines ? (lines.cols[0] + lines.cols[metrics.count]) / 2 : 0);
    return {
        min: metrics.mins.reduce((a, b) => a + b, 0) + spacing,
        max: metrics.maxs.reduce((a, b) => a + b, 0) + spacing
    };
}
