// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Popover - a floating panel anchored to a trigger, with a title, content,
 * actions and an arrow. Opens on click or hover, closes on Escape, on a
 * click outside or from its close button.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, variantStyles, bindInteraction, sizeScale, TONES, TRANSITION, mix } from '../shared/appearance.js';

let _popoverSequence = 0;

function _newPopoverId() {
    return `popover-${Date.now()}-${++_popoverSequence}`;
}

const GAP = 10;

export class Popover extends UINode {
    static id = 'popover';
    static name = 'Popover';
    static category = 'primitive';
    static icon = '💬';
    static description = 'Floating panel anchored to a trigger';
    static tags = ['primitive', 'popover', 'overlay', 'floating', 'popup'];
    static dependencies = [];
    static optionValues = {
        placement: ['bottom', 'top', 'right', 'left'], align: ['start', 'center', 'end'],
        trigger: ['click', 'hover'], tone: TONES, width: ['sm', 'md', 'lg'], open: 'boolean', arrow: 'boolean', closeButton: 'boolean'
    };

    static getDefaultOptions() {
        return {
            label: 'Open popover', title: 'Popover', content: '', placement: 'bottom', align: 'center',
            trigger: 'click', tone: 'primary', width: 'md', open: false, arrow: true, closeButton: true, actions: []
        };
    }

    static stories() {
        return {
            'Open below': {
                label: 'Share', title: 'Share this scene', open: true, placement: 'bottom', align: 'start',
                content: 'Anyone with the link can view. Editors can change lights, materials and cameras.',
                actions: [{ label: 'Copy link', variant: 'solid' }, { label: 'Settings', variant: 'ghost' }]
            },
            'Right, no arrow': { label: 'Details', title: 'Render pass', open: true, placement: 'right', arrow: false, width: 'sm', content: '1,240 draw calls · 3.1 ms on the GPU this frame.' },
            'Hover': { label: 'Hover me', title: 'Tip', trigger: 'hover', placement: 'top', tone: 'accent', closeButton: false, content: 'Shift + drag pans the viewport.' },
            'Closed': { label: 'Filters', title: 'Filters', content: 'Choose what the list shows.', tone: 'neutral' }
        };
    }

    static create(container, options = {}) {
        const instance = new Popover(_newPopoverId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newPopoverId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...Popover.getDefaultOptions(), ...options };
        this.isOpen = Boolean(this.options.open);
        this._onDocumentDown = (event) => {
            if (!this.isOpen || !this.element) return;
            if (!this.element.contains(event.target)) this.close();
        };
        this._onDocumentKey = (event) => {
            if (this.isOpen && event.key === 'Escape') {
                this.close();
                this.trigger?.focus?.();
            }
        };
        if (typeof document !== 'undefined') {
            document.addEventListener('mousedown', this._onDocumentDown, true);
            document.addEventListener('keydown', this._onDocumentKey);
        }
        this.build();
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { label, title, content, tone, trigger, width, arrow, closeButton } = this.options;
        const scale = sizeScale('md');
        this.setStyles({ position: 'relative', display: 'inline-block' });

        this.trigger = el(this, 'trigger', 'button', {
            text: label, attrs: { type: 'button', 'aria-haspopup': 'dialog', 'aria-controls': `${this.id}-panel` },
            style: {
                display: 'inline-flex', alignItems: 'center', gap: '8px', height: `${scale.height}px`, padding: `0 ${scale.padX}px`,
                borderRadius: `${scale.radius}px`, border: '1px solid transparent', fontSize: `${scale.fontSize}px`, fontWeight: '600',
                cursor: 'pointer', transition: TRANSITION, fontFamily: 'inherit'
            }
        });
        this._paintTrigger = bindInteraction(this.trigger, (state) => this.trigger.setStyles(variantStyles(this.isOpen ? 'solid' : 'soft', tone, state)));
        if (trigger === 'hover') {
            this.addEventListener('mouseenter', () => this.open());
            this.addEventListener('mouseleave', () => this.close());
            this.trigger.addEventListener('focus', () => this.open());
            this.trigger.addEventListener('blur', () => this.close());
        } else {
            this.trigger.addEventListener('click', () => this.toggle());
        }
        this.appendChild(this.trigger);

        const panelWidth = { sm: 220, md: 280, lg: 340 }[width] || 280;
        this.panel = el(this, 'panel', 'div', {
            role: 'dialog', attrs: { 'aria-labelledby': `${this.id}-title` },
            style: {
                position: 'absolute', zIndex: '100', width: `${panelWidth}px`, boxSizing: 'border-box',
                padding: '14px 16px', borderRadius: '12px', textAlign: 'left',
                backgroundColor: 'var(--surface-overlay, #0f0f17)', color: 'var(--text-primary, #e4e4e7)',
                border: '1px solid var(--border-medium, #3a3a4a)',
                boxShadow: `var(--shadow-xl, 0 20px 25px -5px rgba(0,0,0,0.4)), 0 0 0 1px ${mix('var(--color-primary, #0ea5e9)', 6)}`,
                transition: 'opacity var(--duration-base, 200ms) var(--ease-out, ease), transform var(--duration-base, 200ms) var(--ease-out, ease)'
            }
        });
        if (arrow) {
            this.arrowNode = el(this, 'arrow', 'span', {
                attrs: { 'aria-hidden': 'true' },
                style: {
                    position: 'absolute', width: '12px', height: '12px', backgroundColor: 'var(--surface-overlay, #0f0f17)',
                    border: '1px solid var(--border-medium, #3a3a4a)', transform: 'rotate(45deg)'
                }
            });
            this.panel.appendChild(this.arrowNode);
        } else {
            this.arrowNode = null;
        }
        const head = el(this, 'head', 'div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: content ? '6px' : '0' } });
        head.appendChild(el(this, 'title', 'div', { text: title, style: { flex: '1', fontWeight: '650', fontSize: '14px' } }));
        if (closeButton) {
            const close = el(this, 'close', 'button', {
                label: 'Close', attrs: { type: 'button' },
                style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '24px', height: '24px', padding: '0', borderRadius: '6px', border: '1px solid transparent', cursor: 'pointer', transition: TRANSITION },
                children: [icon(this, 'close-icon', ICONS.x, 14)]
            });
            bindInteraction(close, (state) => close.setStyles(variantStyles('ghost', 'neutral', state)));
            close.addEventListener('click', () => { this.close(); this.trigger?.focus?.(); });
            head.appendChild(close);
        }
        this.panel.appendChild(head);
        if (content) {
            this.panel.appendChild(el(this, 'content', 'div', { text: content, style: { fontSize: '13px', lineHeight: '1.55', color: 'var(--text-secondary, #d1d5db)' } }));
        }
        const actions = Array.isArray(this.options.actions) ? this.options.actions : [];
        if (actions.length) {
            const row = el(this, 'actions', 'div', { style: { display: 'flex', gap: '8px', marginTop: '12px', justifyContent: 'flex-end' } });
            actions.forEach((action, index) => {
                const button = el(this, `action-${index}`, 'button', {
                    text: action.label, attrs: { type: 'button' },
                    style: { height: '30px', padding: '0 12px', borderRadius: '7px', border: '1px solid transparent', fontSize: '13px', fontWeight: '600', cursor: 'pointer', transition: TRANSITION, fontFamily: 'inherit' }
                });
                bindInteraction(button, (state) => button.setStyles(variantStyles(action.variant || 'soft', action.tone || tone, state)));
                button.addEventListener('click', () => this.dispatchEvent({ type: 'action', target: this, action: action.label, index }));
                row.appendChild(button);
            });
            this.panel.appendChild(row);
        }
        this.appendChild(this.panel);
        this.place();
    }

    /** Position the panel and arrow for the placement and alignment. */
    place() {
        const { placement, align } = this.options;
        const p = this.panel;
        const vertical = placement === 'top' || placement === 'bottom';
        const reset = { top: 'auto', bottom: 'auto', left: 'auto', right: 'auto' };
        const along = vertical
            ? (align === 'start' ? { left: '0' } : align === 'end' ? { right: '0' } : { left: '50%' })
            : (align === 'start' ? { top: '0' } : align === 'end' ? { bottom: '0' } : { top: '50%' });
        const centerShift = align === 'center' || !align ? (vertical ? 'translateX(-50%)' : 'translateY(-50%)') : '';
        const away = { bottom: { top: `calc(100% + ${GAP}px)` }, top: { bottom: `calc(100% + ${GAP}px)` }, right: { left: `calc(100% + ${GAP}px)` }, left: { right: `calc(100% + ${GAP}px)` } }[placement] || { top: `calc(100% + ${GAP}px)` };
        const slide = { bottom: 'translateY(-4px)', top: 'translateY(4px)', right: 'translateX(-4px)', left: 'translateX(4px)' }[placement] || '';
        p.setStyles({
            ...reset, ...along, ...away,
            opacity: this.isOpen ? '1' : '0',
            visibility: this.isOpen ? 'visible' : 'hidden',
            pointerEvents: this.isOpen ? 'auto' : 'none',
            transform: `${centerShift} ${this.isOpen ? '' : slide}`.trim() || 'none'
        });
        if (this.arrowNode) {
            const a = this.arrowNode;
            const edge = { bottom: { top: '-7px', borderRightColor: 'transparent', borderBottomColor: 'transparent' }, top: { bottom: '-7px', borderLeftColor: 'transparent', borderTopColor: 'transparent' }, right: { left: '-7px', borderTopColor: 'transparent', borderRightColor: 'transparent' }, left: { right: '-7px', borderBottomColor: 'transparent', borderLeftColor: 'transparent' } }[placement];
            const anchor = vertical
                ? (align === 'start' ? { left: '18px' } : align === 'end' ? { right: '18px' } : { left: 'calc(50% - 6px)' })
                : (align === 'start' ? { top: '14px' } : align === 'end' ? { bottom: '14px' } : { top: 'calc(50% - 6px)' });
            a.setStyles({ ...reset, borderColor: 'var(--border-medium, #3a3a4a)', ...edge, ...anchor });
        }
        this.trigger?.setAttribute('aria-expanded', this.isOpen ? 'true' : 'false');
        this._paintTrigger?.();
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

    setPlacement(placement) {
        this.options.placement = placement;
        this.place();
    }

    destroy() {
        if (typeof document !== 'undefined') {
            document.removeEventListener('mousedown', this._onDocumentDown, true);
            document.removeEventListener('keydown', this._onDocumentKey);
        }
        super.destroy();
    }
}
