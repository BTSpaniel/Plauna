// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Carousel - slides that move sideways with arrows, dots, the arrow keys
 * and optional autoplay (paused while hovered or focused). Slides here are
 * toned feature cards; set slides to any title/text/tone list.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, tone, TONES, mix } from '../shared/appearance.js';

let _carouselSequence = 0;

function _newCarouselId() {
    return `carousel-${Date.now()}-${++_carouselSequence}`;
}

const SLIDES = [
    { title: 'Render anywhere', text: 'DOM, GPU and auto modes from one widget tree.', tone: 'primary', icon: 'image' },
    { title: 'Theme everything', text: 'CSS-variable themes restyle every widget live.', tone: 'accent', icon: 'settings' },
    { title: 'Ship faster', text: '91 widgets, each with stories and a playground.', tone: 'success', icon: 'zap' },
    { title: 'Stay accessible', text: 'Keyboard, focus rings and ARIA in every widget.', tone: 'info', icon: 'user' }
];

export class Carousel extends UINode {
    static id = 'carousel';
    static name = 'Carousel';
    static category = 'dataviews';
    static icon = '🎠';
    static description = 'Slides with arrows, dots and autoplay';
    static tags = ['dataviews', 'carousel', 'slider', 'slideshow', 'gallery', 'hero'];
    static emits = ['change'];
    static dependencies = [];
    static optionValues = { indicators: ['dots', 'bars', 'none'], arrows: 'boolean', autoplay: 'boolean', loop: 'boolean' };

    static getDefaultOptions() {
        return { slides: SLIDES, index: 0, height: 200, indicators: 'dots', arrows: true, autoplay: false, interval: 4000, loop: true };
    }

    static stories() {
        return {
            'Feature cards': { slides: SLIDES },
            'Autoplay with bars': { slides: SLIDES, autoplay: true, indicators: 'bars', index: 1 },
            'No arrows': { slides: SLIDES.slice(0, 3), arrows: false, height: 160 }
        };
    }

    static create(container, options = {}) {
        const instance = new Carousel(_newCarouselId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newCarouselId(), options = {}) {
        super(id, 'section');
        this.tag = 'section';
        this.options = { ...Carousel.getDefaultOptions(), ...options };
        this.slides = Array.isArray(this.options.slides) ? this.options.slides : SLIDES;
        this.index = Math.max(0, Math.min(this.slides.length - 1, Number(this.options.index) || 0));
        this.paused = false;
        this._timer = null;
        this.addEventListener('mouseenter', () => { this.paused = true; });
        this.addEventListener('mouseleave', () => { this.paused = false; });
        this.addEventListener('focusin', () => { this.paused = true; });
        this.addEventListener('focusout', () => { this.paused = false; });
        this.build();
        if (this.options.autoplay && typeof setInterval === 'function') {
            this._timer = setInterval(() => { if (!this.paused) this.go(this.index + 1); }, Math.max(1500, Number(this.options.interval) || 4000));
        }
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { height, arrows, indicators } = this.options;
        this.role = 'region';
        this.ariaLabel = 'Carousel';
        this.setAttribute('aria-roledescription', 'carousel');
        this.setStyles({ position: 'relative', width: '100%', maxWidth: '640px', userSelect: 'none' });
        this.track = el(this, 'track', 'div', {
            style: { display: 'flex', width: '100%', transition: 'transform 420ms var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1))' }
        });
        this.slides.forEach((slide, index) => {
            const c = tone(slide.tone || 'primary');
            this.track.appendChild(el(this, `slide-${index}`, 'div', {
                role: 'group', attrs: { 'aria-roledescription': 'slide', 'aria-label': `${index + 1} of ${this.slides.length}` },
                style: {
                    flex: '0 0 100%', height: `${height}px`, boxSizing: 'border-box', padding: '28px 64px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '8px',
                    backgroundColor: 'var(--surface-card, #0f0f17)',
                    backgroundImage: `radial-gradient(circle at 85% 20%, ${mix(c.base, 34)}, transparent 55%), linear-gradient(135deg, ${mix(c.base, 18)}, ${mix('var(--color-accent, #8b5cf6)', 10)})`
                },
                children: [
                    ICONS[slide.icon] ? el(this, `slide-icon-${index}`, 'span', {
                        style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '40px', height: '40px', borderRadius: '12px', backgroundColor: c.soft, color: c.base, border: `1px solid ${c.subtleBorder}` },
                        children: [icon(this, `slide-glyph-${index}`, ICONS[slide.icon], 20)]
                    }) : null,
                    el(this, `slide-title-${index}`, 'h3', { text: slide.title, style: { margin: '6px 0 0', fontSize: '22px', fontWeight: '750', letterSpacing: '-0.02em', color: 'var(--text-primary, #e4e4e7)' } }),
                    el(this, `slide-text-${index}`, 'p', { text: slide.text, style: { margin: '0', fontSize: '14px', color: 'var(--text-secondary, #d1d5db)' } })
                ]
            }));
        });
        this.viewport = el(this, 'viewport', 'div', {
            attrs: { 'aria-live': this.options.autoplay ? 'off' : 'polite' },
            style: { overflow: 'hidden', borderRadius: '16px', border: '1px solid var(--border-light, #2a2a3a)' },
            children: [this.track]
        });
        this.viewport.tabIndex = 0;
        this.viewport.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault?.();
                this.go(this.index + (event.key === 'ArrowRight' ? 1 : -1));
            }
        });
        this.appendChild(this.viewport);
        if (arrows) {
            this.arrowButtons = ['prev', 'next'].map((side) => {
                const button = el(this, side, 'button', {
                    label: side === 'prev' ? 'Previous slide' : 'Next slide', attrs: { type: 'button' },
                    style: {
                        position: 'absolute', top: `${height / 2 - 18}px`, [side === 'prev' ? 'left' : 'right']: '12px', width: '36px', height: '36px', padding: '0',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', cursor: 'pointer',
                        border: '1px solid var(--border-medium, #3a3a4a)', backgroundColor: 'var(--surface-overlay, #0f0f17)', color: 'var(--text-primary, #e4e4e7)',
                        boxShadow: 'var(--shadow-md, 0 4px 6px -1px rgba(0,0,0,0.4))', transition: 'transform 120ms ease, opacity 120ms ease'
                    },
                    children: [icon(this, `${side}-icon`, side === 'prev' ? ICONS.chevronLeft : ICONS.chevronRight, 18)]
                });
                button.addEventListener('click', () => this.go(this.index + (side === 'prev' ? -1 : 1)));
                button.addEventListener('mouseenter', () => button.setStyles({ transform: 'scale(1.08)' }));
                button.addEventListener('mouseleave', () => button.setStyles({ transform: 'none' }));
                this.appendChild(button);
                return button;
            });
        } else {
            this.arrowButtons = [];
        }
        this.indicatorNodes = [];
        if (indicators !== 'none') {
            const row = el(this, 'indicators', 'div', { role: 'tablist', label: 'Slides', style: { display: 'flex', justifyContent: 'center', gap: '6px', marginTop: '12px' } });
            this.slides.forEach((slide, index) => {
                const dot = el(this, `indicator-${index}`, 'button', {
                    role: 'tab', label: `Slide ${index + 1}: ${slide.title}`, attrs: { type: 'button' },
                    style: { height: indicators === 'bars' ? '4px' : '8px', padding: '0', border: 'none', borderRadius: '9999px', cursor: 'pointer', transition: 'background-color 200ms ease' }
                });
                dot.addEventListener('click', () => this.go(index));
                row.appendChild(dot);
                this.indicatorNodes.push(dot);
            });
            this.appendChild(row);
        }
        this.paint(true);
    }

    paint(first = false) {
        const bars = this.options.indicators === 'bars';
        this.track.setStyles({ transform: `translateX(-${this.index * 100}%)` });
        if (first) this.track.setStyles({ transition: 'transform 420ms var(--ease-out, cubic-bezier(0.22, 1, 0.36, 1))' });
        this.indicatorNodes.forEach((dot, index) => {
            const active = index === this.index;
            dot.setAttribute('aria-selected', active ? 'true' : 'false');
            dot.setStyles({ width: bars ? '28px' : active ? '22px' : '8px', backgroundColor: active ? tone(this.slides[index].tone || 'primary').base : 'var(--border-dark, #4a4a5a)' });
        });
        if (!this.options.loop) {
            this.arrowButtons[0]?.setStyles({ opacity: this.index === 0 ? '0.35' : '1' });
            this.arrowButtons[1]?.setStyles({ opacity: this.index === this.slides.length - 1 ? '0.35' : '1' });
        }
    }

    go(index) {
        const count = this.slides.length;
        if (!count) return;
        const next = this.options.loop ? (index + count) % count : Math.max(0, Math.min(count - 1, index));
        if (next === this.index) return;
        this.index = next;
        this.paint();
        this.dispatchEvent({ type: 'change', target: this, index: next });
    }

    destroy() {
        clearInterval(this._timer);
        this._timer = null;
        super.destroy();
    }
}
