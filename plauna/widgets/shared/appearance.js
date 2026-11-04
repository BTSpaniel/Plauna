// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * appearance - the shared look of Plauna widgets.
 *
 * Tones (primary, accent, neutral, success, warning, danger, info), variants
 * (solid, soft, outline, ghost), sizes (xs to xl) and shapes, built from the
 * theme's CSS variables, so a theme switch restyles every widget without a
 * re-render. Colours are mixed with color-mix(in srgb, ...), which the DOM
 * and the GPU path paint the same. Every variant keeps a 1px border (often
 * transparent), so switching variants never moves anything.
 *
 * Also: interaction states (hover, press, keyboard focus ring), a node
 * builder for widget parts and a shared keyframe sheet.
 */

import { UINode } from '../../core/UINode.js';

export const TONES = ['primary', 'accent', 'neutral', 'success', 'warning', 'danger', 'info'];
export const VARIANTS = ['solid', 'soft', 'surface', 'outline', 'ghost', 'gradient'];
export const RADII = ['none', 'sm', 'md', 'lg', 'full'];
export const SIZES = ['xs', 'sm', 'md', 'lg', 'xl'];
export const SHAPES = ['rounded', 'pill', 'square'];

const TONE_ALIASES = {
    default: 'primary', secondary: 'neutral', gray: 'neutral', grey: 'neutral',
    error: 'danger', destructive: 'danger'
};
const TONE_VARS = {
    primary: ['--color-primary', '#0ea5e9'],
    accent: ['--color-accent', '#8b5cf6'],
    neutral: ['--color-secondary', '#64748b'],
    success: ['--color-success', '#10b981'],
    warning: ['--color-warning', '#f59e0b'],
    danger: ['--color-error', '#ef4444'],
    info: ['--color-info', '#3b82f6']
};

/** A tone name with aliases resolved (error → danger, secondary → neutral); unknown names are primary. */
export function toneName(tone) {
    const name = TONE_ALIASES[tone] || tone;
    return TONE_VARS[name] ? name : 'primary';
}

/** color-mix(in srgb, color p%, other). */
export function mix(color, percent, other = 'transparent') {
    return `color-mix(in srgb, ${color} ${percent}%, ${other})`;
}

/** The colours of one tone, for every surface a widget paints. */
export function tone(name) {
    const t = toneName(name);
    const [variable, fallback] = TONE_VARS[t];
    const base = `var(${variable}, ${fallback})`;
    return {
        name: t,
        base,
        hover: mix(base, 86, 'var(--text-primary, #e4e4e7)'),
        active: mix(base, 74, 'var(--text-primary, #e4e4e7)'),
        on: `var(--on-${t}, ${t === 'warning' ? '#1c1400' : '#ffffff'})`,
        soft: mix(base, 14),
        softHover: mix(base, 22),
        softActive: mix(base, 30),
        border: mix(base, 50),
        subtleBorder: mix(base, 28),
        // 60% keeps tone text at 4.5:1 or more on light surfaces (warning is the hardest)
        text: mix(base, 60, 'var(--text-primary, #e4e4e7)'),
        glow: mix(base, 40)
    };
}

/** Size scale: control height, horizontal padding, font size, gap, corner radius, icon size (px). */
const SIZE_SCALE = {
    xs: { height: 24, padX: 8, fontSize: 12, gap: 4, radius: 6, icon: 12 },
    sm: { height: 30, padX: 11, fontSize: 13, gap: 6, radius: 7, icon: 14 },
    md: { height: 36, padX: 14, fontSize: 14, gap: 8, radius: 9, icon: 16 },
    lg: { height: 42, padX: 18, fontSize: 15, gap: 9, radius: 10, icon: 18 },
    xl: { height: 50, padX: 22, fontSize: 17, gap: 10, radius: 12, icon: 20 }
};

export function sizeScale(size) {
    return SIZE_SCALE[size] || SIZE_SCALE.md;
}

/** Corner radius for a shape at a size. */
export function radiusFor(shape, size = 'md') {
    if (shape === 'pill' || shape === 'circle' || shape === 'full') return '9999px';
    if (shape === 'none') return '0';
    if (shape === 'square' || shape === 'sm') return '4px';
    if (shape === 'lg') return `${sizeScale(size).radius + 4}px`;
    return `${sizeScale(size).radius}px`;
}

/** The keyboard-focus halo as a box-shadow (white in the high-contrast theme). */
export const FOCUS_RING = '0 0 0 3px var(--ring, color-mix(in srgb, var(--color-primary, #0ea5e9) 45%, transparent))';

export const TRANSITION = [
    'background-color', 'color', 'border-color', 'box-shadow', 'transform', 'opacity'
].map((property) => `${property} var(--duration-fast, 120ms) var(--ease-out, ease)`).join(', ');

/**
 * Colours for a variant of a tone in an interaction state ('rest', 'hover'
 * or 'active'): { backgroundColor, backgroundImage, color, borderColor, boxShadow }.
 * 'surface' is a tinted fill with a tinted border; 'gradient' runs from the
 * tone to the accent colour.
 */
export function variantStyles(variant, toneValue, state = 'rest', options = {}) {
    return { backgroundImage: 'none', ...variantColors(variant, toneValue, state, options) };
}

function variantColors(variant, toneValue, state, options) {
    const c = tone(toneValue);
    if (options.disabled) {
        return {
            backgroundColor: variant === 'solid' || variant === 'soft' ? mix('var(--text-tertiary, #9ca3af)', 14) : 'transparent',
            color: 'var(--text-disabled, #6b7280)',
            borderColor: variant === 'outline' ? 'var(--border-light, #2a2a3a)' : 'transparent',
            boxShadow: 'none'
        };
    }
    const pick = (rest, hover, active) => (state === 'active' ? active : state === 'hover' ? hover : rest);
    switch (variant) {
        case 'soft':
            return { backgroundColor: pick(c.soft, c.softHover, c.softActive), color: c.text, borderColor: 'transparent', boxShadow: 'none' };
        case 'outline':
            return { backgroundColor: pick('transparent', mix(c.base, 10), mix(c.base, 18)), color: c.text, borderColor: pick(c.border, c.base, c.base), boxShadow: 'none' };
        case 'ghost':
            return { backgroundColor: pick('transparent', mix(c.base, 12), mix(c.base, 20)), color: c.text, borderColor: 'transparent', boxShadow: 'none' };
        case 'surface':
            return {
                backgroundColor: pick(mix(c.base, 8, 'var(--surface-card, #0f0f17)'), mix(c.base, 14, 'var(--surface-card, #0f0f17)'), mix(c.base, 20, 'var(--surface-card, #0f0f17)')),
                color: c.text, borderColor: pick(c.subtleBorder, c.border, c.border), boxShadow: 'none'
            };
        case 'gradient': {
            const accent = c.name === 'accent' ? 'var(--color-primary, #0ea5e9)' : 'var(--color-accent, #8b5cf6)';
            return {
                backgroundColor: c.base,
                backgroundImage: `linear-gradient(135deg, ${pick(c.base, c.hover, c.active)}, ${accent})`,
                color: c.on, borderColor: 'transparent',
                boxShadow: pick(`0 4px 14px -6px ${c.glow}`, `0 8px 20px -6px ${c.glow}`, 'inset 0 2px 4px rgba(0, 0, 0, 0.18)')
            };
        }
        case 'solid':
        default:
            return {
                backgroundColor: pick(c.base, c.hover, c.active),
                color: c.on,
                borderColor: 'transparent',
                boxShadow: pick(
                    '0 1px 2px rgba(0, 0, 0, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.14)',
                    `0 6px 16px -6px ${c.glow}, inset 0 1px 0 rgba(255, 255, 255, 0.18)`,
                    'inset 0 2px 4px rgba(0, 0, 0, 0.18)'
                )
            };
    }
}

/**
 * Colours of a text field (input, select, textarea, picker shell):
 * { backgroundColor, borderColor, boxShadow }. Focus shows the tone's border
 * and a soft halo; invalid uses danger; 'filled' is a tinted fill with no
 * border at rest. The same keys as variantStyles, so a field can take both.
 */
export function fieldStyles(toneValue = 'primary', state = {}) {
    if (state.disabled) {
        return { backgroundColor: mix('var(--text-tertiary, #9ca3af)', 8), borderColor: 'var(--border-light, #2a2a3a)', boxShadow: 'none' };
    }
    const c = tone(state.invalid ? 'danger' : toneValue);
    const filled = state.variant === 'filled';
    return {
        backgroundColor: filled ? 'var(--bg-tertiary, #171723)' : 'var(--surface-card, #0f0f17)',
        borderColor: state.focused || state.invalid ? c.base
            : state.hovered ? 'var(--border-dark, #4a4a5a)'
            : filled ? 'transparent' : 'var(--border-medium, #3a3a4a)',
        boxShadow: state.focused ? `0 0 0 3px ${c.soft}` : 'none'
    };
}

/** The surface of a floating panel (menus, dropdown lists, pickers, popovers). */
export const OVERLAY = {
    backgroundColor: 'var(--surface-overlay, #0f0f17)',
    borderColor: 'var(--border-medium, #3a3a4a)',
    boxShadow: 'var(--shadow-xl, 0 20px 25px -5px rgba(0, 0, 0, 0.4))'
};

/**
 * Hover, press and keyboard-focus states for an interactive node. `apply(state)`
 * gets 'rest', 'hover' or 'active' and sets the node's styles; the focus ring
 * shows for keyboard focus only (:focus-visible). Returns a function that
 * re-applies the current state (after a variant or disabled change).
 */
export function bindInteraction(node, apply, options = {}) {
    let hovered = false;
    let pressed = false;
    const isDisabled = options.isDisabled || (() => false);
    const current = () => (isDisabled() ? 'rest' : pressed ? 'active' : hovered ? 'hover' : 'rest');
    const update = () => apply(current());
    node.addEventListener('mouseenter', () => { hovered = true; update(); });
    node.addEventListener('mouseleave', () => { hovered = false; pressed = false; update(); });
    node.addEventListener('mousedown', () => { pressed = true; update(); });
    node.addEventListener('mouseup', () => { pressed = false; update(); });
    node.addEventListener('focus', (event) => {
        const target = event?.domTarget || node.element;
        let keyboard = true;
        try { keyboard = target?.matches?.(':focus-visible') ?? true; } catch { /* older engines */ }
        if (keyboard) node.setStyles({ outline: '2px solid var(--color-primary, #0ea5e9)', outlineOffset: '2px' });
    });
    node.addEventListener('blur', () => node.setStyles({ outline: 'none', outlineOffset: '0px' }));
    update();
    return update;
}

let _partSequence = 0;

/**
 * A widget part: el(owner, 'label', 'span', { style, attrs, text, role, children }).
 * The id is the owner's id plus the part name, so parts stay unique per widget.
 */
export function el(owner, part, tag, spec = {}) {
    const id = `${owner?.id ?? 'plauna'}-${part}${spec.unique ? `-${++_partSequence}` : ''}`;
    const node = new UINode(id, tag);
    node.tag = tag;
    if (spec.style) node.setStyles(spec.style);
    const hasChildren = (spec.children || []).some(Boolean);
    if (spec.text !== undefined && spec.text !== null) {
        // A node shows either its own text or its children: with both, the
        // text goes first as its own span so the renderer keeps it
        if (hasChildren) {
            const label = new UINode(`${id}-text`, 'span');
            label.tag = 'span';
            label.textContent = String(spec.text);
            node.appendChild(label);
        } else {
            node.textContent = String(spec.text);
        }
    }
    if (spec.role) node.role = spec.role;
    if (spec.label) node.ariaLabel = spec.label;
    if (spec.tabIndex !== undefined) node.tabIndex = spec.tabIndex;
    for (const [name, value] of Object.entries(spec.attrs || {})) {
        if (value !== null && value !== undefined && value !== false) node.setAttribute(name, value === true ? '' : String(value));
    }
    for (const [key, value] of Object.entries(spec.data || {})) node.userData[key] = value;
    for (const child of spec.children || []) if (child) node.appendChild(child);
    for (const [type, handler] of Object.entries(spec.on || {})) node.addEventListener(type, handler);
    return node;
}

/** An inline SVG icon from path data (24 x 24 view box, stroked in currentColor). */
export function icon(owner, part, paths, size = 16, spec = {}) {
    const svg = new UINode(`${owner?.id ?? 'plauna'}-${part}`, 'svg');
    svg.tag = 'svg';
    Object.assign(svg.userData, {
        viewBox: '0 0 24 24', width: String(size), height: String(size), fill: 'none',
        stroke: 'currentColor', 'stroke-width': String(spec.strokeWidth ?? 2),
        'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true'
    });
    svg.setStyles({ display: 'block', flexShrink: '0', width: `${size}px`, height: `${size}px`, ...(spec.style || {}) });
    (Array.isArray(paths) ? paths : [paths]).forEach((d, index) => {
        const path = new UINode(`${svg.id}-p${index}`, 'path');
        path.tag = 'path';
        path.userData.d = d;
        svg.appendChild(path);
    });
    return svg;
}

/** Path data for the icons the widgets share. */
export const ICONS = {
    check: 'M5 12.5l4.5 4.5L19 7.5',
    x: ['M6 6l12 12', 'M18 6L6 18'],
    chevronDown: 'M6 9l6 6 6-6',
    chevronRight: 'M9 6l6 6-6 6',
    chevronLeft: 'M15 6l-6 6 6 6',
    search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-3.6-3.6'],
    eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
    eyeOff: ['M3 3l18 18', 'M10.6 5.1A10.9 10.9 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2', 'M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'],
    copy: ['M9 9h10v10H9z', 'M5 15V5h10'],
    info: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M12 16v-4', 'M12 8h.01'],
    alert: ['M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4', 'M12 17h.01'],
    checkCircle: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M8 12.5l2.8 2.8L16.5 9.5'],
    xCircle: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z', 'M15 9l-6 6', 'M9 9l6 6'],
    arrowUp: ['M12 19V5', 'M5 12l7-7 7 7'],
    arrowDown: ['M12 5v14', 'M19 12l-7 7-7-7'],
    minus: 'M5 12h14',
    plus: ['M12 5v14', 'M5 12h14'],
    command: 'M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z',
    grip: ['M9 6h.01', 'M15 6h.01', 'M9 12h.01', 'M15 12h.01', 'M9 18h.01', 'M15 18h.01'],
    calendar: ['M4 6h16v14H4z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
    bold: ['M7 5h6a3.5 3.5 0 0 1 0 7H7z', 'M7 12h7a3.5 3.5 0 0 1 0 7H7z'],
    italic: ['M10 5h8', 'M6 19h8', 'M14 5l-4 14'],
    underline: ['M7 4v7a5 5 0 0 0 10 0V4', 'M5 20h14'],
    alignLeft: ['M4 6h16', 'M4 10h10', 'M4 14h16', 'M4 18h10'],
    alignCenter: ['M4 6h16', 'M7 10h10', 'M4 14h16', 'M7 18h10'],
    alignRight: ['M4 6h16', 'M10 10h10', 'M4 14h16', 'M10 18h10'],
    link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
    image: ['M4 5h16v14H4z', 'M4 16l5-5 4 4 3-3 4 4', 'M15 9h.01'],
    undo: ['M9 14L4 9l5-5', 'M4 9h11a5 5 0 0 1 0 10h-3'],
    redo: ['M15 14l5-5-5-5', 'M20 9H9a5 5 0 0 0 0 10h3'],
    file: ['M14 3H6v18h12V7z', 'M14 3v4h4'],
    settings: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
    user: ['M20 21a8 8 0 0 0-16 0', 'M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z'],
    home: ['M3 11l9-8 9 8', 'M5 10v10h14V10'],
    bell: ['M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9', 'M13.7 21a2 2 0 0 1-3.4 0'],
    star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
    zap: 'M13 2L3 14h9l-1 8 10-12h-9z',
    trendUp: ['M3 17l6-6 4 4 8-8', 'M15 7h6v6'],
    trendDown: ['M3 7l6 6 4-4 8 8', 'M15 17h6v-6']
};

const KEYFRAMES_ID = 'plauna-widget-keyframes';

/** Add @keyframes `name` (body: the keyframe list) to the shared sheet once. */
export function ensureKeyframes(name, body) {
    if (typeof document === 'undefined') return;
    let sheet = document.getElementById(KEYFRAMES_ID);
    if (!sheet) {
        sheet = document.createElement('style');
        sheet.id = KEYFRAMES_ID;
        document.head.appendChild(sheet);
    }
    if (sheet.dataset[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())]) return;
    sheet.dataset[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = '1';
    sheet.appendChild(document.createTextNode(`@keyframes ${name} { ${body} }\n`));
}

/**
 * Run fn(element) once the node's element is in the page (checked each frame
 * for up to `frames` frames), for work that needs measured geometry.
 */
export function afterRender(node, fn, frames = 30) {
    if (typeof requestAnimationFrame !== 'function') return;
    let left = frames;
    const check = () => {
        const element = node.element;
        if (element?.isConnected) {
            fn(element);
        } else if (--left > 0 && !node._appearanceDestroyed) {
            requestAnimationFrame(check);
        }
    };
    requestAnimationFrame(check);
}

/**
 * Page coordinates of an absolutely positioned popup (a tooltip or menu) in
 * its containing block: unchanged when that is the page, offset when it is a
 * positioned ancestor such as an app window or a render surface's scene.
 */
export function pageToContainingBlock(element, x, y) {
    const parent = element?.offsetParent;
    if (!parent || parent === document.body || parent === document.documentElement) return { x, y };
    const r = parent.getBoundingClientRect();
    return {
        x: x - (r.left + window.pageXOffset + parent.clientLeft) + parent.scrollLeft,
        y: y - (r.top + window.pageYOffset + parent.clientTop) + parent.scrollTop
    };
}

/**
 * The page-coordinate box { left, top, right, bottom } where an absolutely
 * positioned popup shows: the viewport, narrowed to each ancestor from its
 * containing block up that clips overflow (an app window, a scroller). Boxes
 * between the popup and its containing block do not clip it.
 */
export function popupBounds(element) {
    const sx = window.pageXOffset;
    const sy = window.pageYOffset;
    const bounds = { left: sx, top: sy, right: sx + window.innerWidth, bottom: sy + window.innerHeight };
    for (let a = element?.offsetParent; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
        const cs = getComputedStyle(a);
        const clipX = cs.overflowX !== 'visible';
        const clipY = cs.overflowY !== 'visible';
        if (!clipX && !clipY) continue;
        const r = a.getBoundingClientRect();
        if (clipX) {
            const left = r.left + sx + a.clientLeft;
            bounds.left = Math.max(bounds.left, left);
            bounds.right = Math.min(bounds.right, left + a.clientWidth);
        }
        if (clipY) {
            const top = r.top + sy + a.clientTop;
            bounds.top = Math.max(bounds.top, top);
            bounds.bottom = Math.min(bounds.bottom, top + a.clientHeight);
        }
    }
    return bounds;
}

/** Clamp a number to [min, max]. */
export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
