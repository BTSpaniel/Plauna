// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * StyleRules - author style sheets in Plauna's style pass.
 *
 * Collects the style rules of the page's style sheets and adopted sheets,
 * indexes each selector by the key of its rightmost compound (id, class, tag
 * or universal), and returns the rules that apply to an element in cascade
 * order: specificity, then source order. Conditional groups follow their
 * conditions when the index is built (@media, @supports, @import media,
 * @layer blocks in source order); nested rules resolve `&` against their
 * parent. ::before and ::after rules are indexed by their element part for
 * generated content (matchPseudo); other pseudo-elements are skipped.
 * @container groups keep their condition on each rule: it is tested when
 * the rule's selector matches, against the nearest container's size in the
 * live page (the scene stays laid out by the browser).
 *
 * @scope rules match as Chrome measures them: a scoped selector is relative
 * to its scoping root (an implicit `:where(:scope) ` in front, so it adds no
 * specificity; `&` is `:where(:scope)` too, an explicit :scope counts as a
 * pseudo-class); declarations directly in @scope style the root itself; a
 * prelude-less @scope is rooted at its style element's parent (or its
 * shadow root). The subject must lie in scope: within a root, not at or
 * below a scoping limit of that root (limits are relative too, so `to
 * (.b)` never limits at the root itself, `to (:scope)` does), and within
 * every outer @scope's scope. Equal specificity goes to the nearest root
 * (fewest generations up; unscoped rules are the farthest), then to source
 * order, for !important declarations too. Nested in a style rule, an
 * @scope's start is relative to the rule's selector, as a nested rule's is
 * (`&` is the rule's subject; a start without `&` matches below it); a
 * prelude-less one ignores the rule, as Chrome does: it is rooted at its
 * style element's parent all the same.
 *
 * Matching uses the element's own matches(), so state pseudo-classes
 * (:hover, :focus-visible, :checked) follow the live scene. Routed input
 * (RenderSurface.pointer) marks its hover and press chains with
 * data-plauna-hover and data-plauna-active, which :hover and :active match.
 *
 * Other pseudo-elements the style pass reads are indexed like generated
 * content, by their element part: ::selection, and the scrollbar parts
 * (::-webkit-scrollbar, -thumb, -track, -track-piece, -button, -corner and
 * ::-webkit-resizer) with the scrollbar states after them (:horizontal,
 * :vertical, :hover, :active...), which the caller states (matchPseudo).
 * `.a ::selection` is `.a *::selection`, as the browser reads it.
 *
 * A shadow root's rules also hold what its tree gives elements outside it
 * (matchHost, matchSlotted): :host, :host() and :host-context() rules for
 * the shadow host (a host is featureless: `:host.x` or `:host:hover` match
 * nothing, as Chrome measures), and ::slotted() rules for elements assigned
 * to a slot in the tree. Their specificity counts their argument, as
 * :is() does. Which tree wins is the caller's (StyleResolver.cascade).
 */

import { splitTopLevel } from './CssValues.js';
import { WELL_ATTRIBUTE } from '../layout/LayoutTree.js';

export const HOVER_ATTRIBUTE = 'data-plauna-hover';
export const ACTIVE_ATTRIBUTE = 'data-plauna-active';

const PSEUDO_ELEMENT = /::|:(before|after|first-line|first-letter)(?![\w-])/i;
// A selector ending in ::before / ::after (or the legacy single colon)
const GENERATED = /::?(before|after)\s*$/i;
const INTERACTIVE = /:(hover|active|focus|focus-within|focus-visible)(?![\w-])/i;
// Matches that change without a mutation of the element itself
const STATEFUL = /:(checked|disabled|enabled|placeholder-shown|valid|invalid|indeterminate|default|required|optional|read-only|read-write|in-range|out-of-range|open|target|user-invalid|user-valid)(?![\w-])/i;
// Matches that depend on siblings or the child list
const STRUCTURAL = /[+~]|:(nth-|first-child|last-child|only-child|first-of-type|last-of-type|only-of-type|empty|has\()/i;
// A custom property read with var()
export const VAR_REFERENCE = /var\(\s*(--[^\s,)]+)/g;
const VIEW_TRANSITION = /::view-transition/i;
const IDENT = /[\w\- -￿]|\\./;

function skipIdent(text, i) {
    while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (!IDENT.test(text[i])) break;
        i++;
    }
    return i;
}

/** Index just past the bracket or parenthesis group starting at `i`. */
function skipGroup(text, i) {
    const open = text[i];
    const close = open === '[' ? ']' : ')';
    let depth = 0;
    let quote = null;
    for (; i < text.length; i++) {
        const ch = text[i];
        if (quote) {
            if (ch === '\\') i++;
            else if (ch === quote) quote = null;
            continue;
        }
        if (ch === '"' || ch === "'") quote = ch;
        else if (ch === open) depth++;
        else if (ch === close && --depth === 0) return i + 1;
    }
    return text.length;
}

/** Selector specificity as one comparable number (a, b, c packed). */
export function specificity(selector) {
    let a = 0;
    let b = 0;
    let c = 0;
    const text = selector;
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (ch === '\\') { c++; i = skipIdent(text, i); continue; }
        if (ch === '#') { a++; i = skipIdent(text, i + 1); continue; }
        if (ch === '.') { b++; i = skipIdent(text, i + 1); continue; }
        if (ch === '[') { b++; i = skipGroup(text, i); continue; }
        if (ch === ':') {
            const element = text[i + 1] === ':';
            const end = skipIdent(text, i + (element ? 2 : 1));
            const name = text.slice(i + (element ? 2 : 1), end).toLowerCase();
            i = end;
            let args = null;
            if (text[i] === '(') {
                const close = skipGroup(text, i);
                args = text.slice(i + 1, close - 1);
                i = close;
            }
            if (element || ['before', 'after', 'first-line', 'first-letter'].includes(name)) {
                c++;
                // ::slotted(x) counts its argument too
                if (name === 'slotted' && args != null) {
                    const inner = specificity(args);
                    a += Math.floor(inner / 1e6);
                    b += Math.floor(inner / 1e3) % 1e3;
                    c += inner % 1e3;
                }
                continue;
            }
            if (name === 'where') continue;
            // :host(x) and :host-context(x): a pseudo-class plus their argument
            if ((name === 'host' || name === 'host-context') && args != null) {
                const inner = specificity(args);
                a += Math.floor(inner / 1e6);
                b += 1 + Math.floor(inner / 1e3) % 1e3;
                c += inner % 1e3;
                continue;
            }
            if (['is', 'not', 'has', 'matches', '-webkit-any'].includes(name) && args != null) {
                const best = Math.max(0, ...splitTopLevel(args, ',').map(specificity));
                a += Math.floor(best / 1e6);
                b += Math.floor(best / 1e3) % 1e3;
                c += best % 1e3;
                continue;
            }
            b++;
            if ((name === 'nth-child' || name === 'nth-last-child') && args) {
                const of = /\sof\s+(.+)$/i.exec(args);
                if (of) {
                    const best = Math.max(0, ...splitTopLevel(of[1], ',').map(specificity));
                    a += Math.floor(best / 1e6);
                    b += Math.floor(best / 1e3) % 1e3;
                    c += best % 1e3;
                }
            }
            continue;
        }
        if (ch === '*' || ch === '&') { i++; continue; }
        if (IDENT.test(ch) && ch !== '-' || (ch === '-' && IDENT.test(text[i + 1] || ''))) {
            c++;
            i = skipIdent(text, i);
            continue;
        }
        i++;
    }
    return a * 1e6 + b * 1e3 + c;
}

/** Index key of a selector's rightmost compound: '#id', '.class', 'tag' or '*'. */
export function selectorKey(selector) {
    const text = selector.trim();
    // Start of the rightmost compound: after the last top-level combinator
    let start = 0;
    for (let i = 0; i < text.length;) {
        const ch = text[i];
        if (ch === '\\') { i += 2; continue; }
        if (ch === '[' || ch === '(') { i = skipGroup(text, i); continue; }
        if (ch === ' ' || ch === '>' || ch === '+' || ch === '~' || ch === '\n' || ch === '\t') {
            let j = i;
            while (j < text.length && /[\s>+~]/.test(text[j])) j++;
            if (j < text.length) start = j;
            i = j;
            continue;
        }
        i++;
    }
    const compound = text.slice(start);
    let tag = null;
    let className = null;
    for (let i = 0; i < compound.length;) {
        const ch = compound[i];
        if (ch === '#') {
            const end = skipIdent(compound, i + 1);
            return '#' + unescapeIdent(compound.slice(i + 1, end));
        }
        if (ch === '.') {
            const end = skipIdent(compound, i + 1);
            if (!className) className = unescapeIdent(compound.slice(i + 1, end));
            i = end;
            continue;
        }
        if (ch === '[' || ch === '(') { i = skipGroup(compound, i); continue; }
        if (ch === ':') { i = skipIdent(compound, i + (compound[i + 1] === ':' ? 2 : 1)); continue; }
        if (i === 0 && IDENT.test(ch) && ch !== '\\') {
            const end = skipIdent(compound, i);
            tag = compound.slice(i, end).toLowerCase();
            if (tag.includes('|')) tag = null;
            i = end;
            continue;
        }
        i++;
    }
    if (className) return '.' + className;
    if (tag) return tag;
    return '*';
}

function unescapeIdent(text) {
    return text.replace(/\\([0-9a-fA-F]{1,6}\s?|.)/g, (_, esc) => {
        if (/^[0-9a-fA-F]/.test(esc) && esc.trim().length <= 6 && /^[0-9a-fA-F]+\s?$/.test(esc)) {
            return String.fromCodePoint(parseInt(esc, 16));
        }
        return esc;
    });
}

/** :hover and :active also match the routed-input marks. */
function withRoutedStates(selector) {
    return selector
        .replace(/:hover(?![\w-])/gi, `:is(:hover, [${HOVER_ATTRIBUTE}])`)
        .replace(/:active(?![\w-])/gi, `:is(:active, [${ACTIVE_ATTRIBUTE}])`);
}

/** Resolve a nested rule's selector against its parent's. */
function nestSelector(selector, parent) {
    if (!parent) return selector;
    return splitTopLevel(selector, ',').map((part) => (
        part.includes('&') ? part.replace(/&/g, `:is(${parent})`) : `:is(${parent}) ${part}`
    )).join(', ');
}

// ── Highlights, scrollbar parts, :host and ::slotted ──────────────────────

/** Scrollbar pseudo-elements and the part names StyleResolver gives them. */
export const SCROLLBAR_PARTS = new Map([
    ['-webkit-scrollbar', 'scrollbar'], ['-webkit-scrollbar-thumb', 'thumb'], ['-webkit-scrollbar-track', 'track'],
    ['-webkit-scrollbar-track-piece', 'trackPiece'], ['-webkit-scrollbar-button', 'button'],
    ['-webkit-scrollbar-corner', 'corner'], ['-webkit-resizer', 'resizer']
]);

/**
 * A selector's pseudo-element: { base, name, args, states }. `base` is the
 * element part (`*` when empty or ending in a combinator: `.a ::selection`
 * is `.a *::selection`), `name` the pseudo-element's lowercase name,
 * `args` the text in its parentheses (::slotted) and `states` the
 * pseudo-classes after it, lowercase (:horizontal, :hover). Null when the
 * selector has none; name 'unsupported' when more follows than states.
 */
function selectorPseudoElement(selector) {
    const text = selector.trim();
    let at = -1;
    for (let i = 0; i < text.length && at < 0;) {
        const ch = text[i];
        if (ch === '\\') { i += 2; continue; }
        if (ch === '[' || ch === '(') { i = skipGroup(text, i); continue; }
        if (ch === ':' && text[i + 1] === ':') at = i;
        else i++;
    }
    if (at < 0) return null;
    const end = skipIdent(text, at + 2);
    const name = text.slice(at + 2, end).toLowerCase();
    let i = end;
    let args = null;
    if (text[i] === '(') {
        const close = skipGroup(text, i);
        args = text.slice(i + 1, close - 1).trim();
        i = close;
    }
    const states = [];
    while (i < text.length && text[i] === ':' && text[i + 1] !== ':') {
        const stop = skipIdent(text, i + 1);
        let state = text.slice(i + 1, stop).toLowerCase();
        i = stop;
        if (text[i] === '(') {
            const close = skipGroup(text, i);
            state += text.slice(i, close);
            i = close;
        }
        states.push(state);
    }
    const raw = text.slice(0, at);
    const trimmed = raw.trimEnd();
    const base = !trimmed ? '*' : (/[>+~]$/.test(trimmed) || trimmed !== raw) ? `${trimmed} *` : trimmed;
    return { base, name: i < text.length ? 'unsupported' : name, args, states };
}

/**
 * A selector whose subject is the shadow host: { kind, argument } with kind
 * 'host' (:host, :host(x)) or 'context' (:host-context(x)); 'never' for one
 * that can match no host (`:host.x`, `:host:hover`, `.a :host`: the host is
 * featureless and has no ancestors in its shadow tree); null when the
 * subject is not :host.
 */
function hostSubject(selector) {
    const text = selector.trim();
    // Start of the rightmost compound, as selectorKey finds it
    let start = 0;
    for (let i = 0; i < text.length;) {
        const ch = text[i];
        if (ch === '\\') { i += 2; continue; }
        if (ch === '[' || ch === '(') { i = skipGroup(text, i); continue; }
        if (/[\s>+~]/.test(ch)) {
            let j = i;
            while (j < text.length && /[\s>+~]/.test(text[j])) j++;
            if (j < text.length) start = j;
            i = j;
            continue;
        }
        i++;
    }
    const compound = text.slice(start);
    const match = /^:host(-context)?(?![\w-])/i.exec(compound);
    if (!match) return null;
    let i = match[0].length;
    let argument = null;
    if (compound[i] === '(') {
        const close = skipGroup(compound, i);
        argument = compound.slice(i + 1, close - 1).trim();
        i = close;
    }
    const context = Boolean(match[1]);
    if (start > 0 || i < compound.length || (context && !argument)) return { kind: 'never', argument: null };
    return { kind: context ? 'context' : 'host', argument };
}

/** The parent a :host-context() walk takes: the parent element, or a shadow root's host. */
function shadowIncludingParent(node) {
    if (node.parentElement) return node.parentElement;
    const root = node.parentNode;
    return root?.nodeType === 11 ? root.host ?? null : null;
}

// ── @scope ────────────────────────────────────────────────────────────────

const SCOPE_PSEUDO = /:scope(?![\w-])/i;
// The implicit start of a scoped selector: the scoping root, with no specificity
const SCOPE_PREFIX = ':where(:scope) ';

/**
 * A selector in @scope made relative to its scoping root: `&` is the root
 * (with no specificity, as Chrome counts it), and a selector naming neither
 * :scope nor & starts at the root: `.x` is `:where(:scope) .x`, `> .x` is
 * `:where(:scope) > .x`.
 */
function scopedSelector(selector) {
    return splitTopLevel(selector, ',').map((raw) => {
        const part = raw.trim().replace(/&/g, ':where(:scope)');
        return SCOPE_PSEUDO.test(part) ? part : SCOPE_PREFIX + part;
    }).join(', ');
}

/**
 * The scoping root of a prelude-less @scope: the parent element of the
 * style element (or link) holding the sheet, or the shadow root it sits in
 * directly. A sheet without an owner element (adopted) has none: Chrome
 * then matches nothing.
 */
function ownerScopeRoot(rule) {
    let sheet = rule.parentStyleSheet;
    while (sheet && !sheet.ownerNode && sheet.ownerRule) sheet = sheet.ownerRule.parentStyleSheet;
    const owner = sheet?.ownerNode;
    if (!owner) return null;
    if (owner.parentElement) return owner.parentElement;
    return owner.parentNode?.nodeType === 11 ? owner.parentNode : null;
}

/**
 * One @scope rule: its start and end selectors as matched, its outer @scope.
 * Nested in a style rule (`nestedIn`, the rule's selector), a start is
 * relative to that selector; without one the root is still the style
 * element's parent.
 */
function makeScope(rule, parent, nestedIn = null) {
    let start = rule.start ?? null;
    if (start != null && nestedIn) start = nestSelector(start, nestedIn);
    const end = rule.end ?? null;
    return {
        parent,
        // A top-level prelude's :scope is the document root; a nested one starts at the outer root
        start: start == null ? null : parent ? scopedSelector(start) : start.replace(/:scope(?![\w-])/gi, ':root'),
        end: end == null ? null : scopedSelector(end),
        owner: start == null ? ownerScopeRoot(rule) : null
    };
}

// ── @container ────────────────────────────────────────────────────────────

/** Nearest ancestor of `element` that is a size container (named `name` when given). */
function sizeContainer(element, name) {
    for (let node = element.parentElement; node; node = node.parentElement) {
        const cs = getComputedStyle(node);
        if (!cs.containerType || cs.containerType === 'normal') continue;
        if (name && !String(cs.containerName || '').split(/\s+/).includes(name)) continue;
        return { node, cs };
    }
    return null;
}

/** A container's content-box size, as its queries see it. */
function containerSize({ node, cs }) {
    const px = (key) => parseFloat(cs[key]) || 0;
    let width = parseFloat(cs.width);
    let height = parseFloat(cs.height);
    if (!Number.isFinite(width)) width = node.clientWidth - px('paddingLeft') - px('paddingRight');
    if (!Number.isFinite(height)) height = node.clientHeight - px('paddingTop') - px('paddingBottom');
    if (cs.boxSizing === 'border-box') {
        width -= px('paddingLeft') + px('paddingRight') + px('borderLeftWidth') + px('borderRightWidth');
        height -= px('paddingTop') + px('paddingBottom') + px('borderTopWidth') + px('borderBottomWidth');
    }
    const fontSize = px('fontSize') || 16;
    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return { width, height, fontSize, rootFontSize };
}

function queryLength(number, unit, size) {
    const value = parseFloat(number);
    const lower = (unit || 'px').toLowerCase();
    if (lower === 'rem') return value * size.rootFontSize;
    if (lower === 'em') return value * size.fontSize;
    return value;
}

const AXIS = { width: 'width', 'inline-size': 'width', height: 'height', 'block-size': 'height' };
const COMPARE = { '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b, '=': (a, b) => a === b };

/** One feature test: (min-width: 600px), (width < 40rem), not (...). */
function containerTerm(term, size) {
    let text = term.trim();
    let negate = false;
    if (/^not\s+/i.test(text)) { negate = true; text = text.replace(/^not\s+/i, ''); }
    const inner = text.replace(/^\(\s*|\s*\)$/g, '');
    let result = false;
    let match = /^(min|max)-(width|height|inline-size|block-size)\s*:\s*([\d.]+)(px|rem|em)?$/i.exec(inner);
    if (match) {
        const value = size[AXIS[match[2].toLowerCase()]];
        const limit = queryLength(match[3], match[4], size);
        result = match[1].toLowerCase() === 'min' ? value >= limit : value <= limit;
    } else if ((match = /^(width|height|inline-size|block-size)\s*(<=|>=|<|>|=)\s*([\d.]+)(px|rem|em)?$/i.exec(inner))) {
        result = COMPARE[match[2]](size[AXIS[match[1].toLowerCase()]], queryLength(match[3], match[4], size));
    } else if ((match = /^([\d.]+)(px|rem|em)?\s*(<=|>=|<|>|=)\s*(width|height|inline-size|block-size)$/i.exec(inner))) {
        result = COMPARE[match[3]](queryLength(match[1], match[2], size), size[AXIS[match[4].toLowerCase()]]);
    }
    return negate ? !result : result;
}

/** A container query: terms joined by `and`, groups by `or`. */
function containerMatches(query, size) {
    const text = String(query || '').trim();
    if (!text) return true;
    return text.split(/\s+or\s+/i).some((group) => group.split(/\s+and\s+/i).every((term) => containerTerm(term, size)));
}

function mediaMatches(media) {
    const text = typeof media === 'string' ? media : media?.mediaText;
    if (!text || text === 'all') return true;
    try { return matchMedia(text).matches; } catch { return false; }
}

export class StyleRules {
    /** `root`: the shadow root whose style sheets apply, or null for the document's. */
    constructor(root = null) {
        this.root = root;
        this.index = new Map();
        this.signature = null;
        this.interactive = false;
        this.stateful = false;
        this.structural = false;
        this.count = 0;
        this.pseudo = { before: new Map(), after: new Map(), selection: new Map(), scrollbar: new Map() };
        this.pseudoCount = 0;
        // ::selection and scrollbar part rules (matchPseudo)
        this.selectionCount = 0;
        this.scrollbarCount = 0;
        // What this tree gives elements outside it: :host and ::slotted() rules
        this.hostEntries = [];
        this.slottedEntries = [];
    }

    /** Forget the index; the next match rebuilds it. */
    invalidate() {
        this.signature = null;
        this.references = null;
    }

    sheets() {
        if (typeof document === 'undefined') return [];
        const root = this.root ?? document;
        const list = [];
        for (const sheet of root.styleSheets) list.push(sheet);
        for (const sheet of root.adoptedStyleSheets || []) list.push(sheet);
        return list;
    }

    currentSignature(sheets) {
        let signature = `${sheets.length}|${globalThis.innerWidth}x${globalThis.innerHeight}|${globalThis.devicePixelRatio}`;
        for (const sheet of sheets) {
            let length = -1;
            try { length = sheet.cssRules.length; } catch { /* cross-origin */ }
            signature += `|${sheet.disabled ? 'd' : ''}${length}`;
        }
        if (typeof matchMedia !== 'undefined') {
            signature += matchMedia('(prefers-color-scheme: dark)').matches ? '|dark' : '|light';
        }
        return signature;
    }

    /** Rebuild the index when the page's style sheets or viewport changed. */
    refresh() {
        // A pass starts: what scoped selectors matched in the last one may have moved
        this.scopeCache = null;
        const sheets = this.sheets();
        const signature = this.currentSignature(sheets);
        if (signature === this.signature) return;
        this.signature = signature;
        this.index = new Map();
        this.pseudo = { before: new Map(), after: new Map(), selection: new Map(), scrollbar: new Map() };
        this.pseudoCount = 0;
        this.selectionCount = 0;
        this.scrollbarCount = 0;
        this.hostEntries = [];
        this.slottedEntries = [];
        this.interactive = false;
        this.stateful = false;
        this.structural = false;
        // The size containers @container rules were last tested against
        this.containers = false;
        this.containerElements = new Set();
        this.count = 0;
        let order = 0;
        const flags = (selector) => {
            if (INTERACTIVE.test(selector)) this.interactive = true;
            if (STATEFUL.test(selector)) this.stateful = true;
            if (STRUCTURAL.test(selector.replace(/\[[^\]]*\]/g, ''))) this.structural = true;
        };
        // One selector of `rule` that is a highlight, a scrollbar part, :host
        // or ::slotted(): indexed (or dropped, if it can match nothing); true
        // when it was one of those
        const addOther = (selector, rule, scope) => {
            const pseudo = selectorPseudoElement(selector);
            const part = pseudo && SCROLLBAR_PARTS.get(pseudo.name);
            if (pseudo && (part || (pseudo.name === 'selection' && !pseudo.states.length))) {
                const entry = {
                    rule,
                    selector: withRoutedStates(pseudo.base),
                    specificity: specificity(selector),
                    order: rule.order,
                    invalid: false,
                    part: part || null,
                    states: pseudo.states
                };
                if (scope && pseudo.base.startsWith(SCOPE_PREFIX)) {
                    const rest = pseudo.base.slice(SCOPE_PREFIX.length);
                    if (!SCOPE_PSEUDO.test(rest) && !/^[>+~]/.test(rest)) entry.rest = withRoutedStates(rest);
                }
                flags(pseudo.base);
                const index = this.pseudo[part ? 'scrollbar' : 'selection'];
                const key = selectorKey(pseudo.base);
                if (!index.has(key)) index.set(key, []);
                index.get(key).push(entry);
                if (part) this.scrollbarCount++;
                else this.selectionCount++;
                return true;
            }
            if (pseudo?.name === 'slotted') {
                // A slot's assignees, in this tree's slots (not under @scope)
                if (pseudo.args && !pseudo.states.length && !scope) {
                    this.slottedEntries.push({
                        rule, specificity: specificity(selector), order: rule.order, invalid: false,
                        slot: withRoutedStates(pseudo.base), argument: withRoutedStates(pseudo.args)
                    });
                    flags(selector);
                }
                return true;
            }
            if (pseudo) return false;
            const host = hostSubject(selector);
            if (!host) return false;
            if (host.kind !== 'never' && !scope) {
                this.hostEntries.push({
                    rule, specificity: specificity(selector), order: rule.order, invalid: false,
                    kind: host.kind, argument: host.argument == null ? null : withRoutedStates(host.argument)
                });
                flags(selector);
            }
            return true;
        };
        const add = (selectorText, style, container = null, scope = null) => {
            if (!style || !style.length) return;
            const rule = { style, order: order++, container, scope };
            if (container) this.containers = true;
            for (const selector of splitTopLevel(selectorText, ',')) {
                if (!selector) continue;
                // Highlights, scrollbar parts, :host and ::slotted()
                if (addOther(selector, rule, scope)) continue;
                // Generated content: index by the element part of the selector
                const generated = GENERATED.exec(selector);
                const base = generated ? selector.slice(0, generated.index).trim() || '*' : selector;
                if (PSEUDO_ELEMENT.test(base)) continue;
                const entry = {
                    rule,
                    selector: withRoutedStates(base),
                    specificity: specificity(selector),
                    order: rule.order,
                    invalid: false
                };
                // Under a shadow root as scoping root (which :scope never matches),
                // a selector starting at the root matches as the rest of it
                if (scope && base.startsWith(SCOPE_PREFIX)) {
                    const rest = base.slice(SCOPE_PREFIX.length);
                    if (!SCOPE_PSEUDO.test(rest) && !/^[>+~]/.test(rest)) entry.rest = withRoutedStates(rest);
                }
                if (INTERACTIVE.test(selector)) this.interactive = true;
                if (STATEFUL.test(selector)) this.stateful = true;
                // Attribute selectors can hold ~= or + in their values
                if (STRUCTURAL.test(base.replace(/\[[^\]]*\]/g, ''))) this.structural = true;
                const index = generated ? this.pseudo[generated[1].toLowerCase()] : this.index;
                const key = selectorKey(base);
                if (!index.has(key)) index.set(key, []);
                index.get(key).push(entry);
                if (generated) this.pseudoCount++;
                else this.count++;
            }
        };
        const visit = (rules, parentSelector, container = null, scope = null) => {
            for (const rule of rules) {
                const kind = rule.constructor?.name;
                if (kind === 'CSSStyleRule') {
                    // Directly in @scope a selector is relative to the scoping root
                    const selector = scope && !parentSelector ? scopedSelector(rule.selectorText) : nestSelector(rule.selectorText, parentSelector);
                    add(selector, rule.style, container, scope);
                    if (rule.cssRules?.length) visit(rule.cssRules, selector, container, scope);
                } else if (kind === 'CSSNestedDeclarations') {
                    // Declarations directly in @scope style the scoping root
                    if (parentSelector) add(parentSelector, rule.style, container, scope);
                    else if (scope) add(':where(:scope)', rule.style, container, scope);
                } else if (kind === 'CSSMediaRule') {
                    if (mediaMatches(rule.media)) visit(rule.cssRules, parentSelector, container, scope);
                } else if (kind === 'CSSSupportsRule') {
                    let ok = false;
                    try { ok = CSS.supports(rule.conditionText); } catch { ok = false; }
                    if (ok) visit(rule.cssRules, parentSelector, container, scope);
                } else if (kind === 'CSSContainerRule') {
                    const condition = { name: rule.containerName || '', query: rule.containerQuery ?? rule.conditionText ?? '' };
                    visit(rule.cssRules, parentSelector, container ? [...[].concat(container), condition] : condition, scope);
                } else if (kind === 'CSSScopeRule') {
                    visit(rule.cssRules, null, container, makeScope(rule, scope, parentSelector));
                } else if (kind === 'CSSLayerBlockRule') {
                    visit(rule.cssRules, parentSelector, container, scope);
                } else if (kind === 'CSSImportRule') {
                    let imported = null;
                    try { imported = rule.styleSheet?.cssRules; } catch { imported = null; }
                    if (imported && mediaMatches(rule.media)) visit(imported, parentSelector, container, scope);
                }
            }
        };
        for (const sheet of sheets) {
            if (sheet.disabled || !mediaMatches(sheet.media)) continue;
            let rules = null;
            try { rules = sheet.cssRules; } catch { rules = null; }
            if (rules) visit(rules, null);
        }
    }

    /**
     * Rules that apply to `element`, lowest priority first. The index is as of
     * the last refresh() (StyleResolver.beginPass runs one per layout pass).
     */
    /** Whether every @container condition around a rule holds for `element`. */
    containerHolds(element, container) {
        for (const condition of [].concat(container)) {
            const found = sizeContainer(element, condition.name);
            if (!found) return false;
            this.containerElements.add(found.node);
            if (!containerMatches(condition.query, containerSize(found))) return false;
        }
        return true;
    }

    match(element) {
        if (!element || element.nodeType !== 1) return [];
        if (this.signature === null) this.refresh();
        return this.count ? this.matchIn(this.index, element) : [];
    }

    /**
     * Custom properties any rule reads with var(), in every sheet, condition
     * and keyframe, except rules that only style view-transition
     * pseudo-elements (those never reach an element). Kept while the sheets
     * stay the same. Null when a sheet cannot be read.
     */
    variableReferences() {
        const sheets = this.sheets();
        const signature = this.currentSignature(sheets);
        if (this.references?.signature === signature) return this.references.names;
        const names = new Set();
        let readable = true;
        const scan = (text) => {
            for (const [, name] of String(text || '').matchAll(VAR_REFERENCE)) names.add(name);
        };
        const visit = (rules) => {
            for (const rule of rules) {
                if (rule.selectorText !== undefined && rule.style) {
                    if (!splitTopLevel(rule.selectorText, ',').every((part) => VIEW_TRANSITION.test(part))) scan(rule.style.cssText);
                } else if (rule.style) {
                    scan(rule.style.cssText);
                } else if (!rule.cssRules && !rule.styleSheet) {
                    scan(rule.cssText);
                }
                let nested = rule.cssRules;
                if (!nested && rule.styleSheet) {
                    try { nested = rule.styleSheet.cssRules; } catch { readable = false; }
                }
                if (nested) visit(nested);
            }
        };
        for (const sheet of sheets) {
            let rules = null;
            try { rules = sheet.cssRules; } catch { readable = false; }
            if (rules) visit(rules);
        }
        this.references = { signature, names: readable ? names : null };
        return this.references.names;
    }

    /**
     * Rules for `element`'s ::before, ::after or ::selection (`which`),
     * lowest priority first.
     */
    matchPseudo(element, which) {
        if (!element || element.nodeType !== 1) return [];
        if (this.signature === null) this.refresh();
        const count = which === 'selection' ? this.selectionCount : this.pseudoCount;
        return count ? this.matchIn(this.pseudo[which], element) : [];
    }

    /**
     * Scrollbar part rules whose element part matches `element`, lowest
     * priority first: [{ style, part, states }] (part: scrollbar, thumb,
     * track, trackPiece, button, corner, resizer; states: the scrollbar
     * pseudo-classes the rule names, which the caller tests). A rule listing
     * one part in several states gives one item per state set.
     */
    matchScrollbar(element) {
        if (!element || element.nodeType !== 1) return [];
        if (this.signature === null) this.refresh();
        return this.scrollbarCount ? this.matchIn(this.pseudo.scrollbar, element, true) : [];
    }

    /** This tree's :host rules that match `host`, its shadow host, lowest priority first. */
    matchHost(host) {
        if (!host || host.nodeType !== 1) return [];
        if (this.signature === null) this.refresh();
        return this.matchEntries(this.hostEntries, host, (entry) => {
            if (entry.kind === 'host') return entry.argument == null || host.matches(entry.argument);
            for (let node = host; node; node = shadowIncludingParent(node)) if (node.matches(entry.argument)) return true;
            return false;
        });
    }

    /** This tree's ::slotted() rules that match `element`, assigned to `slot` (a slot in this tree), lowest priority first. */
    matchSlotted(element, slot) {
        if (!element || element.nodeType !== 1 || !slot) return [];
        if (this.signature === null) this.refresh();
        return this.matchEntries(this.slottedEntries, element, (entry) => slot.matches(entry.slot) && element.matches(entry.argument));
    }

    /** Styles of the `entries` (host or slotted) that `test` accepts for `element`, by specificity then order. */
    matchEntries(entries, element, test) {
        if (!entries.length) return [];
        const found = new Map();
        for (const entry of entries) {
            if (entry.invalid) continue;
            const current = found.get(entry.rule);
            if (current && current.specificity >= entry.specificity) continue;
            let matches = false;
            try {
                matches = test(entry);
            } catch {
                entry.invalid = true;
            }
            if (matches && entry.rule.container) matches = this.containerHolds(element, entry.rule.container);
            if (matches) found.set(entry.rule, entry);
        }
        if (!found.size) return [];
        return [...found.values()].sort((x, y) => x.specificity - y.specificity || x.order - y.order).map((entry) => entry.rule.style);
    }

    matchIn(index, element, detail = false) {
        const keys = ['*', element.localName];
        if (element.id) keys.push('#' + element.id);
        for (const name of element.classList || []) keys.push('.' + name);
        // rule (or, in detail, rule, part and states) -> { specificity, proximity,
        // order, entry } of its best matching selector
        const found = new Map();
        for (const key of keys) {
            const entries = index.get(key);
            if (!entries) continue;
            for (const entry of entries) {
                if (entry.invalid) continue;
                const id = detail ? `${entry.order}|${entry.part}|${entry.states.join(':')}` : entry.rule;
                const current = found.get(id);
                // A scoped selector of equal specificity may still match from a nearer root
                if (current && (current.specificity > entry.specificity
                    || (current.specificity === entry.specificity && !entry.rule.scope))) continue;
                let matches = false;
                let proximity = Infinity;
                try {
                    if (entry.rule.scope) {
                        proximity = this.scopedMatch(element, entry);
                        matches = proximity >= 0;
                    } else {
                        // `*` (as in *::-webkit-scrollbar) matches every element
                        matches = entry.selector === '*' || element.matches(entry.selector);
                    }
                } catch {
                    entry.invalid = true;
                }
                if (matches && entry.rule.container) matches = this.containerHolds(element, entry.rule.container);
                if (!matches) continue;
                if (current && current.specificity === entry.specificity && current.proximity <= proximity) continue;
                found.set(id, { specificity: entry.specificity, proximity, order: entry.order, entry });
            }
        }
        if (!found.size) return [];
        // Specificity, then scope proximity (the nearest root wins; unscoped is
        // the farthest), then source order
        const sorted = [...found.values()]
            .sort((x, y) => x.specificity - y.specificity || (y.proximity - x.proximity) || x.order - y.order);
        return detail
            ? sorted.map(({ entry }) => ({ style: entry.rule.style, part: entry.part, states: entry.states }))
            : sorted.map(({ entry }) => entry.rule.style);
    }

    /**
     * What scoped selectors matched in this pass (roots, limits, query
     * results). It also lapses once the current task ends, as matches made
     * outside a pass would go stale with the page.
     */
    taskCache() {
        if (!this.scopeCache) {
            const cache = { roots: new Map(), starts: new Map(), limits: new Map(), queries: new Map() };
            this.scopeCache = cache;
            queueMicrotask(() => {
                if (this.scopeCache === cache) this.scopeCache = null;
            });
        }
        return this.scopeCache;
    }

    /**
     * The scope proximity at which a scoped entry matches `element`: the
     * generations between it and the nearest scoping root it matches from,
     * or -1 when it matches from none.
     */
    scopedMatch(element, entry) {
        for (const { root, distance } of this.scopeRoots(entry.rule.scope, element)) {
            if (this.matchesFrom(root, entry.selector, element, entry.rest)) return distance;
        }
        return -1;
    }

    /** Whether `element` matches `selector` with `root` as :scope. */
    matchesFrom(root, selector, element, rest = null) {
        if (root === element) return element.matches(selector);
        // A shadow root is no element: :scope matches nothing there
        if (root.nodeType !== 1) return rest != null && element.matches(rest);
        const queries = this.taskCache().queries;
        let byRoot = queries.get(selector);
        if (!byRoot) queries.set(selector, (byRoot = new Map()));
        let matched = byRoot.get(root);
        if (!matched) byRoot.set(root, (matched = new Set(root.querySelectorAll(selector))));
        return matched.has(element);
    }

    /**
     * The roots of `scope` whose scope holds `element`, nearest first:
     * [{ root, distance }] with distance in generations (0: the element).
     */
    scopeRoots(scope, element) {
        const cache = this.taskCache().roots;
        let byScope = cache.get(scope);
        if (!byScope) cache.set(scope, (byScope = new Map()));
        let roots = byScope.get(element);
        if (roots) return roots;
        roots = [];
        if (!scope.start) {
            // Prelude-less: the one root the style element gives
            const root = scope.owner;
            let distance = 0;
            let node = element;
            for (; node && node !== root; node = node.parentElement) distance++;
            if (!node && root?.nodeType === 11 && element.getRootNode?.() === root) node = root;
            if (node === root && root && this.holds(scope, root, element) && this.outerHolds(scope, root, element)) roots.push({ root, distance });
        } else {
            let distance = 0;
            for (let node = element; node; node = node.parentElement, distance++) {
                if (this.isRootFor(scope, node, element)) roots.push({ root: node, distance });
            }
        }
        byScope.set(element, roots);
        return roots;
    }

    /** Whether `node` is a root of `scope` whose scope (and every outer scope) holds `element`. */
    isRootFor(scope, node, element) {
        if (!this.holds(scope, node, element)) return false;
        if (!scope.parent) {
            const starts = this.taskCache().starts;
            let byScope = starts.get(scope);
            if (!byScope) starts.set(scope, (byScope = new Map()));
            let matches = byScope.get(node);
            if (matches === undefined) byScope.set(node, (matches = node.matches(scope.start)));
            return matches;
        }
        // Nested: the start selector is relative to an outer root whose scope holds both
        for (const { root } of this.scopeRoots(scope.parent, node)) {
            if (this.holds(scope.parent, root, element) && this.matchesFrom(root, scope.start, node)) return true;
        }
        return false;
    }

    /** For a prelude-less nested @scope: some outer root's scope holds its root and `element`. */
    outerHolds(scope, root, element) {
        if (!scope.parent) return true;
        if (root.nodeType !== 1) return false;
        return this.scopeRoots(scope.parent, root).some((outer) => this.holds(scope.parent, outer.root, element));
    }

    /** Whether `root`'s scope holds `element`: no scoping limit of `root` is `element` or above it. */
    holds(scope, root, element) {
        if (!scope.end) return true;
        const limits = this.limitsOf(scope, root);
        if (!limits.size) return true;
        for (let node = element; node; node = node.parentElement) {
            if (limits.has(node)) return false;
            if (node === root) break;
        }
        return true;
    }

    /** The scoping limits of `root`: elements below it (or itself) matching the end selector. */
    limitsOf(scope, root) {
        const cache = this.taskCache().limits;
        let byScope = cache.get(scope);
        if (!byScope) cache.set(scope, (byScope = new Map()));
        let limits = byScope.get(root);
        if (limits) return limits;
        limits = new Set();
        try {
            for (const node of root.querySelectorAll(scope.end)) limits.add(node);
            if (root.nodeType === 1 && root.matches(scope.end)) limits.add(root);
        } catch {
            // An end selector the browser does not take limits nothing
        }
        byScope.set(root, limits);
        return limits;
    }
}

export const styleRules = new StyleRules();

// ── Watching style sheets ─────────────────────────────────────────────────

const SHEET_SELECTOR = 'style, link[rel~="stylesheet" i]';

// Elements that hold a style sheet: style elements and stylesheet links
function isSheetNode(node) {
    if (node?.nodeType !== 1) return false;
    if (node.localName === 'style') return true;
    return node.localName === 'link' && /(^|\s)stylesheet(\s|$)/i.test(node.getAttribute('rel') || '');
}

// Whether an added or removed node is, or contains, a style sheet element
function holdsSheet(node) {
    if (node?.nodeType !== 1) return false;
    return isSheetNode(node) || Boolean(node.firstElementChild && node.querySelector(SHEET_SELECTOR));
}

const SHEET_ATTRIBUTES = ['media', 'disabled', 'href', 'rel', 'type', 'title', 'crossorigin'];
const sheetWatchers = new WeakMap();

/**
 * One watcher per tree root (a document or a shadow root), shared by every
 * surface in it: style and link elements added, removed or edited anywhere
 * in that tree (head, panels, app containers, the scene), a linked sheet or
 * @import finishing loading, and, for a document, the body's style and
 * class (font and zoom). Text edits inside a style element and attribute
 * changes on style and link elements are watched per element.
 */
function createSheetWatcher(root) {
    const listeners = new Set();
    const doc = root.nodeType === 9 ? root : null;
    let body = null;
    const notify = (reason) => {
        for (const listener of [...listeners]) {
            try { listener(reason); } catch (error) { console.error('[Plauna] style sheet watcher:', error); }
        }
    };
    // Watch the style and link elements in `node`; true when one holds a sheet.
    // Every link is watched: a preload link can become a stylesheet (rel)
    const track = (node) => {
        if (node?.nodeType !== 1) return false;
        if (node.localName === 'style' || node.localName === 'link') {
            observer.observe(node, { characterData: true, subtree: true, attributes: true, attributeFilter: SHEET_ATTRIBUTES });
            return isSheetNode(node);
        }
        let found = false;
        if (node.firstElementChild) for (const sheet of node.querySelectorAll('style, link')) found = track(sheet) || found;
        return found;
    };
    const trackBody = () => {
        if (!doc || doc.body === body || !doc.body) return;
        body = doc.body;
        observer.observe(body, { attributes: true, attributeFilter: ['style', 'class'] });
    };
    const observer = new MutationObserver((records) => {
        let sheets = false;
        let bodyChanged = false;
        for (const record of records) {
            if (record.type === 'childList') {
                // An island's content changes all the time and holds no sheets (NativeWell)
                if (record.target.closest?.(`[${WELL_ATTRIBUTE}]`)) continue;
                // Text replaced inside a style element
                if (isSheetNode(record.target)) sheets = true;
                for (const node of record.addedNodes) {
                    if (track(node)) sheets = true;
                    if (node === doc?.body || node === doc?.documentElement) trackBody();
                }
                if (!sheets) for (const node of record.removedNodes) if (holdsSheet(node)) sheets = true;
            } else if (record.type === 'characterData') {
                if (isSheetNode(record.target.parentNode)) sheets = true;
            } else if (record.type === 'attributes') {
                if (record.target === body) bodyChanged = true;
                else if (isSheetNode(record.target) || record.attributeName === 'rel') sheets = true;
            }
        }
        if (sheets) notify('sheets');
        if (bodyChanged) notify('body');
    });
    observer.observe(root, { childList: true, subtree: true });
    for (const node of root.querySelectorAll('style, link')) track(node);
    trackBody();
    // A linked sheet (or a style element's @import) has loaded or failed
    const onLoad = (event) => {
        if (isSheetNode(event.target)) notify('sheets');
    };
    root.addEventListener('load', onLoad, true);
    root.addEventListener('error', onLoad, true);
    return {
        listeners,
        stop() {
            observer.disconnect();
            root.removeEventListener('load', onLoad, true);
            root.removeEventListener('error', onLoad, true);
        }
    };
}

/**
 * Call `onChange(reason)` when style sheets in tree `root` (a document or a
 * shadow root) change: 'sheets' for style and link elements added, removed,
 * edited or loaded, 'body' for the document body's style or class. Returns
 * a function that stops it.
 */
export function watchStyleSheets(root, onChange) {
    if (typeof MutationObserver === 'undefined' || !root || (root.nodeType !== 9 && root.nodeType !== 11)) return () => {};
    let watcher = sheetWatchers.get(root);
    if (!watcher) sheetWatchers.set(root, (watcher = createSheetWatcher(root)));
    watcher.listeners.add(onChange);
    return () => {
        if (!watcher.listeners.delete(onChange) || watcher.listeners.size) return;
        watcher.stop();
        if (sheetWatchers.get(root) === watcher) sheetWatchers.delete(root);
    };
}

const scopedRules = new WeakMap();

/**
 * The rules for elements in tree `root`: the shared document rules, or a
 * shadow root's own (the document's sheets do not reach into a shadow tree).
 */
export function rulesFor(root) {
    if (typeof ShadowRoot === 'undefined' || !(root instanceof ShadowRoot)) return styleRules;
    let rules = scopedRules.get(root);
    if (!rules) scopedRules.set(root, (rules = new StyleRules(root)));
    return rules;
}

/**
 * Whether `rules` are a tree's shared rules (rulesFor), so elements of other
 * trees take their own tree's; rules a caller built itself stay as given.
 */
export function isTreeRules(rules) {
    if (!rules) return false;
    return rules === styleRules || (rules.root != null && scopedRules.get(rules.root) === rules);
}
