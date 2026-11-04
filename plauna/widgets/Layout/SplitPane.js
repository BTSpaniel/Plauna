// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * SplitPane - two panes side by side (or stacked) with a draggable divider.
 * Drag the handle, or focus it and use the arrow keys (Home and End jump to
 * the limits). Fires 'resize' with the first pane's share in percent.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, tone, TONES, clamp } from '../shared/appearance.js';

let _splitSequence = 0;

function _newSplitId() {
    return `split-pane-${Date.now()}-${++_splitSequence}`;
}

const PANES = [
    { title: 'Scene', content: 'Hierarchy of 214 nodes. Select one to edit it in the inspector.' },
    { title: 'Inspector', content: 'Transform, material and physics properties of the selection.' }
];

export class SplitPane extends UINode {
    static id = 'split-pane';
    static name = 'Split Pane';
    static category = 'layout';
    static icon = '↔️';
    static description = 'Two panes with a draggable divider';
    static tags = ['layout', 'split', 'resizable', 'panes', 'divider', 'sidebar'];
    static dependencies = [];
    static optionValues = { direction: ['horizontal', 'vertical'], handle: ['line', 'grip', 'bar'], tone: TONES };

    static getDefaultOptions() {
        return { panes: PANES, split: 38, min: 15, max: 85, direction: 'horizontal', handle: 'grip', tone: 'primary', height: 220 };
    }

    static stories() {
        return {
            'Editor panes': { panes: PANES, split: 38 },
            'Vertical, line handle': { panes: [{ title: 'Viewport', content: 'Rendered scene.' }, { title: 'Console', content: 'Logs and warnings.' }], direction: 'vertical', handle: 'line', split: 62, height: 260 },
            'Bar handle, accent': { panes: PANES, handle: 'bar', tone: 'accent', split: 50 }
        };
    }

    static create(container, options = {}) {
        const instance = new SplitPane(_newSplitId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newSplitId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...SplitPane.getDefaultOptions(), ...options };
        this.split = clamp(Number(this.options.split) || 50, this.options.min, this.options.max);
        this.dragging = false;
        this.hovered = false;
        this.build();
    }

    pane(index) {
        const data = (Array.isArray(this.options.panes) ? this.options.panes : PANES)[index] || {};
        return el(this, `pane-${index}`, 'section', {
            label: data.title || `Pane ${index + 1}`,
            style: { minWidth: '0', minHeight: '0', overflow: 'auto', boxSizing: 'border-box', padding: '14px 16px' },
            children: [
                el(this, `pane-title-${index}`, 'div', { text: data.title || '', style: { fontSize: '13px', fontWeight: '650', color: 'var(--text-primary, #e4e4e7)', marginBottom: '6px' } }),
                el(this, `pane-text-${index}`, 'div', { text: data.content || '', style: { fontSize: '13px', lineHeight: '1.55', color: 'var(--text-secondary, #d1d5db)' } })
            ]
        });
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const vertical = this.options.direction === 'vertical';
        this.setStyles({
            display: 'flex', flexDirection: vertical ? 'column' : 'row', width: '100%', height: `${this.options.height}px`, minWidth: '260px',
            boxSizing: 'border-box', borderRadius: '14px', overflow: 'hidden', border: '1px solid var(--border-light, #2a2a3a)',
            backgroundColor: 'var(--surface-card, #0f0f17)'
        });
        this.first = this.pane(0);
        this.second = this.pane(1);
        this.second.setStyles({ flex: '1 1 0', backgroundColor: 'var(--bg-secondary, #0f0f17)' });
        const handleStyle = this.options.handle;
        const thickness = handleStyle === 'bar' ? 10 : 9;
        this.grip = el(this, 'grip', 'span', {
            attrs: { 'aria-hidden': 'true' },
            style: {
                position: 'absolute', display: handleStyle === 'line' ? 'none' : 'flex', alignItems: 'center', justifyContent: 'center',
                left: vertical ? 'calc(50% - 18px)' : `${(thickness - 6) / 2}px`, top: vertical ? `${(thickness - 6) / 2}px` : 'calc(50% - 18px)',
                width: vertical ? '36px' : '6px', height: vertical ? '6px' : '36px', borderRadius: '3px', transition: 'background-color 120ms ease'
            }
        });
        this.line = el(this, 'rule', 'span', {
            attrs: { 'aria-hidden': 'true' },
            style: {
                position: 'absolute', left: vertical ? '0' : `${(thickness - 1) / 2}px`, right: vertical ? '0' : 'auto',
                top: vertical ? `${(thickness - 1) / 2}px` : '0', bottom: vertical ? 'auto' : '0',
                width: vertical ? 'auto' : '1px', height: vertical ? '1px' : 'auto', transition: 'background-color 120ms ease, box-shadow 120ms ease'
            }
        });
        this.handle = el(this, 'handle', 'div', {
            role: 'separator', tabIndex: 0, label: 'Resize panes',
            attrs: { 'aria-orientation': vertical ? 'horizontal' : 'vertical', 'aria-valuemin': String(this.options.min), 'aria-valuemax': String(this.options.max), 'aria-controls': `${this.id}-pane-0` },
            style: {
                position: 'relative', flex: `0 0 ${thickness}px`, cursor: vertical ? 'row-resize' : 'col-resize', outline: 'none', touchAction: 'none',
                backgroundColor: handleStyle === 'bar' ? 'var(--bg-tertiary, #171723)' : 'transparent'
            },
            children: [this.line, this.grip]
        });
        this.handle.addEventListener('pointerdown', (event) => this.startDrag(event));
        this.handle.addEventListener('pointermove', (event) => this.drag(event));
        this.handle.addEventListener('pointerup', (event) => this.endDrag(event));
        this.handle.addEventListener('pointercancel', (event) => this.endDrag(event));
        this.handle.addEventListener('keydown', (event) => this.onKey(event));
        this.handle.addEventListener('mouseenter', () => { this.hovered = true; this.paintHandle(); });
        this.handle.addEventListener('mouseleave', () => { this.hovered = false; this.paintHandle(); });
        this.handle.addEventListener('focus', () => { this.focused = true; this.paintHandle(); });
        this.handle.addEventListener('blur', () => { this.focused = false; this.paintHandle(); });
        this.appendChild(this.first);
        this.appendChild(this.handle);
        this.appendChild(this.second);
        this.layoutPanes();
        this.paintHandle();
    }

    layoutPanes() {
        this.first.setStyles({ flex: `0 0 ${this.split.toFixed(2)}%` });
        this.handle.setAttribute('aria-valuenow', String(Math.round(this.split)));
    }

    paintHandle() {
        const c = tone(this.options.tone);
        const active = this.dragging || this.hovered || this.focused;
        this.line.setStyles({ backgroundColor: active ? c.base : 'var(--border-light, #2a2a3a)', boxShadow: active ? `0 0 0 1px ${c.glow}` : 'none' });
        this.grip.setStyles({ backgroundColor: active ? c.base : 'var(--border-dark, #4a4a5a)' });
        if (this.options.handle === 'bar') this.handle.setStyles({ backgroundColor: active ? c.soft : 'var(--bg-tertiary, #171723)' });
    }

    startDrag(event) {
        const native = event?.nativeEvent || event;
        this.dragging = true;
        this.handle.element?.setPointerCapture?.(native.pointerId);
        native.preventDefault?.();
        this.paintHandle();
    }

    drag(event) {
        if (!this.dragging || !this.element) return;
        const native = event?.nativeEvent || event;
        const rect = this.element.getBoundingClientRect();
        const vertical = this.options.direction === 'vertical';
        const ratio = vertical ? (native.clientY - rect.top) / rect.height : (native.clientX - rect.left) / rect.width;
        this.setSplit(ratio * 100, true);
    }

    endDrag(event) {
        if (!this.dragging) return;
        const native = event?.nativeEvent || event;
        this.dragging = false;
        try { this.handle.element?.releasePointerCapture?.(native.pointerId); } catch { /* already released */ }
        this.paintHandle();
    }

    onKey(event) {
        const vertical = this.options.direction === 'vertical';
        const step = event.shiftKey ? 10 : 2;
        const delta = { [vertical ? 'ArrowUp' : 'ArrowLeft']: -step, [vertical ? 'ArrowDown' : 'ArrowRight']: step }[event.key];
        if (delta !== undefined) {
            event.preventDefault?.();
            this.setSplit(this.split + delta, true);
        } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault?.();
            this.setSplit(event.key === 'Home' ? this.options.min : this.options.max, true);
        }
    }

    setSplit(percent, fromUser = false) {
        const next = clamp(Number(percent), this.options.min, this.options.max);
        if (Math.abs(next - this.split) < 0.01) return;
        this.split = next;
        this.layoutPanes();
        if (fromUser) this.dispatchEvent({ type: 'resize', target: this, split: Math.round(next * 100) / 100 });
    }
}
