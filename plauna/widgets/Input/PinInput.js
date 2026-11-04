// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * PinInput - one box per character for codes and PINs. Typing moves to the
 * next box, Backspace to the previous one, arrow keys move between boxes
 * and a pasted code fills them all. Fires 'change' and, once every box is
 * filled, 'complete'.
 */

import { UINode, DIRTY } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, tone, sizeScale, SIZES, TONES, TRANSITION, clamp } from '../shared/appearance.js';

let _pinSequence = 0;

function _newPinId() {
    return `pin-input-${Date.now()}-${++_pinSequence}`;
}

export class PinInput extends UINode {
    static id = 'pin-input';
    static name = 'PIN Input';
    static category = 'input';
    static icon = '🔢';
    static description = 'One box per character for codes and PINs';
    static tags = ['input', 'pin', 'otp', 'code', 'verification'];
    static emits = ['change'];
    static dependencies = [];
    static optionValues = { type: ['numeric', 'alphanumeric'], variant: ['outline', 'filled', 'underline'], size: SIZES, tone: TONES, mask: 'boolean', disabled: 'boolean', invalid: 'boolean' };

    static getDefaultOptions() {
        return { length: 6, value: '', type: 'numeric', variant: 'outline', size: 'lg', tone: 'primary', mask: false, groupSize: 3, disabled: false, invalid: false, label: 'Verification code' };
    }

    static stories() {
        return {
            'Verification code': { length: 6, value: '4207', groupSize: 3 },
            'PIN, masked': { length: 4, value: '1234', mask: true, variant: 'filled', groupSize: 0 },
            'Invite code': { length: 8, type: 'alphanumeric', value: 'PLA', variant: 'underline', size: 'md', groupSize: 4, tone: 'accent' },
            'Invalid': { length: 6, value: '999999', invalid: true, groupSize: 3 }
        };
    }

    static create(container, options = {}) {
        const instance = new PinInput(_newPinId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newPinId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...PinInput.getDefaultOptions(), ...options };
        this.length = clamp(Number(this.options.length) || 6, 2, 12);
        this.chars = Array.from({ length: this.length }, (_, i) => this.accept(String(this.options.value ?? '')[i] ?? ''));
        this.focusedIndex = -1;
        this.build();
    }

    accept(char) {
        if (!char) return '';
        const c = String(char).slice(-1);
        if (this.options.type === 'numeric') return /\d/.test(c) ? c : '';
        return /[a-z0-9]/i.test(c) ? c.toUpperCase() : '';
    }

    get value() {
        return this.chars.join('');
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { size, groupSize, label, disabled } = this.options;
        const scale = sizeScale(size);
        const box = Math.round(scale.height * 1.12);
        this.role = 'group';
        this.ariaLabel = label;
        this.setStyles({ display: 'inline-flex', alignItems: 'center', gap: `${Math.max(6, scale.gap)}px` });
        this.boxes = [];
        for (let i = 0; i < this.length; i++) {
            if (groupSize > 0 && i > 0 && i % groupSize === 0) {
                this.appendChild(el(this, `sep-${i}`, 'span', {
                    attrs: { 'aria-hidden': 'true' },
                    style: { width: `${Math.round(box * 0.28)}px`, height: '2px', borderRadius: '1px', backgroundColor: 'var(--border-dark, #4a4a5a)' }
                }));
            }
            const input = el(this, `box-${i}`, 'input', {
                label: `${label} character ${i + 1} of ${this.length}`,
                data: { value: this.chars[i], type: this.options.mask ? 'password' : 'text', disabled: Boolean(disabled) },
                attrs: { inputmode: this.options.type === 'numeric' ? 'numeric' : 'text', autocomplete: i === 0 ? 'one-time-code' : 'off', maxlength: '2' },
                style: {
                    width: `${box}px`, height: `${Math.round(box * 1.18)}px`, boxSizing: 'border-box', padding: '0', textAlign: 'center',
                    fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: `${Math.round(scale.fontSize * 1.45)}px`, fontWeight: '700',
                    color: 'var(--text-primary, #e4e4e7)', caretColor: 'var(--color-primary, #0ea5e9)', outline: 'none', transition: TRANSITION
                }
            });
            const index = i;
            input.addEventListener('input', (event) => this.onInput(event, index));
            input.addEventListener('keydown', (event) => this.onKey(event, index));
            input.addEventListener('paste', (event) => this.onPaste(event, index));
            input.addEventListener('focus', (event) => { this.focusedIndex = index; event?.domTarget?.select?.(); this.paint(); });
            input.addEventListener('blur', () => { if (this.focusedIndex === index) this.focusedIndex = -1; this.paint(); });
            this.appendChild(input);
            this.boxes.push(input);
        }
        this.paint();
    }

    paint() {
        const { variant, invalid, disabled } = this.options;
        const c = tone(invalid ? 'danger' : this.options.tone);
        this.boxes.forEach((input, index) => {
            const focused = index === this.focusedIndex;
            const filled = Boolean(this.chars[index]);
            const accent = invalid || focused;
            const style = {
                opacity: disabled ? '0.5' : '1',
                borderRadius: variant === 'underline' ? '0' : '10px',
                boxShadow: focused && variant !== 'underline' ? `0 0 0 3px ${c.soft}` : 'none'
            };
            if (variant === 'underline') {
                Object.assign(style, {
                    backgroundColor: 'transparent', border: 'none',
                    borderBottom: `2px solid ${accent ? c.base : filled ? 'var(--border-dark, #4a4a5a)' : 'var(--border-medium, #3a3a4a)'}`
                });
            } else if (variant === 'filled') {
                Object.assign(style, {
                    backgroundColor: accent ? c.soft : 'var(--bg-tertiary, #171723)',
                    border: `1px solid ${accent ? c.base : 'transparent'}`
                });
            } else {
                Object.assign(style, {
                    backgroundColor: 'var(--surface-card, #0f0f17)',
                    border: `1px solid ${accent ? c.base : filled ? 'var(--border-dark, #4a4a5a)' : 'var(--border-medium, #3a3a4a)'}`
                });
            }
            input.setStyles(style);
            input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
        });
    }

    setChar(index, char) {
        this.chars[index] = char;
        const input = this.boxes[index];
        if (input) {
            input.userData.value = char;
            if (input.element && input.element.value !== char) input.element.value = char;
            input.markDirty(DIRTY.PAINT);
        }
    }

    emit() {
        this.dispatchEvent({ type: 'change', target: this, value: this.value });
        if (this.chars.every(Boolean)) this.dispatchEvent({ type: 'complete', target: this, value: this.value });
        this.paint();
    }

    focusBox(index) {
        const target = this.boxes[clamp(index, 0, this.length - 1)];
        target?.element?.focus?.();
        target?.element?.select?.();
    }

    onInput(event, index) {
        const raw = event?.domTarget?.value ?? event?.target?.value ?? '';
        if (raw.length > 1) {
            this.fill(raw, index);
            return;
        }
        const char = this.accept(raw);
        this.setChar(index, char);
        if (char && index < this.length - 1) this.focusBox(index + 1);
        this.emit();
    }

    onKey(event, index) {
        if (event.key === 'Backspace' && !this.chars[index] && index > 0) {
            event.preventDefault?.();
            this.setChar(index - 1, '');
            this.focusBox(index - 1);
            this.emit();
        } else if (event.key === 'ArrowLeft') {
            event.preventDefault?.();
            this.focusBox(index - 1);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault?.();
            this.focusBox(index + 1);
        } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault?.();
            this.focusBox(event.key === 'Home' ? 0 : this.length - 1);
        }
    }

    onPaste(event, index) {
        const text = event?.clipboardData?.getData?.('text') ?? event?.originalEvent?.clipboardData?.getData?.('text') ?? '';
        if (!text) return;
        event.preventDefault?.();
        this.fill(text, index);
    }

    /** Spread a typed or pasted string over the boxes from `start`. */
    fill(text, start = 0) {
        const chars = [...String(text)].map((c) => this.accept(c)).filter(Boolean);
        let index = start;
        for (const char of chars) {
            if (index >= this.length) break;
            this.setChar(index++, char);
        }
        this.focusBox(Math.min(index, this.length - 1));
        this.emit();
    }

    setValue(value) {
        for (let i = 0; i < this.length; i++) this.setChar(i, this.accept(String(value ?? '')[i] ?? ''));
        this.paint();
    }

    clear() {
        this.setValue('');
        this.focusBox(0);
    }

    setInvalid(invalid) {
        this.options.invalid = Boolean(invalid);
        this.paint();
    }
}
