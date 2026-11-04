// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Marquee - an endless row of items scrolling sideways (logos, tags,
 * announcements), with faded edges; hovering pauses it. The row repeats
 * once and slides by half its width, so the loop has no seam.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, tone, TONES, ensureKeyframes } from '../shared/appearance.js';

let _marqueeSequence = 0;

function _newMarqueeId() {
    return `marquee-${Date.now()}-${++_marqueeSequence}`;
}

const TECH = ['WebGPU', 'ECS', 'PhysX', 'Particles', 'Plauna', 'SOUL Sight', 'Music Studio', 'Realm Forge', 'WebXR', 'Code Lab'];

export class Marquee extends UINode {
    static id = 'marquee';
    static name = 'Marquee';
    static category = 'layout';
    static icon = '🎞️';
    static description = 'Endless scrolling row of items';
    static tags = ['layout', 'marquee', 'ticker', 'logos', 'scrolling', 'carousel'];
    static dependencies = [];
    static optionValues = { direction: ['left', 'right'], speed: ['slow', 'normal', 'fast'], itemStyle: ['pill', 'card', 'text'], tone: TONES, pauseOnHover: 'boolean', fade: 'boolean' };

    static getDefaultOptions() {
        return { items: TECH, direction: 'left', speed: 'normal', itemStyle: 'pill', tone: 'primary', pauseOnHover: true, fade: true };
    }

    static stories() {
        return {
            'Pills': { items: TECH },
            'Cards, right': { items: TECH.slice(0, 6), direction: 'right', itemStyle: 'card', tone: 'accent', speed: 'slow' },
            'News ticker': { items: ['Build 418 passed', 'Shard 3 back online', 'New theme: High Contrast', 'Plauna 0.3 ships 91 widgets'], itemStyle: 'text', speed: 'fast', tone: 'info' }
        };
    }

    static create(container, options = {}) {
        const instance = new Marquee(_newMarqueeId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newMarqueeId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...Marquee.getDefaultOptions(), ...options };
        this.build();
    }

    item(label, index, copy) {
        const c = tone(this.options.tone);
        const style = this.options.itemStyle;
        const base = { flex: '0 0 auto', whiteSpace: 'nowrap', fontSize: '13px', fontWeight: '600' };
        const looks = {
            pill: { ...base, padding: '6px 14px', borderRadius: '9999px', backgroundColor: c.soft, color: c.text, border: `1px solid ${c.subtleBorder}` },
            card: { ...base, padding: '14px 18px', borderRadius: '12px', backgroundColor: 'var(--surface-card, #0f0f17)', color: 'var(--text-primary, #e4e4e7)', border: '1px solid var(--border-light, #2a2a3a)', boxShadow: 'var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.3))' },
            text: { ...base, padding: '2px 0', color: 'var(--text-secondary, #d1d5db)' }
        };
        const children = style === 'text' ? [el(this, `dot-${copy}-${index}`, 'span', { style: { display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', marginRight: '10px', backgroundColor: c.base, verticalAlign: 'middle' } }), el(this, `text-${copy}-${index}`, 'span', { text: label })] : [];
        return el(this, `item-${copy}-${index}`, 'span', {
            text: style === 'text' ? undefined : label,
            attrs: copy ? { 'aria-hidden': 'true' } : {},
            style: looks[style] || looks.pill,
            children
        });
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { direction, speed, pauseOnHover, fade } = this.options;
        const items = Array.isArray(this.options.items) ? this.options.items : [];
        const seconds = { slow: 40, normal: 24, fast: 14 }[speed] || 24;
        const gap = this.options.itemStyle === 'text' ? 36 : 12;
        ensureKeyframes('plauna-marquee-left', 'from { transform: translateX(0); } to { transform: translateX(-50%); }');
        ensureKeyframes('plauna-marquee-right', 'from { transform: translateX(-50%); } to { transform: translateX(0); }');
        this.role = 'marquee';
        this.ariaLabel = items.join(', ');
        this.setStyles({ position: 'relative', width: '100%', overflow: 'hidden', padding: '4px 0' });
        // Two copies side by side; the track slides by one copy's width and starts over
        const copies = [0, 1].map((copy) => el(this, `copy-${copy}`, 'div', {
            style: { display: 'flex', alignItems: 'center', gap: `${gap}px`, paddingRight: `${gap}px`, flex: '0 0 auto' },
            children: items.map((label, index) => this.item(label, index, copy))
        }));
        this.track = el(this, 'track', 'div', {
            style: {
                display: 'flex', width: 'max-content',
                transform: direction === 'right' ? 'translateX(-50%)' : 'translateX(0)',
                animation: `plauna-marquee-${direction === 'right' ? 'right' : 'left'} ${seconds}s linear infinite`
            },
            children: copies
        });
        this.appendChild(this.track);
        if (pauseOnHover) {
            this.addEventListener('mouseenter', () => this.track.setStyles({ animationPlayState: 'paused' }));
            this.addEventListener('mouseleave', () => this.track.setStyles({ animationPlayState: 'running' }));
        }
        if (fade) {
            for (const side of ['left', 'right']) {
                this.appendChild(el(this, `fade-${side}`, 'span', {
                    attrs: { 'aria-hidden': 'true' },
                    style: {
                        position: 'absolute', top: '0', bottom: '0', [side]: '0', width: '56px', pointerEvents: 'none', zIndex: '1',
                        backgroundImage: `linear-gradient(to ${side === 'left' ? 'right' : 'left'}, var(--bg-secondary, #0f0f17), transparent)`
                    }
                }));
            }
        }
    }
}
