// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Combobox - a text field that filters a list of options as you type, with
 * groups, descriptions, highlighted matches and full keyboard support
 * (arrows, Enter, Escape, Home, End).
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, tone, sizeScale, SIZES, TONES, variantStyles, bindInteraction, TRANSITION } from '../shared/appearance.js';

let _comboboxSequence = 0;

function _newComboboxId() {
    return `combobox-${Date.now()}-${++_comboboxSequence}`;
}

function normalize(options) {
    return (Array.isArray(options) ? options : []).map((option, index) => (
        typeof option === 'object' && option
            ? { value: String(option.value ?? option.label ?? index), label: String(option.label ?? option.value ?? ''), description: option.description || '', group: option.group || '' }
            : { value: String(option), label: String(option), description: '', group: '' }
    ));
}

const MATERIALS = [
    { value: 'pbr-metal', label: 'Brushed metal', description: 'Anisotropic, roughness 0.35', group: 'Metals' },
    { value: 'pbr-gold', label: 'Polished gold', description: 'Metalness 1, roughness 0.08', group: 'Metals' },
    { value: 'pbr-copper', label: 'Oxidised copper', description: 'Patina mask, roughness 0.6', group: 'Metals' },
    { value: 'glass', label: 'Clear glass', description: 'Transmission 1, IOR 1.5', group: 'Dielectrics' },
    { value: 'water', label: 'Water', description: 'IOR 1.33, absorption tint', group: 'Dielectrics' },
    { value: 'marble', label: 'Carrara marble', description: 'Subsurface, veined albedo', group: 'Stone' },
    { value: 'granite', label: 'Granite', description: 'Speckled, roughness 0.7', group: 'Stone' }
];

export class Combobox extends UINode {
    static id = 'combobox';
    static name = 'Combobox';
    static category = 'input';
    static icon = '🔎';
    static description = 'Searchable select with filtering and keyboard support';
    static tags = ['input', 'combobox', 'autocomplete', 'typeahead', 'select', 'search'];
    static emits = ['change'];
    static dependencies = [];
    static optionValues = { size: SIZES, tone: TONES, variant: ['outline', 'filled'], open: 'boolean', clearable: 'boolean', disabled: 'boolean' };

    static getDefaultOptions() {
        return { label: 'Material', placeholder: 'Search materials…', options: MATERIALS, value: '', query: '', size: 'md', tone: 'primary', variant: 'outline', open: false, clearable: true, disabled: false };
    }

    static stories() {
        return {
            'Open, filtered': { options: MATERIALS, query: 'gl', open: true },
            'Grouped list': { options: MATERIALS, open: true, value: 'pbr-gold' },
            'Selected': { options: MATERIALS, value: 'marble' },
            'Plain strings': { label: 'Country', placeholder: 'Type a country', options: ['Canada', 'Chile', 'China', 'Colombia', 'Croatia', 'Cuba', 'Cyprus'], query: 'c', open: true, variant: 'filled', tone: 'accent' },
            'No matches': { options: MATERIALS, query: 'plutonium', open: true }
        };
    }

    static create(container, options = {}) {
        const instance = new Combobox(_newComboboxId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newComboboxId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...Combobox.getDefaultOptions(), ...options };
        this.items = normalize(this.options.options);
        this.value = String(this.options.value ?? '');
        const selected = this.items.find((item) => item.value === this.value);
        this.query = String(this.options.query || (selected ? selected.label : ''));
        this.filtering = Boolean(this.options.query);
        this.isOpen = Boolean(this.options.open);
        this.activeIndex = -1;
        this.focused = false;
        this._onDocumentDown = (event) => {
            if (this.isOpen && this.element && !this.element.contains(event.target)) this.close();
        };
        if (typeof document !== 'undefined') document.addEventListener('mousedown', this._onDocumentDown, true);
        this.build();
    }

    matches() {
        const q = this.filtering ? this.query.trim().toLowerCase() : '';
        return q ? this.items.filter((item) => item.label.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)) : this.items;
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { label, placeholder, size, disabled } = this.options;
        const scale = sizeScale(size);
        this.setStyles({ position: 'relative', display: 'flex', flexDirection: 'column', gap: '6px', width: '100%', maxWidth: '340px', minWidth: '220px' });
        if (label) {
            this.appendChild(el(this, 'label', 'label', { text: label, data: { for: `${this.id}-input` }, style: { fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary, #d1d5db)' } }));
        }
        this.field = el(this, 'field', 'div', {
            style: { display: 'flex', alignItems: 'center', gap: '8px', height: `${scale.height + 4}px`, boxSizing: 'border-box', padding: `0 6px 0 ${scale.padX - 2}px`, borderRadius: `${scale.radius + 1}px`, transition: TRANSITION }
        });
        this.field.appendChild(icon(this, 'search', ICONS.search, scale.icon, { style: { color: 'var(--text-tertiary, #9ca3af)' } }));
        this.input = el(this, 'input', 'input', {
            role: 'combobox', label: this.options.ariaLabel,
            data: { value: this.query, placeholder, disabled: Boolean(disabled), type: 'text' },
            attrs: { autocomplete: 'off', 'aria-autocomplete': 'list', 'aria-controls': `${this.id}-list` },
            style: { flex: '1', minWidth: '0', height: '100%', border: 'none', outline: 'none', backgroundColor: 'transparent', color: 'var(--text-primary, #e4e4e7)', fontFamily: 'inherit', fontSize: `${scale.fontSize}px` }
        });
        this.input.addEventListener('input', (event) => this.onInput(event));
        this.input.addEventListener('keydown', (event) => this.onKey(event));
        this.input.addEventListener('focus', () => { this.focused = true; this.paintField(); });
        this.input.addEventListener('blur', () => { this.focused = false; this.paintField(); });
        this.input.addEventListener('click', () => this.open());
        this.field.appendChild(this.input);
        if (this.options.clearable) {
            this.clearButton = el(this, 'clear', 'button', {
                label: 'Clear', attrs: { type: 'button' },
                style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', padding: '0', borderRadius: '6px', border: '1px solid transparent', cursor: 'pointer', transition: TRANSITION },
                children: [icon(this, 'clear-icon', ICONS.x, 13)]
            });
            bindInteraction(this.clearButton, (state) => this.clearButton.setStyles(variantStyles('ghost', 'neutral', state)));
            this.clearButton.addEventListener('click', () => this.clear());
            this.field.appendChild(this.clearButton);
        }
        const chevron = el(this, 'chevron', 'button', {
            label: 'Show options', attrs: { type: 'button', tabindex: '-1' },
            style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '26px', height: '26px', padding: '0', borderRadius: '6px', border: '1px solid transparent', cursor: 'pointer', transition: TRANSITION },
            children: [icon(this, 'chevron-icon', ICONS.chevronDown, 15)]
        });
        bindInteraction(chevron, (state) => chevron.setStyles(variantStyles('ghost', 'neutral', state)));
        chevron.addEventListener('click', () => (this.isOpen ? this.close() : this.open()));
        this.chevron = chevron;
        this.field.appendChild(chevron);
        this.appendChild(this.field);
        this.list = el(this, 'list', 'div', {
            role: 'listbox', label: label || 'Options',
            style: {
                position: 'absolute', left: '0', right: '0', top: '100%', marginTop: '6px', zIndex: '100', maxHeight: '252px', overflowY: 'auto',
                boxSizing: 'border-box', padding: '6px', borderRadius: '12px', backgroundColor: 'var(--surface-overlay, #0f0f17)',
                border: '1px solid var(--border-medium, #3a3a4a)', boxShadow: 'var(--shadow-xl, 0 20px 25px -5px rgba(0,0,0,0.4))'
            }
        });
        this.appendChild(this.list);
        this.renderList();
        this.paintField();
    }

    paintField() {
        const { variant, disabled } = this.options;
        const c = tone(this.options.tone);
        const active = this.focused || this.isOpen;
        this.field.setStyles({
            opacity: disabled ? '0.55' : '1',
            backgroundColor: variant === 'filled' ? 'var(--bg-tertiary, #171723)' : 'var(--surface-card, #0f0f17)',
            border: `1px solid ${active ? c.base : variant === 'filled' ? 'transparent' : 'var(--border-medium, #3a3a4a)'}`,
            boxShadow: active ? `0 0 0 3px ${c.soft}` : 'none'
        });
        this.chevron.setStyles({ transform: this.isOpen ? 'rotate(180deg)' : 'none' });
        this.clearButton?.setStyles({ visibility: this.query ? 'visible' : 'hidden' });
        this.input.setAttribute('aria-expanded', this.isOpen ? 'true' : 'false');
    }

    renderList() {
        for (const child of [...this.list.children]) child.destroy();
        this.optionNodes = [];
        const matches = this.matches();
        this.visible = matches;
        if (this.activeIndex >= matches.length) this.activeIndex = matches.length - 1;
        this.list.setStyles({ display: this.isOpen ? 'block' : 'none' });
        if (!matches.length) {
            this.list.appendChild(el(this, 'empty', 'div', {
                text: `No matches for “${this.query.trim()}”`,
                style: { padding: '14px 10px', fontSize: '13px', color: 'var(--text-tertiary, #9ca3af)', textAlign: 'center' }
            }));
            this.input.setAttribute('aria-activedescendant', '');
            return;
        }
        const c = tone(this.options.tone);
        let group = null;
        const q = this.filtering ? this.query.trim().toLowerCase() : '';
        matches.forEach((item, index) => {
            if (item.group && item.group !== group) {
                group = item.group;
                this.list.appendChild(el(this, `group-${index}`, 'div', {
                    text: group, attrs: { 'aria-hidden': 'true' },
                    style: { padding: '8px 10px 4px', fontSize: '11px', fontWeight: '700', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary, #9ca3af)' }
                }));
            }
            const selected = item.value === this.value;
            const active = index === this.activeIndex;
            const title = el(this, `title-${index}`, 'div', { style: { fontSize: '13px', fontWeight: selected ? '650' : '500', color: 'var(--text-primary, #e4e4e7)' } });
            const at = q ? item.label.toLowerCase().indexOf(q) : -1;
            if (at >= 0) {
                if (at > 0) title.appendChild(el(this, `pre-${index}`, 'span', { text: item.label.slice(0, at) }));
                title.appendChild(el(this, `hit-${index}`, 'span', { text: item.label.slice(at, at + q.length), style: { color: c.text, backgroundColor: c.soft, borderRadius: '3px' } }));
                if (at + q.length < item.label.length) title.appendChild(el(this, `post-${index}`, 'span', { text: item.label.slice(at + q.length) }));
            } else {
                title.textContent = item.label;
            }
            const text = el(this, `text-${index}`, 'div', { style: { flex: '1', minWidth: '0' }, children: [title] });
            if (item.description) text.appendChild(el(this, `desc-${index}`, 'div', { text: item.description, style: { fontSize: '12px', color: 'var(--text-tertiary, #9ca3af)', marginTop: '1px' } }));
            const option = el(this, `option-${index}`, 'div', {
                role: 'option',
                style: {
                    display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 10px', borderRadius: '8px', cursor: 'pointer',
                    backgroundColor: active ? c.soft : 'transparent', transition: 'background-color 80ms ease'
                },
                children: [text]
            });
            option.setAttribute('aria-selected', selected ? 'true' : 'false');
            if (selected) option.appendChild(icon(this, `check-${index}`, ICONS.check, 15, { style: { color: c.base } }));
            this.optionNodes[index] = option;
            option.addEventListener('mouseenter', () => this.setActive(index));
            option.addEventListener('mousedown', (event) => { event.preventDefault?.(); this.choose(item); });
            this.list.appendChild(option);
        });
        // A closed list has no active option
        this.input.setAttribute('aria-activedescendant', this.isOpen && this.activeIndex >= 0 ? `${this.id}-option-${this.activeIndex}` : '');
    }

    setActive(index) {
        if (index === this.activeIndex) return;
        const soft = tone(this.options.tone).soft;
        this.optionNodes?.[this.activeIndex]?.setStyles({ backgroundColor: 'transparent' });
        this.activeIndex = index;
        const option = this.optionNodes?.[index];
        option?.setStyles({ backgroundColor: soft });
        option?.element?.scrollIntoView?.({ block: 'nearest' });
        this.input.setAttribute('aria-activedescendant', index >= 0 ? `${this.id}-option-${index}` : '');
    }

    onInput(event) {
        this.query = event?.domTarget?.value ?? event?.target?.value ?? '';
        this.input.userData.value = this.query;
        this.filtering = true;
        this.activeIndex = this.query ? 0 : -1;
        this.isOpen = true;
        this.renderList();
        this.paintField();
    }

    onKey(event) {
        const count = this.visible?.length ?? 0;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault?.();
            if (!this.isOpen) { this.open(); return; }
            if (!count) return;
            const step = event.key === 'ArrowDown' ? 1 : -1;
            this.setActive(((this.activeIndex < 0 ? (step > 0 ? -1 : 0) : this.activeIndex) + step + count) % count);
        } else if (event.key === 'Home' && this.isOpen && count) {
            event.preventDefault?.();
            this.setActive(0);
        } else if (event.key === 'End' && this.isOpen && count) {
            event.preventDefault?.();
            this.setActive(count - 1);
        } else if (event.key === 'Enter' && this.isOpen && this.activeIndex >= 0) {
            event.preventDefault?.();
            this.choose(this.visible[this.activeIndex]);
        } else if (event.key === 'Escape' && this.isOpen) {
            event.preventDefault?.();
            this.close();
        } else if (event.key === 'Tab') {
            this.close();
        }
    }

    choose(item) {
        if (!item) return;
        this.value = item.value;
        this.query = item.label;
        this.filtering = false;
        this.input.userData.value = this.query;
        if (this.input.element) this.input.element.value = this.query;
        this.close();
        this.dispatchEvent({ type: 'change', target: this, value: item.value, item });
    }

    open() {
        if (this.options.disabled) return;
        this.isOpen = true;
        const selected = this.matches().findIndex((item) => item.value === this.value);
        this.activeIndex = selected;
        this.renderList();
        this.paintField();
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.renderList();
        this.paintField();
    }

    clear() {
        this.query = '';
        this.value = '';
        this.filtering = false;
        this.input.userData.value = '';
        if (this.input.element) { this.input.element.value = ''; this.input.element.focus(); }
        this.renderList();
        this.paintField();
        this.dispatchEvent({ type: 'change', target: this, value: '', item: null });
    }

    setValue(value) {
        const item = this.items.find((option) => option.value === String(value));
        if (item) this.choose(item);
    }

    setOptions(options) {
        this.options.options = options;
        this.items = normalize(options);
        this.renderList();
    }

    destroy() {
        if (typeof document !== 'undefined') document.removeEventListener('mousedown', this._onDocumentDown, true);
        super.destroy();
    }
}
