// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Stack - lays children out in a row or column with a gap, alignment,
 * justification, wrapping and optional dividers between them. Items given
 * in options render as labelled tiles, so a stack can be previewed alone;
 * add(node) appends any UINode.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, tone, TONES } from '../shared/appearance.js';

let _stackSequence = 0;

function _newStackId() {
    return `stack-${Date.now()}-${++_stackSequence}`;
}

const GAPS = { none: 0, xs: 4, sm: 8, md: 12, lg: 20, xl: 32 };
const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch', baseline: 'baseline' };
const JUSTIFY = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between', around: 'space-around', evenly: 'space-evenly' };

export class Stack extends UINode {
    static id = 'stack';
    static name = 'Stack';
    static category = 'layout';
    static icon = '🧱';
    static description = 'Row or column of children with gap, alignment and dividers';
    static tags = ['layout', 'stack', 'flex', 'row', 'column', 'spacing'];
    static dependencies = [];
    static optionValues = {
        direction: ['horizontal', 'vertical'], gap: Object.keys(GAPS), align: Object.keys(ALIGN), justify: Object.keys(JUSTIFY),
        frame: ['none', 'dashed', 'card'], tone: TONES, wrap: 'boolean', dividers: 'boolean'
    };

    static getDefaultOptions() {
        return { items: ['Albedo', 'Normal', 'Roughness', 'Metalness'], direction: 'horizontal', gap: 'md', align: 'center', justify: 'start', wrap: false, dividers: false, frame: 'none', tone: 'primary' };
    }

    static stories() {
        return {
            'Row': { items: ['Albedo', 'Normal', 'Roughness', 'Metalness'], frame: 'dashed' },
            'Column with dividers': { items: ['Position', 'Rotation', 'Scale'], direction: 'vertical', dividers: true, align: 'stretch', gap: 'sm', frame: 'card' },
            'Spread between': { items: ['Left', 'Middle', 'Right'], justify: 'between', tone: 'accent', frame: 'dashed' },
            'Wrapping tags': { items: ['WebGPU', 'ECS', 'Physics', 'Particles', 'Audio', 'Networking', 'Editor', 'Plauna', 'XR', 'AGI'], wrap: true, gap: 'sm', tone: 'info' }
        };
    }

    static create(container, options = {}) {
        const instance = new Stack(_newStackId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newStackId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...Stack.getDefaultOptions(), ...options };
        this.build();
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { direction, gap, align, justify, wrap, frame } = this.options;
        const vertical = direction === 'vertical';
        const frames = {
            dashed: { padding: '12px', borderRadius: '12px', border: '1px dashed var(--border-medium, #3a3a4a)', backgroundColor: 'var(--surface-sunken, #0a0a0f)' },
            card: { padding: '12px', borderRadius: '12px', border: '1px solid var(--border-light, #2a2a3a)', backgroundColor: 'var(--surface-card, #0f0f17)' },
            none: { padding: '0', borderRadius: '0', border: 'none', backgroundColor: 'transparent' }
        };
        this.setStyles({
            display: 'flex', flexDirection: vertical ? 'column' : 'row', flexWrap: wrap ? 'wrap' : 'nowrap',
            gap: `${GAPS[gap] ?? GAPS.md}px`, alignItems: ALIGN[align] || 'center', justifyContent: JUSTIFY[justify] || 'flex-start',
            width: '100%', boxSizing: 'border-box', ...(frames[frame] || frames.none)
        });
        (Array.isArray(this.options.items) ? this.options.items : []).forEach((item) => this.add(this.tile(item)));
    }

    tile(label) {
        const c = tone(this.options.tone);
        const index = this.children.length;
        return el(this, `item-${index}`, 'div', {
            text: String(label),
            style: {
                display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '36px', padding: '0 14px', borderRadius: '9px',
                fontSize: '13px', fontWeight: '600', backgroundColor: c.soft, color: c.text, border: `1px solid ${c.subtleBorder}`, whiteSpace: 'nowrap'
            }
        });
    }

    /** Append a child, with a divider before it when dividers are on. */
    add(node) {
        if (this.options.dividers && this.children.length) {
            const vertical = this.options.direction === 'vertical';
            this.appendChild(el(this, `divider-${this.children.length}`, 'span', {
                role: 'separator',
                style: vertical ? { height: '1px', alignSelf: 'stretch', backgroundColor: 'var(--border-light, #2a2a3a)' } : { width: '1px', alignSelf: 'stretch', backgroundColor: 'var(--border-light, #2a2a3a)' }
            }));
        }
        return this.appendChild(node);
    }
}
