// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Result - the outcome of a whole task or page: success, error, warning,
 * info, not found (404) or forbidden (403). A large emblem with soft rings,
 * a title, a subtitle, actions and optional details.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, tone, variantStyles, bindInteraction, TRANSITION } from '../shared/appearance.js';

let _resultSequence = 0;

function _newResultId() {
    return `result-${Date.now()}-${++_resultSequence}`;
}

const STATUSES = {
    success: { tone: 'success', icon: 'checkCircle', title: 'Build published', subtitle: 'Version 0.8.0 is live on all six realm shards.' },
    error: { tone: 'danger', icon: 'xCircle', title: 'Upload failed', subtitle: 'The connection dropped at 63%. Your file is still on this device.' },
    warning: { tone: 'warning', icon: 'alert', title: 'Partly imported', subtitle: '12 of 14 meshes imported; 2 had invalid normals.' },
    info: { tone: 'info', icon: 'info', title: 'Maintenance tonight', subtitle: 'Saving is paused from 02:00 to 02:15 UTC.' },
    404: { tone: 'neutral', code: '404', title: 'Page not found', subtitle: 'The scene you’re looking for was moved or never existed.' },
    403: { tone: 'warning', code: '403', title: 'No access', subtitle: 'Ask a realm owner to invite you as an editor.' }
};

export class Result extends UINode {
    static id = 'result';
    static name = 'Result';
    static category = 'feedback';
    static icon = '🏁';
    static description = 'Outcome page for success, errors and empty states';
    static tags = ['feedback', 'result', 'status', 'success', 'error', '404', 'outcome'];
    static dependencies = [];
    static optionValues = { status: ['success', 'error', 'warning', 'info', '404', '403'], size: ['sm', 'md'] };

    static getDefaultOptions() {
        return { status: 'success', title: '', subtitle: '', actions: [{ label: 'View build', variant: 'solid' }, { label: 'Back to dashboard', variant: 'soft' }], details: '', size: 'md' };
    }

    static stories() {
        return {
            'Success': { status: 'success' },
            'Error with details': { status: 'error', actions: [{ label: 'Try again', variant: 'solid' }, { label: 'Cancel', variant: 'ghost' }], details: 'ERR_CONNECTION_RESET · request 7f2c-91aa · 22:14:06 UTC' },
            'Not found': { status: '404', actions: [{ label: 'Go home', variant: 'solid' }] },
            'Forbidden, small': { status: '403', size: 'sm', actions: [{ label: 'Request access', variant: 'soft' }] }
        };
    }

    static create(container, options = {}) {
        const instance = new Result(_newResultId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newResultId(), options = {}) {
        super(id, 'section');
        this.tag = 'section';
        this.options = { ...Result.getDefaultOptions(), ...options };
        this.build();
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const status = STATUSES[this.options.status] || STATUSES.success;
        const c = tone(status.tone);
        const small = this.options.size === 'sm';
        const emblem = small ? 64 : 88;
        this.role = this.options.status === 'error' ? 'alert' : 'status';
        this.setStyles({ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: small ? '10px' : '14px', padding: small ? '12px' : '24px 16px', maxWidth: '460px', margin: '0 auto' });
        const mark = status.code
            ? el(this, 'code', 'span', { text: status.code, style: { fontSize: `${Math.round(emblem * 0.34)}px`, fontWeight: '800', letterSpacing: '-0.03em' } })
            : icon(this, 'icon', ICONS[status.icon], Math.round(emblem * 0.46), { strokeWidth: 1.8 });
        this.appendChild(el(this, 'emblem', 'div', {
            attrs: { 'aria-hidden': 'true' },
            style: {
                display: 'flex', alignItems: 'center', justifyContent: 'center', width: `${emblem}px`, height: `${emblem}px`, borderRadius: '50%',
                color: c.base, backgroundColor: c.soft, boxShadow: `0 0 0 ${Math.round(emblem * 0.12)}px ${c.soft}, 0 0 0 ${Math.round(emblem * 0.26)}px color-mix(in srgb, ${c.base} 6%, transparent), 0 12px 40px -12px ${c.glow}`,
                marginBottom: `${Math.round(emblem * 0.2)}px`, marginTop: `${Math.round(emblem * 0.2)}px`
            },
            children: [mark]
        }));
        this.appendChild(el(this, 'title', 'h2', { text: this.options.title || status.title, style: { margin: '0', fontSize: small ? '17px' : '21px', fontWeight: '700', letterSpacing: '-0.01em', color: 'var(--text-primary, #e4e4e7)' } }));
        this.appendChild(el(this, 'subtitle', 'p', { text: this.options.subtitle || status.subtitle, style: { margin: '0', fontSize: small ? '13px' : '14px', lineHeight: '1.55', color: 'var(--text-secondary, #d1d5db)' } }));
        const actions = Array.isArray(this.options.actions) ? this.options.actions : [];
        if (actions.length) {
            const row = el(this, 'actions', 'div', { style: { display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px', marginTop: '6px' } });
            actions.forEach((action, index) => {
                const button = el(this, `action-${index}`, 'button', {
                    text: action.label, attrs: { type: 'button' },
                    style: { height: '36px', padding: '0 16px', borderRadius: '9px', border: '1px solid transparent', fontSize: '13px', fontWeight: '650', cursor: 'pointer', fontFamily: 'inherit', transition: TRANSITION }
                });
                bindInteraction(button, (state) => button.setStyles(variantStyles(action.variant || 'soft', action.tone || (action.variant === 'solid' ? (status.tone === 'neutral' ? 'primary' : status.tone) : 'neutral'), state)));
                button.addEventListener('click', () => this.dispatchEvent({ type: 'action', target: this, action: action.label, index }));
                row.appendChild(button);
            });
            this.appendChild(row);
        }
        if (this.options.details) {
            this.appendChild(el(this, 'details', 'div', {
                text: this.options.details,
                style: { marginTop: '6px', padding: '8px 12px', borderRadius: '8px', fontSize: '12px', fontFamily: 'var(--font-mono, ui-monospace, monospace)', color: 'var(--text-tertiary, #9ca3af)', backgroundColor: 'var(--bg-tertiary, #171723)', border: '1px solid var(--border-light, #2a2a3a)' }
            }));
        }
    }

    setStatus(status) {
        this.options.status = status;
        this.build();
    }
}
