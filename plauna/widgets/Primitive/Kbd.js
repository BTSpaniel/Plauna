// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Kbd - keyboard keys and shortcuts ("Ctrl+K", "⌘ Shift P"), drawn as keycaps.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, sizeScale, SIZES, mix } from '../shared/appearance.js';

let _kbdSequence = 0;

function _newKbdId() {
    return `kbd-${Date.now()}-${++_kbdSequence}`;
}

const KEY_GLYPHS = {
    cmd: '⌘', command: '⌘', meta: '⌘', shift: '⇧', option: '⌥', alt: 'Alt', ctrl: 'Ctrl', control: 'Ctrl',
    enter: '↵', return: '↵', backspace: '⌫', delete: '⌦', esc: 'Esc', escape: 'Esc', tab: 'Tab',
    up: '↑', down: '↓', left: '←', right: '→', space: 'Space'
};

/** "Ctrl+Shift+P" or ["Ctrl", "P"] → ['Ctrl', 'Shift', 'P'] with glyphs for named keys. */
function parseKeys(keys, glyphs) {
    const list = Array.isArray(keys) ? keys : String(keys ?? '').split(/\s*\+\s*|\s+/).filter(Boolean);
    return list.map((key) => {
        const named = KEY_GLYPHS[String(key).toLowerCase()];
        if (glyphs && named) return named;
        return String(key).length === 1 ? String(key).toUpperCase() : String(key);
    });
}

export class Kbd extends UINode {
    static id = 'kbd';
    static name = 'Kbd';
    static category = 'primitive';
    static icon = '⌨️';
    static description = 'Keyboard keys and shortcuts as keycaps';
    static tags = ['primitive', 'kbd', 'keyboard', 'shortcut', 'hotkey'];
    static dependencies = [];
    static optionValues = { size: SIZES, variant: ['raised', 'flat', 'outline', 'ghost'], separator: ['+', 'then', 'none'], glyphs: 'boolean' };

    static getDefaultOptions() {
        return { keys: 'Ctrl+K', size: 'sm', variant: 'raised', separator: '+', glyphs: true };
    }

    static stories() {
        return {
            'Shortcut': { keys: 'Ctrl+K', variant: 'raised', size: 'md' },
            'Mac chord': { keys: 'Cmd+Shift+P', variant: 'raised', size: 'md', glyphs: true },
            'Sequence': { keys: ['G', 'H'], separator: 'then', variant: 'outline', size: 'md' },
            'Flat small': { keys: 'Esc', variant: 'flat', size: 'sm' },
            'Large keys': { keys: ['Up', 'Down', 'Enter'], separator: 'none', variant: 'raised', size: 'lg', glyphs: true }
        };
    }

    static create(container, options = {}) {
        const instance = new Kbd(_newKbdId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newKbdId(), options = {}) {
        super(id, 'span');
        this.tag = 'span';
        this.options = { ...Kbd.getDefaultOptions(), ...options };
        this.build();
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { size, variant, separator, glyphs } = this.options;
        const keys = parseKeys(this.options.keys, glyphs !== false);
        const scale = sizeScale(size);
        const height = Math.max(18, Math.round(scale.height * 0.72));
        this.ariaLabel = keys.join(separator === 'then' ? ' then ' : ' + ');
        this.setStyles({
            display: 'inline-flex', alignItems: 'center', gap: `${Math.max(3, scale.gap - 3)}px`,
            verticalAlign: 'middle', color: 'var(--text-secondary, #d1d5db)', fontSize: `${scale.fontSize - 1}px`
        });
        keys.forEach((key, index) => {
            if (index > 0 && separator !== 'none') {
                this.appendChild(el(this, `sep-${index}`, 'span', {
                    text: separator === 'then' ? 'then' : '+',
                    attrs: { 'aria-hidden': 'true' },
                    style: { color: 'var(--text-tertiary, #9ca3af)', fontSize: `${scale.fontSize - 2}px` }
                }));
            }
            this.appendChild(el(this, `key-${index}`, 'kbd', { text: key, style: this.keyStyle(variant, height, scale) }));
        });
    }

    keyStyle(variant, height, scale) {
        const base = {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            minWidth: `${height}px`, height: `${height}px`, padding: `0 ${Math.round(height / 3.2)}px`,
            boxSizing: 'border-box', borderRadius: `${Math.max(4, scale.radius - 3)}px`,
            fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: `${scale.fontSize - 1}px`,
            fontWeight: '600', lineHeight: '1', color: 'var(--text-primary, #e4e4e7)',
            border: '1px solid var(--border-medium, #3a3a4a)', whiteSpace: 'nowrap'
        };
        if (variant === 'flat') return { ...base, backgroundColor: 'var(--bg-tertiary, #171723)', borderColor: 'transparent' };
        if (variant === 'outline') return { ...base, backgroundColor: 'transparent' };
        if (variant === 'ghost') return { ...base, backgroundColor: 'transparent', borderColor: 'transparent', color: 'var(--text-secondary, #d1d5db)' };
        return {
            ...base,
            backgroundImage: `linear-gradient(180deg, var(--bg-quaternary, #1f1f2e), var(--bg-tertiary, #171723))`,
            borderBottomWidth: '2px',
            boxShadow: `0 1px 0 ${mix('var(--text-primary, #e4e4e7)', 8)}, 0 2px 4px rgba(0, 0, 0, 0.18)`
        };
    }

    setKeys(keys) {
        this.options.keys = keys;
        this.build();
    }

    setVariant(variant) {
        this.options.variant = variant;
        this.build();
    }

    setSize(size) {
        this.options.size = size;
        this.build();
    }
}
