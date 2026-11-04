// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Accordion - a stack of sections whose headers expand and collapse their
 * content; one open at a time or several. Separated cards, one contained
 * box, filled panels or bare rows. Keyboard: Enter/Space toggle, Up/Down
 * move between headers, Home/End jump. Fires 'change' with the open ids.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, tone, TONES, mix } from '../shared/appearance.js';

let _accordionSequence = 0;

function _newAccordionId() {
    return `accordion-${Date.now()}-${++_accordionSequence}`;
}

const FAQ = [
    { id: 'modes', title: 'What do DOM, GPU and auto mode change?', content: 'Only who paints. The scene, its input and its accessibility stay in the page in every mode; GPU mode draws it with WebGPU from Plauna’s own layout.', icon: 'image' },
    { id: 'themes', title: 'Can I make my own theme?', content: 'Yes. A theme is a JSON file of CSS variables that extends another theme; switching restyles every widget without a re-render.', icon: 'settings' },
    { id: 'widgets', title: 'How do widgets get their look?', content: 'From the shared appearance module: seven tones, solid/soft/surface/outline/ghost/gradient variants, five sizes and three shapes.', icon: 'star' },
    { id: 'keyboard', title: 'Is everything usable from the keyboard?', content: 'Every interactive widget takes focus, shows a focus ring for keyboard focus and follows the WAI-ARIA patterns for its role.', icon: 'command' }
];

export class Accordion extends UINode {
    static id = 'accordion';
    static name = 'Accordion';
    static category = 'layout';
    static icon = '🪗';
    static description = 'Sections that expand and collapse';
    static tags = ['layout', 'accordion', 'collapse', 'faq', 'disclosure', 'expand'];
    static emits = ['change'];
    static dependencies = [];
    static optionValues = { variant: ['separated', 'contained', 'filled', 'ghost'], chevron: ['right', 'left'], tone: TONES, multiple: 'boolean', showIcons: 'boolean' };

    static getDefaultOptions() {
        return { items: FAQ, open: ['modes'], multiple: false, variant: 'separated', chevron: 'right', tone: 'primary', showIcons: false };
    }

    static stories() {
        return {
            'Separated': { items: FAQ, open: ['modes'] },
            'Contained, multiple': { items: FAQ, open: ['modes', 'widgets'], multiple: true, variant: 'contained' },
            'Filled with icons': { items: FAQ, open: ['themes'], variant: 'filled', showIcons: true, tone: 'accent' },
            'Ghost, chevron left': { items: FAQ.slice(0, 3), open: [], variant: 'ghost', chevron: 'left' }
        };
    }

    static create(container, options = {}) {
        const instance = new Accordion(_newAccordionId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newAccordionId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...Accordion.getDefaultOptions(), ...options };
        this.open = new Set((this.options.open || []).map(String));
        if (!this.options.multiple && this.open.size > 1) this.open = new Set([[...this.open][0]]);
        this.build();
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { variant } = this.options;
        const contained = variant === 'contained';
        this.setStyles({
            display: 'flex', flexDirection: 'column', gap: variant === 'separated' || variant === 'filled' ? '8px' : '0', width: '100%', maxWidth: '560px',
            borderRadius: contained ? '14px' : '0', border: contained ? '1px solid var(--border-light, #2a2a3a)' : 'none',
            backgroundColor: contained ? 'var(--surface-card, #0f0f17)' : 'transparent', overflow: contained ? 'hidden' : 'visible'
        });
        this.sections = (Array.isArray(this.options.items) ? this.options.items : []).map((item, index) => {
            const key = String(item.id ?? index);
            const chevron = icon(this, `chevron-${index}`, ICONS.chevronDown, 16, { style: { transition: 'transform var(--duration-base, 200ms) var(--ease-out, ease)', color: 'var(--text-tertiary, #9ca3af)' } });
            const lead = this.options.showIcons && ICONS[item.icon]
                ? el(this, `lead-${index}`, 'span', { style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '8px', flex: '0 0 auto' }, children: [icon(this, `lead-icon-${index}`, ICONS[item.icon], 15)] })
                : null;
            const header = el(this, `header-${index}`, 'button', {
                attrs: { type: 'button', 'aria-controls': `${this.id}-panel-${index}` },
                style: {
                    display: 'flex', alignItems: 'center', gap: '12px', width: '100%', padding: variant === 'ghost' ? '12px 4px' : '14px 16px', boxSizing: 'border-box',
                    border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: '14px', fontWeight: '600', textAlign: 'left',
                    transition: 'color 120ms ease, background-color 120ms ease'
                },
                children: this.options.chevron === 'left'
                    ? [chevron, lead, el(this, `title-${index}`, 'span', { text: item.title, style: { flex: '1' } })]
                    : [lead, el(this, `title-${index}`, 'span', { text: item.title, style: { flex: '1' } }), chevron]
            });
            header.addEventListener('click', () => this.toggle(key));
            header.addEventListener('keydown', (event) => this.onKey(event, index));
            header.addEventListener('mouseenter', () => { header._hover = true; this.paint(); });
            header.addEventListener('mouseleave', () => { header._hover = false; this.paint(); });
            const panel = el(this, `panel-${index}`, 'div', {
                role: 'region', attrs: { 'aria-labelledby': `${this.id}-header-${index}` },
                style: {
                    padding: variant === 'ghost' ? `0 4px 14px ${this.options.chevron === 'left' ? 32 : 4}px` : `0 16px 16px ${lead ? 56 : this.options.chevron === 'left' ? 44 : 16}px`,
                    fontSize: '13px', lineHeight: '1.6', color: 'var(--text-secondary, #d1d5db)', transition: 'opacity var(--duration-base, 200ms) ease'
                },
                children: [el(this, `content-${index}`, 'div', { text: item.content })]
            });
            const section = el(this, `section-${index}`, 'div', {
                style: {
                    ...(variant === 'separated'
                        ? { border: '1px solid var(--border-light, #2a2a3a)' }
                        : { borderTop: (variant === 'contained' || variant === 'ghost') && index > 0 ? '1px solid var(--border-light, #2a2a3a)' : 'none' }),
                    borderRadius: variant === 'separated' || variant === 'filled' ? '12px' : '0',
                    overflow: 'hidden', transition: 'background-color 160ms ease, border-color 160ms ease, box-shadow 160ms ease'
                },
                children: [header, panel]
            });
            this.appendChild(section);
            return { key, header, panel, chevron, lead, section };
        });
        this.paint();
    }

    paint() {
        const c = tone(this.options.tone);
        const { variant } = this.options;
        for (const { key, header, panel, chevron, lead, section } of this.sections) {
            const open = this.open.has(key);
            header.setAttribute('aria-expanded', open ? 'true' : 'false');
            header.setStyles({ color: open ? c.text : header._hover ? 'var(--text-primary, #e4e4e7)' : 'var(--text-primary, #e4e4e7)' });
            panel.setStyles({ display: open ? 'block' : 'none', opacity: open ? '1' : '0' });
            chevron.setStyles({ transform: open ? 'rotate(180deg)' : 'none', color: open ? c.base : 'var(--text-tertiary, #9ca3af)' });
            lead?.setStyles({ backgroundColor: open ? c.soft : 'var(--bg-tertiary, #171723)', color: open ? c.base : 'var(--text-secondary, #d1d5db)' });
            if (variant === 'separated') {
                section.setStyles({ backgroundColor: open ? 'var(--surface-card, #0f0f17)' : header._hover ? mix('var(--text-primary, #e4e4e7)', 3) : 'transparent', borderColor: open ? c.subtleBorder : 'var(--border-light, #2a2a3a)', boxShadow: open ? 'var(--shadow-md, 0 4px 6px -1px rgba(0,0,0,0.4))' : 'none' });
            } else if (variant === 'filled') {
                section.setStyles({ backgroundColor: open ? c.soft : 'var(--bg-tertiary, #171723)' });
            } else {
                header.setStyles({ backgroundColor: header._hover ? mix('var(--text-primary, #e4e4e7)', 4) : 'transparent' });
            }
        }
    }

    toggle(key) {
        if (this.open.has(key)) this.open.delete(key);
        else {
            if (!this.options.multiple) this.open.clear();
            this.open.add(key);
        }
        this.paint();
        this.dispatchEvent({ type: 'change', target: this, open: [...this.open] });
    }

    onKey(event, index) {
        const count = this.sections.length;
        const to = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: count - 1 }[event.key];
        if (to === undefined) return;
        event.preventDefault?.();
        this.sections[(to + count) % count].header.focus?.();
    }
}
