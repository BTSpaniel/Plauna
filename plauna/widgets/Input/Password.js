// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Password - a password field with a show/hide toggle, a four-step strength
 * meter and a live checklist of requirements.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, tone, sizeScale, SIZES, variantStyles, bindInteraction, TRANSITION } from '../shared/appearance.js';

let _passwordSequence = 0;

function _newPasswordId() {
    return `password-${Date.now()}-${++_passwordSequence}`;
}

const RULES = [
    { id: 'length', label: 'At least 8 characters', test: (v) => v.length >= 8 },
    { id: 'case', label: 'Upper and lower case', test: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v) },
    { id: 'number', label: 'A number', test: (v) => /\d/.test(v) },
    { id: 'symbol', label: 'A symbol', test: (v) => /[^A-Za-z0-9]/.test(v) }
];

const LEVELS = [
    { label: 'Too short', tone: 'neutral' },
    { label: 'Weak', tone: 'danger' },
    { label: 'Fair', tone: 'warning' },
    { label: 'Good', tone: 'info' },
    { label: 'Strong', tone: 'success' }
];

/** 0 (empty) to 4 (strong): one point per rule met, capped by length. */
export function passwordScore(value) {
    const v = String(value ?? '');
    if (!v) return 0;
    let score = RULES.reduce((sum, rule) => sum + (rule.test(v) ? 1 : 0), 0);
    if (v.length < 8) score = Math.min(score, 1);
    if (v.length >= 14 && score >= 3) score = 4;
    return Math.max(1, Math.min(4, score));
}

export class Password extends UINode {
    static id = 'password';
    static name = 'Password';
    static category = 'input';
    static icon = '🔑';
    static description = 'Password field with reveal, strength meter and requirements';
    static tags = ['input', 'password', 'strength', 'security', 'form'];
    static emits = ['change'];
    static dependencies = [];
    static optionValues = { variant: ['outline', 'filled'], size: SIZES, showStrength: 'boolean', showRules: 'boolean', revealed: 'boolean', disabled: 'boolean' };

    static getDefaultOptions() {
        return { label: 'Password', placeholder: 'Create a password', value: '', variant: 'outline', size: 'md', showStrength: true, showRules: true, revealed: false, disabled: false, hint: '' };
    }

    static stories() {
        return {
            'Strength and rules': { label: 'New password', value: 'Particle7', showStrength: true, showRules: true },
            'Strong, revealed': { label: 'Password', value: 'Realm-Forge#2026', revealed: true, showRules: false },
            'Filled, empty': { label: 'Password', variant: 'filled', value: '', hint: 'Use a passphrase you do not use anywhere else.', showRules: false },
            'Compact': { label: 'Password', value: 'abc', size: 'sm', showRules: false }
        };
    }

    static create(container, options = {}) {
        const instance = new Password(_newPasswordId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newPasswordId(), options = {}) {
        super(id, 'div');
        this.tag = 'div';
        this.options = { ...Password.getDefaultOptions(), ...options };
        this.value = String(this.options.value ?? '');
        this.revealed = Boolean(this.options.revealed);
        this.focused = false;
        this.build();
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { label, placeholder, size, showStrength, showRules, hint, disabled } = this.options;
        const scale = sizeScale(size);
        this.setStyles({ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', maxWidth: '360px', minWidth: '220px' });
        this.appendChild(el(this, 'label', 'label', {
            text: label, data: { for: `${this.id}-input` },
            style: { fontSize: '13px', fontWeight: '600', color: 'var(--text-secondary, #d1d5db)' }
        }));
        this.field = el(this, 'field', 'div', {
            style: {
                display: 'flex', alignItems: 'center', gap: '6px', height: `${scale.height + 4}px`, boxSizing: 'border-box',
                padding: `0 4px 0 ${scale.padX}px`, borderRadius: `${scale.radius + 1}px`, transition: TRANSITION
            }
        });
        this.field.appendChild(icon(this, 'lock', ['M6 11h12v10H6z', 'M8 11V7a4 4 0 0 1 8 0v4'], scale.icon, { style: { color: 'var(--text-tertiary, #9ca3af)' } }));
        this.input = el(this, 'input', 'input', {
            data: { type: this.revealed ? 'text' : 'password', value: this.value, placeholder, disabled: Boolean(disabled) },
            attrs: { autocomplete: 'new-password', spellcheck: 'false', 'aria-describedby': showStrength ? `${this.id}-meter-label` : null },
            style: {
                flex: '1', minWidth: '0', height: '100%', border: 'none', outline: 'none', backgroundColor: 'transparent',
                color: 'var(--text-primary, #e4e4e7)', fontFamily: 'inherit', fontSize: `${scale.fontSize}px`, letterSpacing: this.spacing()
            }
        });
        this.input.addEventListener('input', (event) => this.onInput(event));
        this.input.addEventListener('focus', () => { this.focused = true; this.paint(); });
        this.input.addEventListener('blur', () => { this.focused = false; this.paint(); });
        this.field.appendChild(this.input);
        this.toggle = el(this, 'toggle', 'button', {
            label: this.revealed ? 'Hide password' : 'Show password', attrs: { type: 'button', 'aria-pressed': this.revealed ? 'true' : 'false' },
            style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: `${scale.height - 6}px`, height: `${scale.height - 6}px`, padding: '0', borderRadius: `${scale.radius}px`, border: '1px solid transparent', cursor: 'pointer', transition: TRANSITION },
            children: [icon(this, 'eye', this.revealed ? ICONS.eyeOff : ICONS.eye, scale.icon)]
        });
        bindInteraction(this.toggle, (state) => this.toggle.setStyles(variantStyles('ghost', 'neutral', state)));
        this.toggle.addEventListener('click', () => this.setRevealed(!this.revealed));
        this.field.appendChild(this.toggle);
        this.appendChild(this.field);

        if (showStrength) {
            this.bars = [0, 1, 2, 3].map((i) => el(this, `bar-${i}`, 'span', {
                style: { flex: '1', height: '4px', borderRadius: '2px', transition: 'background-color var(--duration-base, 200ms) ease' }
            }));
            this.meterLabel = el(this, 'meter-label', 'span', { style: { minWidth: '58px', textAlign: 'right', fontSize: '12px', fontWeight: '600' } });
            this.appendChild(el(this, 'meter', 'div', {
                role: 'meter', attrs: { 'aria-valuemin': '0', 'aria-valuemax': '4', 'aria-label': 'Password strength' },
                style: { display: 'flex', alignItems: 'center', gap: '6px' },
                children: [...this.bars, this.meterLabel]
            }));
        } else {
            this.bars = [];
            this.meterLabel = null;
        }
        if (showRules) {
            this.ruleNodes = RULES.map((rule) => {
                const mark = el(this, `rule-mark-${rule.id}`, 'span', {
                    style: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '16px', height: '16px', borderRadius: '50%', transition: TRANSITION },
                    children: [icon(this, `rule-icon-${rule.id}`, ICONS.check, 11, { strokeWidth: 3 })]
                });
                const row = el(this, `rule-${rule.id}`, 'li', {
                    style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', transition: TRANSITION },
                    children: [mark, el(this, `rule-text-${rule.id}`, 'span', { text: rule.label })]
                });
                return { rule, row, mark };
            });
            this.appendChild(el(this, 'rules', 'ul', {
                label: 'Password requirements',
                style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', margin: '2px 0 0', padding: '0', listStyle: 'none' },
                children: this.ruleNodes.map((r) => r.row)
            }));
        } else {
            this.ruleNodes = [];
        }
        if (hint) {
            this.appendChild(el(this, 'hint', 'div', { text: hint, style: { fontSize: '12px', color: 'var(--text-tertiary, #9ca3af)' } }));
        }
        this.paint();
    }

    /** Masked dots read better spaced out; the placeholder and revealed text do not. */
    spacing() {
        return this.revealed || !this.value ? '0' : '0.12em';
    }

    paint() {
        const { variant, disabled } = this.options;
        this.input?.setStyles({ letterSpacing: this.spacing() });
        const score = passwordScore(this.value);
        const level = LEVELS[score];
        const c = tone(level.tone);
        const focus = tone('primary');
        this.field.setStyles({
            opacity: disabled ? '0.55' : '1',
            backgroundColor: variant === 'filled' ? 'var(--bg-tertiary, #171723)' : 'var(--surface-card, #0f0f17)',
            border: `1px solid ${this.focused ? focus.base : variant === 'filled' ? 'transparent' : 'var(--border-medium, #3a3a4a)'}`,
            boxShadow: this.focused ? `0 0 0 3px ${focus.soft}` : 'none'
        });
        this.bars.forEach((bar, i) => bar.setStyles({ backgroundColor: i < score ? c.base : 'var(--bg-quaternary, #1f1f2e)' }));
        if (this.meterLabel) {
            this.meterLabel.setTextContent(this.value ? level.label : '');
            this.meterLabel.setStyles({ color: c.text });
            this.meterLabel.parent?.setAttribute('aria-valuenow', String(score));
            this.meterLabel.parent?.setAttribute('aria-valuetext', this.value ? level.label : 'Empty');
        }
        for (const { rule, row, mark } of this.ruleNodes) {
            const met = rule.test(this.value);
            const ok = tone('success');
            row.setStyles({ color: met ? 'var(--text-secondary, #d1d5db)' : 'var(--text-tertiary, #9ca3af)' });
            mark.setStyles({ backgroundColor: met ? ok.soft : 'var(--bg-tertiary, #171723)', color: met ? ok.base : 'transparent', border: `1px solid ${met ? ok.subtleBorder : 'var(--border-medium, #3a3a4a)'}` });
        }
    }

    onInput(event) {
        this.value = event?.domTarget?.value ?? event?.target?.value ?? '';
        this.input.userData.value = this.value;
        this.paint();
        this.dispatchEvent({ type: 'change', target: this, value: this.value, score: passwordScore(this.value) });
    }

    setRevealed(revealed) {
        this.revealed = Boolean(revealed);
        this.input.userData.type = this.revealed ? 'text' : 'password';
        this.input.setStyles({ letterSpacing: this.spacing() });
        this.toggle.ariaLabel = this.revealed ? 'Hide password' : 'Show password';
        this.toggle.setAttribute('aria-pressed', this.revealed ? 'true' : 'false');
        const eye = this.toggle.children[0];
        if (eye) eye.destroy();
        this.toggle.appendChild(icon(this, this.revealed ? 'eye-off' : 'eye', this.revealed ? ICONS.eyeOff : ICONS.eye, sizeScale(this.options.size).icon));
    }

    setValue(value) {
        this.value = String(value ?? '');
        this.input.userData.value = this.value;
        if (this.input.element) this.input.element.value = this.value;
        this.paint();
    }
}
