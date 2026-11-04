// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Timeline - events in order along a line, each with a marker (dot or icon
 * in its tone), a title, a time and a description. Left-aligned or
 * alternating sides; solid, dashed or gradient connectors.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, tone, TONES, mix } from '../shared/appearance.js';

let _timelineSequence = 0;

function _newTimelineId() {
    return `timeline-${Date.now()}-${++_timelineSequence}`;
}

const RELEASE = [
    { title: 'Engine restructure', time: 'Oct 2', description: 'Particle sim, WebGPU playground and the bundler land together.', tone: 'primary', icon: 'zap' },
    { title: 'Plauna audit', time: 'Oct 15', description: '32 findings, a plan in eight phases.', tone: 'warning', icon: 'search' },
    { title: 'GPU render mode', time: 'Oct 15', description: 'DOM, GPU and auto modes over Plauna’s own layout engine.', tone: 'accent', icon: 'image' },
    { title: 'Pixel parity', time: 'Oct 16', description: 'GPU text matches DOM at 100%, 125% and 150%.', tone: 'success', icon: 'checkCircle' }
];

export class Timeline extends UINode {
    static id = 'timeline';
    static name = 'Timeline';
    static category = 'dataviews';
    static icon = '🕰️';
    static description = 'Events in order along a line';
    static tags = ['dataviews', 'timeline', 'history', 'activity', 'changelog', 'steps'];
    static dependencies = [];
    static optionValues = { layout: ['left', 'alternate'], line: ['solid', 'dashed', 'gradient'], marker: ['icon', 'dot'], size: ['sm', 'md'], tone: TONES };

    static getDefaultOptions() {
        return { items: RELEASE, layout: 'left', line: 'gradient', marker: 'icon', size: 'md', tone: 'primary' };
    }

    static stories() {
        return {
            'Release history': { items: RELEASE },
            'Alternating': { items: RELEASE, layout: 'alternate', line: 'solid' },
            'Activity dots': {
                items: [
                    { title: 'Ada pushed 3 commits', time: '2 min ago', tone: 'primary' },
                    { title: 'Build #418 passed', time: '9 min ago', tone: 'success' },
                    { title: 'Grace commented on “Atlas stall”', time: '1 h ago', description: '“Batch the merge, then evict.”', tone: 'info' },
                    { title: 'Deploy paused', time: 'Yesterday', tone: 'warning' }
                ],
                marker: 'dot', line: 'dashed', size: 'sm'
            }
        };
    }

    static create(container, options = {}) {
        const instance = new Timeline(_newTimelineId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newTimelineId(), options = {}) {
        super(id, 'ol');
        this.tag = 'ol';
        this.options = { ...Timeline.getDefaultOptions(), ...options };
        this.build();
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { layout, line, marker, size } = this.options;
        const items = Array.isArray(this.options.items) ? this.options.items : [];
        const alternate = layout === 'alternate';
        const markerSize = marker === 'dot' ? 12 : (size === 'sm' ? 26 : 32);
        const rail = markerSize / 2;
        this.ariaLabel = 'Timeline';
        this.setStyles({ listStyle: 'none', margin: '0', padding: '0', display: 'flex', flexDirection: 'column', width: '100%', maxWidth: alternate ? '640px' : '480px' });
        items.forEach((item, index) => {
            const c = tone(item.tone || this.options.tone);
            const next = items[index + 1] ? tone(items[index + 1].tone || this.options.tone) : c;
            const last = index === items.length - 1;
            const left = !alternate || index % 2 === 0;
            const connector = last ? null : el(this, `line-${index}`, 'span', {
                attrs: { 'aria-hidden': 'true' },
                style: line === 'dashed'
                    ? { flex: '1', width: '0', borderLeft: '2px dashed var(--border-medium, #3a3a4a)', margin: '4px 0' }
                    : line === 'gradient'
                        ? { flex: '1', width: '2px', borderRadius: '1px', margin: '4px 0', backgroundImage: `linear-gradient(180deg, ${c.base}, ${mix(next.base, 55)})` }
                        : { flex: '1', width: '2px', borderRadius: '1px', margin: '4px 0', backgroundColor: 'var(--border-medium, #3a3a4a)' }
            });
            const dot = marker === 'dot'
                ? el(this, `marker-${index}`, 'span', { attrs: { 'aria-hidden': 'true' }, style: { width: '12px', height: '12px', borderRadius: '50%', backgroundColor: c.base, boxShadow: `0 0 0 4px ${c.soft}`, flex: '0 0 auto', marginTop: size === 'sm' ? '3px' : '4px' } })
                : el(this, `marker-${index}`, 'span', {
                    attrs: { 'aria-hidden': 'true' },
                    style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: `${markerSize}px`, height: `${markerSize}px`, borderRadius: '50%', flex: '0 0 auto', backgroundColor: c.soft, color: c.base, border: `1px solid ${c.subtleBorder}` },
                    children: ICONS[item.icon] ? [icon(this, `icon-${index}`, ICONS[item.icon], Math.round(markerSize * 0.5))] : []
                });
            const axis = el(this, `axis-${index}`, 'div', {
                style: { display: 'flex', flexDirection: 'column', alignItems: 'center', width: `${markerSize}px`, flex: '0 0 auto' },
                children: [dot, connector]
            });
            const content = el(this, `content-${index}`, 'div', {
                style: { flex: '1', minWidth: '0', paddingBottom: last ? '0' : (size === 'sm' ? '16px' : '22px'), textAlign: alternate && !left ? 'right' : 'left', paddingTop: marker === 'dot' ? '0' : `${Math.max(0, rail - 10)}px` },
                children: [
                    el(this, `head-${index}`, 'div', {
                        style: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap', justifyContent: alternate && !left ? 'flex-end' : 'flex-start' },
                        children: [
                            el(this, `title-${index}`, 'span', { text: item.title, style: { fontSize: size === 'sm' ? '13px' : '14px', fontWeight: '650', color: 'var(--text-primary, #e4e4e7)' } }),
                            item.time ? el(this, `time-${index}`, 'time', { text: item.time, style: { fontSize: '12px', color: 'var(--text-tertiary, #9ca3af)' } }) : null
                        ]
                    }),
                    item.description ? el(this, `desc-${index}`, 'p', { text: item.description, style: { margin: '4px 0 0', fontSize: '13px', lineHeight: '1.5', color: 'var(--text-secondary, #d1d5db)' } }) : null
                ]
            });
            const spacer = alternate ? el(this, `spacer-${index}`, 'div', { style: { flex: '1', minWidth: '0' } }) : null;
            const row = el(this, `item-${index}`, 'li', {
                style: { display: 'flex', alignItems: 'stretch', gap: '14px' },
                children: alternate ? (left ? [spacer, axis, content] : [content, axis, spacer]) : [axis, content]
            });
            this.appendChild(row);
        });
    }

    setItems(items) {
        this.options.items = items;
        this.build();
    }
}
