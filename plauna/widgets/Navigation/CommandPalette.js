// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * CommandPalette - a searchable list of grouped commands with icons and
 * shortcuts. Type to filter, arrows to move, Enter to run; fires 'command'.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, tone, TONES, mix } from '../shared/appearance.js';
import { Kbd } from '../Primitive/Kbd.js';

let _paletteSequence = 0;

function _newPaletteId() {
    return `command-palette-${Date.now()}-${++_paletteSequence}`;
}

const COMMANDS = [
    { group: 'Scene', items: [
        { label: 'New scene', icon: 'file', shortcut: 'Ctrl+N' },
        { label: 'Add light', icon: 'zap', shortcut: 'Shift+L', description: 'Point, spot or area light' },
        { label: 'Frame selection', icon: 'search', shortcut: 'F' }
    ] },
    { group: 'View', items: [
        { label: 'Toggle wireframe', icon: 'image', shortcut: 'Z' },
        { label: 'Switch theme', icon: 'settings', description: 'Dark, light or high contrast' }
    ] },
    { group: 'Navigate', items: [
        { label: 'Go to home', icon: 'home', shortcut: 'G H' },
        { label: 'Open notifications', icon: 'bell', shortcut: 'G N' },
        { label: 'Account settings', icon: 'user' }
    ] }
];

export class CommandPalette extends UINode {
    static id = 'command-palette';
    static name = 'Command Palette';
    static category = 'navigation';
    static icon = '⌘';
    static description = 'Searchable, keyboard-driven list of commands';
    static tags = ['navigation', 'command', 'palette', 'search', 'launcher', 'spotlight'];
    static dependencies = ['kbd'];
    static optionValues = { tone: TONES, size: ['md', 'lg'], showFooter: 'boolean', showShortcuts: 'boolean' };

    static getDefaultOptions() {
        return { commands: COMMANDS, query: '', placeholder: 'Type a command or search…', tone: 'primary', size: 'md', showFooter: true, showShortcuts: true };
    }

    static stories() {
        return {
            'All commands': { commands: COMMANDS },
            'Filtered': { commands: COMMANDS, query: 'to' },
            'Accent, no footer': { commands: COMMANDS, tone: 'accent', showFooter: false },
            'Empty result': { commands: COMMANDS, query: 'teleport' }
        };
    }

    static create(container, options = {}) {
        const instance = new CommandPalette(_newPaletteId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newPaletteId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...CommandPalette.getDefaultOptions(), ...options };
        this.query = String(this.options.query || '');
        this.activeIndex = 0;
        this.build();
    }

    flat() {
        const q = this.query.trim().toLowerCase();
        const out = [];
        for (const group of Array.isArray(this.options.commands) ? this.options.commands : []) {
            for (const item of group.items || []) {
                if (!q || item.label.toLowerCase().includes(q) || (item.description || '').toLowerCase().includes(q) || group.group.toLowerCase().includes(q)) {
                    out.push({ ...item, group: group.group });
                }
            }
        }
        return out;
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { placeholder, size, showFooter } = this.options;
        const large = size === 'lg';
        this.setStyles({
            display: 'flex', flexDirection: 'column', width: '100%', maxWidth: large ? '620px' : '520px', boxSizing: 'border-box',
            borderRadius: '16px', overflow: 'hidden', backgroundColor: 'var(--surface-overlay, #0f0f17)', color: 'var(--text-primary, #e4e4e7)',
            border: '1px solid var(--border-medium, #3a3a4a)',
            boxShadow: `var(--shadow-xl, 0 20px 25px -5px rgba(0,0,0,0.4)), 0 0 0 4px ${mix('var(--color-primary, #0ea5e9)', 5)}`
        });
        const head = el(this, 'head', 'div', {
            style: { display: 'flex', alignItems: 'center', gap: '12px', padding: large ? '16px 18px' : '12px 16px', borderBottom: '1px solid var(--border-light, #2a2a3a)' }
        });
        head.appendChild(icon(this, 'search', ICONS.search, large ? 20 : 18, { style: { color: 'var(--text-tertiary, #9ca3af)' } }));
        this.input = el(this, 'input', 'input', {
            role: 'combobox', data: { type: 'text', value: this.query, placeholder },
            attrs: { autocomplete: 'off', 'aria-controls': `${this.id}-list`, 'aria-expanded': 'true', 'aria-label': 'Search commands' },
            style: { flex: '1', minWidth: '0', border: 'none', outline: 'none', backgroundColor: 'transparent', color: 'inherit', fontFamily: 'inherit', fontSize: large ? '17px' : '15px' }
        });
        this.input.addEventListener('input', (event) => {
            this.query = event?.domTarget?.value ?? '';
            this.input.userData.value = this.query;
            this.activeIndex = 0;
            this.renderList();
        });
        this.input.addEventListener('keydown', (event) => this.onKey(event));
        head.appendChild(this.input);
        head.appendChild(new Kbd(`${this.id}-esc`, { keys: 'Esc', variant: 'flat', size: 'xs' }));
        this.appendChild(head);
        this.list = el(this, 'list', 'div', { role: 'listbox', label: 'Commands', style: { maxHeight: '320px', overflowY: 'auto', padding: '6px' } });
        this.appendChild(this.list);
        if (showFooter) {
            const hint = (keys, text, part) => el(this, `hint-${part}`, 'span', {
                style: { display: 'inline-flex', alignItems: 'center', gap: '6px' },
                children: [new Kbd(`${this.id}-hint-key-${part}`, { keys, variant: 'flat', size: 'xs', separator: 'none' }), el(this, `hint-text-${part}`, 'span', { text })]
            });
            this.appendChild(el(this, 'foot', 'div', {
                style: { display: 'flex', alignItems: 'center', gap: '16px', padding: '9px 16px', fontSize: '12px', color: 'var(--text-tertiary, #9ca3af)', borderTop: '1px solid var(--border-light, #2a2a3a)', backgroundColor: 'var(--bg-tertiary, #171723)' },
                children: [hint(['Up', 'Down'], 'Navigate', 'nav'), hint('Enter', 'Run', 'run'), hint('Esc', 'Close', 'close')]
            }));
        }
        this.renderList();
    }

    renderList() {
        for (const child of [...this.list.children]) child.destroy();
        this.items = this.flat();
        this.rows = [];
        if (this.activeIndex >= this.items.length) this.activeIndex = Math.max(0, this.items.length - 1);
        if (!this.items.length) {
            this.list.appendChild(el(this, 'empty', 'div', {
                style: { padding: '28px 16px', textAlign: 'center', color: 'var(--text-tertiary, #9ca3af)', fontSize: '13px' },
                children: [
                    el(this, 'empty-title', 'div', { text: 'No commands found', style: { fontSize: '14px', fontWeight: '600', color: 'var(--text-secondary, #d1d5db)', marginBottom: '4px' } }),
                    el(this, 'empty-text', 'div', { text: `Nothing matches “${this.query.trim()}”.` })
                ]
            }));
            return;
        }
        const c = tone(this.options.tone);
        let group = null;
        this.items.forEach((item, index) => {
            if (item.group !== group) {
                group = item.group;
                this.list.appendChild(el(this, `group-${index}`, 'div', {
                    text: group, attrs: { 'aria-hidden': 'true' },
                    style: { padding: '10px 10px 4px', fontSize: '11px', fontWeight: '700', letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary, #9ca3af)' }
                }));
            }
            const glyph = el(this, `glyph-${index}`, 'span', {
                style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '8px', flex: '0 0 auto', transition: 'background-color 80ms ease, color 80ms ease' },
                children: ICONS[item.icon] ? [icon(this, `icon-${index}`, ICONS[item.icon], 16)] : []
            });
            const text = el(this, `text-${index}`, 'div', {
                style: { flex: '1', minWidth: '0' },
                children: [el(this, `label-${index}`, 'div', { text: item.label, style: { fontSize: '14px', fontWeight: '550' } })]
            });
            if (item.description) text.appendChild(el(this, `desc-${index}`, 'div', { text: item.description, style: { fontSize: '12px', color: 'var(--text-tertiary, #9ca3af)', marginTop: '1px' } }));
            const row = el(this, `item-${index}`, 'div', {
                role: 'option',
                style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '7px 10px', borderRadius: '10px', cursor: 'pointer', transition: 'background-color 80ms ease' },
                children: [glyph, text]
            });
            if (item.shortcut && this.options.showShortcuts) {
                row.appendChild(new Kbd(`${this.id}-key-${index}`, { keys: item.shortcut, variant: 'outline', size: 'xs', separator: item.shortcut.includes(' ') ? 'then' : '+' }));
            }
            row.addEventListener('mouseenter', () => this.setActive(index));
            row.addEventListener('click', () => this.run(index));
            this.list.appendChild(row);
            this.rows[index] = { row, glyph };
        });
        this.paintActive(c);
    }

    paintActive(c = tone(this.options.tone)) {
        this.rows.forEach(({ row, glyph }, index) => {
            const active = index === this.activeIndex;
            row.setAttribute('aria-selected', active ? 'true' : 'false');
            row.setStyles({ backgroundColor: active ? c.soft : 'transparent' });
            glyph.setStyles({ backgroundColor: active ? c.base : 'var(--bg-tertiary, #171723)', color: active ? c.on : 'var(--text-secondary, #d1d5db)' });
        });
        this.input?.setAttribute('aria-activedescendant', this.rows.length ? `${this.id}-item-${this.activeIndex}` : '');
    }

    setActive(index) {
        if (index === this.activeIndex) return;
        this.activeIndex = index;
        this.paintActive();
        this.rows[index]?.row?.element?.scrollIntoView?.({ block: 'nearest' });
    }

    onKey(event) {
        const count = this.items.length;
        if (!count) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault?.();
            this.setActive((this.activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + count) % count);
        } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault?.();
            this.setActive(event.key === 'Home' ? 0 : count - 1);
        } else if (event.key === 'Enter') {
            event.preventDefault?.();
            this.run(this.activeIndex);
        } else if (event.key === 'Escape') {
            this.dispatchEvent({ type: 'close', target: this });
        }
    }

    run(index) {
        const item = this.items[index];
        if (!item) return;
        this.dispatchEvent({ type: 'command', target: this, command: item.label, item });
    }

    setQuery(query) {
        this.query = String(query ?? '');
        this.input.userData.value = this.query;
        if (this.input.element) this.input.element.value = this.query;
        this.activeIndex = 0;
        this.renderList();
    }
}
