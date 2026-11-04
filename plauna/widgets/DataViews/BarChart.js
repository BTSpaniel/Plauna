// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * BarChart - values as rounded bars, vertical or horizontal, over a light
 * grid with a value axis. Hovering a bar highlights it and shows its value.
 * Bars are plain boxes, so they stay crisp in every render mode.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, tone, TONES } from '../shared/appearance.js';

let _barChartSequence = 0;

function _newBarChartId() {
    return `bar-chart-${Date.now()}-${++_barChartSequence}`;
}

const WEEK = [
    { label: 'Mon', value: 420 }, { label: 'Tue', value: 580 }, { label: 'Wed', value: 510 }, { label: 'Thu', value: 760 },
    { label: 'Fri', value: 890 }, { label: 'Sat', value: 1240 }, { label: 'Sun', value: 1090 }
];

/** A tidy axis maximum (1, 2 or 5 times a power of ten) at or above `max`. */
export function niceMax(max) {
    if (!(max > 0)) return 1;
    const power = 10 ** Math.floor(Math.log10(max));
    for (const step of [1, 2, 2.5, 5, 10]) if (step * power >= max) return step * power;
    return 10 * power;
}

export class BarChart extends UINode {
    static id = 'bar-chart';
    static name = 'Bar Chart';
    static category = 'dataviews';
    static icon = '📶';
    static description = 'Values as rounded bars with a grid';
    static tags = ['dataviews', 'chart', 'bar', 'column', 'histogram', 'graph'];
    static dependencies = [];
    static optionValues = { orientation: ['vertical', 'horizontal'], tone: ['multi', ...TONES], showValues: 'boolean', showGrid: 'boolean', highlightMax: 'boolean' };

    static getDefaultOptions() {
        return { data: WEEK, title: 'Players per day', unit: '', orientation: 'vertical', tone: 'primary', height: 200, showValues: false, showGrid: true, highlightMax: true };
    }

    static stories() {
        return {
            'Week': { data: WEEK },
            'Horizontal with values': { data: [{ label: 'Lighting', value: 4.2 }, { label: 'Geometry', value: 3.1 }, { label: 'Particles', value: 1.8 }, { label: 'Post FX', value: 1.4 }], title: 'GPU time (ms)', orientation: 'horizontal', showValues: true, tone: 'accent', highlightMax: false },
            'Multi-colour': { data: WEEK.slice(0, 5), tone: 'multi', showValues: true, highlightMax: false, height: 180 }
        };
    }

    static create(container, options = {}) {
        const instance = new BarChart(_newBarChartId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newBarChartId(), options = {}) {
        super(id, 'figure');
        this.tag = 'figure';
        this.options = { ...BarChart.getDefaultOptions(), ...options };
        this.hover = -1;
        this.build();
    }

    format(value) {
        const n = Number(value);
        const text = n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : Number.isInteger(n) ? String(n) : n.toFixed(1);
        return `${text}${this.options.unit || ''}`;
    }

    toneFor(index, max) {
        const palette = ['primary', 'accent', 'success', 'warning', 'info', 'danger', 'neutral'];
        if (this.options.tone === 'multi') return tone(palette[index % palette.length]);
        return tone(this.options.tone);
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { title, orientation, height, showValues, showGrid } = this.options;
        const data = (Array.isArray(this.options.data) ? this.options.data : []).map((d) => ({ label: String(d.label), value: Math.max(0, Number(d.value) || 0) }));
        const max = Math.max(0, ...data.map((d) => d.value));
        const axisMax = niceMax(max);
        this.data = data;
        this.maxIndex = data.findIndex((d) => d.value === max);
        const vertical = orientation !== 'horizontal';
        this.ariaLabel = `${title}: ${data.map((d) => `${d.label} ${this.format(d.value)}`).join(', ')}`;
        this.role = 'figure';
        this.setStyles({ display: 'flex', flexDirection: 'column', gap: '12px', margin: '0', width: '100%', maxWidth: '520px' });
        if (title) this.appendChild(el(this, 'title', 'figcaption', { text: title, style: { fontSize: '13px', fontWeight: '650', color: 'var(--text-secondary, #d1d5db)' } }));
        const ticks = [0, 0.25, 0.5, 0.75, 1];
        this.bars = [];
        if (vertical) {
            const plot = el(this, 'plot', 'div', { style: { position: 'relative', flex: '0 0 auto', height: `${height}px`, marginLeft: '36px' } });
            if (showGrid) {
                ticks.forEach((t, i) => plot.appendChild(el(this, `grid-${i}`, 'div', {
                    attrs: { 'aria-hidden': 'true' },
                    style: { position: 'absolute', left: '0', right: '0', bottom: `${t * 100}%`, height: '1px', backgroundColor: t === 0 ? 'var(--border-medium, #3a3a4a)' : 'var(--border-light, #2a2a3a)' },
                    children: [el(this, `tick-${i}`, 'span', { text: this.format(axisMax * t), style: { position: 'absolute', right: '100%', marginRight: '8px', top: '-7px', fontSize: '11px', color: 'var(--text-tertiary, #9ca3af)', whiteSpace: 'nowrap' } })]
                })));
            }
            const row = el(this, 'bars', 'div', { style: { position: 'absolute', left: '0', right: '0', top: '0', bottom: '0', display: 'flex', alignItems: 'flex-end', gap: '10px', padding: '0 6px' } });
            data.forEach((d, index) => {
                const bar = el(this, `bar-${index}`, 'div', {
                    style: { position: 'relative', width: '100%', height: `${(d.value / axisMax) * 100}%`, minHeight: d.value > 0 ? '3px' : '0', borderRadius: '6px 6px 2px 2px', transition: 'background-color 150ms ease, box-shadow 150ms ease', cursor: 'default' }
                });
                this.attachValue(bar, d, index, showValues, true);
                row.appendChild(el(this, `col-${index}`, 'div', { style: { flex: '1', height: '100%', display: 'flex', alignItems: 'flex-end', minWidth: '0' }, children: [bar] }));
                this.bars.push(bar);
            });
            plot.appendChild(row);
            this.appendChild(plot);
            this.appendChild(el(this, 'labels', 'div', {
                attrs: { 'aria-hidden': 'true' },
                style: { display: 'flex', gap: '10px', padding: '0 6px', marginLeft: '36px' },
                children: data.map((d, index) => el(this, `label-${index}`, 'span', { text: d.label, style: { flex: '1', minWidth: '0', textAlign: 'center', fontSize: '11px', color: 'var(--text-tertiary, #9ca3af)', overflow: 'hidden', whiteSpace: 'nowrap' } }))
            }));
        } else {
            const list = el(this, 'rows', 'div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } });
            data.forEach((d, index) => {
                const bar = el(this, `bar-${index}`, 'div', {
                    style: { position: 'relative', height: '100%', width: `${(d.value / axisMax) * 100}%`, minWidth: d.value > 0 ? '3px' : '0', borderRadius: '2px 6px 6px 2px', transition: 'background-color 150ms ease, box-shadow 150ms ease' }
                });
                this.attachValue(bar, d, index, showValues, false);
                list.appendChild(el(this, `row-${index}`, 'div', {
                    style: { display: 'flex', alignItems: 'center', gap: '12px' },
                    children: [
                        el(this, `label-${index}`, 'span', { text: d.label, style: { width: '86px', flex: '0 0 auto', fontSize: '12px', color: 'var(--text-secondary, #d1d5db)', textAlign: 'right' } }),
                        el(this, `lane-${index}`, 'div', {
                            style: { flex: '1', height: '20px', borderRadius: '6px', backgroundColor: showGrid ? 'color-mix(in srgb, var(--text-primary, #e4e4e7) 5%, transparent)' : 'transparent', paddingRight: '44px' },
                            children: [bar]
                        })
                    ]
                }));
                this.bars.push(bar);
            });
            this.appendChild(list);
        }
        this.paint();
    }

    attachValue(bar, d, index, show, vertical) {
        const value = el(this, `value-${index}`, 'span', {
            text: this.format(d.value),
            style: vertical
                ? { position: 'absolute', left: '50%', bottom: '100%', marginBottom: '6px', transform: 'translateX(-50%)', fontSize: '11px', fontWeight: '650', whiteSpace: 'nowrap', color: 'var(--text-primary, #e4e4e7)', transition: 'opacity 120ms ease' }
                : { position: 'absolute', left: '100%', top: '50%', marginLeft: '8px', transform: 'translateY(-50%)', fontSize: '11px', fontWeight: '650', whiteSpace: 'nowrap', color: 'var(--text-primary, #e4e4e7)', transition: 'opacity 120ms ease' }
        });
        bar._value = value;
        bar._show = show;
        bar.appendChild(value);
        bar.addEventListener('mouseenter', () => { this.hover = index; this.paint(); });
        bar.addEventListener('mouseleave', () => { this.hover = -1; this.paint(); });
    }

    paint() {
        this.bars.forEach((bar, index) => {
            const c = this.toneFor(index);
            const strong = this.hover === index || (this.hover < 0 && this.options.highlightMax && index === this.maxIndex) || this.options.tone === 'multi';
            const dim = this.hover >= 0 && this.hover !== index;
            bar.setStyles({
                backgroundColor: strong ? c.base : c.border,
                boxShadow: this.hover === index ? `0 0 14px ${c.glow}` : 'none',
                opacity: dim ? '0.55' : '1'
            });
            bar._value.setStyles({ opacity: bar._show || this.hover === index ? '1' : '0' });
        });
    }

    setData(data) {
        this.options.data = data;
        this.build();
    }
}
