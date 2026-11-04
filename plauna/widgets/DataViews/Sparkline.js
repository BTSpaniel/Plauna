// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Sparkline - a small inline chart of a series: a line, a filled area or
 * bars, optionally smoothed, with the last point (or every point) marked.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { tone, TONES } from '../shared/appearance.js';

let _sparklineSequence = 0;

function _newSparklineId() {
    return `sparkline-${Date.now()}-${++_sparklineSequence}`;
}

const SERIES = [12, 18, 14, 22, 19, 28, 24, 31, 27, 36, 33, 41];

/** Path through points; smooth uses Catmull-Rom segments as cubic Béziers. */
export function linePath(points, smooth) {
    if (!points.length) return '';
    if (!smooth || points.length < 3) return points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
    let d = `M${points[0][0].toFixed(2)} ${points[0][1].toFixed(2)}`;
    for (let i = 0; i < points.length - 1; i++) {
        const p0 = points[Math.max(0, i - 1)];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = points[Math.min(points.length - 1, i + 2)];
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
        const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
        d += ` C${c1[0].toFixed(2)} ${c1[1].toFixed(2)} ${c2[0].toFixed(2)} ${c2[1].toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
    }
    return d;
}

export class Sparkline extends UINode {
    static id = 'sparkline';
    static name = 'Sparkline';
    static category = 'dataviews';
    static icon = '📈';
    static description = 'Small inline line, area or bar chart';
    static tags = ['dataviews', 'sparkline', 'chart', 'trend', 'graph'];
    static dependencies = [];
    static optionValues = { type: ['area', 'line', 'bar'], tone: TONES, dots: ['last', 'all', 'none'], smooth: 'boolean', showMinMax: 'boolean' };

    static getDefaultOptions() {
        return { data: SERIES, type: 'area', tone: 'primary', width: 220, height: 56, dots: 'last', smooth: true, strokeWidth: 2, showMinMax: false, label: 'Trend' };
    }

    static stories() {
        return {
            'Area': { data: SERIES },
            'Line, every point': { data: [5, 9, 7, 12, 8, 14, 11, 9, 15], type: 'line', smooth: false, dots: 'all', tone: 'accent' },
            'Bars': { data: [4, 7, 5, 9, 12, 8, 10, 6, 11, 14, 9, 13], type: 'bar', tone: 'info', height: 48 },
            'Falling with extremes': { data: [42, 38, 40, 31, 33, 25, 27, 19, 22, 14], tone: 'danger', showMinMax: true },
            'Wide': { data: [3, 4, 3.5, 5, 6, 5.5, 7, 8, 7.2, 9, 10, 9.4, 11, 12.5, 12, 14], width: 420, height: 72, tone: 'success' }
        };
    }

    static create(container, options = {}) {
        const instance = new Sparkline(_newSparklineId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newSparklineId(), options = {}) {
        super(id, 'svg');
        this.tag = 'svg';
        this.options = { ...Sparkline.getDefaultOptions(), ...options };
        this.build();
    }

    shape(part, tag, attributes, style = {}) {
        const node = new UINode(`${this.id}-${part}`, tag);
        node.tag = tag;
        Object.assign(node.userData, attributes);
        if (Object.keys(style).length) node.setStyles(style);
        return node;
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { type, width, height, dots, smooth, strokeWidth, showMinMax, label } = this.options;
        const data = (Array.isArray(this.options.data) ? this.options.data : []).map(Number).filter(Number.isFinite);
        const c = tone(this.options.tone);
        Object.assign(this.userData, { viewBox: `0 0 ${width} ${height}`, width: String(width), height: String(height) });
        this.role = 'img';
        this.ariaLabel = data.length ? `${label}: ${data.length} values from ${data[0]} to ${data[data.length - 1]}` : `${label}: no data`;
        this.setStyles({ display: 'block', overflow: 'visible', maxWidth: '100%' });
        if (!data.length) return;
        const pad = Math.max(3, strokeWidth + 2);
        const min = Math.min(...data);
        const max = Math.max(...data);
        const span = max - min || 1;
        const x = (i) => (data.length === 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (data.length - 1));
        const y = (v) => height - pad - ((v - min) / span) * (height - 2 * pad);

        if (type === 'bar') {
            const slot = (width - 2 * pad) / data.length;
            const barWidth = Math.max(2, slot * 0.68);
            const floor = height - pad;
            data.forEach((v, i) => {
                const top = Math.min(floor - 2, y(v));
                const last = i === data.length - 1;
                this.appendChild(this.shape(`bar-${i}`, 'rect', {
                    x: (pad + i * slot + (slot - barWidth) / 2).toFixed(2), y: top.toFixed(2), width: barWidth.toFixed(2), height: (floor - top).toFixed(2), rx: String(Math.min(3, barWidth / 2))
                }, { fill: last ? c.base : c.border }));
            });
            return;
        }
        const points = data.map((v, i) => [x(i), y(v)]);
        const d = linePath(points, smooth);
        if (type === 'area') {
            const area = `${d} L${points[points.length - 1][0].toFixed(2)} ${height} L${points[0][0].toFixed(2)} ${height} Z`;
            this.appendChild(this.shape('area', 'path', { d: area }, { fill: c.soft, stroke: 'none' }));
        }
        this.appendChild(this.shape('line', 'path', { d, fill: 'none', 'stroke-width': String(strokeWidth), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, { stroke: c.base, fill: 'none' }));
        const mark = (i, part, color, radius) => {
            this.appendChild(this.shape(`${part}-halo`, 'circle', { cx: points[i][0].toFixed(2), cy: points[i][1].toFixed(2), r: String(radius + 3) }, { fill: c.soft, stroke: 'none' }));
            this.appendChild(this.shape(part, 'circle', { cx: points[i][0].toFixed(2), cy: points[i][1].toFixed(2), r: String(radius), 'stroke-width': '2' }, { fill: color, stroke: 'var(--bg-primary, #0a0a0f)' }));
        };
        if (dots === 'all') points.forEach((_, i) => this.appendChild(this.shape(`dot-${i}`, 'circle', { cx: points[i][0].toFixed(2), cy: points[i][1].toFixed(2), r: '2.5' }, { fill: c.base, stroke: 'none' })));
        if (showMinMax) {
            mark(data.indexOf(max), 'max', 'var(--color-success, #10b981)', 3);
            mark(data.indexOf(min), 'min', 'var(--color-error, #ef4444)', 3);
        }
        if (dots === 'last') mark(points.length - 1, 'last', c.base, 3.5);
    }

    setData(data) {
        this.options.data = data;
        this.build();
    }
}
