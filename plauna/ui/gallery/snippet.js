// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Code the showcase shows for a widget with given options: what an app
 * writes to create it through Plauna's public API.
 */

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

const RESERVED = new Set([
    'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else',
    'enum', 'export', 'extends', 'false', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof',
    'new', 'null', 'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof', 'var', 'void',
    'while', 'with', 'yield', 'let', 'static', 'await', 'app'
]);

/** A JavaScript literal for `value`, indented `depth` levels. */
export function literal(value, depth = 0) {
    const pad = '    '.repeat(depth + 1);
    const close = '    '.repeat(depth);
    if (value === undefined) return 'undefined';
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
    if (typeof value === 'function') return '() => {}';
    if (Array.isArray(value)) {
        if (!value.length) return '[]';
        const simple = value.every((item) => item === null || typeof item !== 'object');
        const items = value.map((item) => literal(item, depth + 1));
        const inline = `[${items.join(', ')}]`;
        if (simple && inline.length <= 64) return inline;
        return `[\n${items.map((item) => pad + item).join(',\n')}\n${close}]`;
    }
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    if (!entries.length) return '{}';
    const parts = entries.map(([key, item]) => `${IDENTIFIER.test(key) ? key : literal(key)}: ${literal(item, depth + 1)}`);
    const inline = `{ ${parts.join(', ')} }`;
    if (depth > 0 && inline.length <= 64) return inline;
    return `{\n${parts.map((part) => pad + part).join(',\n')}\n${close}}`;
}

/** A variable name for a widget id: 'input-field' -> 'inputField'. */
export function variableName(id) {
    const name = String(id).replace(/[-_\s]+(\w)/g, (_, c) => c.toUpperCase()).replace(/[^\w$]/g, '');
    if (!IDENTIFIER.test(name)) return 'widget';
    return RESERVED.has(name) ? `${name}Widget` : name;
}

/** Code that creates `WidgetClass` with `options` and puts it in the page. */
export function widgetSnippet(WidgetClass, options) {
    const name = variableName(WidgetClass.id);
    // Names like Number or Date would hide the built-ins
    let className = IDENTIFIER.test(WidgetClass.name) ? WidgetClass.name : 'Widget';
    if (RESERVED.has(className) || className in globalThis) className = `${className}Widget`;
    return [
        "import { createPlaunaApp, widgetRegistry } from './plauna/index.js';",
        '',
        'const app = await createPlaunaApp({ root: document.body });',
        `const ${className} = widgetRegistry.get('${WidgetClass.id}');`,
        `const ${name} = new ${className}('${WidgetClass.id}-1', ${literal(options)});`,
        `document.body.append(app.render(${name}));`
    ].join('\n');
}
