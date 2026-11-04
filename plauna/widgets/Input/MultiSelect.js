// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * MultiSelect - choose several options: chosen values show as removable
 * chips in the field, a filterable list with checkmarks opens below.
 * Keyboard: arrows move, Enter toggles, Backspace removes the last chip,
 * Escape closes.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, tone, TONES, TRANSITION } from '../shared/appearance.js';

let _multiSelectSequence = 0;

function _newMultiSelectId() {
    return `multi-select-${Date.now()}-${++_multiSelectSequence}`;
}

const LAYERS = ['Terrain', 'Water', 'Foliage', 'Buildings', 'Roads', 'Lights', 'Particles', 'Volumetrics', 'Decals'];

function normalize(options) {
    return (Array.isArray(options) ? options : []).map((o) => (typeof o === 'object' && o ? { value: String(o.value ?? o.label), label: String(o.label ?? o.value) } : { value: String(o), label: String(o) }));
}

export class MultiSelect extends UINode {
    static id = 'multi-select';
    static name = 'Multi Select';
    static category = 'input';
    static icon = '🏷️';
    static description = 'Choose several options as removable chips';
    static tags = ['input', 'multi select', 'tags', 'chips', 'pills', 'select'];
    static emits = ['change'];
    static dependencies = [];
    static optionValues = { tone: TONES, variant: ['outline', 'filled'], open: 'boolean', disabled: 'boolean' };

    static getDefaultOptions() {
        return { label: 'Visible layers', placeholder: 'Add a layer…', options: LAYERS, value: ['Terrain', 'Water', 'Lights'], maxChips: 4, tone: 'primary', variant: 'outline', open: false, disabled: false };
    }

    static stories() {
        return {
            'Chosen': { value: ['Terrain', 'Water', 'Lights'] },
            'Open list': { value: ['Foliage'], open: true, tone: 'accent' },
            'Overflow': { value: ['Terrain', 'Water', 'Foliage', 'Buildings', 'Roads', 'Lights'], maxChips: 3, variant: 'filled' },
            'Empty': { value: [] }
        };
    }

    static create(container, options = {}) {
        const instance = new MultiSelect(_newMultiSelectId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newMultiSelectId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...MultiSelect.getDefaultOptions(), ...options };
        this.items = normalize(this.options.options);
        this.selected = new Set((this.options.value || []).map(String));
        this.query = '';
        this.isOpen = Boolean(this.options.open);
        this.active = 0;
        this.focused = false;
        this._onDocumentDown = (event) => {
            if (this.isOpen && this.element && !this.element.contains(event.target)) this.setOpen(false);
        };
        if (typeof document !== 'undefined') document.addEventListener('mousedown', this._onDocumentDown, true);
        this.build();
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { label } = this.options;
        this.setStyles({ position: 'relative', display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', maxWidth: '360px', minWidth: '240px' });
        if (label) this.appendChild(el(this, 'label', 'label', { text: label, data: { for: `${this.id}-input` }, style: { fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary, #d1d5db)' } }));
        this.field = el(this, 'field', 'div', {
            style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', minHeight: '40px', boxSizing: 'border-box', padding: '5px 8px', borderRadius: '10px', cursor: 'text', transition: TRANSITION }
        });
        this.field.addEventListener('click', () => { this.input?.element?.focus(); this.setOpen(true); });
        this.appendChild(this.field);
        this.list = el(this, 'list', 'div', {
            role: 'listbox', label: label || 'Options', attrs: { 'aria-multiselectable': 'true' },
            style: { position: 'absolute', left: '0', right: '0', top: '100%', marginTop: '6px', zIndex: '100', maxHeight: '236px', overflowY: 'auto', boxSizing: 'border-box', padding: '6px', borderRadius: '12px', backgroundColor: 'var(--surface-overlay, #0f0f17)', border: '1px solid var(--border-medium, #3a3a4a)', boxShadow: 'var(--shadow-xl, 0 20px 25px -5px rgba(0,0,0,0.4))' }
        });
        this.appendChild(this.list);
        this.renderField();
        this.renderList();
    }

    renderField() {
        for (const child of [...this.field.children]) child.destroy();
        const c = tone(this.options.tone);
        const chosen = this.items.filter((item) => this.selected.has(item.value));
        const shown = chosen.slice(0, Math.max(1, this.options.maxChips));
        shown.forEach((item, index) => {
            const remove = el(this, `chip-x-${index}`, 'button', {
                label: `Remove ${item.label}`, attrs: { type: 'button', tabindex: '-1' },
                style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px', padding: '0', borderRadius: '50%', border: 'none', backgroundColor: 'transparent', color: 'inherit', cursor: 'pointer', opacity: '0.75' },
                children: [icon(this, `chip-x-icon-${index}`, ICONS.x, 11, { strokeWidth: 2.5 })]
            });
            remove.addEventListener('click', (event) => { event.stopPropagation?.(); this.toggle(item.value); });
            this.field.appendChild(el(this, `chip-${index}`, 'span', {
                style: { display: 'inline-flex', alignItems: 'center', gap: '4px', height: '26px', padding: '0 6px 0 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: '600', backgroundColor: c.soft, color: c.text, border: `1px solid ${c.subtleBorder}`, whiteSpace: 'nowrap' },
                children: [el(this, `chip-text-${index}`, 'span', { text: item.label }), remove]
            }));
        });
        if (chosen.length > shown.length) {
            this.field.appendChild(el(this, 'more', 'span', { text: `+${chosen.length - shown.length}`, style: { height: '26px', display: 'inline-flex', alignItems: 'center', padding: '0 8px', borderRadius: '9999px', fontSize: '12px', fontWeight: '700', backgroundColor: 'var(--bg-quaternary, #1f1f2e)', color: 'var(--text-secondary, #d1d5db)' } }));
        }
        this.input = el(this, 'input', 'input', {
            role: 'combobox', data: { type: 'text', value: this.query, placeholder: chosen.length ? '' : this.options.placeholder, disabled: Boolean(this.options.disabled) },
            attrs: { autocomplete: 'off', 'aria-controls': `${this.id}-list`, 'aria-autocomplete': 'list' },
            style: { flex: '1', minWidth: '48px', height: '26px', border: 'none', outline: 'none', backgroundColor: 'transparent', color: 'var(--text-primary, #e4e4e7)', fontFamily: 'inherit', fontSize: '13px' }
        });
        this.input.addEventListener('input', (event) => { this.query = event?.domTarget?.value ?? ''; this.input.userData.value = this.query; this.active = 0; this.setOpen(true); this.renderList(); });
        this.input.addEventListener('keydown', (event) => this.onKey(event));
        this.input.addEventListener('focus', () => { this.focused = true; this.paintField(); });
        this.input.addEventListener('blur', () => { this.focused = false; this.paintField(); });
        this.field.appendChild(this.input);
        this.paintField();
    }

    paintField() {
        const c = tone(this.options.tone);
        const active = this.focused || this.isOpen;
        const filled = this.options.variant === 'filled';
        this.field.setStyles({
            opacity: this.options.disabled ? '0.55' : '1',
            backgroundColor: filled ? 'var(--bg-tertiary, #171723)' : 'var(--surface-card, #0f0f17)',
            border: `1px solid ${active ? c.base : filled ? 'transparent' : 'var(--border-medium, #3a3a4a)'}`,
            boxShadow: active ? `0 0 0 3px ${c.soft}` : 'none'
        });
        this.input?.setAttribute('aria-expanded', this.isOpen ? 'true' : 'false');
    }

    matches() {
        const q = this.query.trim().toLowerCase();
        return q ? this.items.filter((item) => item.label.toLowerCase().includes(q)) : this.items;
    }

    renderList() {
        for (const child of [...this.list.children]) child.destroy();
        this.list.setStyles({ display: this.isOpen ? 'block' : 'none' });
        this.visible = this.matches();
        this.rows = [];
        if (!this.visible.length) {
            this.list.appendChild(el(this, 'empty', 'div', { text: 'Nothing matches', style: { padding: '12px', textAlign: 'center', fontSize: '13px', color: 'var(--text-tertiary, #9ca3af)' } }));
            this.input?.setAttribute('aria-activedescendant', '');
            return;
        }
        const c = tone(this.options.tone);
        this.visible.forEach((item, index) => {
            const on = this.selected.has(item.value);
            const box = el(this, `box-${index}`, 'span', {
                style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px', borderRadius: '5px', flex: '0 0 auto', backgroundColor: on ? c.base : 'transparent', border: `1px solid ${on ? c.base : 'var(--border-dark, #4a4a5a)'}`, color: c.on },
                children: on ? [icon(this, `box-icon-${index}`, ICONS.check, 11, { strokeWidth: 3 })] : []
            });
            const row = el(this, `option-${index}`, 'div', {
                role: 'option', attrs: { 'aria-selected': on ? 'true' : 'false' },
                style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 10px', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--text-primary, #e4e4e7)', backgroundColor: index === this.active ? c.soft : 'transparent' },
                children: [box, el(this, `option-text-${index}`, 'span', { text: item.label })]
            });
            row.addEventListener('mousedown', (event) => { event.preventDefault?.(); this.toggle(item.value); });
            row.addEventListener('mouseenter', () => this.setActive(index));
            this.list.appendChild(row);
            this.rows.push(row);
        });
        // The highlighted row is the active option while the list is open
        this.input?.setAttribute('aria-activedescendant', this.isOpen && this.rows[this.active] ? `${this.id}-option-${this.active}` : '');
    }

    setActive(index) {
        const soft = tone(this.options.tone).soft;
        this.rows[this.active]?.setStyles({ backgroundColor: 'transparent' });
        this.active = index;
        this.rows[index]?.setStyles({ backgroundColor: soft });
        this.input?.setAttribute('aria-activedescendant', `${this.id}-option-${index}`);
    }

    onKey(event) {
        const count = this.visible?.length ?? 0;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault?.();
            if (!this.isOpen) return this.setOpen(true);
            if (count) this.setActive((this.active + (event.key === 'ArrowDown' ? 1 : -1) + count) % count);
        } else if (event.key === 'Enter' && this.isOpen && count) {
            event.preventDefault?.();
            this.toggle(this.visible[this.active].value);
        } else if (event.key === 'Backspace' && !this.query && this.selected.size) {
            const last = [...this.items].reverse().find((item) => this.selected.has(item.value));
            if (last) this.toggle(last.value);
        } else if (event.key === 'Escape' && this.isOpen) {
            event.preventDefault?.();
            this.setOpen(false);
        }
    }

    toggle(value) {
        if (this.options.disabled) return;
        if (this.selected.has(value)) this.selected.delete(value);
        else this.selected.add(value);
        const keepFocus = this.focused;
        this.renderField();
        this.renderList();
        if (keepFocus) this.input?.focus();
        this.dispatchEvent({ type: 'change', target: this, value: this.items.filter((item) => this.selected.has(item.value)).map((item) => item.value) });
    }

    setOpen(open) {
        if (this.options.disabled) return;
        this.isOpen = Boolean(open);
        this.renderList();
        this.paintField();
    }

    get value() {
        return this.items.filter((item) => this.selected.has(item.value)).map((item) => item.value);
    }

    setValue(values) {
        this.selected = new Set((values || []).map(String));
        this.renderField();
        this.renderList();
    }

    destroy() {
        if (typeof document !== 'undefined') document.removeEventListener('mousedown', this._onDocumentDown, true);
        super.destroy();
    }
}
