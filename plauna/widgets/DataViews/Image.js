// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Image - a picture in a fixed aspect ratio with rounded corners, cover or
 * contain fit, an optional caption or overlay title, a zoom on hover and a
 * placeholder when there is no source or it fails to load.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, tone, TONES, mix } from '../shared/appearance.js';

let _imageSequence = 0;

function _newImageId() {
    return `image-${Date.now()}-${++_imageSequence}`;
}

/** A small landscape drawn as SVG, so stories have a picture without fetching one. */
export const SAMPLE_LANDSCAPE = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">'
    + '<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e1b4b"/><stop offset="0.6" stop-color="#7c3aed"/><stop offset="1" stop-color="#f472b6"/></linearGradient></defs>'
    + '<rect width="320" height="200" fill="url(#sky)"/><circle cx="236" cy="78" r="26" fill="#fde68a"/>'
    + '<path d="M0 150 L70 92 L120 132 L180 70 L250 140 L320 104 L320 200 L0 200 Z" fill="#312e81"/>'
    + '<path d="M0 170 L60 134 L130 168 L200 120 L270 166 L320 146 L320 200 L0 200 Z" fill="#0f172a"/></svg>'
);

export class ImageView extends UINode {
    static id = 'image';
    static name = 'Image';
    static category = 'dataviews';
    static icon = '🖼️';
    static description = 'Picture with ratio, caption, zoom and placeholder';
    static tags = ['dataviews', 'image', 'picture', 'photo', 'thumbnail', 'media'];
    static dependencies = [];
    static optionValues = { ratio: ['16/9', '4/3', '1/1', '3/4', '21/9'], fit: ['cover', 'contain'], radius: ['none', 'md', 'lg', 'full'], captionStyle: ['below', 'overlay'], zoom: 'boolean', bordered: 'boolean', tone: TONES };

    static getDefaultOptions() {
        return { src: SAMPLE_LANDSCAPE, alt: 'Mountains at dusk', ratio: '16/9', fit: 'cover', radius: 'lg', caption: '', captionStyle: 'below', zoom: true, bordered: true, width: 320, tone: 'primary' };
    }

    static stories() {
        return {
            'Landscape': { src: SAMPLE_LANDSCAPE, caption: 'Dusk over the northern ridge' },
            'Overlay title': { src: SAMPLE_LANDSCAPE, caption: 'Northern ridge', captionStyle: 'overlay', ratio: '4/3' },
            'Round avatar': { src: SAMPLE_LANDSCAPE, ratio: '1/1', radius: 'full', width: 120, bordered: false },
            'Placeholder': { src: '', alt: 'No preview yet', caption: 'Rendering preview…', tone: 'accent' }
        };
    }

    static create(container, options = {}) {
        const instance = new ImageView(_newImageId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newImageId(), options = {}) {
        super(id, 'figure');
        this.tag = 'figure';
        this.options = { ...ImageView.getDefaultOptions(), ...options };
        this.failed = false;
        this.build();
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { src, alt, ratio, fit, radius, caption, captionStyle, bordered, width } = this.options;
        const corner = { none: '0', md: '10px', lg: '16px', full: '9999px' }[radius] ?? '16px';
        this.setStyles({ display: 'flex', flexDirection: 'column', gap: '8px', margin: '0', width: `${width}px`, maxWidth: '100%' });
        const frameChildren = [];
        if (src && !this.failed) {
            this.picture = el(this, 'img', 'img', {
                data: { src, alt: alt || '' },
                style: { display: 'block', width: '100%', height: '100%', objectFit: fit, transition: 'transform 400ms var(--ease-out, ease)' }
            });
            this.picture.addEventListener('error', () => { this.failed = true; this.build(); });
            frameChildren.push(this.picture);
        } else {
            this.picture = null;
            const c = tone(this.options.tone);
            frameChildren.push(el(this, 'placeholder', 'div', {
                role: 'img', label: alt || 'Image unavailable',
                style: {
                    width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px', color: c.base,
                    backgroundImage: `linear-gradient(135deg, ${mix(c.base, 16)}, ${mix('var(--color-accent, #8b5cf6)', 8)})`, backgroundColor: 'var(--bg-tertiary, #171723)'
                },
                children: [icon(this, 'placeholder-icon', ICONS.image, 28, { strokeWidth: 1.6 }), el(this, 'placeholder-text', 'span', { text: alt || 'No image', style: { fontSize: '12px', color: 'var(--text-tertiary, #9ca3af)' } })]
            }));
        }
        if (caption && captionStyle === 'overlay') {
            frameChildren.push(el(this, 'overlay', 'div', {
                text: caption,
                style: {
                    position: 'absolute', left: '0', right: '0', bottom: '0', padding: '28px 14px 12px', fontSize: '15px', fontWeight: '700', color: '#ffffff',
                    backgroundImage: 'linear-gradient(to top, rgba(0, 0, 0, 0.72), rgba(0, 0, 0, 0))'
                }
            }));
        }
        this.frame = el(this, 'frame', 'div', {
            style: {
                position: 'relative', width: '100%', aspectRatio: String(ratio).replace('/', ' / '), overflow: 'hidden', borderRadius: corner,
                border: bordered ? '1px solid var(--border-light, #2a2a3a)' : 'none', backgroundColor: 'var(--bg-tertiary, #171723)',
                boxShadow: bordered ? 'var(--shadow-md, 0 4px 6px -1px rgba(0,0,0,0.4))' : 'none'
            },
            children: frameChildren
        });
        if (this.options.zoom && this.picture) {
            this.frame.addEventListener('mouseenter', () => this.picture?.setStyles({ transform: 'scale(1.06)' }));
            this.frame.addEventListener('mouseleave', () => this.picture?.setStyles({ transform: 'none' }));
        }
        this.appendChild(this.frame);
        if (caption && captionStyle !== 'overlay') {
            this.appendChild(el(this, 'caption', 'figcaption', { text: caption, style: { fontSize: '12px', color: 'var(--text-tertiary, #9ca3af)', textAlign: radius === 'full' ? 'center' : 'left' } }));
        }
    }

    setSource(src) {
        this.options.src = src;
        this.failed = false;
        this.build();
    }
}
