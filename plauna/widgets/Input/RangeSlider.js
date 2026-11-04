// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * RangeSlider - pick a low and a high value on one track. Drag either
 * thumb (a click on the track moves the nearest), or focus a thumb and use
 * the arrow keys, PageUp/PageDown and Home/End. Optional marks and value
 * labels. Fires 'change' with [low, high].
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, tone, TONES, clamp } from '../shared/appearance.js';

let _rangeSliderSequence = 0;

function _newRangeSliderId() {
    return `range-slider-${Date.now()}-${++_rangeSliderSequence}`;
}

export class RangeSlider extends UINode {
    static id = 'range-slider';
    static name = 'Range Slider';
    static category = 'input';
    static icon = '🎛️';
    static description = 'Pick a low and a high value on one track';
    static tags = ['input', 'range', 'slider', 'dual', 'min max', 'between'];
    static emits = ['input', 'change'];
    static dependencies = [];
    static optionValues = { tone: TONES, size: ['sm', 'md', 'lg'], showLabels: 'boolean', showMarks: 'boolean', disabled: 'boolean' };

    static getDefaultOptions() {
        return { min: 0, max: 100, step: 1, value: [25, 75], label: 'Range', unit: '', tone: 'primary', size: 'md', showLabels: true, showMarks: false, marks: [], minGap: 0, disabled: false };
    }

    static stories() {
        return {
            'Price': { label: 'Price', min: 0, max: 500, step: 5, value: [80, 320], unit: '$' },
            'Marks': { label: 'Quality', min: 0, max: 4, step: 1, value: [1, 3], showMarks: true, marks: ['Low', 'Medium', 'High', 'Ultra', 'Max'], tone: 'accent' },
            'Temperature': { label: 'Comfort range', min: 10, max: 35, step: 0.5, value: [19, 24], unit: '°C', tone: 'warning', size: 'lg' },
            'Disabled': { label: 'Locked', value: [30, 60], disabled: true }
        };
    }

    static create(container, options = {}) {
        const instance = new RangeSlider(_newRangeSliderId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newRangeSliderId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...RangeSlider.getDefaultOptions(), ...options };
        const [lo, hi] = Array.isArray(this.options.value) ? this.options.value : [this.options.min, this.options.max];
        this.values = [this.snap(Math.min(lo, hi)), this.snap(Math.max(lo, hi))];
        this.dragging = -1;
        this.build();
    }

    snap(value) {
        const { min, max, step } = this.options;
        const stepped = Math.round((Number(value) - min) / step) * step + min;
        return clamp(Number(stepped.toFixed(6)), min, max);
    }

    percent(value) {
        const { min, max } = this.options;
        return max > min ? ((value - min) / (max - min)) * 100 : 0;
    }

    format(value) {
        const { unit } = this.options;
        const text = Number.isInteger(value) ? String(value) : value.toFixed(1);
        return unit === '$' ? `$${text}` : `${text}${unit || ''}`;
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { size, label, showLabels, disabled } = this.options;
        const height = { sm: 4, md: 6, lg: 8 }[size] || 6;
        const thumb = { sm: 14, md: 18, lg: 22 }[size] || 18;
        this.thumbSize = thumb;
        this.role = 'group';
        this.ariaLabel = label;
        this.setStyles({ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%', maxWidth: '420px', minWidth: '220px', opacity: disabled ? '0.5' : '1' });
        this.readout = el(this, 'readout', 'span', { style: { fontSize: '13px', fontWeight: '650', color: tone(this.options.tone).text } });
        this.appendChild(el(this, 'head', 'div', {
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' },
            children: [el(this, 'label', 'span', { text: label, style: { fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary, #d1d5db)' } }), showLabels ? this.readout : null]
        }));
        this.fill = el(this, 'fill', 'span', { style: { position: 'absolute', top: '0', bottom: '0', borderRadius: '9999px' } });
        this.thumbs = [0, 1].map((i) => {
            const node = el(this, `thumb-${i}`, 'span', {
                role: 'slider', tabIndex: disabled ? -1 : 0, label: i === 0 ? `${label} minimum` : `${label} maximum`,
                attrs: { 'aria-valuemin': String(this.options.min), 'aria-valuemax': String(this.options.max) },
                style: {
                    position: 'absolute', top: '50%', width: `${thumb}px`, height: `${thumb}px`, marginLeft: `-${thumb / 2}px`, marginTop: `-${thumb / 2}px`,
                    boxSizing: 'border-box', borderRadius: '50%', backgroundColor: '#ffffff', cursor: disabled ? 'not-allowed' : 'grab', outline: 'none',
                    transition: 'box-shadow 120ms ease'
                }
            });
            node.addEventListener('keydown', (event) => this.onKey(event, i));
            node.addEventListener('focus', () => { node._focused = true; this.paint(); });
            node.addEventListener('blur', () => { node._focused = false; this.paint(); });
            return node;
        });
        this.track = el(this, 'track', 'div', {
            style: { position: 'relative', height: `${height}px`, margin: `${(thumb - height) / 2}px ${thumb / 2}px`, borderRadius: '9999px', backgroundColor: 'color-mix(in srgb, var(--text-primary, #e4e4e7) 12%, transparent)', touchAction: 'none', cursor: disabled ? 'not-allowed' : 'pointer' },
            children: [this.fill, ...this.thumbs]
        });
        this.track.addEventListener('pointerdown', (event) => this.startDrag(event));
        this.track.addEventListener('pointermove', (event) => this.moveDrag(event));
        this.track.addEventListener('pointerup', (event) => this.endDrag(event));
        this.track.addEventListener('pointercancel', (event) => this.endDrag(event));
        this.appendChild(this.track);
        if (this.options.showMarks) {
            const marks = this.options.marks?.length ? this.options.marks : null;
            const count = Math.round((this.options.max - this.options.min) / this.options.step) + 1;
            const row = el(this, 'marks', 'div', { attrs: { 'aria-hidden': 'true' }, style: { position: 'relative', height: '18px', margin: `0 ${thumb / 2}px` } });
            for (let i = 0; i < Math.min(count, 21); i++) {
                const value = this.options.min + i * this.options.step;
                row.appendChild(el(this, `mark-${i}`, 'span', {
                    text: marks ? (marks[i] ?? '') : this.format(value),
                    style: { position: 'absolute', left: `${this.percent(value).toFixed(2)}%`, transform: 'translateX(-50%)', fontSize: '11px', color: 'var(--text-tertiary, #9ca3af)', whiteSpace: 'nowrap' }
                }));
            }
            this.appendChild(row);
        }
        this.paint();
    }

    paint() {
        const c = tone(this.options.tone);
        const [lo, hi] = this.values;
        this.fill.setStyles({ left: `${this.percent(lo).toFixed(3)}%`, width: `${(this.percent(hi) - this.percent(lo)).toFixed(3)}%`, backgroundColor: c.base, boxShadow: `0 0 10px ${c.glow}` });
        this.thumbs.forEach((thumb, i) => {
            thumb.setStyles({
                left: `${this.percent(this.values[i]).toFixed(3)}%`,
                border: `3px solid ${c.base}`,
                boxShadow: thumb._focused || this.dragging === i ? `0 0 0 5px ${c.soft}, 0 2px 6px rgba(0,0,0,0.35)` : '0 2px 6px rgba(0,0,0,0.35)',
                zIndex: this.dragging === i ? '2' : '1'
            });
            thumb.setAttribute('aria-valuenow', String(this.values[i]));
            thumb.setAttribute('aria-valuetext', this.format(this.values[i]));
        });
        this.readout.setTextContent(`${this.format(lo)} – ${this.format(hi)}`);
    }

    valueAt(native) {
        const rect = this.track.element?.getBoundingClientRect();
        if (!rect || rect.width <= 0) return null;
        const t = clamp((native.clientX - rect.left) / rect.width, 0, 1);
        return this.snap(this.options.min + t * (this.options.max - this.options.min));
    }

    startDrag(event) {
        if (this.options.disabled) return;
        const native = event?.nativeEvent || event;
        const value = this.valueAt(native);
        if (value === null) return;
        const [lo, hi] = this.values;
        this.dragging = Math.abs(value - lo) <= Math.abs(value - hi) ? (value > hi ? 1 : 0) : 1;
        if (lo === hi) this.dragging = value > lo ? 1 : 0;
        this.track.element?.setPointerCapture?.(native.pointerId);
        native.preventDefault?.();
        this.setThumb(this.dragging, value);
        this.thumbs[this.dragging].focus?.();
    }

    moveDrag(event) {
        if (this.dragging < 0) return;
        const value = this.valueAt(event?.nativeEvent || event);
        if (value !== null) this.setThumb(this.dragging, value);
    }

    endDrag(event) {
        if (this.dragging < 0) return;
        try { this.track.element?.releasePointerCapture?.((event?.nativeEvent || event).pointerId); } catch { /* released */ }
        this.dragging = -1;
        this.paint();
        this.dispatchEvent({ type: 'change', target: this, value: [...this.values] });
    }

    onKey(event, index) {
        if (this.options.disabled) return;
        const { step, min, max } = this.options;
        const big = Math.max(step, (max - min) / 10);
        const delta = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: big, PageDown: -big }[event.key];
        let next = null;
        if (delta !== undefined) next = this.values[index] + delta;
        else if (event.key === 'Home') next = min;
        else if (event.key === 'End') next = max;
        if (next === null) return;
        event.preventDefault?.();
        this.setThumb(index, this.snap(next));
        this.dispatchEvent({ type: 'change', target: this, value: [...this.values] });
    }

    /** Move one thumb, kept on its side of the other (minGap apart). */
    setThumb(index, value) {
        const gap = Number(this.options.minGap) || 0;
        const next = index === 0 ? Math.min(value, this.values[1] - gap) : Math.max(value, this.values[0] + gap);
        this.values[index] = this.snap(next);
        this.paint();
        this.dispatchEvent({ type: 'input', target: this, value: [...this.values] });
    }

    setValue([lo, hi]) {
        this.values = [this.snap(Math.min(lo, hi)), this.snap(Math.max(lo, hi))];
        this.paint();
    }
}
