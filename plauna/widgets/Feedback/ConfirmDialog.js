// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * ConfirmDialog - asks before a consequential action (an alert dialog).
 * A toned icon, title, message, Cancel and Confirm; destructive actions can
 * require typing a word before Confirm enables. Enter confirms, Escape
 * cancels. `contained` keeps it inside its own frame. Fires 'confirm' and
 * 'cancel'.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, tone, variantStyles, bindInteraction, TONES, TRANSITION } from '../shared/appearance.js';

let _confirmSequence = 0;

function _newConfirmId() {
    return `confirm-dialog-${Date.now()}-${++_confirmSequence}`;
}

const TONE_ICONS = { danger: 'alert', warning: 'alert', success: 'checkCircle', info: 'info', primary: 'info', accent: 'zap', neutral: 'info' };

export class ConfirmDialog extends UINode {
    static id = 'confirm-dialog';
    static name = 'Confirm Dialog';
    static category = 'feedback';
    static icon = '❓';
    static description = 'Asks before a consequential action';
    static tags = ['feedback', 'confirm', 'alert dialog', 'popconfirm', 'modal', 'destructive'];
    static dependencies = [];
    static optionValues = { tone: TONES, layout: ['center', 'left'], open: 'boolean', contained: 'boolean' };

    static getDefaultOptions() {
        return {
            title: 'Delete this scene?', message: 'The scene, its lights and its baked lighting will be removed. This cannot be undone.',
            confirmLabel: 'Delete scene', cancelLabel: 'Cancel', tone: 'danger', requireText: '', layout: 'center', open: true, contained: true, height: 300
        };
    }

    static stories() {
        return {
            'Destructive': {},
            'Type to confirm': { title: 'Delete the realm?', message: 'All 6 shards and their saves go with it. Type the realm name to confirm.', requireText: 'Aurora', confirmLabel: 'Delete realm', height: 340 },
            'Publish, left': { title: 'Publish to everyone?', message: 'Players will see the new lobby the next time they join.', confirmLabel: 'Publish', tone: 'primary', layout: 'left' },
            'Closed': { open: false }
        };
    }

    static create(container, options = {}) {
        const instance = new ConfirmDialog(_newConfirmId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newConfirmId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...ConfirmDialog.getDefaultOptions(), ...options };
        this.isOpen = Boolean(this.options.open);
        this.typed = '';
        this._onKey = (event) => {
            if (!this.isOpen) return;
            if (event.key === 'Escape') this.cancel();
            // Enter confirms from inside the dialog only (buttons keep their own Enter), never from another field on the page
            else if (event.key === 'Enter' && this.canConfirm() && event.target?.tagName !== 'BUTTON' && this.panel?.element?.contains(event.target)) this.confirm();
        };
        if (typeof document !== 'undefined') document.addEventListener('keydown', this._onKey);
        this.build();
    }

    canConfirm() {
        return !this.options.requireText || this.typed === this.options.requireText;
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { contained, height, title, message, confirmLabel, cancelLabel, requireText, layout } = this.options;
        const c = tone(this.options.tone);
        const center = layout === 'center';
        this.setStyles(contained ? {
            position: 'relative', width: '100%', minWidth: '280px', height: `${height}px`, overflow: 'hidden', borderRadius: '14px',
            border: '1px solid var(--border-light, #2a2a3a)', backgroundColor: 'var(--surface-sunken, #0a0a0f)'
        } : { position: 'relative' });
        this.opener = el(this, 'open', 'button', {
            text: confirmLabel, attrs: { type: 'button' },
            style: { position: contained ? 'absolute' : 'static', left: '16px', top: '16px', height: '32px', padding: '0 12px', borderRadius: '8px', border: '1px solid transparent', fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit', transition: TRANSITION }
        });
        bindInteraction(this.opener, (state) => this.opener.setStyles(variantStyles('soft', c.name, state)));
        this.opener.addEventListener('click', () => this.open());
        this.appendChild(this.opener);
        this.backdrop = el(this, 'backdrop', 'div', {
            attrs: { 'aria-hidden': 'true' },
            style: { position: contained ? 'absolute' : 'fixed', top: '0', right: '0', bottom: '0', left: '0', zIndex: '300', backgroundColor: 'rgba(3, 6, 12, 0.6)', transition: 'opacity var(--duration-base, 200ms) ease' }
        });
        this.appendChild(this.backdrop);
        const body = el(this, 'body', 'div', {
            style: { display: 'flex', flexDirection: center ? 'column' : 'row', alignItems: center ? 'center' : 'flex-start', gap: center ? '10px' : '14px', textAlign: center ? 'center' : 'left' },
            children: [
                el(this, 'icon-wrap', 'span', {
                    attrs: { 'aria-hidden': 'true' },
                    style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '44px', height: '44px', flex: '0 0 auto', borderRadius: '50%', backgroundColor: c.soft, color: c.base, boxShadow: `0 0 0 6px ${c.soft}` },
                    children: [icon(this, 'icon', ICONS[TONE_ICONS[c.name]] || ICONS.info, 22)]
                }),
                el(this, 'text', 'div', {
                    style: { display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '0' },
                    children: [
                        el(this, 'title', 'h3', { text: title, style: { margin: '0', fontSize: '16px', fontWeight: '650', color: 'var(--text-primary, #e4e4e7)' } }),
                        el(this, 'message', 'p', { text: message, style: { margin: '0', fontSize: '13px', lineHeight: '1.55', color: 'var(--text-secondary, #d1d5db)' } })
                    ]
                })
            ]
        });
        const panelChildren = [body];
        if (requireText) {
            this.field = el(this, 'confirm-text', 'input', {
                label: `Type ${requireText} to confirm`, data: { type: 'text', placeholder: requireText, value: '' }, attrs: { autocomplete: 'off', spellcheck: 'false' },
                style: { width: '100%', height: '36px', boxSizing: 'border-box', padding: '0 10px', borderRadius: '8px', border: '1px solid var(--border-medium, #3a3a4a)', backgroundColor: 'var(--bg-tertiary, #171723)', color: 'var(--text-primary, #e4e4e7)', fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: '13px', outline: 'none' }
            });
            this.field.addEventListener('input', (event) => { this.typed = event?.domTarget?.value ?? ''; this.paintButtons(); });
            panelChildren.push(this.field);
        } else {
            this.field = null;
        }
        const buttonStyle = { height: '36px', padding: '0 16px', borderRadius: '9px', border: '1px solid transparent', fontSize: '13px', fontWeight: '650', cursor: 'pointer', fontFamily: 'inherit', transition: TRANSITION, flex: center ? '1' : '0 0 auto' };
        this.cancelButton = el(this, 'cancel', 'button', { text: cancelLabel, attrs: { type: 'button' }, style: buttonStyle });
        bindInteraction(this.cancelButton, (state) => this.cancelButton.setStyles({ ...variantStyles('soft', 'neutral', state), color: 'var(--text-primary, #e4e4e7)' }));
        this.cancelButton.addEventListener('click', () => this.cancel());
        this.confirmButton = el(this, 'confirm', 'button', { text: confirmLabel, attrs: { type: 'button' }, style: buttonStyle });
        this._paintConfirm = bindInteraction(this.confirmButton, (state) => this.confirmButton.setStyles(variantStyles('solid', c.name, state, { disabled: !this.canConfirm() })), { isDisabled: () => !this.canConfirm() });
        this.confirmButton.addEventListener('click', () => { if (this.canConfirm()) this.confirm(); });
        panelChildren.push(el(this, 'actions', 'div', {
            style: { display: 'flex', gap: '8px', justifyContent: center ? 'stretch' : 'flex-end', width: '100%' },
            children: [this.cancelButton, this.confirmButton]
        }));
        this.panel = el(this, 'panel', 'div', {
            role: 'alertdialog', attrs: { 'aria-modal': 'true', 'aria-labelledby': `${this.id}-title`, 'aria-describedby': `${this.id}-message` },
            style: {
                position: contained ? 'absolute' : 'fixed', left: '50%', top: '50%', zIndex: '301', width: '360px', maxWidth: 'calc(100% - 32px)', boxSizing: 'border-box',
                display: 'flex', flexDirection: 'column', gap: '16px', padding: '20px', borderRadius: '16px',
                backgroundColor: 'var(--surface-overlay, #0f0f17)', border: '1px solid var(--border-medium, #3a3a4a)',
                boxShadow: `var(--shadow-xl, 0 20px 25px -5px rgba(0,0,0,0.4)), 0 0 0 1px ${c.subtleBorder}`,
                transition: 'opacity var(--duration-base, 200ms) ease, transform var(--duration-base, 200ms) var(--ease-out, ease)'
            },
            children: panelChildren
        });
        this.appendChild(this.panel);
        this.paint();
    }

    paintButtons() {
        this._paintConfirm?.();
        this.confirmButton.userData.disabled = !this.canConfirm();
        this.confirmButton.setStyles({ cursor: this.canConfirm() ? 'pointer' : 'not-allowed' });
    }

    paint() {
        this.panel.setStyles({ opacity: this.isOpen ? '1' : '0', visibility: this.isOpen ? 'visible' : 'hidden', transform: `translate(-50%, -50%) scale(${this.isOpen ? 1 : 0.96})` });
        this.backdrop.setStyles({ opacity: this.isOpen ? '1' : '0', visibility: this.isOpen ? 'visible' : 'hidden' });
        this.paintButtons();
    }

    open() {
        this.isOpen = true;
        this.typed = '';
        if (this.field) {
            this.field.userData.value = '';
            if (this.field.element) this.field.element.value = '';
        }
        this.paint();
        (this.field || this.cancelButton).focus?.();
    }

    close() {
        this.isOpen = false;
        this.paint();
        this.opener?.focus?.();
    }

    confirm() {
        this.dispatchEvent({ type: 'confirm', target: this });
        this.close();
    }

    cancel() {
        this.dispatchEvent({ type: 'cancel', target: this });
        this.close();
    }

    destroy() {
        if (typeof document !== 'undefined') document.removeEventListener('keydown', this._onKey);
        super.destroy();
    }
}
