// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * ColorPicker - a saturation/brightness square, a hue slider, an optional
 * alpha slider, preset swatches and a hex field. Drag with the pointer or
 * use the arrow keys on any thumb (Shift for bigger steps). Fires 'change'
 * with { hex, rgb, hsv, alpha }.
 */

import { UINode, DIRTY } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, clamp } from '../shared/appearance.js';

let _colorPickerSequence = 0;

function _newColorPickerId() {
    return `color-picker-${Date.now()}-${++_colorPickerSequence}`;
}

/** HSV (h 0-360, s and v 0-1) to RGB 0-255. */
export function hsvToRgb(h, s, v) {
    const f = (n) => {
        const k = (n + h / 60) % 6;
        return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
    };
    return [f(5), f(3), f(1)].map((x) => Math.round(x * 255));
}

/** RGB 0-255 to HSV (h 0-360, s and v 0-1). */
export function rgbToHsv(r, g, b) {
    const [R, G, B] = [r, g, b].map((x) => x / 255);
    const max = Math.max(R, G, B);
    const min = Math.min(R, G, B);
    const d = max - min;
    let h = 0;
    if (d) {
        if (max === R) h = ((G - B) / d) % 6;
        else if (max === G) h = (B - R) / d + 2;
        else h = (R - G) / d + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    return [h, max ? d / max : 0, max];
}

export function rgbToHex(r, g, b) {
    return `#${[r, g, b].map((x) => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

export function hexToRgb(hex) {
    let h = String(hex || '').trim().replace(/^#/, '');
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

const SWATCHES = ['#0ea5e9', '#6366f1', '#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#84cc16', '#10b981', '#14b8a6', '#64748b', '#f8fafc', '#0f172a'];

export class ColorPicker extends UINode {
    static id = 'color-picker';
    static name = 'Color Picker';
    static category = 'input';
    static icon = '🎨';
    static description = 'Saturation square, hue and alpha sliders, swatches and hex';
    static tags = ['input', 'color', 'picker', 'hue', 'swatch', 'palette'];
    static emits = ['change'];
    static dependencies = [];
    static optionValues = { size: ['sm', 'md', 'lg'], alpha: 'boolean', swatches: 'boolean', hexInput: 'boolean' };

    static getDefaultOptions() {
        return { value: '#0ea5e9', alphaValue: 1, size: 'md', alpha: false, swatches: true, hexInput: true };
    }

    static stories() {
        return {
            'Picker': { value: '#0ea5e9' },
            'With alpha': { value: '#8b5cf6', alpha: true, alphaValue: 0.7 },
            'Large, no swatches': { value: '#f59e0b', size: 'lg', swatches: false },
            'Compact': { value: '#10b981', size: 'sm', hexInput: false }
        };
    }

    static create(container, options = {}) {
        const instance = new ColorPicker(_newColorPickerId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newColorPickerId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...ColorPicker.getDefaultOptions(), ...options };
        const rgb = hexToRgb(this.options.value) || [14, 165, 233];
        [this.h, this.s, this.v] = rgbToHsv(...rgb);
        this.a = clamp(Number(this.options.alphaValue ?? 1), 0, 1);
        this.drag = null;
        this.build();
    }

    get rgb() {
        return hsvToRgb(this.h, this.s, this.v);
    }

    get hex() {
        return rgbToHex(...this.rgb);
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const width = { sm: 200, md: 248, lg: 300 }[this.options.size] || 248;
        this.areaHeight = Math.round(width * 0.62);
        this.width = width;
        this.role = 'group';
        this.ariaLabel = 'Colour picker';
        this.setStyles({
            display: 'inline-flex', flexDirection: 'column', gap: '12px', width: `${width + 24}px`, boxSizing: 'border-box', padding: '12px',
            borderRadius: '16px', backgroundColor: 'var(--surface-card, #0f0f17)', border: '1px solid var(--border-light, #2a2a3a)',
            boxShadow: 'var(--shadow-lg, 0 10px 15px -3px rgba(0,0,0,0.4))', userSelect: 'none'
        });
        // Saturation (x) and brightness (y) for the current hue
        this.areaThumb = el(this, 'area-thumb', 'span', {
            role: 'slider', tabIndex: 0, label: 'Saturation and brightness',
            style: { position: 'absolute', width: '16px', height: '16px', marginLeft: '-8px', marginTop: '-8px', borderRadius: '50%', border: '2px solid #ffffff', boxShadow: '0 0 0 1px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.4)', boxSizing: 'border-box', outline: 'none' }
        });
        this.area = el(this, 'area', 'div', {
            style: {
                position: 'relative', width: `${width}px`, height: `${this.areaHeight}px`, borderRadius: '10px', cursor: 'crosshair', touchAction: 'none',
                backgroundImage: 'linear-gradient(to top, #000000, rgba(0, 0, 0, 0)), linear-gradient(to right, #ffffff, rgba(255, 255, 255, 0))'
            },
            children: [this.areaThumb]
        });
        this.wireDrag(this.area, 'area');
        this.areaThumb.addEventListener('keydown', (event) => this.onKey(event, 'area'));
        this.appendChild(this.area);

        const row = el(this, 'row', 'div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } });
        this.preview = el(this, 'preview', 'span', {
            attrs: { 'aria-hidden': 'true' },
            style: { flex: '0 0 auto', width: '34px', height: '34px', borderRadius: '50%', border: '1px solid var(--border-medium, #3a3a4a)', boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.08)' }
        });
        const sliders = el(this, 'sliders', 'div', { style: { flex: '1', display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '0' } });
        this.hueThumb = this.thumb('hue-thumb', 'Hue');
        this.hue = this.track('hue', 'linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)', this.hueThumb);
        sliders.appendChild(this.hue);
        if (this.options.alpha) {
            this.alphaThumb = this.thumb('alpha-thumb', 'Opacity');
            this.alphaTrack = this.track('alpha', 'none', this.alphaThumb);
            sliders.appendChild(this.alphaTrack);
        } else {
            this.alphaThumb = null;
            this.alphaTrack = null;
        }
        row.appendChild(this.preview);
        row.appendChild(sliders);
        this.appendChild(row);

        if (this.options.hexInput) {
            this.hexField = el(this, 'hex', 'input', {
                label: 'Hex colour', data: { type: 'text', value: this.hex.toUpperCase() }, attrs: { spellcheck: 'false', maxlength: '7' },
                style: { flex: '1', minWidth: '0', height: '32px', boxSizing: 'border-box', padding: '0 10px', borderRadius: '8px', border: '1px solid var(--border-medium, #3a3a4a)', backgroundColor: 'var(--bg-tertiary, #171723)', color: 'var(--text-primary, #e4e4e7)', fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: '13px', outline: 'none' }
            });
            this.hexField.addEventListener('change', (event) => this.setHex(event?.domTarget?.value, true));
            this.rgbLabel = el(this, 'rgb', 'span', { style: { fontSize: '12px', color: 'var(--text-tertiary, #9ca3af)', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono, ui-monospace, monospace)' } });
            this.appendChild(el(this, 'fields', 'div', { style: { display: 'flex', alignItems: 'center', gap: '10px' }, children: [this.hexField, this.rgbLabel] }));
        } else {
            this.hexField = null;
            this.rgbLabel = null;
        }
        if (this.options.swatches) {
            const grid = el(this, 'swatches', 'div', { role: 'listbox', label: 'Preset colours', style: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px' } });
            SWATCHES.forEach((hex, index) => {
                const swatch = el(this, `swatch-${index}`, 'button', {
                    role: 'option', label: hex, attrs: { type: 'button' },
                    style: { height: '24px', padding: '0', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.12)', backgroundColor: hex, cursor: 'pointer', transition: 'transform 120ms ease, box-shadow 120ms ease' }
                });
                swatch.addEventListener('click', () => this.setHex(hex, true));
                swatch.addEventListener('mouseenter', () => swatch.setStyles({ transform: 'scale(1.08)' }));
                swatch.addEventListener('mouseleave', () => swatch.setStyles({ transform: 'none' }));
                grid.appendChild(swatch);
            });
            this.swatchGrid = grid;
            this.appendChild(grid);
        }
        this.paint();
    }

    thumb(part, label) {
        const thumb = el(this, part, 'span', {
            role: 'slider', tabIndex: 0, label,
            style: { position: 'absolute', top: '50%', width: '16px', height: '16px', marginLeft: '-8px', marginTop: '-8px', borderRadius: '50%', border: '2px solid #ffffff', boxShadow: '0 0 0 1px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.4)', boxSizing: 'border-box', outline: 'none' }
        });
        thumb.addEventListener('keydown', (event) => this.onKey(event, part.startsWith('hue') ? 'hue' : 'alpha'));
        return thumb;
    }

    track(part, background, thumb) {
        const track = el(this, part, 'div', {
            style: { position: 'relative', height: '12px', borderRadius: '6px', cursor: 'pointer', touchAction: 'none', backgroundImage: background },
            children: [thumb]
        });
        this.wireDrag(track, part);
        return track;
    }

    wireDrag(node, kind) {
        node.addEventListener('pointerdown', (event) => {
            const native = event?.nativeEvent || event;
            this.drag = kind;
            node.element?.setPointerCapture?.(native.pointerId);
            this.pointAt(kind, node, native);
            native.preventDefault?.();
        });
        node.addEventListener('pointermove', (event) => { if (this.drag === kind) this.pointAt(kind, node, event?.nativeEvent || event); });
        const end = (event) => {
            if (this.drag !== kind) return;
            this.drag = null;
            try { node.element?.releasePointerCapture?.((event?.nativeEvent || event).pointerId); } catch { /* released */ }
            this.emit();
        };
        node.addEventListener('pointerup', end);
        node.addEventListener('pointercancel', end);
    }

    pointAt(kind, node, native) {
        const rect = node.element?.getBoundingClientRect();
        if (!rect) return;
        const x = clamp((native.clientX - rect.left) / rect.width, 0, 1);
        const y = clamp((native.clientY - rect.top) / rect.height, 0, 1);
        if (kind === 'area') { this.s = x; this.v = 1 - y; }
        else if (kind === 'hue') this.h = x * 360;
        else this.a = x;
        this.paint();
    }

    onKey(event, kind) {
        const step = event.shiftKey ? 10 : 1;
        const dx = { ArrowRight: step, ArrowLeft: -step }[event.key] ?? 0;
        const dy = { ArrowUp: step, ArrowDown: -step }[event.key] ?? 0;
        if (!dx && !dy) return;
        event.preventDefault?.();
        if (kind === 'area') {
            this.s = clamp(this.s + dx / 100, 0, 1);
            this.v = clamp(this.v + dy / 100, 0, 1);
        } else if (kind === 'hue') {
            this.h = (this.h + (dx || dy) * 2 + 360) % 360;
        } else {
            this.a = clamp(this.a + (dx || dy) / 100, 0, 1);
        }
        this.paint();
        this.emit();
    }

    paint() {
        const [r, g, b] = this.rgb;
        const hue = `hsl(${Math.round(this.h)}, 100%, 50%)`;
        this.area.setStyles({ backgroundColor: hue });
        this.areaThumb.setStyles({ left: `${(this.s * 100).toFixed(2)}%`, top: `${((1 - this.v) * 100).toFixed(2)}%`, backgroundColor: this.hex });
        this.areaThumb.setAttribute('aria-valuetext', `saturation ${Math.round(this.s * 100)}%, brightness ${Math.round(this.v * 100)}%`);
        this.hueThumb.setStyles({ left: `${(this.h / 3.6).toFixed(2)}%`, backgroundColor: hue });
        this.hueThumb.setAttribute('aria-valuenow', String(Math.round(this.h)));
        this.hueThumb.setAttribute('aria-valuemin', '0');
        this.hueThumb.setAttribute('aria-valuemax', '360');
        if (this.alphaThumb) {
            this.alphaTrack.setStyles({ backgroundColor: '#3a3a4a', backgroundImage: `linear-gradient(to right, rgba(${r}, ${g}, ${b}, 0), rgb(${r}, ${g}, ${b}))` });
            this.alphaThumb.setStyles({ left: `${(this.a * 100).toFixed(2)}%`, backgroundColor: `rgba(${r}, ${g}, ${b}, ${this.a.toFixed(2)})` });
            this.alphaThumb.setAttribute('aria-valuenow', String(Math.round(this.a * 100)));
        }
        this.preview.setStyles({ backgroundColor: `rgba(${r}, ${g}, ${b}, ${this.a.toFixed(2)})` });
        if (this.hexField) {
            const hex = this.hex.toUpperCase();
            this.hexField.userData.value = hex;
            if (this.hexField.element && document.activeElement !== this.hexField.element) this.hexField.element.value = hex;
            this.hexField.markDirty(DIRTY.PAINT);
            this.rgbLabel.setTextContent(this.options.alpha ? `${r} ${g} ${b} · ${Math.round(this.a * 100)}%` : `${r} ${g} ${b}`);
        }
    }

    emit() {
        this.dispatchEvent({ type: 'change', target: this, hex: this.hex, rgb: this.rgb, hsv: [this.h, this.s, this.v], alpha: this.a });
    }

    setHex(hex, fromUser = false) {
        const rgb = hexToRgb(hex);
        if (!rgb) {
            this.paint();
            return;
        }
        const [h, s, v] = rgbToHsv(...rgb);
        if (s > 0) this.h = h;
        this.s = s;
        this.v = v;
        this.paint();
        if (fromUser) this.emit();
    }

    setValue(hex) {
        this.setHex(hex);
    }
}
