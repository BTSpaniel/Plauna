// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * RollingNumber - a number whose digits roll to their new value like an
 * odometer. Each digit is a column of 0-9 shifted by a transform, so the
 * motion is a pure paint-time transition in every render mode.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, tone, TONES } from '../shared/appearance.js';

let _rollingSequence = 0;

function _newRollingId() {
    return `rolling-number-${Date.now()}-${++_rollingSequence}`;
}

/** The value as text: grouping commas, fixed decimals, prefix and suffix. */
export function formatRolling(value, { decimals = 0, prefix = '', suffix = '', group = true } = {}) {
    const n = Number(value) || 0;
    const fixed = Math.abs(n).toFixed(Math.max(0, decimals));
    const [whole, fraction] = fixed.split('.');
    const grouped = group ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole;
    return `${n < 0 ? '−' : ''}${prefix}${grouped}${fraction ? `.${fraction}` : ''}${suffix}`;
}

export class RollingNumber extends UINode {
    static id = 'rolling-number';
    static name = 'Rolling Number';
    static category = 'primitive';
    static icon = '🎰';
    static description = 'Number whose digits roll to new values';
    static tags = ['primitive', 'number', 'counter', 'odometer', 'animated', 'ticker'];
    static emits = ['change'];
    static dependencies = [];
    static optionValues = { tone: ['default', ...TONES], size: ['sm', 'md', 'lg', 'xl'], group: 'boolean', autoplay: 'boolean' };

    static getDefaultOptions() {
        return { value: 12480, decimals: 0, prefix: '', suffix: '', tone: 'default', size: 'lg', group: true, duration: 700, autoplay: false };
    }

    static stories() {
        return {
            'Counter': { value: 12480, size: 'xl', autoplay: true },
            'Money': { value: 48219.5, decimals: 2, prefix: '$', tone: 'success', size: 'lg', autoplay: true },
            'Percent': { value: 99.98, decimals: 2, suffix: '%', tone: 'info', size: 'md' },
            'Small accent': { value: 42, tone: 'accent', size: 'sm', autoplay: true }
        };
    }

    static create(container, options = {}) {
        const instance = new RollingNumber(_newRollingId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newRollingId(), options = {}) {
        super(id, 'span');
        this.tag = 'span';
        this.options = { ...RollingNumber.getDefaultOptions(), ...options };
        this.value = Number(this.options.value) || 0;
        this._timer = null;
        this.build();
        if (this.options.autoplay && typeof setInterval === 'function') {
            // A small live tick (three up, one down), so the roll is visible in the showcase
            let tick = 0;
            this._timer = setInterval(() => {
                const step = Math.max(1, Math.round(Math.abs(this.value) * 0.0007));
                this.setValue(this.value + (++tick % 4 === 0 ? -step : step));
            }, 2400);
        }
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { size } = this.options;
        const fontSize = { sm: 18, md: 26, lg: 36, xl: 52 }[size] || 36;
        const lineHeight = Math.round(fontSize * 1.15);
        const color = this.options.tone === 'default' ? 'var(--text-primary, #e4e4e7)' : tone(this.options.tone).text;
        const text = formatRolling(this.value, this.options);
        this.ariaLabel = text;
        this.role = 'img';
        this.setStyles({
            display: 'inline-flex', alignItems: 'flex-start', fontSize: `${fontSize}px`, lineHeight: `${lineHeight}px`,
            height: `${lineHeight}px`, fontWeight: '750', letterSpacing: '-0.02em', color, overflow: 'hidden'
        });
        this.columns = [];
        [...text].forEach((char, index) => {
            if (!/\d/.test(char)) {
                this.appendChild(el(this, `glyph-${index}`, 'span', { text: char, attrs: { 'aria-hidden': 'true' } }));
                this.columns.push(null);
                return;
            }
            const strip = el(this, `strip-${index}`, 'span', {
                attrs: { 'aria-hidden': 'true' },
                style: {
                    display: 'flex', flexDirection: 'column', transform: `translateY(-${Number(char) * lineHeight}px)`,
                    transition: `transform ${this.options.duration}ms var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1))`
                },
                children: Array.from({ length: 10 }, (_, d) => el(this, `d-${index}-${d}`, 'span', {
                    text: String(d), style: { display: 'block', height: `${lineHeight}px`, textAlign: 'center' }
                }))
            });
            this.appendChild(el(this, `digit-${index}`, 'span', {
                attrs: { 'aria-hidden': 'true' },
                style: { display: 'inline-block', height: `${lineHeight}px`, overflow: 'hidden' },
                children: [strip]
            }));
            this.columns.push({ strip, lineHeight });
        });
    }

    setValue(value) {
        const next = Number(value) || 0;
        const before = formatRolling(this.value, this.options);
        const after = formatRolling(next, this.options);
        this.value = next;
        if (before.length !== after.length || [...before].some((c, i) => /\d/.test(c) !== /\d/.test(after[i]))) {
            this.build();
            this.dispatchEvent({ type: 'change', target: this, value: next });
            return;
        }
        [...after].forEach((char, index) => {
            const column = this.columns[index];
            if (column) column.strip.setStyles({ transform: `translateY(-${Number(char) * column.lineHeight}px)` });
        });
        this.ariaLabel = after;
        this.dispatchEvent({ type: 'change', target: this, value: next });
    }

    destroy() {
        clearInterval(this._timer);
        this._timer = null;
        super.destroy();
    }
}
