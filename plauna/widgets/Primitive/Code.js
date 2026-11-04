// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Code - inline code and code blocks: a title bar with the language and a
 * copy button, line numbers, highlighted lines and light syntax colouring
 * for C-like languages, JSON, CSS, shell and WGSL (keywords, strings,
 * numbers, comments), all from theme colours.
 */

import { UINode } from '../../core/UINode.js';
import { widgetRenderer } from '../WidgetRenderer.js';
import { el, icon, ICONS, mix, bindInteraction, variantStyles, TRANSITION } from '../shared/appearance.js';

let _codeSequence = 0;

function _newCodeId() {
    return `code-${Date.now()}-${++_codeSequence}`;
}

const KEYWORDS = new Set([
    'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break',
    'continue', 'new', 'class', 'extends', 'import', 'from', 'export', 'default', 'async', 'await', 'try', 'catch',
    'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'this', 'super', 'static', 'get', 'set', 'yield',
    'true', 'false', 'null', 'undefined', 'void', 'delete', 'def', 'self', 'None', 'True', 'False', 'elif',
    'fn', 'struct', 'var', 'let', 'loop', 'uniform', 'storage', 'read_write', 'workgroup', 'vertex', 'fragment',
    'compute', 'binding', 'group', 'location', 'builtin', 'echo', 'cd', 'export', 'pub', 'impl', 'mut', 'use'
]);

const TOKEN = /(\/\/[^\n]*|#(?![0-9a-f]{3,8}\b)[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[a-z]*\b|#[0-9a-f]{3,8}\b)|(@?[A-Za-z_][\w]*)|(\s+)|([^\s\w])/gi;

/** Split one line into [kind, text] tokens: comment, string, number, keyword, call, type, plain. */
export function tokenizeLine(line, language = 'js') {
    const tokens = [];
    const hashComments = language === 'sh' || language === 'bash' || language === 'python' || language === 'py';
    TOKEN.lastIndex = 0;
    let match;
    while ((match = TOKEN.exec(line))) {
        const [text, comment, string, number, word] = match;
        if (comment && (comment.startsWith('#') ? hashComments : true)) tokens.push(['comment', text]);
        else if (comment) tokens.push(['plain', text]);
        else if (string) tokens.push(['string', text]);
        else if (number) tokens.push(['number', text]);
        else if (word) {
            const next = line.slice(TOKEN.lastIndex).match(/^\s*\(/);
            if (KEYWORDS.has(word) || word.startsWith('@')) tokens.push(['keyword', text]);
            else if (next) tokens.push(['call', text]);
            else if (/^[A-Z]/.test(word)) tokens.push(['type', text]);
            else tokens.push(['plain', text]);
        } else tokens.push(['plain', text]);
    }
    return tokens;
}

const TOKEN_COLORS = {
    comment: 'var(--text-tertiary, #9ca3af)',
    string: mix('var(--color-success, #10b981)', 80, 'var(--text-primary, #e4e4e7)'),
    number: mix('var(--color-warning, #f59e0b)', 85, 'var(--text-primary, #e4e4e7)'),
    keyword: mix('var(--color-accent, #8b5cf6)', 75, 'var(--text-primary, #e4e4e7)'),
    call: mix('var(--color-primary, #0ea5e9)', 80, 'var(--text-primary, #e4e4e7)'),
    type: mix('var(--color-info, #3b82f6)', 70, 'var(--text-primary, #e4e4e7)'),
    plain: 'var(--text-primary, #e4e4e7)'
};

export class Code extends UINode {
    static id = 'code';
    static name = 'Code';
    static category = 'primitive';
    static icon = '🧾';
    static description = 'Inline code and code blocks with copy, line numbers and highlighting';
    static tags = ['primitive', 'code', 'snippet', 'syntax', 'pre', 'copy'];
    static emits = ['copy'];
    static dependencies = [];
    static optionValues = {
        language: ['js', 'json', 'css', 'wgsl', 'python', 'sh', 'text'],
        variant: ['block', 'inline'], theme: ['surface', 'sunken', 'contrast'],
        lineNumbers: 'boolean', copyable: 'boolean', wrap: 'boolean'
    };

    static getDefaultOptions() {
        return { code: '', language: 'js', variant: 'block', theme: 'surface', title: '', lineNumbers: true, copyable: true, wrap: false, highlight: [] };
    }

    static stories() {
        return {
            'JavaScript': {
                title: 'counter.js', language: 'js', highlight: [3],
                code: "import { Button } from 'plauna';\n\nconst button = Button.create(host, { text: 'Count' });\nlet clicks = 0; // starts at zero\nbutton.addEventListener('click', () => button.setContent(`Clicked ${++clicks}`));"
            },
            'WGSL shader': {
                title: 'tint.wgsl', language: 'wgsl', theme: 'sunken',
                code: '@group(0) @binding(0) var<uniform> tint: vec4f;\n\n@fragment\nfn main(@location(0) uv: vec2f) -> @location(0) vec4f {\n    return vec4f(uv, 0.5, 1.0) * tint;\n}'
            },
            'JSON, no numbers': {
                title: 'theme.json', language: 'json', lineNumbers: false,
                code: '{\n  "id": "dark",\n  "extends": "_base",\n  "vars": { "--color-primary": "#0ea5e9", "--radius": 8 }\n}'
            },
            'Shell': { language: 'sh', lineNumbers: false, title: 'Terminal', theme: 'contrast', code: '# start the dev server\npython start_server.py --port 9001' },
            'Inline': { variant: 'inline', code: 'widgetRegistry.get("button")' }
        };
    }

    static create(container, options = {}) {
        const instance = new Code(_newCodeId(), options);
        if (container && container instanceof HTMLElement) {
            container.appendChild(widgetRenderer.render(instance));
        }
        return instance;
    }

    constructor(id = _newCodeId(), options = {}) {
        super(id, options.variant === 'inline' ? 'code' : 'figure');
        this.options = { ...Code.getDefaultOptions(), ...options };
        this.tag = this.options.variant === 'inline' ? 'code' : 'figure';
        this._copyTimer = null;
        this.build();
    }

    surfaceColors() {
        const theme = this.options.theme;
        if (theme === 'sunken') return { bg: 'var(--surface-sunken, #0a0a0f)', bar: 'var(--bg-secondary, #0f0f17)' };
        if (theme === 'contrast') return { bg: '#07070b', bar: '#111118' };
        return { bg: 'var(--surface-card, #0f0f17)', bar: 'var(--bg-tertiary, #171723)' };
    }

    build() {
        for (const child of [...this.children]) child.destroy();
        const { code, language, variant, title, lineNumbers, copyable, wrap } = this.options;
        if (variant === 'inline') {
            this.textContent = String(code ?? '');
            this.setStyles({
                display: 'inline', fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: '0.88em',
                padding: '2px 6px', borderRadius: '6px', color: TOKEN_COLORS.call,
                backgroundColor: mix('var(--color-primary, #0ea5e9)', 12), border: `1px solid ${mix('var(--color-primary, #0ea5e9)', 22)}`
            });
            return;
        }
        const colors = this.surfaceColors();
        this.role = 'group';
        this.ariaLabel = title || `${language} code`;
        this.setStyles({
            display: 'block', margin: '0', borderRadius: '12px', overflow: 'hidden', minWidth: '0',
            border: '1px solid var(--border-light, #2a2a3a)', backgroundColor: colors.bg,
            boxShadow: 'var(--shadow-md, 0 4px 6px -1px rgba(0,0,0,0.4))', fontFamily: 'var(--font-mono, ui-monospace, monospace)'
        });
        const showBar = Boolean(title) || copyable;
        if (showBar) {
            const dots = el(this, 'dots', 'span', {
                attrs: { 'aria-hidden': 'true' }, style: { display: 'inline-flex', gap: '6px', marginRight: '4px' },
                children: ['#ff5f57', '#febc2e', '#28c840'].map((color, index) => el(this, `dot-${index}`, 'span', {
                    style: { width: '10px', height: '10px', borderRadius: '50%', backgroundColor: color, opacity: '0.85' }
                }))
            });
            const name = el(this, 'title', 'figcaption', {
                text: title || language,
                style: { flex: '1', minWidth: '0', fontSize: '12px', color: 'var(--text-secondary, #d1d5db)', fontFamily: 'var(--font-sans, inherit)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
            });
            const lang = el(this, 'lang', 'span', {
                text: language.toUpperCase(),
                style: { fontSize: '10px', fontWeight: '700', letterSpacing: '0.06em', color: 'var(--text-tertiary, #9ca3af)', fontFamily: 'var(--font-sans, inherit)' }
            });
            const bar = el(this, 'bar', 'div', {
                style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 10px 8px 14px', backgroundColor: colors.bar, borderBottom: '1px solid var(--border-light, #2a2a3a)' },
                children: [dots, name, lang]
            });
            if (copyable) bar.appendChild(this.buildCopyButton());
            this.appendChild(bar);
        }
        const highlight = new Set((this.options.highlight || []).map(Number));
        const lines = String(code ?? '').replace(/\t/g, '    ').split('\n');
        const gutter = String(lines.length).length;
        const body = el(this, 'pre', 'pre', {
            style: {
                margin: '0', padding: '12px 0', overflowX: wrap ? 'hidden' : 'auto', fontSize: '13px', lineHeight: '1.65',
                fontFamily: 'var(--font-mono, ui-monospace, monospace)', color: TOKEN_COLORS.plain
            }
        });
        lines.forEach((line, index) => {
            const marked = highlight.has(index + 1);
            const row = el(this, `line-${index}`, 'div', {
                style: {
                    display: 'flex', padding: '0 16px 0 0',
                    backgroundColor: marked ? mix('var(--color-primary, #0ea5e9)', 12) : 'transparent',
                    boxShadow: marked ? 'inset 3px 0 0 var(--color-primary, #0ea5e9)' : 'none'
                }
            });
            if (lineNumbers) {
                row.appendChild(el(this, `num-${index}`, 'span', {
                    text: String(index + 1), attrs: { 'aria-hidden': 'true' },
                    style: { flex: '0 0 auto', boxSizing: 'border-box', width: `calc(${gutter}ch + 30px)`, padding: '0 14px 0 16px', textAlign: 'right', color: marked ? 'var(--text-secondary, #d1d5db)' : 'var(--text-disabled, #6b7280)', userSelect: 'none' }
                }));
            } else {
                row.setStyle('paddingLeft', '16px');
            }
            const text = el(this, `code-${index}`, 'code', {
                style: { whiteSpace: wrap ? 'pre-wrap' : 'pre', wordBreak: wrap ? 'break-word' : 'normal', minWidth: '0', flex: '1' }
            });
            const tokens = tokenizeLine(line, language);
            if (!tokens.length) text.textContent = ' ';
            tokens.forEach(([kind, value], t) => {
                if (kind === 'plain') {
                    text.appendChild(el(this, `t-${index}-${t}`, 'span', { text: value }));
                } else {
                    text.appendChild(el(this, `t-${index}-${t}`, 'span', {
                        text: value, style: { color: TOKEN_COLORS[kind], fontStyle: kind === 'comment' ? 'italic' : 'normal' }
                    }));
                }
            });
            row.appendChild(text);
            body.appendChild(row);
        });
        this.appendChild(body);
    }

    buildCopyButton() {
        const label = el(this, 'copy-label', 'span', { text: 'Copy' });
        const button = el(this, 'copy', 'button', {
            label: 'Copy code', attrs: { type: 'button' },
            style: {
                display: 'inline-flex', alignItems: 'center', gap: '6px', height: '26px', padding: '0 10px',
                borderRadius: '7px', border: '1px solid transparent', cursor: 'pointer', fontSize: '12px', fontWeight: '600',
                fontFamily: 'var(--font-sans, inherit)', transition: TRANSITION
            },
            children: [icon(this, 'copy-icon', ICONS.copy, 13), label]
        });
        const paint = (state) => button.setStyles(variantStyles('ghost', 'neutral', state));
        bindInteraction(button, paint);
        button.addEventListener('click', () => this.copy(label));
        return button;
    }

    async copy(label) {
        const text = String(this.options.code ?? '');
        let copied = false;
        try {
            await navigator.clipboard?.writeText?.(text);
            copied = Boolean(navigator.clipboard);
        } catch {
            copied = false;
        }
        label?.setTextContent?.(copied ? 'Copied' : 'Select');
        this.dispatchEvent({ type: 'copy', target: this, copied, text });
        clearTimeout(this._copyTimer);
        this._copyTimer = setTimeout(() => label?.setTextContent?.('Copy'), 1600);
    }

    setCode(code) {
        this.options.code = code;
        this.build();
    }

    setLanguage(language) {
        this.options.language = language;
        this.build();
    }

    destroy() {
        clearTimeout(this._copyTimer);
        this._copyTimer = null;
        super.destroy();
    }
}
