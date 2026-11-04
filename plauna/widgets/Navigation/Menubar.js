// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Menubar - an application menu bar (File, Edit, View…) whose menus hold
 * commands with shortcuts, separators and checkable items. Click a title to
 * open its menu; while one is open, hovering another title switches menus.
 * Keyboard: Left/Right move between menus, Down opens, Up/Down move inside,
 * Enter runs, Escape closes. Fires 'command'.
 */

import { UINode, DIRTY } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, tone, TONES, afterRender } from '../shared/appearance.js';
import { Kbd } from '../Primitive/Kbd.js';

let _menubarSequence = 0;

function _newMenubarId() {
    return `menubar-${Date.now()}-${++_menubarSequence}`;
}

const MENUS = [
    { title: 'File', items: [{ label: 'New scene', shortcut: 'Ctrl+N' }, { label: 'Open…', shortcut: 'Ctrl+O' }, { separator: true }, { label: 'Save', shortcut: 'Ctrl+S' }, { label: 'Export', shortcut: 'Ctrl+E' }] },
    { title: 'Edit', items: [{ label: 'Undo', shortcut: 'Ctrl+Z' }, { label: 'Redo', shortcut: 'Ctrl+Shift+Z' }, { separator: true }, { label: 'Duplicate', shortcut: 'Ctrl+D' }, { label: 'Delete', shortcut: 'Delete', tone: 'danger' }] },
    { title: 'View', items: [{ label: 'Wireframe', checked: false }, { label: 'Grid', checked: true }, { label: 'Statistics', checked: true }, { separator: true }, { label: 'Full screen', shortcut: 'F11' }] },
    { title: 'Help', items: [{ label: 'Documentation' }, { label: 'Keyboard shortcuts', shortcut: 'Ctrl+/' }, { separator: true }, { label: 'About Plauna' }] }
];

export class Menubar extends UINode {
    static id = 'menubar';
    static name = 'Menubar';
    static category = 'navigation';
    static icon = '🗃️';
    static description = 'Application menu bar with dropdown menus';
    static tags = ['navigation', 'menubar', 'menu', 'file menu', 'commands'];
    static dependencies = ['kbd'];
    static optionValues = { tone: TONES, variant: ['surface', 'ghost'], showShortcuts: 'boolean' };

    static getDefaultOptions() {
        return { menus: MENUS, open: -1, tone: 'primary', variant: 'surface', showShortcuts: true };
    }

    static stories() {
        return {
            'Closed': { menus: MENUS },
            'Edit open': { menus: MENUS, open: 1 },
            'View with checks': { menus: MENUS, open: 2, tone: 'accent' },
            'Ghost bar': { menus: MENUS, variant: 'ghost' }
        };
    }

    static create(container, options = {}) {
        const instance = new Menubar(_newMenubarId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newMenubarId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...Menubar.getDefaultOptions(), ...options };
        this.menus = (Array.isArray(this.options.menus) ? this.options.menus : MENUS).map((menu) => ({ ...menu, items: (menu.items || []).map((item) => ({ ...item })) }));
        this.openIndex = Number.isInteger(this.options.open) ? this.options.open : -1;
        // The title holding the bar's one tab stop while no menu is open
        this.focusIndex = Math.max(0, this.openIndex);
        this.activeItem = -1;
        this._onDocumentDown = (event) => {
            if (this.openIndex >= 0 && this.element && !this.element.contains(event.target)) this.openMenu(-1);
        };
        if (typeof document !== 'undefined') document.addEventListener('mousedown', this._onDocumentDown, true);
        this.build();
        afterRender(this, () => this.placePanel());
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const ghost = this.options.variant === 'ghost';
        this.role = 'menubar';
        this.setStyles({
            position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '2px', padding: '4px', boxSizing: 'border-box',
            borderRadius: '10px', backgroundColor: ghost ? 'transparent' : 'var(--surface-card, #0f0f17)',
            border: ghost ? '1px solid transparent' : '1px solid var(--border-light, #2a2a3a)'
        });
        this.titles = this.menus.map((menu, index) => {
            const title = el(this, `title-${index}`, 'button', {
                role: 'menuitem', text: menu.title, attrs: { type: 'button', 'aria-haspopup': 'menu', 'aria-controls': `${this.id}-panel` },
                style: { position: 'relative', height: '30px', padding: '0 12px', border: 'none', borderRadius: '7px', fontFamily: 'inherit', fontSize: '13px', fontWeight: '550', cursor: 'pointer', transition: 'background-color 100ms ease, color 100ms ease' }
            });
            title.addEventListener('click', () => this.openMenu(this.openIndex === index ? -1 : index));
            title.addEventListener('mouseenter', () => { title._hover = true; if (this.openIndex >= 0 && this.openIndex !== index) this.openMenu(index); else this.paint(); });
            title.addEventListener('mouseleave', () => { title._hover = false; this.paint(); });
            title.addEventListener('keydown', (event) => this.onTitleKey(event, index));
            this.appendChild(title);
            return title;
        });
        this.panel = el(this, 'panel', 'div', {
            role: 'menu',
            style: {
                position: 'absolute', top: '100%', marginTop: '6px', zIndex: '100', minWidth: '220px', boxSizing: 'border-box', padding: '5px',
                borderRadius: '12px', backgroundColor: 'var(--surface-overlay, #0f0f17)', border: '1px solid var(--border-medium, #3a3a4a)',
                boxShadow: 'var(--shadow-xl, 0 20px 25px -5px rgba(0,0,0,0.4))'
            }
        });
        this.appendChild(this.panel);
        this.renderMenu();
        this.paint();
    }

    paint() {
        const c = tone(this.options.tone);
        this.titles.forEach((title, index) => {
            const open = index === this.openIndex;
            title.tabIndex = index === (this.openIndex >= 0 ? this.openIndex : this.focusIndex) ? 0 : -1;
            title.markDirty(DIRTY.ACCESSIBILITY);
            title.setAttribute('aria-expanded', open ? 'true' : 'false');
            title.setStyles({
                backgroundColor: open ? c.soft : title._hover ? 'color-mix(in srgb, var(--text-primary, #e4e4e7) 7%, transparent)' : 'transparent',
                color: open ? c.text : 'var(--text-primary, #e4e4e7)'
            });
        });
    }

    renderMenu() {
        for (const child of [...this.panel.children]) child.destroy();
        const menu = this.menus[this.openIndex];
        this.panel.setStyles({ display: menu ? 'block' : 'none' });
        this.rows = [];
        if (!menu) return;
        this.placePanel();
        this.panel.setAttribute('aria-label', menu.title);
        menu.items.forEach((item, index) => {
            if (item.separator) {
                this.panel.appendChild(el(this, `sep-${this.openIndex}-${index}`, 'div', { role: 'separator', style: { height: '1px', margin: '5px 6px', backgroundColor: 'var(--border-light, #2a2a3a)' } }));
                return;
            }
            const checkable = typeof item.checked === 'boolean';
            const lead = el(this, `lead-${this.openIndex}-${index}`, 'span', {
                style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '16px', flex: '0 0 auto', color: tone(this.options.tone).base },
                children: checkable && item.checked ? [icon(this, `check-${this.openIndex}-${index}`, ICONS.check, 14, { strokeWidth: 2.5 })] : []
            });
            const row = el(this, `item-${this.openIndex}-${index}`, 'div', {
                role: checkable ? 'menuitemcheckbox' : 'menuitem', tabIndex: -1,
                attrs: checkable ? { 'aria-checked': item.checked ? 'true' : 'false' } : {},
                style: { display: 'flex', alignItems: 'center', gap: '8px', height: '32px', padding: '0 8px', borderRadius: '8px', fontSize: '13px', cursor: 'pointer', outline: 'none', color: item.tone === 'danger' ? tone('danger').text : 'var(--text-primary, #e4e4e7)' },
                children: [lead, el(this, `label-${this.openIndex}-${index}`, 'span', { text: item.label, style: { flex: '1' } })]
            });
            if (item.shortcut && this.options.showShortcuts) row.appendChild(new Kbd(`${this.id}-kbd-${this.openIndex}-${index}`, { keys: item.shortcut, variant: 'ghost', size: 'xs' }));
            const rowIndex = this.rows.length;
            row.addEventListener('mouseenter', () => this.setActiveItem(rowIndex));
            row.addEventListener('click', () => this.run(item));
            row.addEventListener('keydown', (event) => this.onItemKey(event, rowIndex));
            this.panel.appendChild(row);
            this.rows.push({ row, item });
        });
        this.setActiveItem(this.activeItem);
    }

    /** Line the open menu up under its title. */
    placePanel() {
        const title = this.titles?.[this.openIndex];
        if (title) this.panel.setStyles({ left: `${title.element?.offsetLeft ?? 4}px` });
    }

    setActiveItem(index) {
        this.activeItem = index;
        const c = tone(this.options.tone);
        this.rows.forEach(({ row, item }, i) => row.setStyles({ backgroundColor: i === index ? (item.tone === 'danger' ? tone('danger').soft : c.soft) : 'transparent' }));
    }

    openMenu(index, focusFirst = false) {
        this.openIndex = index;
        if (index >= 0) this.focusIndex = index;
        this.activeItem = focusFirst ? 0 : -1;
        this.renderMenu();
        this.paint();
        if (focusFirst) this.rows[0]?.row?.focus?.();
    }

    run(item) {
        if (typeof item.checked === 'boolean') {
            item.checked = !item.checked;
            this.dispatchEvent({ type: 'command', target: this, command: item.label, checked: item.checked });
            const keep = this.activeItem;
            this.renderMenu();
            this.setActiveItem(keep);
            this.rows[keep]?.row?.focus?.();
            return;
        }
        this.dispatchEvent({ type: 'command', target: this, command: item.label });
        const title = this.titles[this.openIndex];
        this.openMenu(-1);
        title?.focus?.();
    }

    onTitleKey(event, index) {
        const count = this.titles.length;
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault?.();
            const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + count) % count;
            this.focusIndex = next;
            if (this.openIndex >= 0) this.openMenu(next);
            this.titles[next].focus?.();
            this.paint();
        } else if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault?.();
            this.openMenu(index, true);
        } else if (event.key === 'Escape') {
            this.openMenu(-1);
        }
    }

    onItemKey(event, index) {
        const count = this.rows.length;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault?.();
            const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
            this.setActiveItem(next);
            this.rows[next].row.focus?.();
        } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault?.();
            this.run(this.rows[index].item);
        } else if (event.key === 'Escape') {
            event.preventDefault?.();
            const title = this.titles[this.openIndex];
            this.openMenu(-1);
            title?.focus?.();
        } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault?.();
            const next = (this.openIndex + (event.key === 'ArrowRight' ? 1 : -1) + this.titles.length) % this.titles.length;
            this.openMenu(next, true);
        }
    }

    destroy() {
        if (typeof document !== 'undefined') document.removeEventListener('mousedown', this._onDocumentDown, true);
        super.destroy();
    }
}
