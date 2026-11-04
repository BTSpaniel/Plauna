// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Meter - a value within a known range: a radial gauge, a linear bar or a
 * row of segments. Thresholds pick the tone (green, then amber, then red),
 * so a reading changes colour as it crosses them.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, tone, TONES, clamp } from '../shared/appearance.js';

let _meterSequence = 0;

function _newMeterId() {
    return `meter-${Date.now()}-${++_meterSequence}`;
}

const DIAMETERS = { sm: 96, md: 132, lg: 172 };

export class Meter extends UINode {
    static id = 'meter';
    static name = 'Meter';
    static category = 'feedback';
    static icon = '⏲️';
    static description = 'Gauge, bar or segments for a value in a range';
    static tags = ['feedback', 'meter', 'gauge', 'dial', 'level', 'capacity'];
    static dependencies = [];
    static optionValues = { variant: ['radial', 'linear', 'segments'], size: ['sm', 'md', 'lg'], tone: ['auto', ...TONES], showValue: 'boolean' };

    static getDefaultOptions() {
        return { value: 64, min: 0, max: 100, label: 'Usage', unit: '%', variant: 'radial', size: 'md', tone: 'auto', thresholds: [{ value: 0, tone: 'success' }, { value: 70, tone: 'warning' }, { value: 90, tone: 'danger' }], showValue: true, segments: 12 };
    }

    static stories() {
        return {
            'GPU load': { value: 64, label: 'GPU load', unit: '%' },
            'Hot': { value: 93, label: 'Temperature', unit: '°C', min: 20, max: 100, size: 'lg' },
            'Memory bar': { value: 5.6, max: 8, label: 'VRAM', unit: 'GB', variant: 'linear' },
            'Signal segments': { value: 7, max: 12, label: 'Signal', unit: '', variant: 'segments', tone: 'info' },
            'Small fixed tone': { value: 38, label: 'Battery', size: 'sm', tone: 'accent' }
        };
    }

    static create(container, options = {}) {
        const instance = new Meter(_newMeterId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newMeterId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...Meter.getDefaultOptions(), ...options };
        this.build();
    }

    fraction() {
        const { value, min, max } = this.options;
        return max > min ? clamp((Number(value) - min) / (max - min), 0, 1) : 0;
    }

    currentTone() {
        if (this.options.tone && this.options.tone !== 'auto') return tone(this.options.tone);
        const percent = this.fraction() * 100;
        let picked = 'primary';
        for (const step of [...(this.options.thresholds || [])].sort((a, b) => a.value - b.value)) {
            if (percent >= step.value) picked = step.tone;
        }
        return tone(picked);
    }

    formatted() {
        const value = Number(this.options.value);
        const text = Number.isInteger(value) ? String(value) : value.toFixed(1);
        return `${text}${this.options.unit || ''}`;
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { variant, label, min, max, value } = this.options;
        this.role = 'meter';
        this.ariaLabel = label;
        this.setAttribute('aria-valuemin', String(min));
        this.setAttribute('aria-valuemax', String(max));
        this.setAttribute('aria-valuenow', String(value));
        this.setAttribute('aria-valuetext', this.formatted());
        if (variant === 'linear') this.buildLinear();
        else if (variant === 'segments') this.buildSegments();
        else this.buildRadial();
    }

    buildRadial() {
        const { size, label, showValue } = this.options;
        const c = this.currentTone();
        const d = DIAMETERS[size] || DIAMETERS.md;
        const stroke = Math.round(d * 0.085);
        const r = (d - stroke) / 2 - 2;
        const center = d / 2;
        const circumference = 2 * Math.PI * r;
        const sweep = circumference * 0.75;
        this.setStyles({ position: 'relative', display: 'inline-flex', flexDirection: 'column', alignItems: 'center', width: `${d}px` });
        const svg = new UINode(`${this.id}-svg`, 'svg');
        svg.tag = 'svg';
        Object.assign(svg.userData, { viewBox: `0 0 ${d} ${d}`, width: String(d), height: String(d), 'aria-hidden': 'true' });
        svg.setStyles({ display: 'block' });
        const ring = (part, color, length, width) => {
            const circle = new UINode(`${this.id}-${part}`, 'circle');
            circle.tag = 'circle';
            Object.assign(circle.userData, {
                cx: String(center), cy: String(center), r: String(r), fill: 'none', 'stroke-width': String(width),
                'stroke-linecap': 'round', 'stroke-dasharray': `${length} ${circumference}`, transform: `rotate(135 ${center} ${center})`
            });
            // Theme colours go in styles: SVG presentation attributes do not resolve var()
            circle.setStyles({ stroke: color });
            return circle;
        };
        svg.appendChild(ring('track', 'var(--bg-quaternary, #1f1f2e)', sweep, stroke));
        const fill = Math.max(0.001, sweep * this.fraction());
        svg.appendChild(ring('glow', c.glow, fill, stroke + 6));
        svg.appendChild(ring('fill', c.base, fill, stroke));
        this.appendChild(svg);
        if (showValue) {
            this.appendChild(el(this, 'readout', 'div', {
                style: { position: 'absolute', left: '0', right: '0', top: `${Math.round(d * 0.32)}px`, textAlign: 'center' },
                children: [
                    el(this, 'value', 'div', { text: this.formatted(), style: { fontSize: `${Math.round(d * 0.2)}px`, fontWeight: '700', letterSpacing: '-0.02em', color: 'var(--text-primary, #e4e4e7)', lineHeight: '1.1' } }),
                    el(this, 'label', 'div', { text: label, style: { fontSize: `${Math.max(11, Math.round(d * 0.09))}px`, color: 'var(--text-tertiary, #9ca3af)', marginTop: '2px' } })
                ]
            }));
        }
        this.appendChild(el(this, 'scale', 'div', {
            attrs: { 'aria-hidden': 'true' },
            style: { display: 'flex', justifyContent: 'space-between', width: `${Math.round(d * 0.72)}px`, marginTop: `-${Math.round(d * 0.12)}px`, fontSize: '11px', color: 'var(--text-disabled, #6b7280)' },
            children: [el(this, 'min', 'span', { text: String(this.options.min) }), el(this, 'max', 'span', { text: String(this.options.max) })]
        }));
    }

    buildLinear() {
        const { size, label, showValue } = this.options;
        const c = this.currentTone();
        const height = { sm: 6, md: 10, lg: 14 }[size] || 10;
        this.setStyles({ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', maxWidth: '360px', minWidth: '200px' });
        this.appendChild(el(this, 'head', 'div', {
            style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px' },
            children: [
                el(this, 'label', 'span', { text: label, style: { fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary, #d1d5db)' } }),
                showValue ? el(this, 'value', 'span', { text: `${this.formatted()} of ${this.options.max}${this.options.unit || ''}`, style: { fontSize: '13px', fontWeight: '650', color: c.text } }) : null
            ]
        }));
        this.appendChild(el(this, 'track', 'div', {
            style: { position: 'relative', height: `${height}px`, borderRadius: '9999px', backgroundColor: 'var(--bg-quaternary, #1f1f2e)', overflow: 'hidden' },
            children: [el(this, 'fill', 'div', {
                style: {
                    position: 'absolute', left: '0', top: '0', bottom: '0', width: `${(this.fraction() * 100).toFixed(2)}%`, borderRadius: '9999px',
                    backgroundImage: `linear-gradient(90deg, ${c.hover}, ${c.base})`, boxShadow: `0 0 12px ${c.glow}`,
                    transition: 'width var(--duration-slow, 320ms) var(--ease-out, ease)'
                }
            })]
        }));
    }

    buildSegments() {
        const { size, label, showValue } = this.options;
        const c = this.currentTone();
        const count = clamp(Number(this.options.segments) || 12, 3, 40);
        const lit = Math.round(this.fraction() * count);
        const height = { sm: 14, md: 20, lg: 28 }[size] || 20;
        this.setStyles({ display: 'inline-flex', flexDirection: 'column', gap: '8px' });
        const bars = el(this, 'bars', 'div', { style: { display: 'flex', alignItems: 'flex-end', gap: '3px', height: `${height}px` } });
        for (let i = 0; i < count; i++) {
            bars.appendChild(el(this, `seg-${i}`, 'span', {
                style: {
                    width: `${Math.max(4, Math.round(height * 0.32))}px`, height: `${Math.round(height * (0.35 + 0.65 * (i + 1) / count))}px`, borderRadius: '2px',
                    backgroundColor: i < lit ? c.base : 'var(--bg-quaternary, #1f1f2e)', boxShadow: i < lit ? `0 0 6px ${c.glow}` : 'none'
                }
            }));
        }
        this.appendChild(el(this, 'row', 'div', {
            style: { display: 'flex', alignItems: 'flex-end', gap: '12px' },
            children: [bars, showValue ? el(this, 'value', 'span', { text: `${lit}/${count}`, style: { fontSize: '13px', fontWeight: '650', color: c.text } }) : null]
        }));
        this.appendChild(el(this, 'label', 'span', { text: label, style: { fontSize: '12px', color: 'var(--text-tertiary, #9ca3af)' } }));
    }

    setValue(value) {
        this.options.value = Number(value);
        this.build();
    }
}
