// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * SegmentedControl - pick one of a few options from a row of segments. The
 * selection slides between segments; arrow keys, Home and End move it
 * (radio group semantics).
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, tone, sizeScale, SIZES, TONES, mix, afterRender } from '../shared/appearance.js';

let _segmentedSequence = 0;

const SLIDE = 'transform var(--duration-base, 200ms) var(--ease-out, ease), width var(--duration-base, 200ms) var(--ease-out, ease)';

function _newSegmentedId() {
    return `segmented-${Date.now()}-${++_segmentedSequence}`;
}

function normalize(items) {
    return (Array.isArray(items) ? items : []).map((item, index) => (
        typeof item === 'object' && item ? { value: String(item.value ?? item.label ?? index), label: String(item.label ?? item.value ?? ''), icon: item.icon || null }
            : { value: String(item), label: String(item), icon: null }
    ));
}

export class SegmentedControl extends UINode {
    static id = 'segmented';
    static name = 'Segmented Control';
    static category = 'input';
    static icon = '🎚️';
    static description = 'Pick one option from a row of segments';
    static tags = ['input', 'segmented', 'toggle group', 'radio', 'switcher'];
    static emits = ['change'];
    static dependencies = [];
    static optionValues = { variant: ['surface', 'solid', 'soft', 'underline'], tone: TONES, size: SIZES, shape: ['pill', 'rounded'], fullWidth: 'boolean', disabled: 'boolean' };

    static getDefaultOptions() {
        return { items: ['Day', 'Week', 'Month'], value: 'Week', variant: 'surface', tone: 'primary', size: 'md', shape: 'rounded', fullWidth: false, disabled: false };
    }

    static stories() {
        return {
            'Range': { items: ['Day', 'Week', 'Month', 'Year'], value: 'Week' },
            'View with icons': { items: [{ value: 'list', label: 'List', icon: 'alignLeft' }, { value: 'grid', label: 'Grid', icon: 'image' }, { value: 'map', label: 'Map', icon: 'home' }], value: 'grid', variant: 'solid', shape: 'pill' },
            'Soft accent': { items: ['Draft', 'Review', 'Published'], value: 'Review', variant: 'soft', tone: 'accent' },
            'Underline': { items: ['Overview', 'Activity', 'Settings'], value: 'Overview', variant: 'underline', size: 'lg' },
            'Full width small': { items: ['Low', 'Medium', 'High', 'Ultra'], value: 'High', size: 'sm', fullWidth: true }
        };
    }

    static create(container, options = {}) {
        const instance = new SegmentedControl(_newSegmentedId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newSegmentedId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...SegmentedControl.getDefaultOptions(), ...options };
        this.items = normalize(this.options.items);
        this.value = String(this.options.value ?? this.items[0]?.value ?? '');
        this.measured = false;
        this._resize = null;
        this.build();
        afterRender(this, () => {
            this.measured = true;
            this.paint();
            if (typeof ResizeObserver === 'function' && this.element) {
                this._resize = new ResizeObserver(() => this.paint());
                this._resize.observe(this.element);
            }
        });
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { variant, size, shape, fullWidth, disabled } = this.options;
        const scale = sizeScale(size);
        const underline = variant === 'underline';
        const pad = underline ? 0 : 3;
        const radius = shape === 'pill' ? '9999px' : `${scale.radius + 1}px`;
        this.role = 'radiogroup';
        this.ariaLabel = this.options.label || 'Options';
        this.setStyles({
            position: 'relative', display: fullWidth ? 'flex' : 'inline-flex', width: fullWidth ? '100%' : 'auto',
            boxSizing: 'border-box', padding: `${pad}px`, gap: underline ? `${scale.gap * 2}px` : '0',
            borderRadius: underline ? '0' : radius, opacity: disabled ? '0.55' : '1',
            backgroundColor: underline ? 'transparent' : 'var(--bg-tertiary, #171723)',
            border: underline ? 'none' : '1px solid var(--border-light, #2a2a3a)',
            borderBottom: underline ? '1px solid var(--border-light, #2a2a3a)' : '1px solid var(--border-light, #2a2a3a)'
        });
        this.indicator = el(this, 'indicator', 'span', {
            attrs: { 'aria-hidden': 'true' },
            style: {
                position: 'absolute', left: '0', top: underline ? 'auto' : `${pad}px`, bottom: underline ? '-1px' : `${pad}px`,
                width: '0', height: underline ? '2px' : 'auto', borderRadius: underline ? '2px' : radius,
                transition: 'none',
                opacity: '0'
            }
        });
        this.appendChild(this.indicator);
        this.segments = this.items.map((item, index) => {
            const children = [];
            if (item.icon && ICONS[item.icon]) children.push(icon(this, `icon-${index}`, ICONS[item.icon], scale.icon - 2));
            children.push(el(this, `label-${index}`, 'span', { text: item.label }));
            const segment = el(this, `segment-${index}`, 'button', {
                role: 'radio', attrs: { type: 'button' },
                style: {
                    position: 'relative', zIndex: '1', flex: fullWidth ? '1 1 0' : '0 0 auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    gap: `${Math.max(4, scale.gap - 2)}px`, height: `${scale.height - (underline ? 0 : 2 * pad + 2)}px`, padding: `0 ${underline ? 2 : scale.padX}px`,
                    border: 'none', borderRadius: radius, backgroundColor: 'transparent', cursor: disabled ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit', fontSize: `${scale.fontSize}px`, fontWeight: '600', whiteSpace: 'nowrap',
                    transition: 'color var(--duration-fast, 120ms) ease, background-color var(--duration-fast, 120ms) ease'
                },
                children
            });
            segment.addEventListener('click', () => { if (!this.options.disabled) this.select(item.value, true); });
            segment.addEventListener('keydown', (event) => this.onKey(event, index));
            segment.addEventListener('mouseenter', () => { segment._hover = true; this.paint(); });
            segment.addEventListener('mouseleave', () => { segment._hover = false; this.paint(); });
            this.appendChild(segment);
            return segment;
        });
        this.paint();
    }

    colors() {
        const { variant } = this.options;
        const c = tone(this.options.tone);
        if (variant === 'solid') return { indicator: c.base, selected: c.on, shadow: `0 4px 12px -4px ${c.glow}` };
        if (variant === 'soft') return { indicator: c.softHover, selected: c.text, shadow: 'none' };
        if (variant === 'underline') return { indicator: c.base, selected: 'var(--text-primary, #e4e4e7)', shadow: 'none' };
        return { indicator: 'var(--surface-raised, #171723)', selected: 'var(--text-primary, #e4e4e7)', shadow: '0 1px 3px rgba(0, 0, 0, 0.3), 0 0 0 1px var(--border-medium, #3a3a4a)' };
    }

    /** Style segments for the selection and slide the indicator under the selected one. */
    paint() {
        const colors = this.colors();
        const underline = this.options.variant === 'underline';
        const selectedIndex = this.items.findIndex((item) => item.value === this.value);
        this.segments.forEach((segment, index) => {
            const selected = index === selectedIndex;
            segment.setAttribute('aria-checked', selected ? 'true' : 'false');
            segment.tabIndex = selected || (selectedIndex < 0 && index === 0) ? 0 : -1;
            const fallback = selected && !this.measured && !underline;
            segment.setStyles({
                color: selected ? colors.selected : segment._hover ? 'var(--text-primary, #e4e4e7)' : 'var(--text-tertiary, #9ca3af)',
                backgroundColor: fallback ? colors.indicator : (!selected && segment._hover && !underline ? mix('var(--text-primary, #e4e4e7)', 5) : 'transparent'),
                boxShadow: fallback ? colors.shadow : 'none'
            });
        });
        const target = this.segments[selectedIndex]?.element;
        if (this.measured && target) {
            // The first placement is instant; only later selection changes slide
            const first = !this._placed;
            this._placed = true;
            this.indicator.setStyles({
                width: `${target.offsetWidth}px`, transform: `translateX(${target.offsetLeft}px)`, opacity: '1',
                backgroundColor: colors.indicator, boxShadow: colors.shadow,
                transition: first ? 'none' : SLIDE
            });
        } else {
            this.indicator.setStyles({ opacity: '0' });
        }
    }

    onKey(event, index) {
        if (this.options.disabled) return;
        const last = this.items.length - 1;
        const next = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: last }[event.key];
        if (next === undefined) return;
        event.preventDefault?.();
        const wrapped = (next + this.items.length) % this.items.length;
        this.select(this.items[wrapped].value, true);
        this.segments[wrapped]?.focus?.();
    }

    select(value, fromUser = false) {
        const next = String(value);
        if (next === this.value || !this.items.some((item) => item.value === next)) return;
        this.value = next;
        this.paint();
        if (fromUser) this.dispatchEvent({ type: 'change', target: this, value: next });
    }

    setValue(value) {
        this.select(value);
    }

    setItems(items) {
        this.options.items = items;
        this.items = normalize(items);
        if (!this.items.some((item) => item.value === this.value)) this.value = this.items[0]?.value ?? '';
        this.build();
    }

    destroy() {
        this._appearanceDestroyed = true;
        this._resize?.disconnect();
        this._resize = null;
        super.destroy();
    }
}
