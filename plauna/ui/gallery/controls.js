// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Playground controls for the widget showcase.
 *
 * fieldsFor() lists the fields a widget's playground shows: its hand-written
 * schema (schemas.js, applied live through setters) followed by fields
 * inferred from the options its stories use (applied by building the widget
 * again with the new options). createControl() builds one control from
 * Plauna's own widgets: Switch, Number, Range, Textarea, Input and Button.
 */

import { Input as FormInput } from '../../widgets/Input/Input.js';
import { Number as FormNumber } from '../../widgets/Input/Number.js';
import { Range as FormRange } from '../../widgets/Input/Range.js';
import { Button as FormButton } from '../../widgets/Input/Button.js';
import { Switch as FormSwitch } from '../../widgets/Form/Switch.js';
import { Textarea as FormTextarea } from '../../widgets/Form/Textarea.js';
import { CUSTOMIZATION_SCHEMAS } from './schemas.js';

let _controlIdSequence = 0;

/** A module-local id for a control widget. */
export function newControlId(prefix) {
    return `${prefix}-${Date.now()}-${++_controlIdSequence}`;
}

// Option keys that hold one of a few named values
const ENUM_KEYS = new Set([
    'variant', 'tone', 'size', 'status', 'placement', 'type', 'format', 'orientation', 'position', 'align', 'density',
    'padding', 'gap', 'direction', 'lineStyle', 'locale', 'shape', 'circleSize', 'buttonSize', 'trigger'
]);

// Option keys that hold prose, which reads better in a textarea
const LONG_TEXT_KEYS = new Set(['content', 'message', 'description', 'body', 'subheading']);

// Option keys a story sets for the showcase itself, not for the widget's look
const HIDDEN_KEYS = new Set(['showcase', 'story', 'id']);

// Values each enum key offers when the stories use fewer of them
const ENUM_VOCABULARY = {
    size: ['xs', 'sm', 'md', 'lg', 'xl'],
    placement: ['top', 'bottom', 'left', 'right'],
    orientation: ['horizontal', 'vertical'],
    direction: ['horizontal', 'vertical']
};

function labelFor(key) {
    const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ');
    return words.charAt(0).toUpperCase() + words.slice(1);
}

function kindOf(value) {
    if (value === null || value === undefined) return null;
    if (Array.isArray(value) || typeof value === 'object') return 'json';
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'function') return 'function';
    return 'string';
}

// The kind of a declared option: a list of values, or 'boolean' / 'number' / 'text'
function declaredKind(declaration) {
    if (Array.isArray(declaration)) return 'string';
    if (declaration === Boolean || declaration === 'boolean') return 'boolean';
    if (declaration === Number || declaration === 'number') return 'number';
    return 'string';
}

/**
 * Fields inferred from the options every story passes: booleans become
 * switches, numbers number fields, enum-like strings button groups, other
 * strings text fields, and arrays or objects JSON. `declared` is the
 * widget's static optionValues ({ tone: [...], dense: 'boolean' }): every
 * value of a listed option is offered, and declared options no story sets
 * still get a control, starting from `defaults` (getDefaultOptions()).
 */
export function inferFields(stories, skip = new Set(), declared = {}, defaults = {}) {
    const seen = new Map();
    for (const options of Object.values(stories)) {
        for (const [key, value] of Object.entries(options || {})) {
            if (HIDDEN_KEYS.has(key) || skip.has(key)) continue;
            if (!seen.has(key)) seen.set(key, { kinds: new Set(), values: [] });
            const entry = seen.get(key);
            const kind = kindOf(value);
            if (kind) entry.kinds.add(kind);
            if (kind === 'string') entry.values.push(value);
        }
    }
    for (const [key, declaration] of Object.entries(declared || {})) {
        if (seen.has(key) || HIDDEN_KEYS.has(key) || skip.has(key)) continue;
        seen.set(key, { kinds: new Set([declaredKind(declaration)]), values: [] });
    }
    const fields = [];
    for (const [key, { kinds, values }] of seen) {
        if (kinds.has('function')) continue;
        const kind = kinds.size === 1 ? [...kinds][0] : 'string';
        const field = { key, label: labelFor(key), group: 'Options', inferred: true };
        if (defaults && defaults[key] !== undefined && typeof defaults[key] !== 'function') field.fallback = defaults[key];
        const listed = Array.isArray(declared?.[key]) ? declared[key] : null;
        if (kind === 'boolean' || kind === 'number' || kind === 'json') {
            field.type = kind;
        } else {
            const distinct = [...new Set(values)];
            const enumLike = (listed || ENUM_KEYS.has(key)) && distinct.every((value) => /^[\w-]{1,24}$/.test(value));
            if (enumLike) {
                field.type = 'select';
                field.options = [...new Set([...(listed || ENUM_VOCABULARY[key] || []), ...distinct])];
            } else {
                const long = LONG_TEXT_KEYS.has(key) || distinct.some((value) => value.length > 48);
                field.type = long ? 'textarea' : 'text';
            }
        }
        fields.push(field);
    }
    return fields;
}

/** The playground fields for a widget: its schema, then what its stories add. */
export function fieldsFor(WidgetClass, stories) {
    const schema = CUSTOMIZATION_SCHEMAS[WidgetClass.id] || [];
    const covered = new Set(schema.map((field) => field.key));
    let defaults = {};
    try { defaults = WidgetClass.getDefaultOptions?.() || {}; } catch { defaults = {}; }
    return [...schema, ...inferFields(stories, covered, WidgetClass.optionValues || {}, defaults)];
}

/** A field's current value: the schema's read(), else the playground's args. */
export function readField(field, instance, args) {
    let value = typeof field.read === 'function' ? field.read(instance, args) : (args[field.key] ?? field.fallback);
    if (field.type === 'boolean') return Boolean(value);
    if (field.type === 'number' || field.type === 'range') return Number(value ?? 0);
    if (field.type === 'json') return value === undefined ? null : value;
    return value ?? '';
}

function normalizeOptions(field, instance, args) {
    const raw = typeof field.options === 'function' ? field.options(instance, args) : field.options || [];
    return raw.map((option) => {
        if (option && typeof option === 'object') {
            const value = option.value ?? option.id ?? option.key ?? '';
            const text = value === null || value === undefined ? '' : String(value);
            return { value: text, label: String(option.label ?? option.text ?? (text === '' ? 'none' : text)), disabled: Boolean(option.disabled) };
        }
        const text = option === null || option === undefined ? '' : String(option);
        return { value: text, label: text === '' ? 'none' : text, disabled: false };
    });
}

/**
 * One control for `field`. `render(widget)` turns a control widget into its
 * element; `onChange(value)` is called with the new value. Returns
 * { element, widgets, sync(value), refresh() }: sync shows a value without
 * reporting it, refresh rebuilds option lists that depend on the instance.
 */
export function createControl(field, { instance, args, value, render, onChange }) {
    const id = newControlId(`gallery-control-${field.key}`);
    const min = () => (typeof field.min === 'function' ? field.min(instance(), args) : field.min);
    const max = () => (typeof field.max === 'function' ? field.max(instance(), args) : field.max);

    if (field.type === 'boolean') {
        const widget = new FormSwitch(id, { checked: Boolean(value), label: '', size: 'sm', variant: 'primary' });
        widget.addEventListener('change', () => onChange(Boolean(widget.checked)));
        return {
            element: render(widget),
            widgets: [widget],
            sync: (next) => { if (widget.checked !== Boolean(next)) widget.setChecked(Boolean(next)); }
        };
    }

    if (field.type === 'number' || field.type === 'range') {
        const Widget = field.type === 'range' ? FormRange : FormNumber;
        const widget = new Widget(id, {
            value: Number(value ?? 0), min: min() ?? (field.type === 'range' ? 0 : undefined),
            max: max() ?? (field.type === 'range' ? 100 : undefined), step: field.step ?? 1,
            label: '', size: field.type === 'range' ? 'md' : 'sm', showValue: true
        });
        const report = () => onChange(Number(widget.value));
        widget.addEventListener('input', report);
        widget.addEventListener('change', report);
        return {
            element: render(widget),
            widgets: [widget],
            sync: (next) => {
                const lo = min();
                const hi = max();
                if (lo !== undefined && lo !== null) widget.setMin?.(lo);
                if (hi !== undefined && hi !== null) widget.setMax?.(hi);
                if (Number(widget.value) !== Number(next ?? 0)) widget.setValue(Number(next ?? 0));
            }
        };
    }

    if (field.type === 'select') {
        const element = document.createElement('div');
        element.className = 'pg-choice';
        element.setAttribute('role', 'group');
        element.setAttribute('aria-label', field.label);
        let buttons = [];
        let signature = '';
        const build = (options) => {
            for (const { button } of buttons) button.destroy?.();
            element.replaceChildren();
            buttons = options.map((option, index) => {
                const button = new FormButton(`${id}-${index}`, {
                    text: option.label, variant: 'secondary', size: 'sm',
                    onClick: () => { if (!option.disabled) onChange(option.value === '' ? null : option.value); }
                });
                if (option.disabled) button.setDisabled(true);
                element.appendChild(render(button));
                return { option, button };
            });
        };
        const sync = (next) => {
            const current = next === null || next === undefined ? '' : String(next);
            for (const { option, button } of buttons) {
                const selected = option.value === current;
                button.setSelected?.(selected);
                button.setVariant?.(selected ? 'primary' : 'secondary');
            }
        };
        const refresh = () => {
            const options = normalizeOptions(field, instance(), args);
            const next = JSON.stringify(options);
            if (next !== signature) {
                signature = next;
                build(options);
            }
        };
        refresh();
        sync(value);
        return { element, get widgets() { return buttons.map(({ button }) => button); }, sync, refresh };
    }

    if (field.type === 'json') {
        const text = (next) => (next === null || next === undefined ? '' : JSON.stringify(next, null, 2));
        const widget = new FormTextarea(id, { value: text(value), label: '', rows: 5, size: 'sm' });
        const element = document.createElement('div');
        element.className = 'pg-json';
        const note = document.createElement('div');
        note.className = 'pg-json-note';
        note.textContent = 'JSON';
        const report = () => {
            const source = String(widget.value ?? '').trim();
            if (!source) {
                note.textContent = 'JSON';
                note.dataset.state = '';
                onChange(undefined);
                return;
            }
            try {
                const parsed = JSON.parse(source);
                note.textContent = 'JSON';
                note.dataset.state = '';
                onChange(parsed);
            } catch (error) {
                // Typing passes through invalid JSON: say so and keep the last value
                note.textContent = `Invalid JSON: ${error.message}`;
                note.dataset.state = 'invalid';
            }
        };
        widget.addEventListener('change', report);
        element.append(render(widget), note);
        return {
            element,
            widgets: [widget],
            sync: (next) => {
                if (note.dataset.state === 'invalid') return;
                const formatted = text(next);
                let current = null;
                try { current = JSON.stringify(JSON.parse(String(widget.value || 'null'))); } catch { /* being edited */ }
                if (current !== JSON.stringify(next ?? null)) widget.setValue(formatted);
            }
        };
    }

    if (field.type === 'textarea') {
        const widget = new FormTextarea(id, { value: String(value ?? ''), label: '', rows: field.rows || 3, size: 'sm' });
        const report = () => onChange(String(widget.value ?? ''));
        widget.addEventListener('input', report);
        widget.addEventListener('change', report);
        return {
            element: render(widget),
            widgets: [widget],
            sync: (next) => { if (widget.value !== String(next ?? '')) widget.setValue(String(next ?? '')); }
        };
    }

    const widget = new FormInput(id, {
        value: String(value ?? ''), placeholder: field.placeholder || field.label, label: '', size: 'sm'
    });
    const report = () => onChange(String(widget.value ?? ''));
    widget.addEventListener('input', report);
    widget.addEventListener('change', report);
    return {
        element: render(widget),
        widgets: [widget],
        sync: (next) => { if (widget.value !== String(next ?? '')) widget.setValue(String(next ?? '')); }
    };
}
