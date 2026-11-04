// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * IconButton - a square or round button holding one icon, labelled for
 * screen readers, in every tone and variant, with a loading spinner and an
 * optional notification dot.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, variantStyles, bindInteraction, sizeScale, radiusFor, ensureKeyframes, TONES, VARIANTS, SIZES, TRANSITION } from '../shared/appearance.js';

let _iconButtonSequence = 0;

function _newIconButtonId() {
    return `icon-button-${Date.now()}-${++_iconButtonSequence}`;
}

export class IconButton extends UINode {
    static id = 'icon-button';
    static name = 'Icon Button';
    static category = 'primitive';
    static icon = '🔲';
    static description = 'Square or round button with one icon';
    static tags = ['primitive', 'icon button', 'action icon', 'button', 'toolbar'];
    static dependencies = [];
    static optionValues = {
        icon: Object.keys(ICONS), variant: VARIANTS, tone: TONES, size: SIZES, shape: ['rounded', 'circle', 'square'],
        loading: 'boolean', disabled: 'boolean', dot: 'boolean'
    };

    static getDefaultOptions() {
        return { icon: 'settings', label: 'Settings', variant: 'soft', tone: 'neutral', size: 'md', shape: 'rounded', loading: false, disabled: false, dot: false };
    }

    static stories() {
        return {
            'Soft': { icon: 'settings', label: 'Settings' },
            'Solid circle': { icon: 'plus', label: 'Add', variant: 'solid', tone: 'primary', shape: 'circle', size: 'lg' },
            'Notifications': { icon: 'bell', label: 'Notifications', variant: 'ghost', dot: true },
            'Gradient': { icon: 'zap', label: 'Boost', variant: 'gradient', tone: 'accent', shape: 'circle', size: 'xl' },
            'Loading': { icon: 'copy', label: 'Copying', variant: 'outline', tone: 'info', loading: true }
        };
    }

    static create(container, options = {}) {
        const instance = new IconButton(_newIconButtonId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newIconButtonId(), options = {}) {
        super(id, 'button');
        this.tag = 'button';
        this.options = { ...IconButton.getDefaultOptions(), ...options };
        this.setAttribute('type', 'button');
        this._paint = bindInteraction(this, (state) => this.setStyles(variantStyles(this.options.variant, this.options.tone, this.options.loading ? 'rest' : state, { disabled: this.options.disabled })), {
            isDisabled: () => this.options.disabled || this.options.loading
        });
        this.addEventListener('click', (event) => {
            if (this.options.disabled || this.options.loading) {
                event.preventDefault?.();
                return;
            }
            this.dispatchEvent({ type: 'action', target: this, icon: this.options.icon });
        });
        this.build();
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { size, shape, label, loading, disabled, dot } = this.options;
        const scale = sizeScale(size);
        this.ariaLabel = label;
        this.setAttribute('title', label);
        this.setAttribute('aria-busy', loading ? 'true' : 'false');
        this.userData.disabled = Boolean(disabled);
        this.setStyles({
            position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto',
            width: `${scale.height}px`, height: `${scale.height}px`, padding: '0', boxSizing: 'border-box',
            borderRadius: radiusFor(shape === 'circle' ? 'pill' : shape, size), borderWidth: '1px', borderStyle: 'solid',
            cursor: disabled ? 'not-allowed' : loading ? 'progress' : 'pointer', transition: TRANSITION, fontFamily: 'inherit'
        });
        if (loading) {
            ensureKeyframes('plauna-spin', 'from { transform: rotate(0deg); } to { transform: rotate(360deg); }');
            this.appendChild(el(this, 'spinner', 'span', {
                attrs: { 'aria-hidden': 'true' },
                style: {
                    width: `${scale.icon - 2}px`, height: `${scale.icon - 2}px`, boxSizing: 'border-box', borderRadius: '50%',
                    border: '2px solid currentColor', borderRightColor: 'transparent', animation: 'plauna-spin 700ms linear infinite'
                }
            }));
        } else {
            this.appendChild(icon(this, 'icon', ICONS[this.options.icon] || ICONS.settings, scale.icon));
        }
        if (dot) {
            this.appendChild(el(this, 'dot', 'span', {
                attrs: { 'aria-hidden': 'true' },
                style: {
                    position: 'absolute', top: `${Math.round(scale.height * 0.16)}px`, right: `${Math.round(scale.height * 0.16)}px`,
                    width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--color-error, #ef4444)',
                    boxShadow: '0 0 0 2px var(--bg-primary, #0a0a0f)'
                }
            }));
        }
        this._paint?.();
    }

    setLoading(loading) {
        this.options.loading = Boolean(loading);
        this.build();
    }

    setDisabled(disabled) {
        this.options.disabled = Boolean(disabled);
        this.build();
    }

    setIcon(name) {
        this.options.icon = name;
        this.build();
    }
}
