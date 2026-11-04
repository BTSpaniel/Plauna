// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * SpeedDial - a floating action button that fans out related actions with
 * labels. The plus turns into a close mark while open. `contained` keeps it
 * in the corner of its own frame (previews); otherwise it floats over the
 * viewport. Escape or a click outside closes it. Fires 'action'.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, tone, TONES } from '../shared/appearance.js';

let _speedDialSequence = 0;

function _newSpeedDialId() {
    return `speed-dial-${Date.now()}-${++_speedDialSequence}`;
}

const ACTIONS = [
    { id: 'image', icon: 'image', label: 'Add image' },
    { id: 'file', icon: 'file', label: 'New script' },
    { id: 'zap', icon: 'zap', label: 'Add light' },
    { id: 'link', icon: 'link', label: 'Share link' }
];

export class SpeedDial extends UINode {
    static id = 'speed-dial';
    static name = 'Speed Dial';
    static category = 'navigation';
    static icon = '➕';
    static description = 'Floating action button that fans out actions';
    static tags = ['navigation', 'fab', 'floating action button', 'speed dial', 'actions'];
    static dependencies = [];
    static optionValues = { direction: ['up', 'left'], tone: TONES, variant: ['solid', 'gradient'], open: 'boolean', showLabels: 'boolean', contained: 'boolean' };

    static getDefaultOptions() {
        return { actions: ACTIONS, open: true, direction: 'up', tone: 'primary', variant: 'gradient', showLabels: true, contained: true, height: 300, label: 'Create' };
    }

    static stories() {
        return {
            'Open': { actions: ACTIONS, open: true },
            'Closed': { actions: ACTIONS, open: false, variant: 'solid' },
            'Left, accent': { actions: ACTIONS.slice(0, 3), direction: 'left', tone: 'accent', showLabels: false, height: 140 }
        };
    }

    static create(container, options = {}) {
        const instance = new SpeedDial(_newSpeedDialId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newSpeedDialId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...SpeedDial.getDefaultOptions(), ...options };
        this.isOpen = Boolean(this.options.open);
        this._onDocumentDown = (event) => { if (this.isOpen && this.dial?.element && !this.dial.element.contains(event.target)) this.setOpen(false); };
        this._onKey = (event) => { if (this.isOpen && event.key === 'Escape') { this.setOpen(false); this.main?.focus?.(); } };
        if (typeof document !== 'undefined') {
            document.addEventListener('mousedown', this._onDocumentDown, true);
            document.addEventListener('keydown', this._onKey);
        }
        this.build();
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { contained, height, direction, showLabels, label } = this.options;
        const c = tone(this.options.tone);
        const up = direction === 'up';
        this.setStyles(contained ? {
            position: 'relative', width: '100%', minWidth: '260px', height: `${height}px`, overflow: 'hidden', boxSizing: 'border-box',
            borderRadius: '14px', border: '1px solid var(--border-light, #2a2a3a)', backgroundColor: 'var(--surface-sunken, #0a0a0f)'
        } : { position: 'fixed', right: '24px', bottom: '24px', zIndex: '400' });
        this.dial = el(this, 'dial', 'div', {
            style: { position: 'absolute', right: '18px', bottom: '18px', display: 'flex', flexDirection: up ? 'column-reverse' : 'row-reverse', alignItems: up ? 'flex-end' : 'center', gap: '12px' }
        });
        const gradient = this.options.variant === 'gradient';
        this.main = el(this, 'main', 'button', {
            label, attrs: { type: 'button', 'aria-haspopup': 'menu', 'aria-controls': `${this.id}-actions` },
            style: {
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '56px', height: '56px', padding: '0', flex: '0 0 auto',
                borderRadius: '50%', border: 'none', cursor: 'pointer', color: c.on, backgroundColor: c.base,
                backgroundImage: gradient ? `linear-gradient(135deg, ${c.base}, var(--color-accent, #8b5cf6))` : 'none',
                boxShadow: `0 10px 24px -8px ${c.glow}, 0 4px 10px rgba(0, 0, 0, 0.3)`, transition: 'transform 160ms var(--ease-out, ease), box-shadow 160ms ease'
            },
            children: [icon(this, 'main-icon', ICONS.plus, 24, { strokeWidth: 2.4, style: { transition: 'transform 220ms var(--ease-spring, ease)' } })]
        });
        this.mainIcon = this.main.children[0];
        this.main.addEventListener('click', () => this.setOpen(!this.isOpen));
        this.main.addEventListener('mouseenter', () => this.main.setStyles({ transform: 'scale(1.06)' }));
        this.main.addEventListener('mouseleave', () => this.main.setStyles({ transform: 'none' }));
        this.dial.appendChild(this.main);
        this.list = el(this, 'actions', 'div', {
            role: 'menu', label,
            style: { display: 'flex', flexDirection: up ? 'column-reverse' : 'row-reverse', alignItems: up ? 'flex-end' : 'center', gap: '10px' }
        });
        this.items = (Array.isArray(this.options.actions) ? this.options.actions : []).map((action, index) => {
            const button = el(this, `action-${index}`, 'button', {
                role: 'menuitem', label: action.label, attrs: { type: 'button', title: action.label },
                style: {
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '42px', height: '42px', padding: '0', flex: '0 0 auto',
                    borderRadius: '50%', border: '1px solid var(--border-medium, #3a3a4a)', backgroundColor: 'var(--surface-overlay, #0f0f17)',
                    color: 'var(--text-primary, #e4e4e7)', cursor: 'pointer', boxShadow: 'var(--shadow-md, 0 4px 6px -1px rgba(0,0,0,0.4))', transition: 'background-color 120ms ease, color 120ms ease'
                },
                children: [icon(this, `action-icon-${index}`, ICONS[action.icon] || ICONS.plus, 18)]
            });
            button.addEventListener('mouseenter', () => button.setStyles({ backgroundColor: c.base, color: c.on, borderColor: 'transparent' }));
            button.addEventListener('mouseleave', () => button.setStyles({ backgroundColor: 'var(--surface-overlay, #0f0f17)', color: 'var(--text-primary, #e4e4e7)', borderColor: 'var(--border-medium, #3a3a4a)' }));
            button.addEventListener('click', () => { this.dispatchEvent({ type: 'action', target: this, id: action.id, label: action.label }); this.setOpen(false); });
            const row = el(this, `row-${index}`, 'div', {
                style: { display: 'flex', alignItems: 'center', gap: '10px', transition: `opacity 160ms ease ${index * 30}ms, transform 200ms var(--ease-out, ease) ${index * 30}ms`, marginRight: up ? '7px' : '0' },
                children: [
                    showLabels && up ? el(this, `label-${index}`, 'span', {
                        text: action.label,
                        style: { padding: '5px 10px', borderRadius: '8px', fontSize: '12px', fontWeight: '600', whiteSpace: 'nowrap', backgroundColor: 'var(--surface-overlay, #0f0f17)', color: 'var(--text-primary, #e4e4e7)', border: '1px solid var(--border-light, #2a2a3a)', boxShadow: 'var(--shadow-md, 0 4px 6px -1px rgba(0,0,0,0.4))' }
                    }) : null,
                    button
                ]
            });
            this.list.appendChild(row);
            return row;
        });
        this.dial.appendChild(this.list);
        this.appendChild(this.dial);
        this.paint();
    }

    paint() {
        const up = this.options.direction === 'up';
        this.main.setAttribute('aria-expanded', this.isOpen ? 'true' : 'false');
        this.mainIcon.setStyles({ transform: this.isOpen ? 'rotate(45deg)' : 'none' });
        this.list.setStyles({ visibility: this.isOpen ? 'visible' : 'hidden', pointerEvents: this.isOpen ? 'auto' : 'none' });
        this.items.forEach((row) => row.setStyles({ opacity: this.isOpen ? '1' : '0', transform: this.isOpen ? 'none' : (up ? 'translateY(12px)' : 'translateX(12px)') }));
    }

    setOpen(open) {
        this.isOpen = Boolean(open);
        this.paint();
        this.dispatchEvent({ type: this.isOpen ? 'open' : 'close', target: this });
    }

    destroy() {
        if (typeof document !== 'undefined') {
            document.removeEventListener('mousedown', this._onDocumentDown, true);
            document.removeEventListener('keydown', this._onKey);
        }
        super.destroy();
    }
}
