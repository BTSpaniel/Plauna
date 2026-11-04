// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Calendar - a month grid to pick a date or a range, with today marked,
 * event dots, disabled days and keyboard navigation (arrows by day and
 * week, PageUp/PageDown by month, Home/End to the week's ends).
 */

import { UINode, DIRTY } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, tone, variantStyles, bindInteraction, TONES, TRANSITION } from '../shared/appearance.js';

let _calendarSequence = 0;

function _newCalendarId() {
    return `calendar-${Date.now()}-${++_calendarSequence}`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** 'YYYY-MM-DD' for a local date. */
export function isoDay(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDay(value) {
    if (!value) return null;
    const match = String(value).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3] || 1));
}

function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

export class Calendar extends UINode {
    static id = 'calendar';
    static name = 'Calendar';
    static category = 'dataviews';
    static icon = '📅';
    static description = 'Month grid to pick a date or a range';
    static tags = ['dataviews', 'calendar', 'date', 'picker', 'range', 'schedule'];
    static emits = ['change'];
    static dependencies = [];
    static optionValues = { mode: ['single', 'range'], weekStart: ['monday', 'sunday'], tone: TONES, size: ['sm', 'md'], showOutside: 'boolean', disablePast: 'boolean' };

    static getDefaultOptions() {
        return { month: '2026-10', value: '2026-10-16', rangeEnd: '', mode: 'single', weekStart: 'monday', tone: 'primary', size: 'md', events: ['2026-10-02', '2026-10-15', '2026-10-15', '2026-10-24'], showOutside: true, disablePast: false, today: '' };
    }

    static stories() {
        return {
            'Pick a day': { month: '2026-10', value: '2026-10-16' },
            'Range': { month: '2026-10', mode: 'range', value: '2026-10-12', rangeEnd: '2026-10-18', tone: 'accent' },
            'Sunday first, small': { month: '2026-11', value: '2026-11-03', weekStart: 'sunday', size: 'sm', showOutside: false, events: ['2026-11-11', '2026-11-26'] },
            'Past disabled': { month: '2026-10', value: '2026-10-20', disablePast: true, today: '2026-10-16', tone: 'success' }
        };
    }

    static create(container, options = {}) {
        const instance = new Calendar(_newCalendarId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newCalendarId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...Calendar.getDefaultOptions(), ...options };
        this.today = parseDay(this.options.today) || new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
        this.start = parseDay(this.options.value);
        this.end = parseDay(this.options.rangeEnd);
        this.view = parseDay(this.options.month) || new Date((this.start || this.today).getFullYear(), (this.start || this.today).getMonth(), 1);
        this.focusDay = this.start && this.start.getMonth() === this.view.getMonth() ? this.start : new Date(this.view);
        this.build();
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const small = this.options.size === 'sm';
        this.role = 'group';
        this.ariaLabel = 'Calendar';
        this.setStyles({
            display: 'inline-flex', flexDirection: 'column', gap: '10px', boxSizing: 'border-box', padding: small ? '12px' : '16px',
            borderRadius: '16px', backgroundColor: 'var(--surface-card, #0f0f17)', border: '1px solid var(--border-light, #2a2a3a)',
            boxShadow: 'var(--shadow-md, 0 4px 6px -1px rgba(0,0,0,0.4))', userSelect: 'none'
        });
        const nav = (part, path, label, step) => {
            const button = el(this, part, 'button', {
                label, attrs: { type: 'button' },
                style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', padding: '0', borderRadius: '8px', border: '1px solid transparent', cursor: 'pointer', transition: TRANSITION },
                children: [icon(this, `${part}-icon`, path, 16)]
            });
            bindInteraction(button, (state) => button.setStyles(variantStyles('ghost', 'neutral', state)));
            button.addEventListener('click', () => this.shiftMonth(step));
            return button;
        };
        this.title = el(this, 'title', 'div', {
            attrs: { 'aria-live': 'polite' },
            style: { flex: '1', textAlign: 'center', fontSize: small ? '14px' : '15px', fontWeight: '650', color: 'var(--text-primary, #e4e4e7)' }
        });
        this.appendChild(el(this, 'head', 'div', {
            style: { display: 'flex', alignItems: 'center', gap: '6px' },
            children: [nav('prev', ICONS.chevronLeft, 'Previous month', -1), this.title, nav('next', ICONS.chevronRight, 'Next month', 1)]
        }));
        this.grid = el(this, 'grid', 'div', {
            role: 'grid',
            style: { display: 'grid', gridTemplateColumns: `repeat(7, ${small ? 32 : 40}px)`, rowGap: '2px', columnGap: '0' }
        });
        this.appendChild(this.grid);
        this.renderMonth();
    }

    weekdays() {
        return this.options.weekStart === 'sunday' ? WEEKDAYS : [...WEEKDAYS.slice(1), WEEKDAYS[0]];
    }

    renderMonth() {
        for (const child of [...this.grid.children]) child.destroy();
        const small = this.options.size === 'sm';
        const cell = small ? 32 : 40;
        const c = tone(this.options.tone);
        this.title.setTextContent(`${MONTHS[this.view.getMonth()]} ${this.view.getFullYear()}`);
        this.weekdays().forEach((day, i) => this.grid.appendChild(el(this, `wd-${i}`, 'div', {
            role: 'columnheader', text: day,
            style: { height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '700', letterSpacing: '0.04em', color: 'var(--text-tertiary, #9ca3af)' }
        })));
        const first = new Date(this.view.getFullYear(), this.view.getMonth(), 1);
        const offset = (first.getDay() - (this.options.weekStart === 'sunday' ? 0 : 1) + 7) % 7;
        const gridStart = addDays(first, -offset);
        const events = new Map();
        for (const day of this.options.events || []) events.set(day, (events.get(day) || 0) + 1);
        const lo = this.start && this.end && this.end < this.start ? this.end : this.start;
        const hi = this.start && this.end && this.end < this.start ? this.start : this.end;
        this.cells = new Map();
        // Six weeks keep the height steady while paging; without outside days only the month's weeks show
        const daysInMonth = new Date(this.view.getFullYear(), this.view.getMonth() + 1, 0).getDate();
        const cellCount = this.options.showOutside ? 42 : Math.ceil((offset + daysInMonth) / 7) * 7;
        for (let i = 0; i < cellCount; i++) {
            const date = addDays(gridStart, i);
            const key = isoDay(date);
            const inMonth = date.getMonth() === this.view.getMonth();
            const disabled = this.options.disablePast && date < this.today;
            const isStart = lo && key === isoDay(lo);
            const isEnd = hi && key === isoDay(hi);
            const selected = isStart || isEnd;
            const between = this.options.mode === 'range' && lo && hi && date > lo && date < hi;
            const isToday = key === isoDay(this.today);
            const hidden = !inMonth && !this.options.showOutside;
            const band = this.options.mode === 'range' && lo && hi && (between || (isStart && hi > lo) || (isEnd && hi > lo));
            const wrap = el(this, `cell-${i}`, 'div', {
                role: 'gridcell',
                style: {
                    position: 'relative', width: `${cell}px`, height: `${cell}px`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backgroundColor: band ? c.soft : 'transparent',
                    borderRadius: band ? (isStart ? '9999px 0 0 9999px' : isEnd ? '0 9999px 9999px 0' : '0') : '0'
                }
            });
            if (!hidden) {
                const button = el(this, `day-${i}`, 'button', {
                    text: String(date.getDate()),
                    label: date.toDateString(),
                    attrs: { type: 'button', 'aria-selected': selected ? 'true' : 'false', 'aria-current': isToday ? 'date' : null, 'data-day': key },
                    data: { disabled: Boolean(disabled) },
                    style: {
                        width: `${cell - 4}px`, height: `${cell - 4}px`, padding: '0', borderRadius: '9999px', cursor: disabled ? 'not-allowed' : 'pointer',
                        fontFamily: 'inherit', fontSize: small ? '12px' : '13px', fontWeight: selected || isToday ? '700' : '500',
                        border: `1px solid ${isToday && !selected ? c.border : 'transparent'}`, transition: TRANSITION,
                        opacity: disabled ? '0.45' : '1'
                    }
                });
                button.tabIndex = key === isoDay(this.focusDay) ? 0 : -1;
                const paint = (state) => {
                    if (selected) button.setStyles({ backgroundColor: state === 'rest' ? c.base : c.hover, color: c.on, boxShadow: `0 4px 12px -4px ${c.glow}` });
                    else button.setStyles({
                        backgroundColor: disabled ? 'transparent' : state === 'rest' ? 'transparent' : c.softHover,
                        color: disabled ? 'var(--text-disabled, #6b7280)' : !inMonth ? 'var(--text-disabled, #6b7280)' : between ? c.text : 'var(--text-primary, #e4e4e7)',
                        boxShadow: 'none'
                    });
                };
                if (disabled) paint('rest');
                else bindInteraction(button, paint);
                button.addEventListener('click', () => { if (!disabled) this.pick(date); });
                button.addEventListener('keydown', (event) => this.onKey(event, date));
                wrap.appendChild(button);
                this.cells.set(key, button);
                const count = events.get(key) || 0;
                if (count) {
                    wrap.appendChild(el(this, `events-${i}`, 'span', {
                        attrs: { 'aria-hidden': 'true' },
                        style: { position: 'absolute', bottom: small ? '3px' : '4px', left: '0', right: '0', display: 'flex', justifyContent: 'center', gap: '2px', pointerEvents: 'none' },
                        children: Array.from({ length: Math.min(3, count) }, (_, n) => el(this, `event-${i}-${n}`, 'span', {
                            style: { width: '4px', height: '4px', borderRadius: '50%', backgroundColor: selected ? c.on : (n === 0 ? c.base : 'var(--color-accent, #8b5cf6)') }
                        }))
                    }));
                }
            }
            this.grid.appendChild(wrap);
        }
    }

    shiftMonth(step) {
        this.view = new Date(this.view.getFullYear(), this.view.getMonth() + step, 1);
        this.focusDay = new Date(this.view);
        this.renderMonth();
        this.dispatchEvent({ type: 'monthchange', target: this, month: isoDay(this.view).slice(0, 7) });
    }

    pick(date) {
        if (this.options.mode === 'range') {
            if (!this.start || this.end) {
                this.start = date;
                this.end = null;
            } else if (date < this.start) {
                // An end before the start swaps them, so the range stays in order
                this.end = this.start;
                this.start = date;
            } else {
                this.end = date;
            }
        } else {
            this.start = date;
        }
        this.focusDay = date;
        if (date.getMonth() !== this.view.getMonth()) this.view = new Date(date.getFullYear(), date.getMonth(), 1);
        this.renderMonth();
        this.cells.get(isoDay(date))?.focus?.();
        this.dispatchEvent({
            type: 'change', target: this,
            value: this.start ? isoDay(this.start) : '', rangeEnd: this.end ? isoDay(this.end) : ''
        });
    }

    onKey(event, date) {
        const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
        let next = null;
        if (moves[event.key] !== undefined) next = addDays(date, moves[event.key]);
        else if (event.key === 'PageUp' || event.key === 'PageDown') next = new Date(date.getFullYear(), date.getMonth() + (event.key === 'PageDown' ? 1 : -1), Math.min(date.getDate(), 28));
        else if (event.key === 'Home' || event.key === 'End') {
            const offset = (date.getDay() - (this.options.weekStart === 'sunday' ? 0 : 1) + 7) % 7;
            next = addDays(date, event.key === 'Home' ? -offset : 6 - offset);
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault?.();
            this.pick(date);
            return;
        }
        if (!next) return;
        event.preventDefault?.();
        this.focusDay = next;
        if (next.getMonth() !== this.view.getMonth() || next.getFullYear() !== this.view.getFullYear()) {
            this.view = new Date(next.getFullYear(), next.getMonth(), 1);
            this.renderMonth();
        } else {
            for (const [key, button] of this.cells) {
                button.tabIndex = key === isoDay(next) ? 0 : -1;
                button.markDirty(DIRTY.ACCESSIBILITY);
            }
        }
        this.cells.get(isoDay(next))?.focus?.();
    }

    setValue(value, rangeEnd = '') {
        this.start = parseDay(value);
        this.end = parseDay(rangeEnd);
        if (this.start) this.view = new Date(this.start.getFullYear(), this.start.getMonth(), 1);
        this.renderMonth();
    }
}
