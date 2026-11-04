// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Toolbar - groups of icon buttons with separators: toggle buttons (bold,
 * italic), exclusive groups (alignment) and plain actions. One tab stop;
 * arrow keys move between buttons (roving tabindex). Fires 'action' and
 * 'toggle'.
 */

import { UINode, DIRTY } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, tone, variantStyles, sizeScale, TONES, TRANSITION } from '../shared/appearance.js';

let _toolbarSequence = 0;

function _newToolbarId() {
    return `toolbar-${Date.now()}-${++_toolbarSequence}`;
}

const EDITOR_GROUPS = [
    { name: 'history', items: [{ id: 'undo', icon: 'undo', label: 'Undo' }, { id: 'redo', icon: 'redo', label: 'Redo' }] },
    { name: 'format', toggle: true, items: [{ id: 'bold', icon: 'bold', label: 'Bold', pressed: true }, { id: 'italic', icon: 'italic', label: 'Italic' }, { id: 'underline', icon: 'underline', label: 'Underline' }] },
    { name: 'align', exclusive: true, items: [{ id: 'left', icon: 'alignLeft', label: 'Align left', pressed: true }, { id: 'center', icon: 'alignCenter', label: 'Align center' }, { id: 'right', icon: 'alignRight', label: 'Align right' }] },
    { name: 'insert', items: [{ id: 'link', icon: 'link', label: 'Insert link' }, { id: 'image', icon: 'image', label: 'Insert image' }] }
];

export class Toolbar extends UINode {
    static id = 'toolbar';
    static name = 'Toolbar';
    static category = 'navigation';
    static icon = '🧰';
    static description = 'Grouped icon buttons with toggles and keyboard navigation';
    static tags = ['navigation', 'toolbar', 'actions', 'toggle', 'editor', 'buttons'];
    static dependencies = [];
    static optionValues = { variant: ['surface', 'floating', 'ghost'], size: ['sm', 'md', 'lg'], tone: TONES, orientation: ['horizontal', 'vertical'], showLabels: 'boolean' };

    static getDefaultOptions() {
        return { groups: EDITOR_GROUPS, variant: 'surface', size: 'md', tone: 'primary', orientation: 'horizontal', showLabels: false, label: 'Formatting' };
    }

    static stories() {
        return {
            'Text editor': { groups: EDITOR_GROUPS },
            'Floating accent': { groups: EDITOR_GROUPS.slice(1, 3), variant: 'floating', tone: 'accent' },
            'Vertical tools': { groups: [{ name: 'tools', exclusive: true, items: [{ id: 'select', icon: 'grip', label: 'Select', pressed: true }, { id: 'search', icon: 'search', label: 'Zoom' }, { id: 'light', icon: 'zap', label: 'Light' }] }, { name: 'more', items: [{ id: 'settings', icon: 'settings', label: 'Settings' }] }], orientation: 'vertical', size: 'lg' },
            'With labels': { groups: [{ name: 'file', items: [{ id: 'new', icon: 'file', label: 'New' }, { id: 'share', icon: 'link', label: 'Share' }] }, { name: 'star', toggle: true, items: [{ id: 'star', icon: 'star', label: 'Star' }] }], showLabels: true, variant: 'ghost', size: 'sm' }
        };
    }

    static create(container, options = {}) {
        const instance = new Toolbar(_newToolbarId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newToolbarId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...Toolbar.getDefaultOptions(), ...options };
        this.focusIndex = 0;
        this.build();
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { variant, size, orientation, showLabels, label } = this.options;
        const vertical = orientation === 'vertical';
        const scale = sizeScale(size);
        this.role = 'toolbar';
        this.ariaLabel = label;
        this.setAttribute('aria-orientation', vertical ? 'vertical' : 'horizontal');
        const frame = variant === 'ghost' ? { backgroundColor: 'transparent', border: '1px solid transparent', boxShadow: 'none' }
            : variant === 'floating' ? { backgroundColor: 'var(--surface-overlay, #0f0f17)', border: '1px solid var(--border-medium, #3a3a4a)', boxShadow: 'var(--shadow-lg, 0 10px 15px -3px rgba(0,0,0,0.4))' }
                : { backgroundColor: 'var(--bg-secondary, #0f0f17)', border: '1px solid var(--border-light, #2a2a3a)', boxShadow: 'none' };
        this.setStyles({
            display: 'inline-flex', flexDirection: vertical ? 'column' : 'row', alignItems: 'center', gap: '2px',
            padding: '4px', borderRadius: variant === 'floating' ? '9999px' : `${scale.radius + 3}px`, ...frame,
            ...(variant === 'floating' && vertical ? { borderRadius: `${scale.radius + 8}px` } : {})
        });
        this.buttons = [];
        const groups = Array.isArray(this.options.groups) ? this.options.groups : [];
        groups.forEach((group, g) => {
            if (g > 0) {
                this.appendChild(el(this, `sep-${g}`, 'span', {
                    role: 'separator', attrs: { 'aria-orientation': vertical ? 'horizontal' : 'vertical' },
                    style: vertical ? { width: '60%', height: '1px', margin: '3px 0', backgroundColor: 'var(--border-light, #2a2a3a)' } : { width: '1px', height: `${scale.height - 14}px`, margin: '0 4px', backgroundColor: 'var(--border-light, #2a2a3a)' }
                }));
            }
            (group.items || []).forEach((item) => {
                const index = this.buttons.length;
                const children = [];
                if (ICONS[item.icon]) children.push(icon(this, `icon-${item.id}`, ICONS[item.icon], scale.icon));
                if (showLabels) children.push(el(this, `label-${item.id}`, 'span', { text: item.label }));
                const button = el(this, `button-${item.id}`, 'button', {
                    label: showLabels ? null : item.label, attrs: { type: 'button', title: item.label },
                    style: {
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                        minWidth: `${scale.height - 4}px`, height: `${scale.height - 4}px`, padding: showLabels ? `0 ${scale.padX - 4}px` : '0',
                        borderRadius: variant === 'floating' ? '9999px' : `${scale.radius}px`, border: '1px solid transparent',
                        cursor: 'pointer', fontFamily: 'inherit', fontSize: `${scale.fontSize}px`, fontWeight: '600', transition: TRANSITION
                    },
                    children
                });
                const entry = { item, group, button, pressed: Boolean(item.pressed), hover: 'rest' };
                if (group.toggle || group.exclusive) button.setAttribute('aria-pressed', entry.pressed ? 'true' : 'false');
                button.addEventListener('mouseenter', () => { entry.hover = 'hover'; this.paintButton(entry); });
                button.addEventListener('mouseleave', () => { entry.hover = 'rest'; this.paintButton(entry); });
                button.addEventListener('mousedown', () => { entry.hover = 'active'; this.paintButton(entry); });
                button.addEventListener('mouseup', () => { entry.hover = 'hover'; this.paintButton(entry); });
                button.addEventListener('click', () => this.activate(index));
                button.addEventListener('keydown', (event) => this.onKey(event, index));
                button.addEventListener('focus', () => { this.focusIndex = index; this.paintTabStops(); });
                this.buttons.push(entry);
                this.appendChild(button);
            });
        });
        this.buttons.forEach((entry) => this.paintButton(entry));
        this.paintTabStops();
    }

    paintButton(entry) {
        const c = tone(this.options.tone);
        if (entry.pressed) {
            entry.button.setStyles({ backgroundColor: entry.hover === 'active' ? c.softActive : c.softHover, color: c.text, borderColor: 'transparent', boxShadow: 'none' });
        } else {
            const ghost = variantStyles('ghost', 'neutral', entry.hover);
            entry.button.setStyles({ ...ghost, color: entry.hover === 'rest' ? 'var(--text-secondary, #d1d5db)' : 'var(--text-primary, #e4e4e7)' });
        }
    }

    paintTabStops() {
        this.buttons.forEach((entry, index) => { entry.button.tabIndex = index === this.focusIndex ? 0 : -1; entry.button.markDirty(DIRTY.ACCESSIBILITY); });
    }

    activate(index) {
        const entry = this.buttons[index];
        if (!entry) return;
        const { group, item } = entry;
        if (group.exclusive) {
            for (const other of this.buttons) {
                if (other.group === group) {
                    other.pressed = other === entry;
                    other.button.setAttribute('aria-pressed', other.pressed ? 'true' : 'false');
                    this.paintButton(other);
                }
            }
            this.dispatchEvent({ type: 'toggle', target: this, id: item.id, pressed: true, group: group.name });
        } else if (group.toggle) {
            entry.pressed = !entry.pressed;
            entry.button.setAttribute('aria-pressed', entry.pressed ? 'true' : 'false');
            this.paintButton(entry);
            this.dispatchEvent({ type: 'toggle', target: this, id: item.id, pressed: entry.pressed, group: group.name });
        }
        this.dispatchEvent({ type: 'action', target: this, id: item.id });
    }

    onKey(event, index) {
        const vertical = this.options.orientation === 'vertical';
        const prev = vertical ? 'ArrowUp' : 'ArrowLeft';
        const next = vertical ? 'ArrowDown' : 'ArrowRight';
        const last = this.buttons.length - 1;
        const to = { [prev]: index - 1, [next]: index + 1, Home: 0, End: last }[event.key];
        if (to === undefined) return;
        event.preventDefault?.();
        this.focusIndex = (to + this.buttons.length) % this.buttons.length;
        this.paintTabStops();
        this.buttons[this.focusIndex].button.focus?.();
    }

    isPressed(id) {
        return Boolean(this.buttons.find((entry) => entry.item.id === id)?.pressed);
    }
}
