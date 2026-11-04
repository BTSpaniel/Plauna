// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * TableOfContents - the headings of a page as links, indented by level,
 * with the current section marked by a sliding bar or a filled pill.
 * Clicking an entry makes it current and fires 'navigate'.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, tone, TONES, mix } from '../shared/appearance.js';

let _tocSequence = 0;

function _newTocId() {
    return `toc-${Date.now()}-${++_tocSequence}`;
}

const HEADINGS = [
    { id: 'overview', label: 'Overview', level: 1 },
    { id: 'render-modes', label: 'Render modes', level: 1 },
    { id: 'dom', label: 'DOM', level: 2 },
    { id: 'gpu', label: 'GPU', level: 2 },
    { id: 'auto', label: 'Auto', level: 2 },
    { id: 'themes', label: 'Themes', level: 1 },
    { id: 'tokens', label: 'Design tokens', level: 2 },
    { id: 'widgets', label: 'Widget library', level: 1 }
];

export class TableOfContents extends UINode {
    static id = 'table-of-contents';
    static name = 'Table of Contents';
    static category = 'navigation';
    static icon = '🧭';
    static description = 'Page headings with the current section marked';
    static tags = ['navigation', 'toc', 'table of contents', 'outline', 'anchors', 'scroll spy'];
    static dependencies = [];
    static optionValues = { variant: ['line', 'filled'], tone: TONES, size: ['sm', 'md'] };

    static getDefaultOptions() {
        return { title: 'On this page', headings: HEADINGS, active: 'gpu', variant: 'line', tone: 'primary', size: 'md' };
    }

    static stories() {
        return {
            'Line': { headings: HEADINGS, active: 'gpu' },
            'Filled accent': { headings: HEADINGS, active: 'themes', variant: 'filled', tone: 'accent' },
            'Small': { headings: HEADINGS.slice(0, 5), active: 'overview', size: 'sm', title: 'Contents' }
        };
    }

    static create(container, options = {}) {
        const instance = new TableOfContents(_newTocId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newTocId(), options = {}) {
        super(id, 'nav');
        this.tag = 'nav';
        this.options = { ...TableOfContents.getDefaultOptions(), ...options };
        this.active = this.options.active;
        this.build();
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { title, size, variant } = this.options;
        const small = size === 'sm';
        this.ariaLabel = title || 'Table of contents';
        this.setStyles({ display: 'flex', flexDirection: 'column', gap: '8px', width: '220px' });
        if (title) this.appendChild(el(this, 'title', 'div', { text: title, style: { fontSize: '11px', fontWeight: '700', letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-tertiary, #9ca3af)' } }));
        const list = el(this, 'list', 'ul', {
            style: { listStyle: 'none', margin: '0', padding: '0', display: 'flex', flexDirection: 'column', gap: variant === 'filled' ? '2px' : '0', borderLeft: variant === 'line' ? '1px solid var(--border-light, #2a2a3a)' : 'none' }
        });
        this.links = (Array.isArray(this.options.headings) ? this.options.headings : []).map((heading, index) => {
            const link = el(this, `link-${index}`, 'a', {
                text: heading.label, data: { href: `#${heading.id}` },
                style: {
                    display: 'block', position: 'relative', textDecoration: 'none', cursor: 'pointer',
                    padding: `${small ? 4 : 6}px 10px ${small ? 4 : 6}px ${12 + (Math.max(1, heading.level || 1) - 1) * 14}px`,
                    marginLeft: variant === 'line' ? '-1px' : '0', borderRadius: variant === 'filled' ? '7px' : '0',
                    fontSize: small ? '12px' : '13px', transition: 'color 120ms ease, background-color 120ms ease, box-shadow 120ms ease'
                }
            });
            link.addEventListener('click', (event) => {
                event.preventDefault?.();
                this.setActive(heading.id);
                this.dispatchEvent({ type: 'navigate', target: this, id: heading.id, label: heading.label });
            });
            link.addEventListener('mouseenter', () => { link._hover = true; this.paint(); });
            link.addEventListener('mouseleave', () => { link._hover = false; this.paint(); });
            list.appendChild(el(this, `item-${index}`, 'li', { children: [link] }));
            return { link, heading };
        });
        this.appendChild(list);
        this.paint();
    }

    paint() {
        const c = tone(this.options.tone);
        const line = this.options.variant === 'line';
        for (const { link, heading } of this.links) {
            const active = heading.id === this.active;
            if (active) link.setAttribute('aria-current', 'location');
            else link.removeAttribute('aria-current');
            link.setStyles({
                color: active ? c.text : link._hover ? 'var(--text-primary, #e4e4e7)' : (heading.level > 1 ? 'var(--text-tertiary, #9ca3af)' : 'var(--text-secondary, #d1d5db)'),
                fontWeight: active ? '650' : '500',
                boxShadow: line && active ? `inset 2px 0 0 ${c.base}` : 'none',
                backgroundColor: !line && active ? c.soft : !line && link._hover ? mix('var(--text-primary, #e4e4e7)', 6) : 'transparent'
            });
        }
    }

    setActive(id) {
        this.active = id;
        this.paint();
    }
}
