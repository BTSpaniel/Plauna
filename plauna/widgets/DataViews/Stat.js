// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Stat - a key figure with its label, a change against the previous period
 * (green up, red down, or reversed for metrics where lower is better), an
 * icon and an optional sparkline.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, tone, TONES, TRANSITION } from '../shared/appearance.js';
import { Sparkline } from './Sparkline.js';

let _statSequence = 0;

function _newStatId() {
    return `stat-${Date.now()}-${++_statSequence}`;
}

export class Stat extends UINode {
    static id = 'stat';
    static name = 'Stat';
    static category = 'dataviews';
    static icon = '📊';
    static description = 'Key figure with change and trend';
    static tags = ['dataviews', 'stat', 'kpi', 'metric', 'figure', 'dashboard'];
    static dependencies = ['sparkline'];
    static optionValues = { variant: ['card', 'soft', 'plain'], tone: TONES, size: ['sm', 'md', 'lg'], lowerIsBetter: 'boolean', interactive: 'boolean' };

    static getDefaultOptions() {
        return { label: 'Active players', value: '12,480', delta: 8.2, deltaLabel: 'vs last week', icon: 'user', trend: [], variant: 'card', tone: 'primary', size: 'md', lowerIsBetter: false, interactive: true };
    }

    static stories() {
        return {
            'Players': { label: 'Active players', value: '12,480', delta: 8.2, icon: 'user', trend: [8, 9, 8.5, 10, 11, 10.4, 12, 12.5] },
            'Frame time': { label: 'Frame time', value: '6.8 ms', delta: -12.4, deltaLabel: 'since 0.7', icon: 'zap', lowerIsBetter: true, tone: 'success', trend: [9.1, 8.7, 8.9, 8.0, 7.6, 7.4, 7.0, 6.8] },
            'Errors up (bad)': { label: 'Crash reports', value: '37', delta: 23, icon: 'alert', tone: 'danger', lowerIsBetter: true, variant: 'soft', trend: [20, 22, 21, 26, 30, 29, 34, 37] },
            'Plain large': { label: 'Revenue', value: '$48.2k', delta: 3.1, variant: 'plain', size: 'lg', icon: 'trendUp', tone: 'accent' },
            'No change': { label: 'Uptime', value: '99.98%', delta: 0, deltaLabel: 'last 30 days', icon: 'checkCircle', tone: 'info', size: 'sm' }
        };
    }

    static create(container, options = {}) {
        const instance = new Stat(_newStatId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newStatId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...Stat.getDefaultOptions(), ...options };
        this.addEventListener('mouseenter', () => this._hover?.(true));
        this.addEventListener('mouseleave', () => this._hover?.(false));
        this.build();
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { label, value, delta, deltaLabel, variant, size, lowerIsBetter, interactive } = this.options;
        const c = tone(this.options.tone);
        const pad = { sm: 14, md: 18, lg: 22 }[size] || 18;
        const figure = { sm: 22, md: 28, lg: 36 }[size] || 28;
        const frame = variant === 'plain'
            ? { backgroundColor: 'transparent', border: '1px solid transparent', boxShadow: 'none', padding: '4px 0' }
            : variant === 'soft'
                ? { backgroundColor: c.soft, border: `1px solid ${c.subtleBorder}`, boxShadow: 'none', padding: `${pad}px` }
                : { backgroundColor: 'var(--surface-card, #0f0f17)', border: '1px solid var(--border-light, #2a2a3a)', boxShadow: 'var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.3))', padding: `${pad}px` };
        this.role = 'group';
        this.ariaLabel = `${label}: ${value}`;
        this.setStyles({
            position: 'relative', display: 'flex', flexDirection: 'column', gap: '10px', boxSizing: 'border-box', minWidth: '200px',
            maxWidth: '320px', borderRadius: '14px', overflow: 'hidden', transition: TRANSITION, ...frame
        });
        this._hover = interactive && variant !== 'plain'
            ? (over) => this.setStyles(over
                ? { transform: 'translateY(-2px)', boxShadow: 'var(--shadow-lg, 0 10px 15px -3px rgba(0,0,0,0.4))', borderColor: c.border }
                : { transform: 'none', boxShadow: frame.boxShadow, borderColor: variant === 'soft' ? c.subtleBorder : 'var(--border-light, #2a2a3a)' })
            : null;
        const head = el(this, 'head', 'div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } });
        if (ICONS[this.options.icon]) {
            head.appendChild(el(this, 'icon-wrap', 'span', {
                attrs: { 'aria-hidden': 'true' },
                style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '9px', backgroundColor: variant === 'soft' ? c.softHover : c.soft, color: c.base, flex: '0 0 auto' },
                children: [icon(this, 'icon', ICONS[this.options.icon], 16)]
            }));
        }
        head.appendChild(el(this, 'label', 'span', { text: label, style: { fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary, #d1d5db)' } }));
        this.appendChild(head);
        const row = el(this, 'row', 'div', { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: '12px' } });
        row.appendChild(el(this, 'value', 'div', {
            text: value,
            style: { fontSize: `${figure}px`, fontWeight: '750', letterSpacing: '-0.025em', lineHeight: '1.05', color: 'var(--text-primary, #e4e4e7)' }
        }));
        const trend = Array.isArray(this.options.trend) ? this.options.trend : [];
        if (trend.length > 1) {
            row.appendChild(new Sparkline(`${this.id}-spark`, { data: trend, width: size === 'lg' ? 120 : 92, height: size === 'lg' ? 40 : 32, tone: this.options.tone, dots: 'last', strokeWidth: 2, label }));
        }
        this.appendChild(row);
        if (delta !== null && delta !== undefined && delta !== '') {
            const n = Number(delta);
            const good = n === 0 ? null : (n > 0) !== Boolean(lowerIsBetter);
            const d = tone(good === null ? 'neutral' : good ? 'success' : 'danger');
            const chip = el(this, 'delta', 'span', {
                style: { display: 'inline-flex', alignItems: 'center', gap: '3px', height: '22px', padding: '0 7px', borderRadius: '9999px', fontSize: '12px', fontWeight: '700', backgroundColor: d.soft, color: d.text },
                children: [
                    n === 0 ? icon(this, 'delta-icon', ICONS.minus, 12, { strokeWidth: 2.5 }) : icon(this, 'delta-icon', n > 0 ? ICONS.arrowUp : ICONS.arrowDown, 12, { strokeWidth: 2.5 }),
                    el(this, 'delta-text', 'span', { text: `${Math.abs(n).toFixed(1)}%` })
                ]
            });
            this.appendChild(el(this, 'foot', 'div', {
                style: { display: 'flex', alignItems: 'center', gap: '8px' },
                children: [chip, deltaLabel ? el(this, 'delta-label', 'span', { text: deltaLabel, style: { fontSize: '12px', color: 'var(--text-tertiary, #9ca3af)' } }) : null]
            }));
        }
    }

    setValue(value, delta) {
        this.options.value = value;
        if (delta !== undefined) this.options.delta = delta;
        this.build();
    }
}
