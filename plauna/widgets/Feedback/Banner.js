// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Banner - a full-width announcement with an icon, title, message, actions
 * and a dismiss button, in soft, solid, outline, accent-bar or gradient
 * styles for any tone.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, tone, variantStyles, bindInteraction, TONES, TRANSITION, mix } from '../shared/appearance.js';

let _bannerSequence = 0;

function _newBannerId() {
    return `banner-${Date.now()}-${++_bannerSequence}`;
}

const TONE_ICONS = { success: 'checkCircle', warning: 'alert', danger: 'xCircle', info: 'info', primary: 'bell', accent: 'zap', neutral: 'info' };

export class Banner extends UINode {
    static id = 'banner';
    static name = 'Banner';
    static category = 'feedback';
    static icon = '📣';
    static description = 'Full-width announcement with actions';
    static tags = ['feedback', 'banner', 'announcement', 'callout', 'notice'];
    static dependencies = [];
    static optionValues = { tone: TONES, variant: ['soft', 'solid', 'outline', 'accent', 'gradient'], layout: ['inline', 'stacked'], dismissible: 'boolean', showIcon: 'boolean' };

    static getDefaultOptions() {
        return { title: '', message: '', tone: 'info', variant: 'soft', layout: 'inline', dismissible: true, showIcon: true, actions: [] };
    }

    static stories() {
        return {
            'Update available': { tone: 'primary', variant: 'gradient', title: 'Plauna 0.3 is here', message: 'GPU mode now matches the DOM pixel for pixel.', actions: [{ label: 'See what’s new' }] },
            'Soft info': { tone: 'info', title: 'Scheduled maintenance', message: 'The realm servers restart Sunday at 02:00 UTC for about ten minutes.' },
            'Accent bar warning': { tone: 'warning', variant: 'accent', title: 'Unsaved changes', message: 'Three materials changed since the last save.', actions: [{ label: 'Save now', variant: 'solid' }, { label: 'Discard', variant: 'ghost' }] },
            'Solid success': { tone: 'success', variant: 'solid', message: 'Build finished in 4.2 s · all 328 checks passed.', dismissible: false },
            'Stacked danger': { tone: 'danger', variant: 'outline', layout: 'stacked', title: 'Device lost', message: 'The GPU device was lost. Plauna switched to DOM rendering and will retry.', actions: [{ label: 'Retry now', variant: 'solid' }] }
        };
    }

    static create(container, options = {}) {
        const instance = new Banner(_newBannerId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newBannerId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...Banner.getDefaultOptions(), ...options };
        this.build();
    }

    frame(c) {
        switch (this.options.variant) {
            case 'solid': return { backgroundColor: c.base, backgroundImage: 'none', color: c.on, border: '1px solid transparent', boxShadow: `0 8px 24px -10px ${c.glow}` };
            case 'outline': return { backgroundColor: 'var(--surface-card, #0f0f17)', backgroundImage: 'none', color: 'var(--text-primary, #e4e4e7)', border: `1px solid ${c.border}`, boxShadow: 'none' };
            case 'accent': return { backgroundColor: 'var(--surface-card, #0f0f17)', backgroundImage: 'none', color: 'var(--text-primary, #e4e4e7)', border: '1px solid var(--border-light, #2a2a3a)', boxShadow: `inset 4px 0 0 ${c.base}` };
            case 'gradient': return {
                backgroundColor: 'var(--surface-card, #0f0f17)',
                backgroundImage: `linear-gradient(110deg, ${mix(c.base, 26)}, ${mix('var(--color-accent, #8b5cf6)', 18)} 55%, ${mix(c.base, 6)})`,
                color: 'var(--text-primary, #e4e4e7)', border: `1px solid ${c.subtleBorder}`, boxShadow: 'none'
            };
            case 'soft':
            default: return { backgroundColor: c.soft, backgroundImage: 'none', color: 'var(--text-primary, #e4e4e7)', border: `1px solid ${c.subtleBorder}`, boxShadow: 'none' };
        }
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { title, message, layout, dismissible, showIcon, variant } = this.options;
        const c = tone(this.options.tone);
        const solid = variant === 'solid';
        const stacked = layout === 'stacked';
        this.role = c.name === 'danger' || c.name === 'warning' ? 'alert' : 'status';
        this.setStyles({
            display: 'flex', alignItems: stacked ? 'flex-start' : 'center', gap: '12px', width: '100%', boxSizing: 'border-box',
            padding: stacked ? '16px 16px 16px 18px' : '12px 12px 12px 16px', borderRadius: '12px', transition: TRANSITION, ...this.frame(c)
        });
        if (showIcon) {
            this.appendChild(el(this, 'icon-wrap', 'span', {
                attrs: { 'aria-hidden': 'true' },
                style: {
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto', width: '32px', height: '32px', borderRadius: '9px',
                    backgroundColor: solid ? 'rgba(255, 255, 255, 0.18)' : c.soft, color: solid ? c.on : c.base
                },
                children: [icon(this, 'icon', ICONS[TONE_ICONS[c.name]], 18)]
            }));
        }
        const body = el(this, 'body', 'div', {
            style: { flex: '1', minWidth: '0', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px' }
        });
        if (title) body.appendChild(el(this, 'title', 'strong', { text: title, style: { fontSize: '14px', fontWeight: '650' } }));
        if (message) body.appendChild(el(this, 'message', 'span', { text: message, style: { fontSize: '13px', lineHeight: '1.5', opacity: solid ? '0.92' : '1', color: solid ? 'inherit' : 'var(--text-secondary, #d1d5db)' } }));
        this.appendChild(body);
        const actions = Array.isArray(this.options.actions) ? this.options.actions : [];
        if (actions.length) {
            const row = el(this, 'actions', 'div', { style: { display: 'flex', gap: '8px', marginTop: stacked ? '10px' : '0', marginLeft: stacked ? '0' : 'auto', flexWrap: 'wrap' } });
            actions.forEach((action, index) => {
                const button = el(this, `action-${index}`, 'button', {
                    text: action.label, attrs: { type: 'button' },
                    style: { height: '30px', padding: '0 12px', borderRadius: '8px', border: '1px solid transparent', fontSize: '13px', fontWeight: '600', cursor: 'pointer', transition: TRANSITION, fontFamily: 'inherit', whiteSpace: 'nowrap' }
                });
                const variantName = action.variant || (solid ? 'ghost' : 'soft');
                bindInteraction(button, (state) => {
                    const styles = variantStyles(variantName, action.tone || c.name, state);
                    if (solid) Object.assign(styles, { color: c.on, backgroundColor: state === 'rest' ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.26)', borderColor: 'transparent' });
                    button.setStyles(styles);
                });
                button.addEventListener('click', () => this.dispatchEvent({ type: 'action', target: this, action: action.label, index }));
                row.appendChild(button);
            });
            (stacked ? body : this).appendChild(row);
        }
        if (dismissible) {
            const close = el(this, 'close', 'button', {
                label: 'Dismiss', attrs: { type: 'button' },
                style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto', width: '28px', height: '28px', padding: '0', borderRadius: '7px', border: '1px solid transparent', cursor: 'pointer', transition: TRANSITION },
                children: [icon(this, 'close-icon', ICONS.x, 15)]
            });
            bindInteraction(close, (state) => {
                const styles = variantStyles('ghost', 'neutral', state);
                if (solid) Object.assign(styles, { color: c.on, backgroundColor: state === 'rest' ? 'transparent' : 'rgba(255, 255, 255, 0.2)' });
                close.setStyles(styles);
            });
            close.addEventListener('click', () => this.dismiss());
            this.appendChild(close);
        }
    }

    dismiss() {
        this.setStyles({ display: 'none' });
        this.dispatchEvent({ type: 'dismiss', target: this });
    }

    show() {
        this.setStyles({ display: 'flex' });
    }

    setTone(value) {
        this.options.tone = value;
        this.build();
    }
}
