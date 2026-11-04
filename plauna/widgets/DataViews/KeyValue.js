// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * KeyValue - labelled values (a description list): side by side, stacked or
 * in a grid of columns, with optional dividers, stripes, monospace values,
 * status badges and copy buttons.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, tone, variantStyles, bindInteraction, TRANSITION } from '../shared/appearance.js';

let _keyValueSequence = 0;

function _newKeyValueId() {
    return `key-value-${Date.now()}-${++_keyValueSequence}`;
}

const BUILD = [
    { label: 'Version', value: 'v0.8.0-dev' },
    { label: 'Commit', value: '5a4f69a', mono: true, copyable: true },
    { label: 'Status', value: 'Passing', badge: 'success' },
    { label: 'Renderer', value: 'WebGPU · auto' },
    { label: 'Device', value: 'Integrated GPU, 8 GB shared' },
    { label: 'Built', value: '2026-10-16 22:14 UTC' }
];

export class KeyValue extends UINode {
    static id = 'key-value';
    static name = 'Key Value';
    static category = 'dataviews';
    static icon = '🗂️';
    static description = 'Labelled values in rows, stacks or columns';
    static tags = ['dataviews', 'key value', 'description list', 'properties', 'details', 'metadata'];
    static emits = ['copy'];
    static dependencies = [];
    static optionValues = { layout: ['horizontal', 'vertical', 'grid'], variant: ['divided', 'striped', 'card', 'plain'], size: ['sm', 'md'] };

    static getDefaultOptions() {
        return { items: BUILD, layout: 'horizontal', variant: 'divided', size: 'md', columns: 2, labelWidth: 120, title: '' };
    }

    static stories() {
        return {
            'Build details': { items: BUILD, title: 'Build', variant: 'card' },
            'Striped': { items: BUILD.slice(0, 4), variant: 'striped' },
            'Grid of columns': { items: BUILD, layout: 'grid', columns: 3, variant: 'card' },
            'Stacked, small': { items: BUILD.slice(0, 3), layout: 'vertical', size: 'sm', variant: 'plain' }
        };
    }

    static create(container, options = {}) {
        const instance = new KeyValue(_newKeyValueId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newKeyValueId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...KeyValue.getDefaultOptions(), ...options };
        this._timers = new Set();
        this.build();
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { layout, variant, size, columns, labelWidth, title } = this.options;
        const items = Array.isArray(this.options.items) ? this.options.items : [];
        const small = size === 'sm';
        const card = variant === 'card';
        this.setStyles({
            display: 'flex', flexDirection: 'column', width: '100%', maxWidth: layout === 'grid' ? '640px' : '460px', boxSizing: 'border-box',
            borderRadius: card ? '14px' : '0', border: card ? '1px solid var(--border-light, #2a2a3a)' : 'none',
            backgroundColor: card ? 'var(--surface-card, #0f0f17)' : 'transparent', overflow: 'hidden'
        });
        if (title) {
            this.appendChild(el(this, 'title', 'div', {
                text: title,
                style: { padding: card ? '12px 16px' : '0 0 8px', fontSize: '14px', fontWeight: '650', color: 'var(--text-primary, #e4e4e7)', borderBottom: card ? '1px solid var(--border-light, #2a2a3a)' : 'none' }
            }));
        }
        const grid = layout === 'grid';
        const list = el(this, 'list', 'dl', {
            style: grid
                ? { display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, Number(columns) || 2)}, minmax(0, 1fr))`, margin: '0', padding: card ? '4px 0' : '0' }
                : { display: 'flex', flexDirection: 'column', margin: '0', padding: card ? '4px 0' : '0' }
        });
        items.forEach((item, index) => {
            const stripe = variant === 'striped' && index % 2 === 0;
            const divided = (variant === 'divided' || card) && index > 0 && !grid;
            const value = el(this, `value-${index}`, 'dd', {
                style: {
                    display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0', margin: '0', flex: layout === 'horizontal' ? '1' : 'none',
                    fontSize: small ? '13px' : '14px', fontWeight: '550', color: 'var(--text-primary, #e4e4e7)',
                    fontFamily: item.mono ? 'var(--font-mono, ui-monospace, monospace)' : 'inherit'
                }
            });
            if (item.badge) {
                const c = tone(item.badge);
                value.appendChild(el(this, `badge-${index}`, 'span', {
                    style: { display: 'inline-flex', alignItems: 'center', gap: '6px', height: '22px', padding: '0 9px', borderRadius: '9999px', fontSize: '12px', fontWeight: '650', backgroundColor: c.soft, color: c.text },
                    children: [el(this, `badge-dot-${index}`, 'span', { style: { width: '6px', height: '6px', borderRadius: '50%', backgroundColor: c.base } }), el(this, `badge-text-${index}`, 'span', { text: item.value })]
                }));
            } else {
                value.appendChild(el(this, `text-${index}`, 'span', { text: item.value, style: { overflowWrap: 'anywhere' } }));
            }
            if (item.copyable) {
                const copy = el(this, `copy-${index}`, 'button', {
                    label: `Copy ${item.label}`, attrs: { type: 'button' },
                    style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', padding: '0', borderRadius: '6px', border: '1px solid transparent', cursor: 'pointer', transition: TRANSITION },
                    children: [icon(this, `copy-icon-${index}`, ICONS.copy, 13)]
                });
                bindInteraction(copy, (state) => copy.setStyles(variantStyles('ghost', 'neutral', state)));
                copy.addEventListener('click', () => this.copy(item, copy, index));
                value.appendChild(copy);
            }
            const row = el(this, `row-${index}`, 'div', {
                style: {
                    display: 'flex', flexDirection: layout === 'horizontal' ? 'row' : 'column', alignItems: layout === 'horizontal' ? 'center' : 'flex-start',
                    gap: layout === 'horizontal' ? '16px' : '4px', padding: grid ? (small ? '8px 12px' : '10px 16px') : `${small ? 7 : 10}px ${card || stripe || variant === 'striped' ? 16 : 0}px`,
                    borderTop: divided ? '1px solid var(--border-light, #2a2a3a)' : 'none',
                    backgroundColor: stripe ? 'var(--bg-tertiary, #171723)' : 'transparent', borderRadius: variant === 'striped' ? '8px' : '0', minWidth: '0'
                },
                children: [
                    el(this, `label-${index}`, 'dt', {
                        text: item.label,
                        style: { flex: layout === 'horizontal' ? `0 0 ${labelWidth}px` : 'none', fontSize: small ? '12px' : '13px', color: 'var(--text-tertiary, #9ca3af)', fontWeight: '500' }
                    }),
                    value
                ]
            });
            list.appendChild(row);
        });
        this.appendChild(list);
    }

    async copy(item, button, index) {
        try {
            await navigator.clipboard?.writeText?.(String(item.value));
        } catch {
            // Clipboard refused: the value stays selectable
        }
        const glyph = button.children[0];
        glyph?.destroy();
        button.insertBefore(icon(this, `copied-${index}`, ICONS.check, 13, { style: { color: 'var(--color-success, #10b981)' } }), button.children[0] || null);
        const timer = setTimeout(() => {
            this._timers.delete(timer);
            button.children[0]?.destroy();
            button.insertBefore(icon(this, `copy-icon-${index}`, ICONS.copy, 13), button.children[0] || null);
        }, 1400);
        this._timers.add(timer);
        this.dispatchEvent({ type: 'copy', target: this, label: item.label, value: item.value });
    }

    destroy() {
        for (const timer of this._timers) clearTimeout(timer);
        this._timers.clear();
        super.destroy();
    }
}
