// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Drawer - a sheet that slides in from an edge with a header, body and
 * footer actions over a dimmed backdrop. `contained` keeps it inside its
 * own frame (previews, panels); otherwise it covers the viewport.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, variantStyles, bindInteraction, TONES, TRANSITION } from '../shared/appearance.js';

let _drawerSequence = 0;

function _newDrawerId() {
    return `drawer-${Date.now()}-${++_drawerSequence}`;
}

const SIZES = { sm: 240, md: 300, lg: 380 };

export class Drawer extends UINode {
    static id = 'drawer';
    static name = 'Drawer';
    static category = 'primitive';
    static icon = '🗄️';
    static description = 'Sheet that slides in from an edge';
    static tags = ['primitive', 'drawer', 'sheet', 'overlay', 'side panel'];
    static dependencies = [];
    static optionValues = {
        placement: ['right', 'left', 'bottom', 'top'], size: ['sm', 'md', 'lg'], tone: TONES,
        open: 'boolean', backdrop: 'boolean', contained: 'boolean'
    };

    static getDefaultOptions() {
        return {
            title: 'Drawer', content: '', placement: 'right', size: 'md', tone: 'primary', open: true,
            backdrop: true, contained: true, height: 280, triggerLabel: 'Open drawer',
            actions: [{ label: 'Cancel', variant: 'ghost' }, { label: 'Save', variant: 'solid' }]
        };
    }

    static stories() {
        return {
            'Right': { title: 'Edit material', placement: 'right', content: 'Roughness, metalness and emission update live in the viewport while this panel is open.' },
            'Left navigation': { title: 'Project', placement: 'left', size: 'sm', tone: 'accent', content: 'Scenes, assets and scripts of the open project.', actions: [] },
            'Bottom sheet': { title: 'Export', placement: 'bottom', size: 'sm', content: 'Choose a format and resolution, then export the current camera.', actions: [{ label: 'Export PNG', variant: 'solid' }] },
            'Closed': { title: 'Settings', open: false, content: 'Open the drawer from the button.' }
        };
    }

    static create(container, options = {}) {
        const instance = new Drawer(_newDrawerId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newDrawerId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...Drawer.getDefaultOptions(), ...options };
        this.isOpen = Boolean(this.options.open);
        this._onKey = (event) => {
            if (this.isOpen && event.key === 'Escape') this.close();
        };
        if (typeof document !== 'undefined') document.addEventListener('keydown', this._onKey);
        this.build();
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { contained, height, title, content, tone, placement, size, triggerLabel } = this.options;
        const fixed = !contained;
        this.setStyles(contained ? {
            position: 'relative', overflow: 'hidden', width: '100%', minWidth: '260px', height: `${height}px`,
            borderRadius: '14px', border: '1px solid var(--border-light, #2a2a3a)', backgroundColor: 'var(--surface-sunken, #0a0a0f)',
            backgroundImage: 'radial-gradient(circle at 20% 0%, color-mix(in srgb, var(--color-primary, #0ea5e9) 12%, transparent), transparent 60%)'
        } : { position: 'relative', display: 'inline-block' });

        const opener = el(this, 'open', 'button', {
            text: triggerLabel, attrs: { type: 'button', 'aria-controls': `${this.id}-panel` },
            style: {
                position: contained ? 'absolute' : 'static', left: '16px', top: '16px', height: '32px', padding: '0 12px',
                borderRadius: '8px', border: '1px solid transparent', fontSize: '13px', fontWeight: '600', cursor: 'pointer',
                transition: TRANSITION, fontFamily: 'inherit'
            }
        });
        bindInteraction(opener, (state) => opener.setStyles(variantStyles('soft', tone, state)));
        opener.addEventListener('click', () => this.open());
        this.opener = opener;
        this.appendChild(opener);

        this.backdrop = el(this, 'backdrop', 'div', {
            attrs: { 'aria-hidden': 'true' },
            style: {
                position: fixed ? 'fixed' : 'absolute', top: '0', right: '0', bottom: '0', left: '0', zIndex: '300',
                backgroundColor: 'rgba(3, 6, 12, 0.55)', backdropFilter: 'blur(2px)',
                transition: 'opacity var(--duration-base, 200ms) var(--ease-out, ease)'
            }
        });
        this.backdrop.addEventListener('click', () => this.close());
        this.appendChild(this.backdrop);

        const vertical = placement === 'top' || placement === 'bottom';
        const extent = SIZES[size] || SIZES.md;
        const edgeRadius = { right: '14px 0 0 14px', left: '0 14px 14px 0', bottom: '14px 14px 0 0', top: '0 0 14px 14px' }[placement] || '14px 0 0 14px';
        const anchor = {
            right: { top: '0', bottom: '0', right: '0', width: `${extent}px`, maxWidth: '92%' },
            left: { top: '0', bottom: '0', left: '0', width: `${extent}px`, maxWidth: '92%' },
            bottom: { left: '0', right: '0', bottom: '0', height: `${Math.round(extent * 0.62)}px`, maxHeight: '86%' },
            top: { left: '0', right: '0', top: '0', height: `${Math.round(extent * 0.62)}px`, maxHeight: '86%' }
        }[placement] || {};
        this.panel = el(this, 'panel', 'aside', {
            role: 'dialog', attrs: { 'aria-modal': 'true', 'aria-labelledby': `${this.id}-title` },
            style: {
                position: fixed ? 'fixed' : 'absolute', zIndex: '301', boxSizing: 'border-box', display: 'flex', flexDirection: 'column',
                backgroundColor: 'var(--surface-overlay, #0f0f17)', color: 'var(--text-primary, #e4e4e7)',
                border: '1px solid var(--border-medium, #3a3a4a)', borderRadius: edgeRadius,
                boxShadow: 'var(--shadow-xl, 0 20px 25px -5px rgba(0,0,0,0.4))',
                transition: 'transform var(--duration-slow, 320ms) var(--ease-out, ease)', ...anchor
            }
        });
        const head = el(this, 'head', 'header', {
            style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 16px', borderBottom: '1px solid var(--border-light, #2a2a3a)' }
        });
        if (vertical) {
            head.appendChild(el(this, 'grab', 'span', { attrs: { 'aria-hidden': 'true' }, style: { position: 'absolute', left: 'calc(50% - 18px)', top: placement === 'bottom' ? '6px' : 'auto', bottom: placement === 'top' ? '6px' : 'auto', width: '36px', height: '4px', borderRadius: '2px', backgroundColor: 'var(--border-dark, #4a4a5a)' } }));
        }
        head.appendChild(el(this, 'title', 'h3', { text: title, style: { flex: '1', margin: '0', fontSize: '15px', fontWeight: '650' } }));
        const close = el(this, 'close', 'button', {
            label: 'Close', attrs: { type: 'button' },
            style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', padding: '0', borderRadius: '7px', border: '1px solid transparent', cursor: 'pointer', transition: TRANSITION },
            children: [icon(this, 'close-icon', ICONS.x, 15)]
        });
        bindInteraction(close, (state) => close.setStyles(variantStyles('ghost', 'neutral', state)));
        close.addEventListener('click', () => this.close());
        head.appendChild(close);
        this.panel.appendChild(head);
        this.panel.appendChild(el(this, 'body', 'div', {
            text: content,
            style: { flex: '1', minHeight: '0', overflow: 'auto', padding: '14px 16px', fontSize: '13px', lineHeight: '1.6', color: 'var(--text-secondary, #d1d5db)' }
        }));
        const actions = Array.isArray(this.options.actions) ? this.options.actions : [];
        if (actions.length) {
            const foot = el(this, 'foot', 'footer', {
                style: { display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '12px 16px', borderTop: '1px solid var(--border-light, #2a2a3a)' }
            });
            actions.forEach((action, index) => {
                const button = el(this, `action-${index}`, 'button', {
                    text: action.label, attrs: { type: 'button' },
                    style: { height: '32px', padding: '0 14px', borderRadius: '8px', border: '1px solid transparent', fontSize: '13px', fontWeight: '600', cursor: 'pointer', transition: TRANSITION, fontFamily: 'inherit' }
                });
                bindInteraction(button, (state) => button.setStyles(variantStyles(action.variant || 'soft', action.tone || tone, state)));
                button.addEventListener('click', () => {
                    this.dispatchEvent({ type: 'action', target: this, action: action.label, index });
                    if (action.variant !== 'solid' || action.close) this.close();
                });
                foot.appendChild(button);
            });
            this.panel.appendChild(foot);
        }
        this.appendChild(this.panel);
        this.place();
    }

    place() {
        const hidden = { right: 'translateX(105%)', left: 'translateX(-105%)', bottom: 'translateY(105%)', top: 'translateY(-105%)' }[this.options.placement] || 'translateX(105%)';
        this.panel.setStyles({ transform: this.isOpen ? 'none' : hidden, visibility: this.isOpen ? 'visible' : 'hidden' });
        this.backdrop.setStyles({
            opacity: this.isOpen && this.options.backdrop !== false ? '1' : '0',
            pointerEvents: this.isOpen && this.options.backdrop !== false ? 'auto' : 'none',
            visibility: this.isOpen && this.options.backdrop !== false ? 'visible' : 'hidden'
        });
        this.opener.setAttribute('aria-expanded', this.isOpen ? 'true' : 'false');
    }

    open() {
        if (this.isOpen) return;
        this.isOpen = true;
        this.place();
        this.dispatchEvent({ type: 'open', target: this });
    }

    close() {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.place();
        this.dispatchEvent({ type: 'close', target: this });
    }

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    }

    destroy() {
        if (typeof document !== 'undefined') document.removeEventListener('keydown', this._onKey);
        super.destroy();
    }
}
