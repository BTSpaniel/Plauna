// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * DatePicker - a field that opens a Calendar to pick a date or a range.
 * The field shows the chosen date in words ("Fri, Oct 16, 2026"); Escape or
 * a click outside closes the calendar.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, tone, TONES, TRANSITION } from '../shared/appearance.js';
import { Calendar } from '../DataViews/Calendar.js';

let _datePickerSequence = 0;

function _newDatePickerId() {
    return `date-picker-${Date.now()}-${++_datePickerSequence}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** 'YYYY-MM-DD' → 'Fri, Oct 16, 2026' (or 'Oct 16' when short). */
export function formatDay(iso, short = false) {
    const match = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return '';
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return short ? `${MONTHS[date.getMonth()]} ${date.getDate()}` : `${DAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

export class DatePicker extends UINode {
    static id = 'date-picker';
    static name = 'Date Picker';
    static category = 'input';
    static icon = '🗓️';
    static description = 'Field that opens a calendar to pick a date or range';
    static tags = ['input', 'date', 'picker', 'calendar', 'range', 'datepicker'];
    static emits = ['change'];
    static dependencies = ['calendar'];
    static optionValues = { mode: ['single', 'range'], tone: TONES, variant: ['outline', 'filled'], open: 'boolean', clearable: 'boolean', disabled: 'boolean' };

    static getDefaultOptions() {
        return { label: 'Release date', placeholder: 'Pick a date', value: '2026-10-16', rangeEnd: '', mode: 'single', tone: 'primary', variant: 'outline', open: false, clearable: true, disabled: false };
    }

    static stories() {
        return {
            'Closed': { value: '2026-10-16' },
            'Open': { value: '2026-10-16', open: true },
            'Range': { label: 'Sprint', mode: 'range', value: '2026-10-12', rangeEnd: '2026-10-23', tone: 'accent' },
            'Empty, filled': { value: '', variant: 'filled' }
        };
    }

    static create(container, options = {}) {
        const instance = new DatePicker(_newDatePickerId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newDatePickerId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...DatePicker.getDefaultOptions(), ...options };
        this.value = String(this.options.value || '');
        this.rangeEnd = String(this.options.rangeEnd || '');
        this.isOpen = Boolean(this.options.open);
        this._onDocumentDown = (event) => {
            if (this.isOpen && this.element && !this.element.contains(event.target)) this.setOpen(false);
        };
        this._onKey = (event) => {
            if (this.isOpen && event.key === 'Escape') { this.setOpen(false); this.field?.focus?.(); }
        };
        if (typeof document !== 'undefined') {
            document.addEventListener('mousedown', this._onDocumentDown, true);
            document.addEventListener('keydown', this._onKey);
        }
        this.build();
    }

    text() {
        if (this.options.mode === 'range') {
            if (!this.value) return '';
            return this.rangeEnd ? `${formatDay(this.value, true)} – ${formatDay(this.rangeEnd, true)}, ${this.rangeEnd.slice(0, 4)}` : `${formatDay(this.value, true)} – …`;
        }
        return formatDay(this.value);
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { label, placeholder } = this.options;
        this.setStyles({ position: 'relative', display: 'inline-flex', flexDirection: 'column', gap: '6px', width: '280px', maxWidth: '100%' });
        if (label) this.appendChild(el(this, 'label', 'span', { text: label, style: { fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary, #d1d5db)' } }));
        this.valueText = el(this, 'value', 'span', { style: { flex: '1', minWidth: '0', textAlign: 'left', overflow: 'hidden', whiteSpace: 'nowrap' } });
        this.clear = el(this, 'clear', 'span', {
            role: 'button', label: 'Clear date', tabIndex: -1,
            style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '22px', height: '22px', borderRadius: '6px', color: 'var(--text-tertiary, #9ca3af)', cursor: 'pointer' },
            children: [icon(this, 'clear-icon', ICONS.x, 13)]
        });
        this.clear.addEventListener('click', (event) => { event.stopPropagation?.(); this.setValue('', ''); this.emit(); });
        this.field = el(this, 'field', 'button', {
            attrs: { type: 'button', 'aria-haspopup': 'dialog', 'aria-controls': `${this.id}-panel` },
            style: { display: 'flex', alignItems: 'center', gap: '10px', height: '40px', boxSizing: 'border-box', padding: '0 8px 0 12px', borderRadius: '10px', fontFamily: 'inherit', fontSize: '14px', cursor: 'pointer', transition: TRANSITION },
            children: [icon(this, 'calendar-icon', ICONS.calendar, 17, { style: { color: 'var(--text-tertiary, #9ca3af)' } }), this.valueText, this.clear]
        });
        this.field.addEventListener('click', () => this.setOpen(!this.isOpen));
        this.field.addEventListener('mouseenter', () => { this.hover = true; this.paint(); });
        this.field.addEventListener('mouseleave', () => { this.hover = false; this.paint(); });
        this.appendChild(this.field);
        this.calendar = new Calendar(`${this.id}-calendar`, {
            value: this.value, rangeEnd: this.rangeEnd, mode: this.options.mode, tone: this.options.tone,
            month: (this.value || '2026-10-16').slice(0, 7), events: []
        });
        this.calendar.addEventListener('change', (event) => {
            this.value = event.value || '';
            this.rangeEnd = event.rangeEnd || '';
            this.paint();
            this.emit();
            if (this.options.mode !== 'range' || this.rangeEnd) this.setOpen(false);
        });
        this.panel = el(this, 'panel', 'div', {
            role: 'dialog', label: label || 'Choose a date',
            style: { position: 'absolute', left: '0', top: '100%', marginTop: '6px', zIndex: '100' },
            children: [this.calendar]
        });
        this.appendChild(this.panel);
        this.placeholder = placeholder;
        this.paint();
    }

    paint() {
        const c = tone(this.options.tone);
        const filled = this.options.variant === 'filled';
        const text = this.text();
        this.valueText.setTextContent(text || this.placeholder);
        this.valueText.setStyles({ color: text ? 'var(--text-primary, #e4e4e7)' : 'var(--text-tertiary, #9ca3af)' });
        this.clear.setStyles({ visibility: text && this.options.clearable ? 'visible' : 'hidden' });
        this.field.setStyles({
            opacity: this.options.disabled ? '0.55' : '1',
            backgroundColor: filled ? 'var(--bg-tertiary, #171723)' : 'var(--surface-card, #0f0f17)',
            border: `1px solid ${this.isOpen ? c.base : this.hover ? 'var(--border-dark, #4a4a5a)' : filled ? 'transparent' : 'var(--border-medium, #3a3a4a)'}`,
            boxShadow: this.isOpen ? `0 0 0 3px ${c.soft}` : 'none',
            color: 'var(--text-primary, #e4e4e7)'
        });
        this.field.setAttribute('aria-expanded', this.isOpen ? 'true' : 'false');
        this.panel.setStyles({ display: this.isOpen ? 'block' : 'none' });
    }

    emit() {
        this.dispatchEvent({ type: 'change', target: this, value: this.value, rangeEnd: this.rangeEnd });
    }

    setOpen(open) {
        if (this.options.disabled) return;
        this.isOpen = Boolean(open);
        this.paint();
    }

    setValue(value, rangeEnd = '') {
        this.value = String(value || '');
        this.rangeEnd = String(rangeEnd || '');
        this.calendar.setValue(this.value, this.rangeEnd);
        this.paint();
    }

    destroy() {
        if (typeof document !== 'undefined') {
            document.removeEventListener('mousedown', this._onDocumentDown, true);
            document.removeEventListener('keydown', this._onKey);
        }
        super.destroy();
    }
}
