// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Toggle - a two-state button (aria-pressed) with an icon and/or label,
 * for on/off actions like Bold, Mute or Favourite. Fires 'change'.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, tone, variantStyles, bindInteraction, sizeScale, TONES, SIZES, TRANSITION } from '../shared/appearance.js';

let _toggleSequence = 0;

function _newToggleId() {
    return `toggle-${Date.now()}-${++_toggleSequence}`;
}

export class Toggle extends UINode {
    static id = 'toggle';
    static name = 'Toggle';
    static category = 'input';
    static icon = '🔛';
    static description = 'Two-state button with icon and label';
    static tags = ['input', 'toggle', 'pressed', 'button', 'on off'];
    static emits = ['change'];
    static dependencies = [];
    static optionValues = { icon: Object.keys(ICONS), variant: ['soft', 'solid', 'outline'], tone: TONES, size: SIZES, pressed: 'boolean', disabled: 'boolean' };

    static getDefaultOptions() {
        return { label: 'Favourite', icon: 'star', pressed: false, variant: 'soft', tone: 'warning', size: 'md', disabled: false, iconOnly: false };
    }

    static stories() {
        return {
            'Favourite': { label: 'Favourite', icon: 'star', pressed: true },
            'Notifications off': { label: 'Notify me', icon: 'bell', pressed: false, tone: 'primary' },
            'Solid pressed': { label: 'Live', icon: 'zap', pressed: true, variant: 'solid', tone: 'danger' },
            'Icon only': { label: 'Bold', icon: 'bold', iconOnly: true, pressed: true, variant: 'outline', tone: 'neutral', size: 'sm' }
        };
    }

    static create(container, options = {}) {
        const instance = new Toggle(_newToggleId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newToggleId(), options = {}) {
        super(id, 'button');
        this.tag = 'button';
        this.options = { ...Toggle.getDefaultOptions(), ...options };
        this.pressed = Boolean(this.options.pressed);
        this.setAttribute('type', 'button');
        this._paint = bindInteraction(this, (state) => this.paintState(state), { isDisabled: () => this.options.disabled });
        this.addEventListener('click', () => { if (!this.options.disabled) this.setPressed(!this.pressed, true); });
        this.build();
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { size, label, iconOnly, disabled } = this.options;
        const scale = sizeScale(size);
        this.ariaLabel = iconOnly ? label : null;
        this.userData.disabled = Boolean(disabled);
        this.setStyles({
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: `${scale.gap - 2}px`,
            height: `${scale.height}px`, minWidth: `${scale.height}px`, padding: iconOnly ? '0' : `0 ${scale.padX}px`, boxSizing: 'border-box',
            borderRadius: `${scale.radius}px`, borderWidth: '1px', borderStyle: 'solid', fontFamily: 'inherit', fontSize: `${scale.fontSize}px`, fontWeight: '600',
            cursor: disabled ? 'not-allowed' : 'pointer', transition: TRANSITION
        });
        if (ICONS[this.options.icon]) this.glyph = this.appendChild(icon(this, 'icon', ICONS[this.options.icon], scale.icon));
        if (!iconOnly) this.appendChild(el(this, 'label', 'span', { text: label }));
        this._paint?.();
    }

    paintState(state) {
        const c = tone(this.options.tone);
        this.setAttribute('aria-pressed', this.pressed ? 'true' : 'false');
        if (this.options.disabled) {
            this.setStyles({ ...variantStyles('ghost', 'neutral', 'rest', { disabled: true }) });
            return;
        }
        if (this.pressed) {
            this.setStyles(variantStyles(this.options.variant, this.options.tone, state));
            // A filled star or bell reads as "on"
            this.glyph?.setStyles({ fill: this.options.variant === 'solid' ? 'currentColor' : c.base });
        } else {
            this.setStyles({ ...variantStyles('ghost', 'neutral', state), borderColor: state === 'rest' ? 'var(--border-medium, #3a3a4a)' : 'var(--border-dark, #4a4a5a)', color: 'var(--text-secondary, #d1d5db)' });
            this.glyph?.setStyles({ fill: 'none' });
        }
    }

    setPressed(pressed, fromUser = false) {
        this.pressed = Boolean(pressed);
        this._paint?.();
        if (fromUser) this.dispatchEvent({ type: 'change', target: this, pressed: this.pressed });
    }
}
