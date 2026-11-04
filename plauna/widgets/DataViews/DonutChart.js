// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * DonutChart - parts of a whole as ring segments with a total in the middle
 * and a legend with values and shares. Hovering a segment or legend row
 * highlights it and shows its value in the centre.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, tone } from '../shared/appearance.js';

let _donutSequence = 0;

function _newDonutId() {
    return `donut-chart-${Date.now()}-${++_donutSequence}`;
}

const PALETTE = ['primary', 'accent', 'success', 'warning', 'info', 'danger', 'neutral'];

const FRAME_BUDGET = [
    { label: 'Lighting', value: 4.2 },
    { label: 'Geometry', value: 3.1 },
    { label: 'Particles', value: 1.8 },
    { label: 'Post FX', value: 1.4 },
    { label: 'UI', value: 0.6 }
];

export class DonutChart extends UINode {
    static id = 'donut-chart';
    static name = 'Donut Chart';
    static category = 'dataviews';
    static icon = '🍩';
    static description = 'Parts of a whole as a ring with a legend';
    static tags = ['dataviews', 'chart', 'donut', 'pie', 'ring', 'breakdown'];
    static dependencies = [];
    static optionValues = { size: ['sm', 'md', 'lg'], thickness: ['thin', 'normal', 'thick'], legend: ['right', 'bottom', 'none'], gap: 'boolean' };

    static getDefaultOptions() {
        return { data: FRAME_BUDGET, label: 'Frame time', unit: ' ms', decimals: 1, size: 'md', thickness: 'normal', legend: 'right', gap: true };
    }

    static stories() {
        return {
            'Frame budget': { data: FRAME_BUDGET },
            'Thick, legend below': { data: [{ label: 'Desktop', value: 58 }, { label: 'Mobile', value: 31 }, { label: 'XR', value: 11 }], label: 'Players', unit: '%', decimals: 0, thickness: 'thick', legend: 'bottom', size: 'sm' },
            'Thin, large': { data: FRAME_BUDGET.slice(0, 3), thickness: 'thin', size: 'lg', legend: 'none' }
        };
    }

    static create(container, options = {}) {
        const instance = new DonutChart(_newDonutId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newDonutId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...DonutChart.getDefaultOptions(), ...options };
        this.hover = -1;
        this.build();
    }

    format(value) {
        return `${Number(value).toFixed(this.options.decimals)}${this.options.unit || ''}`;
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { size, thickness, legend, gap, label } = this.options;
        const data = (Array.isArray(this.options.data) ? this.options.data : []).map((d, i) => ({ ...d, value: Math.max(0, Number(d.value) || 0), tone: d.tone || PALETTE[i % PALETTE.length] }));
        const total = data.reduce((sum, d) => sum + d.value, 0);
        this.data = data;
        this.total = total;
        const d = { sm: 132, md: 168, lg: 208 }[size] || 168;
        const stroke = Math.round(d * ({ thin: 0.06, normal: 0.11, thick: 0.17 }[thickness] || 0.11));
        const r = (d - stroke) / 2 - 4;
        const circumference = 2 * Math.PI * r;
        const center = d / 2;
        const spacing = gap && data.length > 1 ? Math.min(4, circumference * 0.01) : 0;
        this.role = 'figure';
        this.ariaLabel = `${label}: ${data.map((x) => `${x.label} ${this.format(x.value)}`).join(', ')}`;
        this.setStyles({ display: 'flex', flexDirection: legend === 'bottom' ? 'column' : 'row', alignItems: 'center', gap: legend === 'bottom' ? '14px' : '24px' });
        const svg = new UINode(`${this.id}-svg`, 'svg');
        svg.tag = 'svg';
        Object.assign(svg.userData, { viewBox: `0 0 ${d} ${d}`, width: String(d), height: String(d), 'aria-hidden': 'true' });
        svg.setStyles({ display: 'block' });
        const ring = new UINode(`${this.id}-ring`, 'g');
        ring.tag = 'g';
        ring.userData.transform = `rotate(-90 ${center} ${center})`;
        svg.appendChild(ring);
        const track = new UINode(`${this.id}-track`, 'circle');
        track.tag = 'circle';
        Object.assign(track.userData, { cx: String(center), cy: String(center), r: String(r), fill: 'none', 'stroke-width': String(stroke) });
        track.setStyles({ stroke: 'color-mix(in srgb, var(--text-primary, #e4e4e7) 8%, transparent)' });
        ring.appendChild(track);
        this.segments = [];
        let offset = 0;
        data.forEach((item, index) => {
            const length = total > 0 ? (item.value / total) * circumference : 0;
            const visible = Math.max(0, length - spacing);
            const seg = new UINode(`${this.id}-seg-${index}`, 'circle');
            seg.tag = 'circle';
            Object.assign(seg.userData, {
                cx: String(center), cy: String(center), r: String(r), fill: 'none', 'stroke-width': String(stroke),
                'stroke-dasharray': `${visible.toFixed(3)} ${(circumference - visible).toFixed(3)}`, 'stroke-dashoffset': String((-offset).toFixed(3))
            });
            seg.setStyles({ stroke: tone(item.tone).base, transition: 'opacity 150ms ease', cursor: 'pointer' });
            seg.addEventListener('mouseenter', () => this.setHover(index));
            seg.addEventListener('mouseleave', () => this.setHover(-1));
            ring.appendChild(seg);
            this.segments.push(seg);
            offset += length;
        });
        this.centerValue = el(this, 'center-value', 'div', { style: { fontSize: `${Math.round(d * 0.15)}px`, fontWeight: '750', letterSpacing: '-0.02em', color: 'var(--text-primary, #e4e4e7)', lineHeight: '1.1' } });
        this.centerLabel = el(this, 'center-label', 'div', { style: { fontSize: '12px', color: 'var(--text-tertiary, #9ca3af)', marginTop: '2px' } });
        this.appendChild(el(this, 'chart', 'div', {
            style: { position: 'relative', width: `${d}px`, height: `${d}px`, flex: '0 0 auto' },
            children: [svg, el(this, 'center', 'div', {
                style: { position: 'absolute', top: '0', left: '0', right: '0', bottom: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', pointerEvents: 'none' },
                children: [this.centerValue, this.centerLabel]
            })]
        }));
        this.rows = [];
        if (legend !== 'none') {
            const list = el(this, 'legend', 'ul', { style: { listStyle: 'none', margin: '0', padding: '0', display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '180px' } });
            data.forEach((item, index) => {
                const share = total > 0 ? Math.round((item.value / total) * 100) : 0;
                const row = el(this, `row-${index}`, 'li', {
                    style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '5px 8px', borderRadius: '8px', fontSize: '13px', cursor: 'default', transition: 'background-color 120ms ease' },
                    children: [
                        el(this, `swatch-${index}`, 'span', { style: { width: '10px', height: '10px', borderRadius: '3px', backgroundColor: tone(item.tone).base, flex: '0 0 auto' } }),
                        el(this, `name-${index}`, 'span', { text: item.label, style: { flex: '1', color: 'var(--text-secondary, #d1d5db)' } }),
                        el(this, `value-${index}`, 'span', { text: this.format(item.value), style: { fontWeight: '650', color: 'var(--text-primary, #e4e4e7)' } }),
                        el(this, `share-${index}`, 'span', { text: `${share}%`, style: { width: '38px', textAlign: 'right', fontSize: '12px', color: 'var(--text-tertiary, #9ca3af)' } })
                    ]
                });
                row.addEventListener('mouseenter', () => this.setHover(index));
                row.addEventListener('mouseleave', () => this.setHover(-1));
                list.appendChild(row);
                this.rows.push(row);
            });
            this.appendChild(list);
        }
        this.paint();
    }

    setHover(index) {
        this.hover = index;
        this.paint();
    }

    paint() {
        const item = this.data[this.hover];
        this.centerValue.setTextContent(item ? this.format(item.value) : this.format(this.total));
        this.centerLabel.setTextContent(item ? item.label : this.options.label);
        this.segments.forEach((seg, index) => seg.setStyles({ opacity: this.hover < 0 || this.hover === index ? '1' : '0.35' }));
        this.rows.forEach((row, index) => row.setStyles({ backgroundColor: index === this.hover ? 'color-mix(in srgb, var(--text-primary, #e4e4e7) 6%, transparent)' : 'transparent' }));
    }

    setData(data) {
        this.options.data = data;
        this.build();
    }
}
