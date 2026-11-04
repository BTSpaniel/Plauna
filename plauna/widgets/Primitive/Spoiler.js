// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Spoiler - long text clipped to a few lines with a fade and a "Show more"
 * control; expanding reveals the rest.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, variantStyles, bindInteraction, TONES, TRANSITION } from '../shared/appearance.js';

let _spoilerSequence = 0;

function _newSpoilerId() {
    return `spoiler-${Date.now()}-${++_spoilerSequence}`;
}

const TEXT = 'Plauna lays out and paints its own scene: a CSS cascade over the page’s style sheets, block, inline, flex, grid and table layout, then a WebGPU pass that draws boxes, borders, shadows, gradients and text from atlas pages. The scene stays in the page, invisible, so native input, focus, IME and screen readers keep working while the canvas shows what Plauna paints. Auto mode picks GPU unless WebGPU is missing, the device is lost or the content needs the DOM, and switches live.';

export class Spoiler extends UINode {
    static id = 'spoiler';
    static name = 'Spoiler';
    static category = 'primitive';
    static icon = '📜';
    static description = 'Long text clipped with a Show more control';
    static tags = ['primitive', 'spoiler', 'read more', 'show more', 'truncate', 'expand'];
    static dependencies = [];
    static optionValues = { tone: TONES, expanded: 'boolean', fade: 'boolean' };

    static getDefaultOptions() {
        return { text: TEXT, lines: 3, expanded: false, fade: true, tone: 'primary', showLabel: 'Show more', hideLabel: 'Show less' };
    }

    static stories() {
        return {
            'Collapsed': { text: TEXT, lines: 3 },
            'Two lines, accent': { text: TEXT, lines: 2, tone: 'accent' },
            'Expanded': { text: TEXT, lines: 3, expanded: true }
        };
    }

    static create(container, options = {}) {
        const instance = new Spoiler(_newSpoilerId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newSpoilerId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...Spoiler.getDefaultOptions(), ...options };
        this.expanded = Boolean(this.options.expanded);
        this.build();
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const lineHeight = 22;
        this.setStyles({ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '6px', maxWidth: '560px' });
        this.fade = el(this, 'fade', 'span', {
            attrs: { 'aria-hidden': 'true' },
            style: {
                position: 'absolute', left: '0', right: '0', bottom: '0', height: `${lineHeight * 1.6}px`, pointerEvents: 'none',
                backgroundImage: 'linear-gradient(180deg, transparent, var(--bg-secondary, #0f0f17))'
            }
        });
        this.body = el(this, 'body', 'div', {
            style: { position: 'relative', overflow: 'hidden', fontSize: '14px', lineHeight: `${lineHeight}px`, color: 'var(--text-secondary, #d1d5db)' },
            children: [el(this, 'body-text', 'span', { text: this.options.text }), this.fade]
        });
        this.appendChild(this.body);
        this.label = el(this, 'toggle-label', 'span', {});
        this.chevron = icon(this, 'toggle-icon', ICONS.chevronDown, 15, { style: { transition: 'transform var(--duration-base, 200ms) var(--ease-out, ease)' } });
        this.toggle = el(this, 'toggle', 'button', {
            attrs: { type: 'button', 'aria-controls': `${this.id}-body` },
            style: { display: 'inline-flex', alignItems: 'center', gap: '4px', height: '28px', padding: '0 8px', marginLeft: '-8px', borderRadius: '7px', border: '1px solid transparent', fontSize: '13px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit', transition: TRANSITION },
            children: [this.label, this.chevron]
        });
        bindInteraction(this.toggle, (state) => this.toggle.setStyles(variantStyles('ghost', this.options.tone, state)));
        this.toggle.addEventListener('click', () => this.setExpanded(!this.expanded));
        this.appendChild(this.toggle);
        this.paint(lineHeight);
    }

    paint(lineHeight = 22) {
        this.body.setStyles({ maxHeight: this.expanded ? 'none' : `${lineHeight * this.options.lines}px` });
        this.fade.setStyles({ display: !this.expanded && this.options.fade ? 'block' : 'none' });
        this.label.setTextContent(this.expanded ? this.options.hideLabel : this.options.showLabel);
        this.chevron.setStyles({ transform: this.expanded ? 'rotate(180deg)' : 'none' });
        this.toggle.setAttribute('aria-expanded', this.expanded ? 'true' : 'false');
    }

    setExpanded(expanded) {
        this.expanded = Boolean(expanded);
        this.paint();
        this.dispatchEvent({ type: 'toggle', target: this, expanded: this.expanded });
    }
}
