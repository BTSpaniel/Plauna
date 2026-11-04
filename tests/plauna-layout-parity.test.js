// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Layout parity: Plauna's own layout pass (GPU mode) against the browser.
 * Every registry widget story is rendered in the DOM, then laid out again by
 * LayoutEngine from the same element tree. Each element's border box must
 * match the browser's within TOLERANCE px.
 */

import { widgets } from '../plauna/widgets/index.js';
import { widgetRenderer } from '../plauna/widgets/WidgetRenderer.js';
import { themeLoader } from '../plauna/themes/ThemeLoader.js';
import { LayoutEngine, transformRectBounds } from '../plauna/render/layout/LayoutEngine.js';
import { StyleResolver, inheritedStyleFromHost } from '../plauna/render/css/StyleResolver.js';
import { userAgentStyles } from '../plauna/render/css/UserAgentStyles.js';

const TOLERANCE = 1.5;
const tests = [];
const stage = document.getElementById('stage');

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function test(name, body) {
    try {
        await body();
        tests.push({ name, passed: true });
    } catch (error) {
        tests.push({ name, passed: false, error: error?.stack || String(error) });
    }
}

function storiesOf(Widget) {
    return typeof Widget.stories === 'function' ? Widget.stories() : {};
}

await themeLoader.apply('dark');
userAgentStyles.calibrate(stage);
const varCache = new Map();
const resolver = new StyleResolver({
    variables: (name) => {
        if (!varCache.has(name)) varCache.set(name, getComputedStyle(stage).getPropertyValue(name).trim() || undefined);
        return varCache.get(name);
    }
});
const engine = new LayoutEngine({ resolver, scrollbarWidth: 0 });

function describe(el, root) {
    const parts = [];
    let e = el;
    while (e && e !== root.parentElement) {
        const index = e.parentElement ? [...e.parentElement.children].indexOf(e) : 0;
        parts.unshift(`${e.localName}${e.id ? '#' + e.id.slice(-18) : ''}[${index}]`);
        e = e.parentElement;
    }
    return parts.slice(-3).join(' > ');
}

/** Compare one rendered element tree; returns a list of mismatches. */
export function compareLayout(rootEl, host, tolerance = TOLERANCE) {
    const hostRect = host.getBoundingClientRect();
    const contentX = hostRect.left + host.clientLeft + parseFloat(getComputedStyle(host).paddingLeft);
    const contentY = hostRect.top + host.clientTop + parseFloat(getComputedStyle(host).paddingTop);
    const width = host.clientWidth - parseFloat(getComputedStyle(host).paddingLeft) - parseFloat(getComputedStyle(host).paddingRight);
    const result = engine.layout(rootEl, { width, rootInherited: inheritedStyleFromHost(host) });
    const mismatches = [];
    const elements = [rootEl, ...rootEl.querySelectorAll('*')];
    for (const el of elements) {
        if (el.closest('svg') && el.localName !== 'svg') continue;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const box = result.boxes.get(el);
        // A closed details' content still reports rects (the browser lays it
        // out on demand) but is never shown
        const inClosedDetails = Boolean(el.closest('details:not([open]) > :not(summary:first-of-type)'));
        const domHidden = style.display === 'none' || inClosedDetails || (rect.width === 0 && rect.height === 0 && !el.getClientRects().length);
        if (!box) {
            if (!domHidden && el.getClientRects().length) mismatches.push({ el: describe(el, rootEl), reason: 'missing in Plauna layout', dom: rect });
            continue;
        }
        if (domHidden && style.display === 'none') {
            mismatches.push({ el: describe(el, rootEl), reason: 'hidden in DOM, laid out by Plauna' });
            continue;
        }
        let ours;
        if (box.outer === 'inline' && !box.atomic && box.absFragments?.length) {
            const xs = box.absFragments.map((f) => f.x);
            const ys = box.absFragments.map((f) => f.y);
            const x1 = Math.max(...box.absFragments.map((f) => f.x + f.width));
            const y1 = Math.max(...box.absFragments.map((f) => f.y + f.height));
            ours = { x: Math.min(...xs), y: Math.min(...ys), width: x1 - Math.min(...xs), height: y1 - Math.min(...ys) };
        } else {
            ours = { x: box.absX, y: box.absY, width: box.width, height: box.height };
            if (box.matrix) ours = transformRectBounds(box.matrix, ours);
        }
        const dom = { x: rect.left - contentX, y: rect.top - contentY, width: rect.width, height: rect.height };
        // Scrolled-out content: the DOM rect still reports position, so compare as-is
        const err = Math.max(Math.abs(ours.x - dom.x), Math.abs(ours.y - dom.y), Math.abs(ours.width - dom.width), Math.abs(ours.height - dom.height));
        if (err > tolerance) {
            mismatches.push({
                el: describe(el, rootEl),
                err: +err.toFixed(2),
                dom: [dom.x, dom.y, dom.width, dom.height].map((v) => +v.toFixed(1)),
                ours: [ours.x, ours.y, ours.width, ours.height].map((v) => +v.toFixed(1)),
                display: style.display
            });
        }
    }
    return mismatches;
}

const report = {};
// A wide and a narrow stage: the narrow one exercises wrapping and shrinking
const WIDTHS = (new URLSearchParams(location.search).get('widths') || '640,280').split(',').map(Number);
for (const width of WIDTHS) for (const Widget of widgets) {
    for (const [storyName, options] of Object.entries(storiesOf(Widget))) {
        await test(`${width}px ${Widget.id}/${storyName}`, async () => {
            stage.style.width = `${width}px`;
            stage.replaceChildren();
            const id = `parity-${Widget.id}-${storyName.replace(/\W+/g, '-').toLowerCase()}`;
            const instance = new Widget(id, { ...options });
            const element = widgetRenderer.render(instance);
            stage.appendChild(element);
            widgetRenderer.flush();
            await new Promise((r) => requestAnimationFrame(r));
            let mismatches;
            try {
                mismatches = compareLayout(element, stage);
            } finally {
                instance.destroy();
            }
            report[`${width}px ${Widget.id}/${storyName}`] = mismatches;
            assert(mismatches.length === 0, `${mismatches.length} boxes differ; first: ${JSON.stringify(mismatches.slice(0, 3))}`);
        });
    }
}
// Shapes the widget stories do not produce, including style sheet rules
const sheet = document.createElement('style');
sheet.textContent = `
    .parity-card { display: flex; gap: 8px; padding: 12px; border: 1px solid #445; }
    .parity-card > .parity-tag { padding: 2px 8px; border-radius: 4px; }
    .parity-card .parity-tag:first-child { padding-left: 14px; }
    @media (min-width: 1px) { .parity-grid { display: grid; grid-template-columns: 1fr 2fr; gap: 6px; } }
    .parity-forced { margin-left: 20px !important; }
    .parity-gen::before { content: "92  "; font-weight: 700; }
    .parity-gen::after { content: attr(data-count); display: inline-block; padding: 0 6px; margin-left: 4px; border: 1px solid; }
    .parity-head::before { content: ""; display: block; height: 14px; margin-bottom: 4px; }`;
document.head.appendChild(sheet);
const MARKUP = {
    'inline-block inside inline': `<p style="margin:0">Before <span>wrap <span style="display:inline-block;width:40px;height:30px"></span>
        after</span> <em>tail <b style="display:inline-block;padding:4px">chip</b></em> end</p>`,
    'flex shrink weighs inner sizes': `<div style="display:flex;justify-content:space-between;gap:12px;width:200px">
        <div><b>Customize</b><div>Live props and token-driven tweaks</div></div>
        <button style="padding:4px 8px;border:1px solid;min-width:36px">Show controls</button></div>`,
    'generated content': `<p class="parity-gen" data-count="12" style="margin:0">Unread messages wait here</p>
        <div class="parity-head"><span class="parity-gen" data-count="3">Tasks</span> due today</div>`,
    'logical properties': `<div style="padding-inline:12px 20px;padding-block:6px 10px;margin-inline:auto;inline-size:220px;border-inline-start:4px solid;border-block-end:2px solid">Logical box</div>
        <div style="position:relative;block-size:60px"><span style="position:absolute;inset-inline-start:10px;inset-block-start:5px;max-inline-size:120px">placed</span></div>
        <div style="margin-block:14px 6px;min-block-size:30px;max-inline-size:150px">clamped</div>`,
    'aspect ratio': `<div style="width:160px;aspect-ratio:16 / 9"></div>
        <div style="display:flex;align-items:flex-start;gap:8px"><div style="height:50px;aspect-ratio:2"></div><div style="width:30%;aspect-ratio:1"></div></div>
        <div style="width:120px;aspect-ratio:3 / 2;padding:10px;box-sizing:border-box"></div>
        <div style="width:100px;aspect-ratio:1;min-height:150px"></div>`,
    'grid template areas': `<div style="display:grid;grid-template-areas:'head head' 'side main' 'foot foot';grid-template-columns:80px 1fr;gap:6px">
        <div style="grid-area:head;height:30px">Head</div><div style="grid-area:main;height:60px">Main</div>
        <div style="grid-area:side">Side</div><div style="grid-area:foot;height:20px">Foot</div></div>`,
    'ch units use the font': `<p style="margin:0 0 8px;max-width:24ch;font:16px system-ui, sans-serif">Each card is a working widget you can open and edit.</p>
        <p style="margin:0 0 8px;max-width:24ch;font:14px monospace">const value = createPlaunaApp(options);</p>
        <div style="width:10ch;height:8px;font-size:20px;background:#888"></div>`,
    'wrapping flex line takes min-height': `<div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:center;min-height:60px;gap:8px">
        <span style="display:inline-block;width:40px;height:20px"></span><span style="display:inline-block;width:60px;height:12px"></span></div>
        <div style="display:flex;flex-direction:column;flex-wrap:wrap;align-content:center;min-height:50px"><div style="height:10px;width:30px"></div></div>`,
    'table never narrower than its columns': `<div style="width:120px"><table style="width:100%;border-collapse:collapse"><tr><td style="padding:4px">unbreakable-first-cell</td><td style="padding:4px">second-long-cell</td></tr><tr><td>a</td><td>b</td></tr></table></div>`,
    'clipped input keeps its flex minimum': `<div style="display:flex;width:150px;align-items:center;gap:4px"><button style="width:28px;flex:none">-</button><input style="flex:1 1 0%"><button style="width:28px;flex:none">+</button></div>`,
    'grid named lines': `<div style="display:grid;grid-template-columns:[full-start] 40px [main-start] 1fr [main-end] 40px [full-end];grid-template-areas:'. top .' 'left . right';gap:4px">
        <div style="grid-area:top">top</div><div style="grid-area:right;height:30px">right</div>
        <div style="grid-row:2;grid-column:left-start / left-end">left</div><div style="grid-area:2 / 2 / 3 / 3">mid</div>
        <div style="grid-column:main;height:20px">main</div><div style="grid-column:full-start / full-end;height:10px">full</div></div>`,
    'individual transforms': `<div style="width:80px;height:40px;translate:10px 20px"></div>
        <div style="width:80px;height:40px;rotate:15deg;margin:20px"></div>
        <div style="width:80px;height:40px;scale:1.5 0.5;margin:20px"></div>
        <div style="width:80px;height:40px;translate:5px;rotate:10deg;scale:1.2;transform:translateX(30px)"></div>`,
    'scrollbar width none': `<div style="width:200px;height:60px;overflow-y:auto;scrollbar-width:none"><div style="height:150px">tall</div></div>
        <div style="width:200px;height:60px;overflow-y:scroll;scrollbar-width:thin"><div style="height:150px">thin</div></div>`,
    'style sheet cascade': `<div class="parity-card"><span class="parity-tag">One</span><span class="parity-tag">Two</span></div>
        <div class="parity-grid"><div>A</div><div>B</div><div class="parity-forced" style="margin-left:4px">C</div></div>`,
    // Default margins are in em: they follow each element's font size, not the stage's
    'em margins follow the font size': `<div style="font-size:16px"><p>Sixteen</p><h1>Heading one</h1><h2>Heading two</h2><h5>Five</h5></div>
        <div style="font-size:22px"><p>Twenty-two</p><h1>One</h1><h3>Three</h3><blockquote>Quote</blockquote><dl><dt>Term</dt><dd>Px rule</dd></dl></div>
        <div style="font-size:11px"><p>Eleven</p><h2>Two</h2><h4>Four</h4><h6>Six</h6><ul><li>Item</li></ul><p><small>small</small> print</p><dl><dd>Px rule</dd></dl></div>`,
    'text inputs size to their own font': `<div style="display:flex;width:150px;gap:4px"><input style="flex:1;font:13px monospace;padding:6px 12px;border:1px solid;box-sizing:border-box"><button style="flex:none">Go</button></div>
        <div><input style="font:16px Arial"> <input type="number" style="font:12px monospace"> <input size="8" style="font:18px system-ui"></div>
        <div><input type="date" style="font:15px serif"> <input type="time" style="font:12px monospace"> <input type="search" style="font:italic 700 14px Georgia;letter-spacing:1px"></div>`,
    'fr tracks under a min-content constraint': `<div style="display:flex;justify-content:center;flex-wrap:wrap;width:206px"><div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:8px">
        <div style="padding:8px">Albedo</div><div style="padding:8px">Normal</div><div style="padding:8px">Roughness</div><div style="padding:8px">Metallic</div><div style="padding:8px">Height</div><div style="padding:8px">Emission</div></div></div>
        <div style="display:flex;width:60px"><div style="display:grid;grid-template-columns:1fr 2fr auto minmax(30px, 1fr);gap:4px"><div>alpha</div><div>beta gamma</div><div>delta</div><div>epsilon</div></div></div>`,
    'flex items shrink below their specified width': `<div style="display:flex;align-items:center;gap:8px;width:150px"><span>Go to page</span><div style="width:60px;padding:4px 8px;border:1px solid;box-sizing:border-box"></div><button>Go</button></div>
        <div style="display:flex;width:100px"><div style="width:80px;padding:0 5px"></div><div style="width:80px">abc defghijkl</div></div>`,
    // top/bottom percentages need a definite containing block height, else they act as auto
    'relative offsets in percent': `<div style="height:40px"><div style="height:20px;position:relative;top:50%">definite</div></div>
        <div><div style="position:relative;top:50%;left:10%">auto height</div></div>
        <div style="min-height:40px"><div style="position:relative;bottom:25%">min-height</div></div>
        <div style="display:flex;height:50px"><div style="position:relative;top:20%">flex item</div></div>`,
    // A row's minimum is an item's minimum height: zero for a scroll container
    // or min-height:0, so tall scrolling content cannot push a row past a definite grid height
    'grid rows in a definite height ignore tall scrollers': `<div style="display:flex;flex-direction:column;height:160px">
        <div style="height:20px">bar</div>
        <div style="flex:1 1 auto;min-height:0;display:grid;grid-template-columns:60px 1fr 1fr">
        <nav style="overflow:auto"><div style="height:240px">nav</div></nav>
        <div style="min-height:0;display:flex;flex-direction:column"><div style="flex:1 1 auto;min-height:0;overflow:auto"><div style="height:400px">tall</div></div></div>
        <aside style="overflow:hidden"><div style="height:100%">fills</div></aside></div></div>
        <div style="display:grid;height:80px;grid-template-rows:auto"><div style="overflow:auto;padding:6px"><div style="height:300px">scroll</div></div></div>
        <div style="display:grid;height:50px"><div><div style="height:90px">still grows</div></div></div>`,
    // A closed <details> lays out its first <summary> only, and keeps the
    // summary's bottom margin inside (its empty content slot is isolated)
    'a closed details shows its summary only': `<details><summary style="margin:12px 0;padding:8px;border:1px solid">Playback</summary>
        <div style="height:80px">hidden</div><label><input type="checkbox"> also hidden</label></details><div>after</div>
        <details open><summary style="margin:12px 0">Open</summary><div style="height:30px">shown</div></details><div>end</div>`,
    // A summary always has its disclosure marker: with no text it still takes a
    // line, and before block content the marker sits on a line of its own
    'a summary keeps its marker without inline content': `<details><summary></summary><div>hidden</div></details><div>after empty</div>
        <details open><summary style="padding:4px"></summary><div>shown</div></details>
        <details><summary><h3 style="margin:0">Block title</h3></summary></details><div>after block</div>
        <details open><summary style="font-size:20px"><div style="height:10px;background:#888"></div><span>then text</span></summary><p style="margin:0">body</p></details>
        <details><summary style="display:block">Plain block summary</summary></details><div>end</div>
        <div style="position:relative"><details><summary><span style="position:absolute;right:8px">New</span>Title<div>desc</div></summary></details>
        <details><summary><span style="position:absolute;right:0">3</span><h3 style="margin:0">Q</h3></summary></details>
        <details open><summary><span style="position:absolute;left:200px">abs</span><div>block first</div>tail</summary></details></div>`,
    // A button centres its content in the height min-height gives it, not only a set height
    'a button centres its content in its min-height': `<button style="min-height:44px;font:14px Arial"><span>Pause</span></button>
        <button style="display:block;min-height:40px;width:80px;padding:0"><span>Go</span></button>
        <div style="position:relative;height:60px"><button style="position:absolute;right:8px;top:8px;width:44px;min-height:44px;padding:0"><span>Play</span></button></div>
        <button style="min-height:44px;padding:6px 12px;font:14px Arial"><span><span style="display:inline-block;width:16px;height:16px;background:#888"></span> Save</span></button>
        <div style="display:flex;height:56px"><button style="font:13px Arial"><a><svg width="14" height="14"></svg></a> Open</button></div>
        <table><tr><td style="height:60px"><a href="#"><span style="display:inline-block;width:16px;height:16px"></span></a> cell</td></tr></table>`,
    // Track sizes may be math functions resolved against the grid's width
    'grid tracks sized by min()': `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,120px),1fr));gap:8px">
        <div>one</div><div>two</div><div>three</div><div>four</div><div>five</div></div>`,
    // auto-fit: repeated tracks no item occupies collapse, with their gaps
    'auto-fit collapses empty tracks': `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(42px,1fr));gap:8px">
        <div>a</div><div>b</div><div>c</div></div>`,
    // An item spanning a flexible track grows only the flexible tracks
    'spanning items grow only the flexible tracks': `<div style="display:grid;width:600px;max-width:100%;grid-template-columns:auto 1fr"><div style="grid-column:1/3;width:300px;height:10px"></div><div style="width:35px;height:10px"></div><div style="height:10px"></div></div>
        <div style="display:grid;grid-template-columns:auto 1fr;font:13px Arial"><header style="grid-column:1/3">A long header that spans both columns of the layout</header><nav>Side</nav><main>Main content</main></div>
        <div style="display:grid;width:260px;grid-template-columns:auto .5fr .3fr;column-gap:4px"><div style="grid-column:1/4;width:250px;height:6px"></div><div style="width:20px;height:6px"></div><div style="height:6px"></div><div style="height:6px"></div></div>
        <div style="display:inline-grid;grid-template-columns:40px 2fr 1fr"><div style="grid-column:1/4;width:190px;height:6px"></div><div style="height:6px"></div></div>
        <div style="display:grid;grid-template-rows:auto 1fr;width:120px"><div style="grid-row:1/3;height:90px"></div><div style="height:12px"></div></div>
        <div style="display:grid;width:300px;grid-template-columns:auto .5fr"><div style="width:40px;height:6px"></div><div style="height:6px"></div></div>
        <div style="display:grid;width:300px;grid-template-columns:auto .3fr .2fr;column-gap:5px"><div style="width:30px;height:6px"></div><div style="height:6px"></div><div style="height:6px"></div></div>`,
    // A grid sized by its rows still fills its min-height and stops at its max-height
    'grid rows fill a min-height': `<div style="display:grid;min-height:300px;grid-template-rows:auto 1fr auto"><div style="height:20px"></div><div style="height:50px"></div><div style="height:20px"></div></div>
        <div style="display:grid;min-height:120px;grid-template-rows:auto auto"><div style="height:20px"></div><div style="height:30px"></div></div>
        <div style="display:grid;min-height:100px;place-items:center"><div style="width:30px;height:20px"></div></div>
        <div style="display:grid;min-height:100px;align-content:start;grid-template-rows:auto 1fr"><div style="height:20px"></div><div style="height:10px"></div></div>
        <div style="display:grid;min-height:80px;padding:6px;box-sizing:border-box;grid-template-rows:1fr 2fr;row-gap:4px"><div></div><div></div></div>
        <div style="display:grid;max-height:60px;grid-template-rows:1fr 1fr"><div style="height:50px"></div><div style="height:50px"></div></div>`,
    // The browser keeps no author padding or border on a native checkbox or radio
    'a native checkbox drops author padding and border': `<label style="display:flex;align-items:center;gap:6px">
        <input type="checkbox" style="padding:8px 12px;border:1px solid;min-height:44px;box-sizing:border-box">Pause</label>
        <input type="radio" style="padding:10px;border:3px solid">`,
    // @container rules follow the size of their container
    'container queries follow their container': `<style>.cq-cols{display:grid;grid-template-columns:1fr 1fr;gap:6px}
        @container (max-width: 400px){.cq-cols{grid-template-columns:1fr}}</style>
        <div style="container-type:inline-size;width:300px"><div class="cq-cols"><div>narrow a</div><div>narrow b</div></div></div>
        <div style="container-type:inline-size;width:500px"><div class="cq-cols"><div>wide a</div><div>wide b</div></div></div>`,
    // @scope: relative selectors, the root itself (:scope, bare declarations),
    // limits, proximity over source order, nested scopes and a prelude-less scope
    '@scope rules match from their root, within limits, nearest root first': `<style>
        .ps-item { display: block; width: 8px; height: 4px; }
        @scope (.ps-card) to (.ps-slot) { .ps-item { width: 12px; } :scope { border: 2px solid; } > .ps-head { margin-bottom: 6px; } }
        @scope (.ps-card) { padding: 3px 5px; }
        @scope (.ps-outer) { .ps-item { width: 24px; } }
        @scope (.ps-inner) { .ps-item { width: 36px; } }
        .ps-item.ps-late { width: 9px; }
        @scope (.ps-a) to (.ps-c) { @scope (.ps-b) { .ps-t { width: 30px; height: 6px; } } }
        @scope (.ps-card) to (:scope) { .ps-head { width: 1px; } }
        </style>
        <div class="ps-card"><div class="ps-head">head</div><div class="ps-item"></div><div class="ps-slot"><div class="ps-item"></div></div></div>
        <div class="ps-outer"><div class="ps-inner"><div class="ps-item"></div></div></div>
        <div class="ps-inner"><div class="ps-outer"><div class="ps-item"></div><div class="ps-item ps-late"></div></div></div>
        <div class="ps-a"><div class="ps-b"><div class="ps-c"><div class="ps-t"></div></div><div class="ps-t"></div></div></div>
        <section><style>@scope { p { margin: 5px 9px; width: 60px; } }</style><p>scoped</p></section><p style="width:70px">unscoped</p>`,
    // Nested in a style rule, an @scope's start is relative to the rule's
    // selector: `&` is its subject, otherwise the root lies below it (never on
    // the subject itself); limits and `&` in the body are relative to the root
    '@scope nested in a style rule starts from the rule\'s subject': `<style>
        .pn-c { height: 2px; }
        .pn-a { @scope (.pn-b) to (& > .pn-x) { .pn-c { width: 30px; } padding-left: 4px; } }
        .pn-f { @scope (& > .pn-g) { .pn-c { width: 34px; } & > .pn-d { width: 35px; height: 2px; } } }
        .pn-o { .pn-p { @scope (.pn-q) { .pn-c { width: 46px; } } } }
        @scope (.pn-h) { .pn-i { @scope (.pn-j) { .pn-c { width: 39px; } } } }
        .pn-k { @scope (.pn-l) { :scope .pn-c { width: 52px; } } } .pn-l .pn-c { width: 53px; }
        </style>
        <div class="pn-a"><div class="pn-b"><div class="pn-c"></div><div class="pn-x"><div class="pn-c"></div></div></div></div>
        <div class="pn-b"><div class="pn-c"></div></div><div class="pn-a pn-b"><div class="pn-c"></div></div>
        <div class="pn-f"><div class="pn-g"><div class="pn-c"></div><div class="pn-d"></div><div><div class="pn-d"></div></div></div><div><div class="pn-g"><div class="pn-c"></div></div></div></div>
        <div class="pn-o"><div class="pn-p"><div class="pn-q"><div class="pn-c"></div></div></div></div><div class="pn-p"><div class="pn-q"><div class="pn-c"></div></div></div>
        <div class="pn-h"><div class="pn-i"><div class="pn-j"><div class="pn-c"></div></div></div></div><div class="pn-i"><div class="pn-j"><div class="pn-c"></div></div></div>
        <div class="pn-k"><div class="pn-l"><div class="pn-c"></div></div></div>`,
    // A prelude-less @scope nested in a style rule ignores the rule (Chrome
    // roots it at its style element's parent even when the rule matches nothing)
    'a prelude-less @scope nested in a style rule is rooted at its style element\'s parent': `<style>
        .pl-c, .pl-d, .pl-e { height: 2px; }
        .pl-a { @scope { .pl-c { width: 32px; } > .pl-d { margin-left: 5px; } padding-left: 3px; } }
        .pl-none { @scope to (.pl-x) { .pl-e { width: 44px; } } }
        </style>
        <div class="pl-a"><div class="pl-c"></div><div class="pl-d"></div></div><div class="pl-c"></div><div class="pl-d"></div>
        <div class="pl-x"><div class="pl-e"></div></div><div class="pl-e"></div>`,
    // Container query units: the nearest query container's content box on
    // the unit's axis (in layout units), else the small viewport
    'container query units resolve against their query container': `<style>.cq-gen::before { content: ""; display: block; width: 25cqw; height: 3px; }</style>
        <div style="container-type:inline-size;width:333.33px;padding:7px;border:3px solid;box-sizing:border-box">
          <div style="width:10cqw;height:4px;margin-left:12.5cqi"></div>
          <div style="width:calc(50cqw - 10px);height:2px;padding-left:max(4px, 3cqw)"></div>
          <div style="container-type:inline-size;width:50cqw"><div style="width:33.3cqw;height:2px"></div></div>
          <div style="width:1cqh;height:0.5cqb"></div>
        </div>
        <div style="container-type:size;width:301px;height:83px;padding:4px">
          <div style="width:20cqw;height:20cqh;font-size:12cqh;line-height:1">Ag</div>
          <div style="width:10cqmax;height:10cqmin"></div>
        </div>
        <div style="width:5cqw;height:2cqh;margin-left:1cqmin"></div>
        <div class="cq-gen" style="container-type:inline-size;width:200px"></div>`
};
for (const width of WIDTHS) for (const [name, html] of Object.entries(MARKUP)) {
    await test(`${width}px markup/${name}`, async () => {
        stage.style.width = `${width}px`;
        const element = document.createElement('div');
        element.innerHTML = html;
        stage.replaceChildren(element);
        await new Promise((r) => requestAnimationFrame(r));
        const mismatches = compareLayout(element, stage);
        report[`${width}px markup/${name}`] = mismatches;
        assert(mismatches.length === 0, `${mismatches.length} boxes differ; first: ${JSON.stringify(mismatches.slice(0, 3))}`);
    });
}
// Unstyled form controls in plain markup: sized and aligned as the browser
// does it, to within half a pixel
const CONTROL_TOLERANCE = 0.5;
const CONTROLS = {
    'date, month and week inputs size to their fields': `<div><input type="datetime-local"> <input type="month"> <input type="week"></div>
        <div><input type="datetime-local" style="font:15px serif"> <input type="month" style="font:12px monospace"> <input type="week" style="font:italic 700 14px Georgia;letter-spacing:1px"></div>`,
    'button inputs size to their labels': `<div><input type="button"> <input type="button" value="Click me"> <input type="submit"> <input type="reset"> <input type="submit" value=""></div>
        <div><input type="submit" style="font:16px serif"> <input type="reset" style="font:12px monospace;padding:4px 10px"> <input type="button" value="Wide label" style="font:700 15px Georgia;letter-spacing:1px;text-transform:uppercase"></div>`,
    'textareas size to cols, rows and scrollbar room': `<div><textarea></textarea> <textarea cols="30" rows="3"></textarea> <textarea style="overflow:hidden"></textarea></div>
        <div><textarea style="font:14px Arial"></textarea> <textarea cols="8" style="font:12px monospace"></textarea> <textarea style="overflow-x:scroll"></textarea></div>`,
    'checkbox, radio, range and colour baselines': `<div>text <input type="checkbox"> <input type="checkbox" style="appearance:none;width:12px;height:12px;border:1px solid"> after</div>
        <div>text <input type="radio"> after</div><div>text <input type="range"> after</div>
        <div>text <input type="color"> <input type="color" style="height:40px"> after</div>
        <div>text <select><option>One</option></select> <input type="button" style="height:33.3px;padding-top:2.3px"> after</div>`
};
for (const width of WIDTHS) for (const [name, html] of Object.entries(CONTROLS)) {
    await test(`${width}px controls/${name}`, async () => {
        stage.style.width = `${width}px`;
        const element = document.createElement('div');
        element.innerHTML = html;
        stage.replaceChildren(element);
        await new Promise((r) => requestAnimationFrame(r));
        const mismatches = compareLayout(element, stage, CONTROL_TOLERANCE);
        report[`${width}px controls/${name}`] = mismatches;
        assert(mismatches.length === 0, `${mismatches.length} boxes differ; first: ${JSON.stringify(mismatches.slice(0, 3))}`);
    });
}
// Lengths with more digits than the six CSSOM writes (10.765625px reads
// "10.7656px", a layout unit short), and percentages and unitless line
// heights, which the browser resolves in single precision: exact to the unit
const EXACT_TOLERANCE = 1e-3;
sheet.textContent += `
    .parity-exact-rule { padding-left: 10.765625px; width: calc(33.3333333% - 3.3333333px); height: 2px; }
    .parity-exact-gap { display: flex; gap: 10.765625px; }`;
const PERCENTS = ['33.3333333%', '66.6666667%', '12.3456789%', '21%', '25.5%', '37.5%', '14.2857143%', '7.77777%', `${100 / 3}%`, `${100 / 7}%`];
const EXACT = {
    'long px lengths in markup and style rules': `<div style="padding-left:10.765625px"><div style="height:2px"></div></div>
        <div style="width:123.453125px;height:2px;margin-left:33.328125px"></div>
        <div style="width:calc(10px * 1.0765625);height:2px"></div>
        <div style="display:flex"><div style="flex:0 0 10.765625px;height:2px"></div><div style="flex:0 0 1.015625px;height:2px"></div></div>
        <div class="parity-exact-gap"><div style="width:10px;height:2px"></div><div style="width:10px;height:2px"></div></div>
        <div class="parity-exact-rule"></div>`,
    'percentages in single precision': [101, 138.015625, 175.03125, 212.046875, 249.0625, 270].map((w) => `<div style="width:${w}px">${PERCENTS.map((p) => (
        `<div style="width:${p};margin-left:${p};height:2px"></div><div style="width:calc(${p} - 3.3333333px);height:2px"></div>`)).join('')}</div>`).join(''),
    'unitless line heights in single precision': [11, 12, 13, 14, 15, 16, 20, 24].map((size) => [1.1, 1.15, 1.2, 1.3333333, 4 / 3, 1.4285714, 10 / 7, 1.7, 2].map((n) => (
        `<div style="font-size:${size}px;line-height:${n}"><div>x</div><div>y</div></div>`)).join('')).join(''),
    // fr tracks share their space in single precision, the remainder carried
    'fr tracks share their space in single precision': [200, 203, 204.5, 251.25, 270].map((w) => (
        `<div style="display:grid;width:${w}px;grid-template-columns:1fr .92fr"><div style="height:2px"></div><div style="height:2px"></div></div>`
        + `<div style="display:grid;width:${w}px;grid-template-columns:.5fr .3fr .2fr"><div style="height:2px"></div><div style="height:2px"></div><div style="height:2px"></div></div>`
        + `<div style="display:grid;width:${w}px;grid-template-columns:20px minmax(10px,1fr) minmax(10px,.92fr)"><div style="height:2px"></div><div style="height:2px"></div><div style="height:2px"></div></div>`)).join('')
        // Under a max-content constraint (inline-grid width, auto-height rows)
        // fr tracks take the used flex fraction: flex factors below 1 count as
        // 1, items spanning several tracks count too, and the sizes are
        // truncated to layout units with the remainder carried
        + `<div style="display:inline-grid;grid-template-columns:.5fr;font:13px Arial"><div>min and max differ here</div></div>`
        + `<div style="display:inline-grid;grid-template-columns:1fr 1fr;column-gap:3px"><div style="grid-column:span 2;width:101px;height:2px"></div></div>`
        + `<div style="display:inline-grid;grid-template-columns:1fr 2fr"><div style="width:100px;height:2px"></div><div style="width:200.015625px;height:2px"></div></div>`
        + `<div style="display:inline-grid;grid-template-columns:30px 1.5fr .5fr"><div style="grid-column:span 3;width:157px;height:2px"></div><div style="width:20px;height:2px"></div></div>`
        + `<div style="display:grid;grid-template-rows:1fr 1fr;width:40px"><div style="grid-row:span 2;height:37px"></div></div>`
        + `<div style="display:grid;grid-template-rows:1fr 3fr;width:40px"><div style="height:5px"></div><div style="height:20px"></div></div>`
        + `<div style="display:grid;grid-template-rows:2fr 1fr;row-gap:4px;width:40px"><div style="height:7px"></div><div style="height:30px"></div></div>`
        // A flexible track never ends below its base size
        + `<div style="display:grid;width:947.59375px;grid-template-columns:minmax(473.796875px,.7fr) .7fr"><div style="height:2px"></div><div style="height:2px"></div></div>`
        + `<div style="display:grid;width:947.59375px;grid-template-columns:.7fr .7fr"><div style="width:473.796875px;height:2px"></div><div style="height:2px"></div></div>`,
    // The browser kerns text as it shapes each text item, across spaces too
    // (" A", "T "), also in fonts with a legacy kern table (Arial, Times)
    'text kerns as the browser shapes it': ['Arial', "'Times New Roman'", 'Georgia', "'Segoe UI'"].map((family) => [9, 13, 20].map((size) => (
        `<div style="font:${size}px ${family}"><span>Lost Archive Reconstruction</span> <span>AVATAR Tokyo WAVE</span> <span>Impossible Arcology, Ty Va</span></div>`)).join('')).join(''),
    // ...but not across an inline box edge with margin, border or padding, or
    // one off the baseline: the browser breaks shaping there
    'text kerning stops at inline box edges': ['Arial', "'Times New Roman'"].map((family) => [13, 20].map((size) => (
        `<div style="font:${size}px ${family}">AV<a style="padding:0 3px">AV</a>AV<span style="margin-left:2px">To</span>WA<span style="border-right:1px solid">AT</span>Ty`
        + ` <span style="vertical-align:2px">AV</span>AV <span style="vertical-align:sub">Te</span>Yo <span>AV</span>AV</div>`)).join('')).join(''),
    // A line that ends after a hyphen drops the kern its hyphen formed with
    // the next line's first letter: the browser reshapes that line end, so it
    // fits and measures unkerned. Min-content keeps the kern (no reshaping).
    // These fonts kern a hyphen with the letter after it and give a pair's
    // whole kern to its first glyph
    'a hyphen line end drops its kerning': ['Verdana', 'Calibri', 'Cambria'].map((family) => [40, 46, 52, 58, 64, 70, 76, 84, 100, 110].map((w) => (
        `<div style="width:${w}px;font:20px ${family}">go-Tom re-Yes LA-Vat WWWWW-Tom</div>`)).join('')
        + `<div style="width:min-content;font:20px ${family}">go-Tom re-Yes LA-Vat WWWWW-Yes</div>`
        + `<div style="display:inline-block;width:min-content;font:13px ${family};text-align:right">re-Visit to-Ward</div>`
        + `<div style="width:60px;font:17px ${family};text-align:right"><span>go-Tom</span> <span>re-Yes</span></div>`).join(''),
    // A word split to fit keeps the kern with what follows only on its last piece
    'a split word keeps its kern on the last piece': ['Verdana', 'Calibri'].map((family) => [45, 52, 60].map((w) => (
        `<div style="width:${w}px;font:20px ${family};overflow-wrap:break-word;text-align:right"><span style="background:#ff0">WWWW-Tom</span></div>`)).join('')).join(''),
    // Shaping breaks at an inline edge with any margin, border or padding,
    // also when they add up to nothing or a percentage resolves to nothing
    'kerning breaks at each inline edge component': ['Arial', "'Times New Roman'"].map((family) => (
        `<p style="font:20px ${family};margin:0">AV<a style="padding:0 4px;margin:0 -4px">AV</a>AV</p>`
        + `<p style="font:20px ${family};margin:0">To<span style="border-left:2px solid;margin-left:-2px">Ty</span>Te</p>`
        + `<div style="display:inline-block;font:20px ${family}">AV<span style="padding-left:5%">AV</span></div>`
        + `<div style="display:inline-block;font:20px ${family}">Te<span style="margin-right:3%">Yo</span>Ty</div>`)).join(''),
    // Word spacing belongs to its own text: equal text in the same font without it keeps plain spaces
    'word spacing stays with its own text': `<p style="word-spacing:8px;font:13px Arial;margin:0">a b c d e f</p><p style="font:13px Arial;margin:0">a b c d e f</p>
        <p style="font:13px Arial;margin:0">g h i j</p><p style="word-spacing:5px;font:13px Arial;margin:0">g h i j</p>`,
    // The browser shares a table's width among its columns in layout units:
    // each share truncated, the remainder to the last column that took one
    'table columns share their width in layout units': ['100%', '73.3%', '210px'].map((w) => `<table style="width:${w};border-collapse:collapse;font-size:13px">
        <tr><th>App</th><th>ID</th><th>Uptime</th><th>State</th><th>GPU Memory</th><th>GPU Engine</th><th></th></tr>
        <tr><td>Task Manager</td><td>os.task-manager</td><td>2 s</td><td>running</td><td>0 B</td><td>none</td><td><button>End</button></td></tr></table>
        <table style="width:${w};border-spacing:3px"><tr><td style="width:37px">fixed</td><td>auto one</td><td style="width:55.5px">fixed two</td><td>a</td><td>the longest cell of all</td></tr></table>`).join(''),
    // A column with a specified width ignores its other cells' max-content
    'a fixed column ignores its other cells max-content': ['auto', '100%', '400px'].map((w) => `<table style="width:${w};font-size:13px">
        <tr><td style="width:100px">a</td><td>b</td></tr><tr><td>text whose max-content is wider than the column's specified width</td><td>x</td></tr></table>
        <table style="width:${w};font-size:13px;border-spacing:2px"><tr><td style="width:60px">fixed</td><td style="width:50px">two</td><td>auto</td></tr>
        <tr><td>a wide cell under a fixed column</td><td>short</td><td>an auto cell with some text</td></tr></table>`).join(''),
    // Spanning cells widen their columns in layout units, so an auto table at
    // its own max-content gives every column its max
    'colspan widens columns in layout units': `<table style="font-size:13px;border-spacing:0">
        <tr><td>aaa bbb</td><td><span style="display:inline-block;width:10px">x</span></td><td><span style="display:inline-block;width:10px">y</span></td><td><span style="display:inline-block;width:10px">z</span></td></tr>
        <tr><td>c</td><td colspan="3">a cell that spans three narrow columns</td></tr></table>
        <table style="font-size:13px"><tr><td>one</td><td>two</td><td>three</td></tr><tr><td colspan="2">spanning two columns, wider</td><td>t</td></tr></table>`,
    // sub and sup are smaller and shifted off the baseline, as the UA sheet sets them
    'sub and sup elements': [11, 13, 16, 20].map((size) => `<p style="font:${size}px Arial;margin:0">x<sub>2</sub> y<sup>3</sup> H<sub>2</sub>O, E=mc<sup>2</sup> <span style="vertical-align:sub">s</span><span style="vertical-align:super">S</span></p>`).join(''),
    // A spanning cell's width is shared among its columns as the table's
    // width is: columns grow toward their max-content first
    'colspan cells share their width like the table does': `<table style="width:1px;border-spacing:0;font:13px Arial"><tr><td>aaa aaa aaa aaa</td><td>bbbbbbbbbbbb</td></tr><tr><td colspan="2">cccccccccccccccccccccccc</td></tr></table>
        <table style="font:13px Arial"><tr><td>one two three</td><td>x</td><td>four five</td></tr><tr><td colspan="3">a spanning cell wider than all three columns together are</td></tr></table>
        <table style="width:1px;font:13px Arial"><tr><td style="width:40px">fix</td><td>auto auto auto</td></tr><tr><td colspan="2">ddddddddddddddddddddddddddddd</td></tr></table>
        <table style="font:13px Arial;border-spacing:3px"><tr><td>a</td><td>b b b b</td><td>c</td></tr><tr><td colspan="2" style="width:150px">fixed span</td><td>d</td></tr></table>
        <table style="width:300px;font:13px Arial"><tr><td>s</td><td>t t t</td></tr><tr><td colspan="2">eeeeeeeeeeeeee</td></tr><tr><td>u u u u u u u u</td><td>v</td></tr></table>`,
    // Columns no cell starts in are merged: no width and no border spacing
    'columns only spanning cells reach take no spacing': `<table style="border-spacing:10px;font:13px Arial"><tr><td>a</td><td>b</td></tr><tr><td colspan="4">c</td></tr></table>
        <table style="border-spacing:4px;font:13px Arial"><tr><td>x</td><td>y</td><td>z</td></tr><tr><td colspan="100">a footer spanning a hundred columns</td></tr></table>
        <table style="width:300px;border-spacing:6px;font:13px Arial"><tr><td>a</td><td colspan="3">wide</td></tr><tr><td>b</td><td>c</td></tr></table>`,
    // A table with no columns has rows of no width
    'a table with no columns': `<table style="border-spacing:10px"><tr></tr></table><table style="border-spacing:4px 6px;padding:3px"><tbody><tr></tr></tbody></table>`,
    // A container query unit is a percentage of the container's size in
    // layout units (222.2px holds 222.1875px), not of the six digits CSSOM shows
    'container query units of fractional containers': `<div style="container-type:inline-size;width:222.2px"><div style="width:33.3cqw;height:2px;margin-left:12.5cqw"></div></div>
        <div style="container-type:size;width:333.33px;height:77.7px;padding:7px;border:3px solid;box-sizing:border-box"><div style="width:21cqw;height:33.3cqh;margin-left:7.77cqmin"></div></div>`
};
for (const width of WIDTHS) for (const [name, html] of Object.entries(EXACT)) {
    await test(`${width}px exact/${name}`, async () => {
        stage.style.width = `${width}px`;
        const element = document.createElement('div');
        element.innerHTML = html;
        stage.replaceChildren(element);
        await new Promise((r) => requestAnimationFrame(r));
        const mismatches = compareLayout(element, stage, EXACT_TOLERANCE);
        report[`${width}px exact/${name}`] = mismatches;
        assert(mismatches.length === 0, `${mismatches.length} boxes differ; first: ${JSON.stringify(mismatches.slice(0, 3))}`);
    });
}
// Set from script, both widths read "10.7656px" and so does the style
// attribute; then they trade values, which leaves both attributes as they were
for (const width of WIDTHS) {
    await test(`${width}px exact/script lengths that read the same`, async () => {
        stage.style.width = `${width}px`;
        const element = document.createElement('div');
        const [a, b] = [document.createElement('div'), document.createElement('div')];
        a.style.height = b.style.height = '2px';
        a.style.width = '10.765625px';
        b.style.width = '10.76562px';
        element.append(a, b);
        stage.replaceChildren(element);
        await new Promise((r) => requestAnimationFrame(r));
        const mismatches = compareLayout(element, stage, EXACT_TOLERANCE);
        a.style.width = '10.76562px';
        b.style.width = '10.765625px';
        await new Promise((r) => requestAnimationFrame(r));
        mismatches.push(...compareLayout(element, stage, EXACT_TOLERANCE));
        report[`${width}px exact/script lengths that read the same`] = mismatches;
        assert(mismatches.length === 0, `${mismatches.length} boxes differ; first: ${JSON.stringify(mismatches.slice(0, 3))}`);
    });
}
// ── Sticky positioning, containing blocks, line clamp, shadow trees ──────
// Their own engine reads each element's scroll offsets, and the comparison
// walks the flat tree, into open shadow roots and through slots
const scrollEngine = new LayoutEngine({
    resolver,
    scrollbarWidth: 0,
    scrollOffsets: (box) => (box.element ? { x: box.element.scrollLeft || 0, y: box.element.scrollTop || 0 } : null)
});

/** Elements of `root`'s flat tree (shadow trees and slotted nodes included). */
function flatElements(root) {
    const out = [];
    const walk = (el) => {
        out.push(el);
        let children = el.shadowRoot ? [...el.shadowRoot.children] : [...el.children];
        if (el.localName === 'slot') {
            const assigned = el.assignedElements();
            if (assigned.length || el.assignedNodes().length) children = assigned;
        }
        for (const child of children) walk(child);
    };
    walk(root);
    return out;
}

/** compareLayout with the scroll-aware engine over the flat tree. */
function compareFlat(rootEl, host, tolerance) {
    const hostRect = host.getBoundingClientRect();
    const contentX = hostRect.left + host.clientLeft + parseFloat(getComputedStyle(host).paddingLeft);
    const contentY = hostRect.top + host.clientTop + parseFloat(getComputedStyle(host).paddingTop);
    const width = host.clientWidth - parseFloat(getComputedStyle(host).paddingLeft) - parseFloat(getComputedStyle(host).paddingRight);
    const result = scrollEngine.layout(rootEl, { width, rootInherited: inheritedStyleFromHost(host) });
    const mismatches = [];
    for (const el of flatElements(rootEl)) {
        if (el.closest('svg') && el.localName !== 'svg') continue;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const box = result.boxes.get(el);
        const domHidden = style.display === 'none' || (rect.width === 0 && rect.height === 0 && !el.getClientRects().length);
        if (!box) {
            if (!domHidden && el.getClientRects().length) mismatches.push({ el: describe(el, rootEl), reason: 'missing in Plauna layout', dom: rect });
            continue;
        }
        if (domHidden && style.display === 'none') {
            mismatches.push({ el: describe(el, rootEl), reason: 'hidden in DOM, laid out by Plauna' });
            continue;
        }
        let ours;
        if (box.outer === 'inline' && !box.atomic && box.absFragments?.length) {
            const x0 = Math.min(...box.absFragments.map((f) => f.x));
            const y0 = Math.min(...box.absFragments.map((f) => f.y));
            ours = { x: x0, y: y0, width: Math.max(...box.absFragments.map((f) => f.x + f.width)) - x0, height: Math.max(...box.absFragments.map((f) => f.y + f.height)) - y0 };
        } else {
            ours = { x: box.absX, y: box.absY, width: box.width, height: box.height };
            if (box.matrix) ours = transformRectBounds(box.matrix, ours);
        }
        const dom = { x: rect.left - contentX, y: rect.top - contentY, width: rect.width, height: rect.height };
        const err = Math.max(Math.abs(ours.x - dom.x), Math.abs(ours.y - dom.y), Math.abs(ours.width - dom.width), Math.abs(ours.height - dom.height));
        if (err > tolerance) {
            mismatches.push({
                el: describe(el, rootEl), err: +err.toFixed(3),
                dom: [dom.x, dom.y, dom.width, dom.height].map((v) => +v.toFixed(2)),
                ours: [ours.x, ours.y, ours.width, ours.height].map((v) => +v.toFixed(2))
            });
        }
    }
    return { mismatches, result };
}

sheet.textContent += `
    .ps-sc { position: relative; overflow: auto; width: 200px; height: 100px; border: 3px solid; padding: 7px 5px 11px 4px; margin-bottom: 6px; font: 13px Arial }
    .ps-st { position: sticky; height: 12px }
    .ps-tb { border-spacing: 2px; border: 1px solid }`;
const TALL = '<div style="height:300px"></div>';
const ROWS = Array.from({ length: 12 }, (_, i) => `<tr><td>row ${i}</td><td>v</td></tr>`).join('');
// Each case: markup, then the scroll offsets to check it at ([top, left] of every .ps-sc)
const STICKY = {
    // A top inset holds the box that far below the scroll container's content
    // box top: at the very start it is pushed down even at rest, mid content
    // only once scrolled to it
    'top insets at the start and mid content': [`<div class="ps-sc"><div class="ps-st" style="top:10px"></div><div style="height:40px"></div>
        <div class="ps-st" style="top:10px"></div>${TALL}</div>`, [[0, 0], [15, 0], [30, 0], [45, 0], [140, 0]]],
    // The margin box stays inside the containing block's content box
    'the containing block limits how far it sticks': [`<div class="ps-sc"><div style="height:20px"></div><div style="padding:3px;border:2px solid;height:60px">
        <div class="ps-st" style="top:0;margin:4px 0"></div></div>${TALL}</div>`, [[0, 0], [30, 0], [60, 0], [140, 0]]],
    'bottom insets, at rest and pulled up': [`<div class="ps-sc"><div style="height:20px"></div><div class="ps-st" style="bottom:5px"></div>
        <div style="height:130px"></div><div class="ps-st" style="bottom:5px"></div>${TALL}</div>`, [[0, 0], [15, 0], [60, 0], [140, 0]]],
    'left and right insets scroll sideways': [`<div class="ps-sc"><div style="display:flex;width:600px;height:20px"><div style="flex:none;width:30px"></div>
        <div class="ps-st" style="left:6px;flex:none;width:40px"></div><div style="flex:none;width:300px"></div><div class="ps-st" style="right:8px;flex:none;width:30px"></div>
        <div style="flex:none;width:100px"></div></div></div>`, [[0, 0], [0, 30], [0, 120], [0, 300]]],
    // Percentages are of the scroll container's content box
    'percentage insets': [`<div class="ps-sc"><div style="height:40px"></div><div class="ps-st" style="top:20%"></div>${TALL}</div>`, [[0, 0], [30, 0], [90, 0]]],
    // An inline box sticks within its line's block, here a single line
    'an inline box stays in its block': [`<div class="ps-sc"><div style="height:40px"></div><p style="margin:0">text <span class="ps-st" style="top:0;height:auto">sticky</span> tail</p>${TALL}</div>`,
        [[0, 0], [45, 0], [140, 0]]],
    // Table parts stick within the whole table
    'table header cells and groups stick within the table': [`<div class="ps-sc"><div style="height:20px"></div><table class="ps-tb"><thead><tr><th class="ps-st" style="top:0;height:auto">Head</th><th>H2</th></tr></thead>
        <tbody>${ROWS}</tbody></table></div><div class="ps-sc"><table class="ps-tb"><thead class="ps-st" style="top:4px"><tr><th>Head</th><th>H2</th></tr></thead><tbody>${ROWS}</tbody></table></div>`,
        [[0, 0], [30, 0], [120, 0], [400, 0]]],
    // Flex and grid items stick within their container, not their area
    'grid and flex items stick within the container': [`<div class="ps-sc"><div style="display:grid;grid-template-rows:auto 1fr;height:300px"><div class="ps-st" style="top:0;height:20px"></div><div></div></div></div>
        <div class="ps-sc"><div style="height:30px"></div><div style="display:grid;grid-template-rows:20px 50px"><div class="ps-st" style="top:5px;height:20px"></div><div></div></div>${TALL}</div>
        <div class="ps-sc"><div style="display:flex;flex-direction:column;height:300px"><div style="height:30px;flex:none"></div><div class="ps-st" style="top:0;height:20px;flex:none"></div></div></div>
        <div class="ps-sc"><div style="display:flex;height:300px"><div class="ps-st" style="top:0;width:40px;height:auto"></div></div></div>`, [[0, 0], [15, 0], [60, 0], [200, 0]]],
    // A relatively positioned parent moves its static position; a sticky box
    // positions its absolute children
    'relative parents and absolute children': [`<div class="ps-sc"><div style="height:30px"></div><div style="position:relative;top:10px"><div class="ps-st" style="top:0;height:20px"></div><div style="height:200px"></div></div></div>
        <div class="ps-sc"><div style="height:30px"></div><div class="ps-st" style="top:0;height:20px"><div style="position:absolute;top:5px;left:5px;width:10px;height:10px"></div></div>${TALL}</div>`,
        [[0, 0], [15, 0], [60, 0], [160, 0]]],
    // Each sticky box sticks within its nearest scroll container
    'nested scroll containers': [`<div class="ps-sc" style="height:150px"><div style="height:20px"></div><div class="ps-sc" style="height:60px">
        <div style="height:10px"></div><div class="ps-st" style="top:2px"></div>${TALL}</div><div class="ps-st" style="top:0"></div>${TALL}</div>`, [[0, 0], [25, 0], [80, 0]]]
};
for (const width of WIDTHS) for (const [name, [html, offsets]] of Object.entries(STICKY)) {
    await test(`${width}px sticky/${name}`, async () => {
        stage.style.width = `${width}px`;
        const element = document.createElement('div');
        element.innerHTML = html;
        stage.replaceChildren(element);
        const mismatches = [];
        for (const [top, left] of offsets) {
            for (const scroller of element.querySelectorAll('.ps-sc')) {
                scroller.scrollTop = top;
                scroller.scrollLeft = left;
            }
            await new Promise((r) => requestAnimationFrame(r));
            for (const m of compareFlat(element, stage, EXACT_TOLERANCE).mismatches) mismatches.push({ at: [top, left], ...m });
        }
        report[`${width}px sticky/${name}`] = mismatches;
        assert(mismatches.length === 0, `${mismatches.length} boxes differ; first: ${JSON.stringify(mismatches.slice(0, 3))}`);
    });
}

// What makes a containing block for absolutely positioned and fixed boxes
// (Chrome 155, measured): the root has contain: layout, so a fixed box with
// no other containing block resolves against it in both layouts
const CONTAINING = [
    ['content-visibility: auto', 'content-visibility:auto'], ['transform', 'transform:translateX(0)'], ['translate', 'translate:0px'],
    ['scale', 'scale:1'], ['perspective', 'perspective:100px'], ['filter', 'filter:blur(0)'], ['filter opacity', 'filter:opacity(1)'],
    ['backdrop-filter', 'backdrop-filter:blur(2px)'], ['will-change transform', 'will-change:transform'], ['will-change perspective', 'will-change:perspective'],
    ['will-change filter', 'will-change:filter'], ['will-change backdrop-filter', 'will-change:backdrop-filter'], ['will-change translate', 'will-change:translate'],
    ['will-change scale', 'will-change:scale'], ['will-change rotate', 'will-change:rotate'], ['will-change list', 'will-change:opacity, transform'],
    ['will-change contain', 'will-change:contain'], ['will-change position (absolute only)', 'will-change:position'], ['contain layout', 'contain:layout'],
    ['contain paint', 'contain:paint'], ['contain strict', 'contain:strict'], ['contain content', 'contain:content'], ['preserve-3d', 'transform-style:preserve-3d'],
    // ...and what does not
    ['will-change opacity', 'will-change:opacity'], ['will-change top', 'will-change:top'], ['contain size', 'contain:size'], ['contain style', 'contain:style'],
    ['contain inline-size', 'contain:inline-size'], ['container-type size', 'container-type:size'], ['container-type inline-size', 'container-type:inline-size'],
    ['clip-path', 'clip-path:inset(0)'], ['mask', 'mask-image:linear-gradient(#000,#000)'], ['isolation', 'isolation:isolate'], ['opacity', 'opacity:0.99'],
    ['mix-blend-mode', 'mix-blend-mode:multiply'], ['overflow hidden', 'overflow:hidden']
];
for (const width of WIDTHS) {
    await test(`${width}px containing blocks/absolute and fixed boxes`, async () => {
        stage.style.width = `${width}px`;
        const element = document.createElement('div');
        element.style.cssText = 'contain:layout;padding:5px 7px';
        element.innerHTML = CONTAINING.map(([, css]) => `<div style="margin:4px 0 0 13px;width:100px;height:20px;${css}">`
            + '<div style="position:absolute;left:3px;top:4px;width:5px;height:5px"></div><div style="position:fixed;left:6px;top:2px;width:4px;height:3px"></div>'
            + '<div style="position:absolute;right:2px;bottom:1px;width:3px;height:3px"></div></div>').join('');
        stage.replaceChildren(element);
        await new Promise((r) => requestAnimationFrame(r));
        const mismatches = compareFlat(element, stage, EXACT_TOLERANCE).mismatches;
        report[`${width}px containing blocks/absolute and fixed boxes`] = mismatches;
        assert(mismatches.length === 0, `${mismatches.length} boxes differ; first: ${JSON.stringify(mismatches.slice(0, 3))}`);
    });
}

// -webkit-line-clamp (Chrome 155, measured): the box ends at the bottom of
// its last kept line; what follows is still laid out
sheet.textContent += `
    .pc-lc { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; width: 150px; font: 13px Arial; margin-bottom: 8px }`;
const TEXT = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen';
const CLAMP = {
    'text past the clamp': `<div class="pc-lc">${TEXT}</div><div class="pc-lc" style="padding:5px 3px 7px;border:2px solid">${TEXT}</div>
        <div class="pc-lc" style="-webkit-line-clamp:1">${TEXT}</div><div class="pc-lc" style="overflow:visible">${TEXT}</div><div>after</div>`,
    'fewer lines than the clamp': '<div class="pc-lc">one two</div><div class="pc-lc" style="-webkit-line-clamp:3">one two three four five six seven eight</div>',
    'lines counted through nested blocks': `<div class="pc-lc"><p style="margin:0">first para</p><p style="margin:4px 0">second para here</p><p style="margin:0">third para</p><div style="height:20px"></div></div>
        <div class="pc-lc"><p style="margin:0">first para which wraps onto two lines</p><p style="margin:0">second</p></div>
        <div class="pc-lc"><div><span>nested one two three four five six</span></div><div>seven eight nine ten eleven twelve</div></div>`,
    'inline boxes across the clamp': '<div class="pc-lc">one two three <span>four five six seven</span> eight nine <span style="padding:0 2px">ten eleven twelve thirteen</span> fourteen</div>',
    'a set height, a flex item and an inline box': `<div class="pc-lc" style="height:60px">${TEXT}</div>
        <div style="display:flex;align-items:flex-start"><div class="pc-lc" style="flex:none">${TEXT}</div></div>
        <div><div class="pc-lc" style="display:-webkit-inline-box;vertical-align:top">${TEXT}</div> after</div>`,
    // A block holding the clamped line ends there; a block past it ends
    // after its own first line (its later lines still lay out)
    'blocks past the clamped line keep their first line': `<div class="pc-lc"><div>one two</div><div>x</div><div>${TEXT}</div><div>${TEXT}</div></div>
        <div class="pc-lc"><div>one two</div><div>x</div><div style="padding:4px;border:1px solid">${TEXT}</div><div style="height:7px"></div></div>
        <div class="pc-lc"><div>one</div><div><div>two</div><div>${TEXT}</div></div><div>${TEXT}</div></div>
        <div class="pc-lc" style="-webkit-line-clamp:3"><div>one</div><div>${TEXT}</div><div>${TEXT}</div></div>
        <div class="pc-lc"><p style="margin:5px 0">one</p><p style="margin:5px 0">two</p><p style="margin:5px 0">${TEXT}</p><p style="margin:5px 0">x</p></div>
        <div class="pc-lc" style="overflow:visible"><div>one</div><div>two</div><div><div>${TEXT}</div><div>${TEXT}</div></div><div>x</div></div>
        <div class="pc-lc"><div>one</div><div>two</div><div style="height:0"></div><div style="height:12px"></div><div>x y</div></div>`,
    // An inline-block inside keeps its own lines out of the count
    'lines of a nested formatting context do not count': `<div class="pc-lc"><span style="display:inline-block;width:60px">a b c d e f g h</span> tail words here and more words</div>`
};
for (const width of WIDTHS) for (const [name, html] of Object.entries(CLAMP)) {
    await test(`${width}px line clamp/${name}`, async () => {
        stage.style.width = `${width}px`;
        const element = document.createElement('div');
        element.innerHTML = html;
        stage.replaceChildren(element);
        await new Promise((r) => requestAnimationFrame(r));
        const mismatches = compareFlat(element, stage, EXACT_TOLERANCE).mismatches;
        report[`${width}px line clamp/${name}`] = mismatches;
        assert(mismatches.length === 0, `${mismatches.length} boxes differ; first: ${JSON.stringify(mismatches.slice(0, 3))}`);
    });
}
// The last kept line ends in an ellipsis right after its text when it fits
// (the browser reports the line's text without it), else its text is cut
await test('line clamp/the last kept line ends in an ellipsis', async () => {
    stage.style.width = '640px';
    const element = document.createElement('div');
    element.innerHTML = `<div class="pc-lc">${TEXT}</div><div class="pc-lc" style="width:118px">${TEXT}</div><div class="pc-lc">one two</div>
        <div class="pc-lc"><p style="margin:0">first para</p><p style="margin:0">second para here</p><p style="margin:0">third</p></div>`;
    stage.replaceChildren(element);
    await new Promise((r) => requestAnimationFrame(r));
    const { result } = compareFlat(element, stage, EXACT_TOLERANCE);
    const [fits, cut, short, blocks] = element.children;
    const ellipses = (box) => (box.runs || []).filter((run) => run.ellipsis);
    const fitsBox = result.boxes.get(fits);
    const [ellipsis] = ellipses(fitsBox);
    assert(ellipsis && ellipsis.text === '…' && ellipsis.line === 1, `no ellipsis on the kept line: ${JSON.stringify(ellipses(fitsBox))}`);
    // The DOM's second line of text ends where the ellipsis starts
    const range = document.createRange();
    range.selectNodeContents(fits);
    const lines = [...range.getClientRects()];
    const lineRight = lines[1].right - fits.getBoundingClientRect().left;
    assert(Math.abs(ellipsis.x - lineRight) < 0.05, `ellipsis at ${ellipsis.x}, the line's text ends at ${lineRight}`);
    assert(!fitsBox.runs.some((run) => run.line > 1 && run.ellipsis), 'ellipsis past the kept line');
    const cutBox = result.boxes.get(cut);
    const [cutEllipsis] = ellipses(cutBox);
    assert(cutEllipsis && cutEllipsis.x + cutEllipsis.width <= cutBox.contentX + 118 + 1e-6, 'cut line overflows with its ellipsis');
    assert(cutBox.runs.filter((run) => run.line === 1 && !run.ellipsis).every((run) => run.x + run.width <= cutEllipsis.x + 1e-6), 'text under the ellipsis');
    assert(!ellipses(result.boxes.get(short)).length, 'ellipsis without clamped lines');
    const second = result.boxes.get(blocks.children[1]);
    assert(ellipses(second).length === 1 && !ellipses(result.boxes.get(blocks.children[0])).length, 'ellipsis not on the nested kept line');
});

// Open shadow roots and slots lay out as the browser renders the flat tree
const SHADOW = {
    // A host whose content lives only in its shadow tree (Control Panel)
    'a shadow host lays out its shadow tree': `<div style="width:300px"><template shadowrootmode="open"><style>:host { display: block; padding: 4px }
        .panel { height: 200px; border: 1px solid; display: grid; grid-template-columns: 80px 1fr } .side { background: #333 }</style>
        <div class="panel"><nav class="side">nav</nav><main><h2 style="margin:0 0 6px">Title</h2><p style="margin:0">Body text in the shadow tree</p></main></div></template>light text never shown</div>`,
    // Named and default slots, ::slotted() and :host rules, fallback content
    'slots show assigned nodes or their fallback': `<div class="ph"><template shadowrootmode="open"><style>:host { display: block; border: 2px solid }
        ::slotted(p) { margin: 3px 0; height: 20px } slot[name=title] { display: block; padding: 5px } main { display: flex; gap: 4px }</style>
        <header><slot name="title">fallback title</slot></header><main><slot></slot></main>
        <footer><slot name="none"><span style="display:inline-block;width:30px;height:9px">fallback</span></slot></footer></template>
        <p slot="title">Titled</p><p>one</p><p>two</p>text node</div>`,
    // A shadow host inside another shadow tree, and a slot forwarded through it
    'nested shadow trees and forwarded slots': `<div><template shadowrootmode="open"><style>.inner-host { padding: 6px; border: 1px solid }</style>
        <div class="inner-host"><template shadowrootmode="open"><style>:host { display: block } div { height: 14px }</style><div>inner</div><slot></slot></template><slot></slot></div></template>
        <span style="display:inline-block;width:50px;height:12px">slotted</span></div>`
};
for (const width of WIDTHS) for (const [name, html] of Object.entries(SHADOW)) {
    await test(`${width}px shadow/${name}`, async () => {
        stage.style.width = `${width}px`;
        const element = document.createElement('div');
        element.setHTMLUnsafe(html);
        stage.replaceChildren(element);
        await new Promise((r) => requestAnimationFrame(r));
        const mismatches = compareFlat(element, stage, EXACT_TOLERANCE).mismatches;
        report[`${width}px shadow/${name}`] = mismatches;
        assert(mismatches.length === 0, `${mismatches.length} boxes differ; first: ${JSON.stringify(mismatches.slice(0, 3))}`);
    });
}

// A stable scrollbar gutter takes the classic bar's room even where
// scrollbars are hidden (Chrome with --hide-scrollbars, as this page runs)
const GUTTER = {
    'stable gutters reserve room with hidden scrollbars': `<div style="width:120px;height:40px;overflow:auto;scrollbar-gutter:stable"><div style="height:10px"></div></div>
        <div style="width:120px;height:40px;overflow:hidden;scrollbar-gutter:stable both-edges;padding:0 3px"><div style="height:10px"></div></div>
        <div style="width:120px;overflow-x:auto;overflow-y:hidden;scrollbar-gutter:stable"><div style="height:10px"></div></div>
        <div style="width:120px;overflow:clip;scrollbar-gutter:stable"><div style="height:10px"></div></div>
        <div style="width:120px;overflow:auto;scrollbar-gutter:stable;scrollbar-width:none"><div style="height:10px"></div></div>
        <div style="display:inline-block;overflow:hidden;scrollbar-gutter:stable both-edges"><div style="width:50px;height:10px"></div></div>
        <div style="width:120px;height:30px;overflow:auto;scrollbar-gutter:stable;direction:rtl"><div style="height:10px"></div></div>`
};
for (const width of WIDTHS) for (const [name, html] of Object.entries(GUTTER)) {
    await test(`${width}px scrollbars/${name}`, async () => {
        stage.style.width = `${width}px`;
        const element = document.createElement('div');
        element.innerHTML = html;
        stage.replaceChildren(element);
        await new Promise((r) => requestAnimationFrame(r));
        const mismatches = compareFlat(element, stage, EXACT_TOLERANCE).mismatches;
        report[`${width}px scrollbars/${name}`] = mismatches;
        assert(mismatches.length === 0, `${mismatches.length} boxes differ; first: ${JSON.stringify(mismatches.slice(0, 3))}`);
    });
}

// A scroll moves only the scroll container's subtree: nothing is laid out
// again and the rest of the tree keeps its coordinates. (A scroll is a layout
// pass with the last pass's boxes and nothing dirty.)
await test('sticky/a scroll walks only what scrolled', async () => {
    stage.style.width = '640px';
    const element = document.createElement('div');
    element.innerHTML = `<div class="ps-sc"><div style="height:40px"></div><div class="ps-st" style="top:0"></div>${TALL}</div><div><div style="height:9px"></div></div>
        <div class="ps-sc"><div style="height:40px"></div><div class="ps-st" style="top:0"></div>${TALL}</div>`;
    stage.replaceChildren(element);
    await new Promise((r) => requestAnimationFrame(r));
    const offsets = (box) => (box.element ? { x: box.element.scrollLeft || 0, y: box.element.scrollTop || 0 } : null);
    const incremental = new LayoutEngine({ resolver, scrollbarWidth: 0, scrollOffsets: offsets });
    const options = { width: 640, rootInherited: inheritedStyleFromHost(stage) };
    const first = incremental.layout(element, options);
    const [scrolled, plain, other] = element.children;
    scrolled.scrollTop = 90;
    await new Promise((r) => requestAnimationFrame(r));
    const walked = new Set();
    const relativeOffset = incremental.relativeOffset;
    incremental.relativeOffset = function spy(box) { walked.add(box.element); return relativeOffset.call(this, box); };
    let laidOut = 0;
    const layoutBoxNow = incremental.layoutBoxNow;
    incremental.layoutBoxNow = function spy(...args) { laidOut++; return layoutBoxNow.apply(this, args); };
    const second = incremental.layout(element, { ...options, previous: first.boxes, dirty: [] });
    const sticky = scrolled.children[1];
    const box = second.boxes.get(sticky);
    const origin = stage.getBoundingClientRect();
    const rect = sticky.getBoundingClientRect();
    assert(Math.abs(box.absY - (rect.top - origin.top)) < EXACT_TOLERANCE, `sticky box at ${box.absY}, the browser's at ${rect.top - origin.top}`);
    assert(laidOut === 0, `${laidOut} boxes laid out again by a scroll`);
    assert(walked.has(scrolled) && walked.has(sticky), 'the scrolled subtree was not walked');
    // (The walk reaches its siblings, and stops there)
    assert(![plain.firstElementChild, ...other.children].some((el) => walked.has(el)), 'a scroll walked boxes outside its scroll container');
    assert(second.boxes.get(other.children[1]).absY === first.boxes.get(other.children[1]).absY, 'a scroll moved another scroll container');
});
// A scroll container's positioned boxes scroll with its content; a box
// positioned against something above the scroll container does not
for (const width of WIDTHS) {
    await test(`${width}px sticky/absolute boxes scroll with their scroll container`, async () => {
        stage.style.width = `${width}px`;
        const element = document.createElement('div');
        element.style.position = 'relative';
        const abs = '<div style="position:absolute;left:3px;top:4px;width:9px;height:9px"></div><div style="position:absolute;right:3px;bottom:4px;width:9px;height:9px"></div>';
        element.innerHTML = `<div class="ps-sc">${abs}<div style="width:400px;height:300px"></div></div>
            <div class="ps-sc" style="position:static">${abs}<div style="width:400px;height:300px"></div></div>
            <div class="ps-sc"><div>${abs}<div style="width:400px;height:300px"></div></div></div>
            <div class="ps-sc"><div style="position:relative;margin:5px">${abs}<div style="width:400px;height:300px"></div></div></div>
            <div class="ps-sc" style="contain:layout"><div style="position:fixed;left:2px;top:2px;width:9px;height:9px"></div><div style="width:400px;height:300px"></div></div>`;
        stage.replaceChildren(element);
        const mismatches = [];
        for (const [top, left] of [[0, 0], [40, 25], [150, 180]]) {
            for (const scroller of element.querySelectorAll('.ps-sc')) {
                scroller.scrollTop = top;
                scroller.scrollLeft = left;
            }
            await new Promise((r) => requestAnimationFrame(r));
            for (const m of compareFlat(element, stage, EXACT_TOLERANCE).mismatches) mismatches.push({ at: [top, left], ...m });
        }
        report[`${width}px sticky/absolute boxes scroll with their scroll container`] = mismatches;
        assert(mismatches.length === 0, `${mismatches.length} boxes differ; first: ${JSON.stringify(mismatches.slice(0, 3))}`);
    });
}
// With no scroll container above it in the scene, a sticky box sticks within
// the viewport it is given (the scene's in scene coordinates), if any
await test('sticky/a box with no scroll container in the scene', async () => {
    stage.style.width = '640px';
    const element = document.createElement('div');
    element.innerHTML = `<div style="height:60px"></div><div class="sticky-page" style="position:sticky;top:6px;height:12px"></div><div style="height:${innerHeight * 3}px"></div>`;
    stage.replaceChildren(element);
    const sticky = element.querySelector('.sticky-page');
    const rootScroll = document.scrollingElement;
    const was = rootScroll.scrollTop;
    try {
        for (const scroll of [0, 300, 900]) {
            rootScroll.scrollTop = scroll;
            await new Promise((r) => requestAnimationFrame(r));
            const origin = stage.getBoundingClientRect();
            const given = new LayoutEngine({ resolver, scrollbarWidth: 0, stickyViewport: { x: -origin.left, y: -origin.top, width: innerWidth, height: innerHeight } });
            const box = given.layout(element, { width: 640, rootInherited: inheritedStyleFromHost(stage) }).boxes.get(sticky);
            const dom = sticky.getBoundingClientRect().top - origin.top;
            assert(Math.abs(box.absY - dom) < EXACT_TOLERANCE, `scrolled ${scroll}: sticky box at ${box.absY}, the browser's at ${dom}`);
        }
        // Without one, it stays in flow (a surface scrolled from outside keeps its boxes)
        const plain = new LayoutEngine({ resolver, scrollbarWidth: 0 });
        const box = plain.layout(element, { width: 640, rootInherited: inheritedStyleFromHost(stage) }).boxes.get(sticky);
        assert(box.absY === 60, `sticky box at ${box.absY} with no viewport`);
    } finally {
        rootScroll.scrollTop = was;
    }
});
// A kept sticky box still follows what it sticks within
await test('sticky/a kept box follows its scroll container and containing block', async () => {
    stage.style.width = '640px';
    const element = document.createElement('div');
    element.innerHTML = `<div class="ps-sc" style="box-sizing:border-box;height:120px"><div><div style="height:300px"></div><div class="ps-st" style="bottom:0"></div></div></div>
        <div class="ps-sc"><div style="height:40px"></div><div class="grow" style="height:60px"><div style="height:30px"></div><div class="ps-st" style="top:0"></div></div>${TALL}</div>`;
    stage.replaceChildren(element);
    const offsets = (box) => (box.element ? { x: box.element.scrollLeft || 0, y: box.element.scrollTop || 0 } : null);
    const incremental = new LayoutEngine({ resolver, scrollbarWidth: 0, scrollOffsets: offsets });
    const options = { width: 640, rootInherited: inheritedStyleFromHost(stage) };
    await new Promise((r) => requestAnimationFrame(r));
    let result = incremental.layout(element, options);
    const [first, second] = element.children;
    const compare = (el, label) => {
        const box = result.boxes.get(el);
        const rect = el.getBoundingClientRect();
        const y = rect.top - stage.getBoundingClientRect().top;
        assert(Math.abs(box.absY - y) < EXACT_TOLERANCE, `${label}: sticky box at ${box.absY}, the browser's at ${y}`);
    };
    // The scroll container shrinks, its child box stays where it is
    first.style.height = '70px';
    second.scrollTop = 60;
    await new Promise((r) => requestAnimationFrame(r));
    result = incremental.layout(element, { ...options, previous: result.boxes, dirty: [first] });
    compare(first.querySelector('.ps-st'), 'resized scroll container');
    compare(second.querySelector('.ps-st'), 'scrolled');
    // Its padding takes room from what the box sticks within, nothing else moves
    first.style.paddingBottom = '31px';
    await new Promise((r) => requestAnimationFrame(r));
    result = incremental.layout(element, { ...options, previous: result.boxes, dirty: [first] });
    compare(first.querySelector('.ps-st'), 'padded scroll container');
    // The containing block grows, the sticky box's parent and origin stay
    const grow = second.querySelector('.grow');
    grow.style.height = '150px';
    await new Promise((r) => requestAnimationFrame(r));
    result = incremental.layout(element, { ...options, previous: result.boxes, dirty: [grow] });
    compare(second.querySelector('.ps-st'), 'grown containing block');
});

// Anonymous boxes repeat none of their parent's non-inherited values
for (const width of WIDTHS) {
    await test(`${width}px containing blocks/anonymous boxes are none`, async () => {
        stage.style.width = `${width}px`;
        const element = document.createElement('div');
        const inner = '<div>block</div>text<span style="position:fixed;left:3px;top:4px;width:5px;height:5px"></span><span style="position:absolute;left:6px;top:2px;width:4px;height:3px"></span>';
        element.innerHTML = ['contain:layout', 'contain:paint', 'will-change:transform', 'filter:blur(0)', 'backdrop-filter:blur(1px)', 'perspective:100px', 'transform-style:preserve-3d', 'content-visibility:auto']
            .map((css) => `<div style="padding:9px 7px;margin-bottom:3px;${css}">${inner}</div><div style="display:flex;padding:5px;${css}">flex text</div>`).join('');
        stage.replaceChildren(element);
        await new Promise((r) => requestAnimationFrame(r));
        const mismatches = compareFlat(element, stage, EXACT_TOLERANCE).mismatches;
        report[`${width}px containing blocks/anonymous boxes are none`] = mismatches;
        assert(mismatches.length === 0, `${mismatches.length} boxes differ; first: ${JSON.stringify(mismatches.slice(0, 3))}`);
    });
    await test(`${width}px line clamp/anonymous boxes do not clamp again`, async () => {
        stage.style.width = `${width}px`;
        const element = document.createElement('div');
        element.innerHTML = `<div class="pc-lc" style="-webkit-line-clamp:3">${TEXT}<div>block</div>${TEXT}</div>
            <div class="pc-lc" style="-webkit-line-clamp:1">one<div>block</div>${TEXT}</div>
            <div class="pc-lc" style="display:-webkit-box;width:300px">${TEXT}<div>block</div>${TEXT}<div>block two</div>x</div>`;
        stage.replaceChildren(element);
        await new Promise((r) => requestAnimationFrame(r));
        const mismatches = compareFlat(element, stage, EXACT_TOLERANCE).mismatches;
        report[`${width}px line clamp/anonymous boxes do not clamp again`] = mismatches;
        assert(mismatches.length === 0, `${mismatches.length} boxes differ; first: ${JSON.stringify(mismatches.slice(0, 3))}`);
    });
}

// Positioned boxes sit inside a stable gutter, as they do inside a bar
const GUTTER_POSITIONED = {
    'absolute boxes stay inside stable gutters': `<div style="position:relative;width:120px;height:40px;overflow:hidden;scrollbar-gutter:stable"><div style="position:absolute;right:0;top:0;width:10px;height:10px"></div><div style="position:absolute;left:10%;width:50%;height:5px"></div></div>
        <div style="position:relative;width:120px;height:40px;overflow:hidden;scrollbar-gutter:stable both-edges;padding:2px"><div style="position:absolute;left:0;top:0;width:10px;height:10px"></div><div style="position:absolute;right:0;top:0;width:10px;height:10px"></div><div style="height:3px"></div><div style="position:absolute;width:5px;height:5px"></div></div>`
};
for (const width of WIDTHS) for (const [name, html] of Object.entries(GUTTER_POSITIONED)) {
    await test(`${width}px scrollbars/${name}`, async () => {
        stage.style.width = `${width}px`;
        const element = document.createElement('div');
        element.innerHTML = html;
        stage.replaceChildren(element);
        await new Promise((r) => requestAnimationFrame(r));
        const mismatches = compareFlat(element, stage, EXACT_TOLERANCE).mismatches;
        report[`${width}px scrollbars/${name}`] = mismatches;
        assert(mismatches.length === 0, `${mismatches.length} boxes differ; first: ${JSON.stringify(mismatches.slice(0, 3))}`);
    });
}

// Everything else inside a shadow tree: form controls take their tree's UA
// sizes, boxes position, stick and clamp there as anywhere
const SHADOW_MORE = {
    'form controls in a shadow tree': `<div><template shadowrootmode="open"><style>input, select, textarea { margin: 2px }</style>
        <input><input type="checkbox"><input type="radio"><input type="range"><input type="color"><select><option>one</option></select><textarea></textarea><button>Push</button>
        <input type="button" value="Label"></template></div>`,
    'positioned, sticky and clamped boxes in a shadow tree': `<div style="position:relative;width:300px"><template shadowrootmode="open"><style>:host { display: block; height: 150px; transform: translateX(0) }
        .sc { position: relative; overflow: auto; height: 80px; width: 200px } .st { position: sticky; top: 3px; height: 10px }
        .ab { position: absolute; right: 4px; bottom: 4px; width: 10px; height: 10px } .fx { position: fixed; left: 2px; top: 1px; width: 7px; height: 7px }
        .lc { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; width: 120px; font: 13px Arial }</style>
        <div class="sc"><div class="st"></div><div style="height:200px"></div><div class="ab"></div></div><div class="fx"></div><div class="lc">${TEXT}</div></template></div>`,
    'a slot with its own box and a host that is a container': `<div style="display:flex;gap:4px"><template shadowrootmode="open"><style>slot { display: flex; flex-direction: column; gap: 2px; width: 90px } ::slotted(*) { height: 12px }
        .side { width: 40px; height: 40px }</style><div class="side"></div><slot></slot></template><b>one</b><i>two</i>three</div>`,
    'display contents around slots, and empty slots': `<div><template shadowrootmode="open"><style>section { display: contents } ::slotted(p) { margin: 2px 0 }</style>
        <section><slot name="a"></slot></section><section><slot name="none"></slot></section><div><slot></slot></div></template><p slot="a">named</p><p>default</p></div>`
};
for (const width of WIDTHS) for (const [name, html] of Object.entries(SHADOW_MORE)) {
    await test(`${width}px shadow/${name}`, async () => {
        stage.style.width = `${width}px`;
        const element = document.createElement('div');
        element.setHTMLUnsafe(html);
        stage.replaceChildren(element);
        await new Promise((r) => requestAnimationFrame(r));
        const mismatches = compareFlat(element, stage, EXACT_TOLERANCE).mismatches;
        report[`${width}px shadow/${name}`] = mismatches;
        assert(mismatches.length === 0, `${mismatches.length} boxes differ; first: ${JSON.stringify(mismatches.slice(0, 3))}`);
    });
}
// A change below a slot or host rebuilds up the flat tree (through the slot and its host)
await test('shadow/a change in a slotted element and in a shadow tree lays out again', async () => {
    stage.style.width = '640px';
    const element = document.createElement('div');
    element.setHTMLUnsafe(`<div><template shadowrootmode="open"><div class="a" style="height:10px"></div><slot></slot></template><p class="light" style="margin:0;height:10px"></p></div><div class="after" style="height:5px"></div>`);
    stage.replaceChildren(element);
    await new Promise((r) => requestAnimationFrame(r));
    const incremental = new LayoutEngine({ resolver, scrollbarWidth: 0 });
    const options = { width: 640, rootInherited: inheritedStyleFromHost(stage) };
    let result = incremental.layout(element, options);
    const host = element.firstElementChild;
    const light = host.querySelector('.light');
    const inner = host.shadowRoot.querySelector('.a');
    const after = element.querySelector('.after');
    const check = (label) => {
        const box = result.boxes.get(after);
        const y = after.getBoundingClientRect().top - stage.getBoundingClientRect().top;
        assert(box && Math.abs(box.absY - y) < EXACT_TOLERANCE, `${label}: next box at ${box?.absY}, the browser's at ${y}`);
    };
    light.style.height = '30px';
    await new Promise((r) => requestAnimationFrame(r));
    result = incremental.layout(element, { ...options, previous: result.boxes, dirty: [light] });
    check('slotted element');
    inner.style.height = '40px';
    await new Promise((r) => requestAnimationFrame(r));
    result = incremental.layout(element, { ...options, previous: result.boxes, dirty: [inner] });
    check('shadow tree element');
});

// -webkit-line-clamp, the blocks around the clamped line (Chrome 155,
// measured): the content ends at the clamped line plus the block-end padding
// and border of every block from the line up to the clamp container (their
// end margins drop), and with nothing in flow after the line the clamp cuts
// nothing, so those blocks keep their natural heights, margins included
const CLAMP_BLOCKS = {
    'a block holding the clamped line keeps its padding and border': `<div class="pc-lc"><div style="padding:5px;border:2px solid">${TEXT}</div></div>
        <div class="pc-lc"><div style="padding:3px;border-bottom:1px solid"><div style="padding:5px;border:2px solid;margin-bottom:9px">${TEXT}</div></div></div>
        <div class="pc-lc"><div style="padding-bottom:3px"><div style="margin-bottom:9px;padding-bottom:4px">${TEXT}</div><div>x</div></div></div>
        <div class="pc-lc"><div style="margin-bottom:6px"><div style="margin-bottom:9px;padding-bottom:4px">${TEXT}</div><div>x</div></div></div>
        <div class="pc-lc">one<div style="padding:5px;border:2px solid;margin-bottom:9px">${TEXT}</div></div>
        <div class="pc-lc" style="padding:4px 0 6px;border-bottom:3px solid"><div style="padding:5px">${TEXT}</div></div><div>after</div>`,
    'blocks past the clamped line end at their own padding and border': `<div class="pc-lc"><div style="padding:5px">one two</div><div style="padding:4px;border-bottom:2px solid"><div style="padding:6px;border-bottom:1px solid">${TEXT}</div></div></div>
        <div class="pc-lc"><div style="padding:5px">${TEXT}</div><div style="padding:4px;border-bottom:2px solid"><div style="padding:6px;border-bottom:1px solid">${TEXT}</div></div></div>
        <div class="pc-lc"><div style="padding:5px">${TEXT}</div><div style="padding-bottom:4px"><div style="margin-bottom:9px;padding-bottom:3px">${TEXT}</div></div></div>
        <div class="pc-lc"><div style="padding:5px">${TEXT}</div><div style="padding-bottom:4px"><div style="margin-bottom:9px">x</div></div></div><div>after</div>`,
    'nothing in flow after the clamped line cuts nothing': `<div class="pc-lc"><div style="padding:5px;border:2px solid;margin-bottom:9px">one two three four five six</div></div>
        <div class="pc-lc"><div style="padding:5px;margin-bottom:9px">one two three four five six</div><div style="position:absolute;width:5px;height:5px"></div></div>
        <div class="pc-lc"><div style="padding-bottom:3px"><div style="padding:5px;margin-bottom:9px">one two three four five six</div></div></div>
        <div class="pc-lc"><div style="padding:5px;margin-bottom:9px">one two three four five six</div><div style="height:10px"></div></div>
        <div class="pc-lc"><div style="padding-bottom:3px"><div style="padding:5px;margin-bottom:9px">one two three four five six</div></div><div></div></div>
        <div class="pc-lc"><div><div style="padding:5px;margin-bottom:9px">one two three four five six</div></div>x</div>
        <div class="pc-lc" style="padding-bottom:3px">one two three four five six seven eight</div><div>after</div>`
};
for (const width of WIDTHS) for (const [name, html] of Object.entries(CLAMP_BLOCKS)) {
    await test(`${width}px line clamp/${name}`, async () => {
        stage.style.width = `${width}px`;
        const element = document.createElement('div');
        element.innerHTML = html;
        stage.replaceChildren(element);
        await new Promise((r) => requestAnimationFrame(r));
        const mismatches = compareFlat(element, stage, EXACT_TOLERANCE).mismatches;
        report[`${width}px line clamp/${name}`] = mismatches;
        assert(mismatches.length === 0, `${mismatches.length} boxes differ; first: ${JSON.stringify(mismatches.slice(0, 3))}`);
    });
}
// -webkit-line-clamp (Chrome 155, measured): an in-flow formatting context
// root or replaced block past the clamped line makes the clamp cut too, and
// the content ends at the border-box bottom of the block that holds the
// line, whose own height, min-height and max-height apply
const CLAMP_SIZED = {
    'a formatting context root past the clamped line makes it cut': ['display:flow-root', 'overflow:hidden', 'display:flex', 'display:grid']
        .map((css) => `<div class="pc-lc"><div style="padding:5px;margin-bottom:9px">one two three four five six</div><div style="${css}">x</div></div>`).join('')
        + `<div class="pc-lc"><div style="padding:5px;margin-bottom:9px">one two three four five six</div><hr></div>
        <div class="pc-lc"><div style="padding:5px;margin-bottom:9px">one two three four five six</div><canvas width="10" height="10" style="display:block"></canvas></div>
        <div class="pc-lc"><div style="padding:5px;margin-bottom:9px">one two three four five six</div><table><tr><td>x</td></tr></table></div>
        <div class="pc-lc"><div style="padding:5px;margin-bottom:9px">one two three four five six</div><div style="display:flow-root"></div></div>
        <div class="pc-lc"><div style="padding-bottom:3px"><div style="padding:5px;margin-bottom:9px">one two three four five six</div><div style="display:flow-root">x</div></div></div>
        <div class="pc-lc"><div>one two three four five six</div><div style="display:flex">footer</div></div>
        <div class="pc-lc"><div style="padding:5px;margin-bottom:9px">one two three four five six</div><div style="position:fixed;width:5px;height:5px"></div></div><div>after</div>`,
    'the block holding the clamped line keeps its own height': `<div class="pc-lc"><div style="height:80px;padding:5px">${TEXT}</div><div>x</div></div>
        <div class="pc-lc"><div style="height:20px;padding:5px">${TEXT}</div><div>x</div></div>
        <div class="pc-lc"><div style="min-height:60px;padding:5px">${TEXT}</div><div>x</div></div>
        <div class="pc-lc"><div style="max-height:20px;padding:5px">${TEXT}</div><div>x</div></div>
        <div class="pc-lc"><div style="box-sizing:border-box;height:50px;padding:5px;border:2px solid">${TEXT}</div><div>x</div></div>
        <div class="pc-lc"><div style="height:70px;padding:3px"><div style="padding:5px;margin-bottom:9px">${TEXT}</div></div><div>x</div></div>
        <div class="pc-lc"><div style="padding:3px"><div style="height:60px;margin-bottom:9px">${TEXT}</div></div></div>
        <div class="pc-lc"><div style="height:80px;padding:5px;margin-bottom:4px">one two three four five six</div></div>
        <div class="pc-lc"><div style="padding:5px">${TEXT}</div><div style="height:40px;padding:4px">${TEXT}</div></div><div>after</div>`
};
for (const width of WIDTHS) for (const [name, html] of Object.entries(CLAMP_SIZED)) {
    await test(`${width}px line clamp/${name}`, async () => {
        stage.style.width = `${width}px`;
        const element = document.createElement('div');
        element.innerHTML = html;
        stage.replaceChildren(element);
        await new Promise((r) => requestAnimationFrame(r));
        const mismatches = compareFlat(element, stage, EXACT_TOLERANCE).mismatches;
        report[`${width}px line clamp/${name}`] = mismatches;
        assert(mismatches.length === 0, `${mismatches.length} boxes differ; first: ${JSON.stringify(mismatches.slice(0, 3))}`);
    });
}
// The ellipsis and the cut are decided where the line would sit unaligned;
// text-align shifts the line as it would without them, so a right-aligned
// line that is not cut keeps all its text and puts the ellipsis past the edge
await test('line clamp/aligned lines are cut where they would sit unaligned', async () => {
    stage.style.width = '640px';
    const element = document.createElement('div');
    element.innerHTML = ['left', 'right', 'center'].map((align) => `<div class="pc-lc" style="text-align:${align}">${TEXT}</div>`
        + `<div class="pc-lc" style="text-align:${align};width:118px">${TEXT}</div>`).join('');
    stage.replaceChildren(element);
    await new Promise((r) => requestAnimationFrame(r));
    const { result } = compareFlat(element, stage, EXACT_TOLERANCE);
    const kept = (el) => {
        const box = result.boxes.get(el);
        const runs = box.runs.filter((run) => run.line === 1).sort((a, b) => a.x - b.x);
        return { box, text: runs.filter((run) => !run.ellipsis).map((run) => run.text).join('').trim(), runs, ellipsis: runs.find((run) => run.ellipsis) };
    };
    // The DOM's second line (its text as laid out, before any cut)
    const domLine = (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const rect = [...range.getClientRects()][1];
        const left = el.getBoundingClientRect().left;
        return { left: rect.left - left, right: rect.right - left };
    };
    const [leftFits, leftCut, rightFits, rightCut, centreFits, centreCut] = element.children;
    const plain = kept(leftFits).text;
    const cut = kept(leftCut).text;
    assert(cut && cut !== plain, `the narrow left-aligned line is not cut: ${JSON.stringify(cut)}`);
    for (const [el, label] of [[rightFits, 'right'], [centreFits, 'centre']]) {
        const line = kept(el);
        const dom = domLine(el);
        assert(line.text === plain, `${label}: kept line ${JSON.stringify(line.text)}, not ${JSON.stringify(plain)}`);
        assert(line.ellipsis && Math.abs(line.ellipsis.x - line.box.contentX - dom.right) < 0.05, `${label}: ellipsis at ${line.ellipsis?.x}, the line's text ends at ${dom.right}`);
    }
    for (const [el, label] of [[rightCut, 'right'], [centreCut, 'centre']]) {
        const line = kept(el);
        const dom = domLine(el);
        assert(line.text === cut, `${label}: cut line ${JSON.stringify(line.text)}, not ${JSON.stringify(cut)}`);
        assert(Math.abs(line.runs[0].x - line.box.contentX - dom.left) < 0.05, `${label}: cut line starts at ${line.runs[0].x}, the line's text at ${dom.left}`);
    }
});

// Containing blocks made by inline boxes (Chrome 155, measured): position
// relative or sticky, filter, backdrop-filter, will-change naming filter or
// backdrop-filter (absolute and fixed boxes) and will-change: position
// (absolute only) make a span one; transforms, perspective, preserve-3d,
// contain and content-visibility do not apply to a non-atomic inline. The
// block runs from the first fragment's padding box top left to the last
// fragment's padding box bottom right, never narrower than nothing
const INLINE_KIDS = '<i style="position:absolute;left:3px;top:4px;width:5px;height:5px"></i><i style="position:fixed;left:6px;top:2px;width:4px;height:3px"></i>'
    + '<i style="position:absolute;right:2px;bottom:1px;width:3px;height:3px"></i><i style="position:absolute;left:0;top:0;width:100%;height:100%"></i>'
    + '<i style="position:absolute;width:4px;height:4px"></i><i style="position:absolute;left:10%;top:20%;right:5px;bottom:2px"></i><i style="position:absolute;left:0;top:0">auto size text</i>';
const INLINE_EDGES = 'padding:2px 4px;border:solid;border-width:3px 5px 7px 9px';
const INLINE_CB = {
    'what makes an inline box a containing block': `<div style="contain:layout;padding:20px 30px;font:13px Arial">${['position:relative', 'position:sticky', 'filter:blur(0)', 'filter:opacity(1)',
        'backdrop-filter:blur(1px)', 'will-change:filter', 'will-change:backdrop-filter', 'will-change:opacity, filter', 'will-change:position', 'transform:translateX(0)', 'translate:1px',
        'rotate:0deg', 'scale:1', 'perspective:100px', 'transform-style:preserve-3d', 'contain:paint', 'contain:layout', 'contain:strict', 'contain:content', 'content-visibility:auto',
        'will-change:transform', 'will-change:translate', 'will-change:perspective', 'will-change:contain', 'opacity:0.5', 'isolation:isolate']
        .map((css) => `<p style="margin:0 0 4px">text before <span style="${css};${INLINE_EDGES}">inline ${INLINE_KIDS} after</span> tail</p>`).join('')}</div>`,
    'an inline containing block over one or more lines': `<div style="contain:layout;padding:20px 30px;font:13px Arial">
        <div style="line-height:30px;width:400px">text before <span style="position:relative;${INLINE_EDGES}">inline ${INLINE_KIDS} after</span> tail</div>
        <div style="line-height:30px;width:200px">text before more words <span style="position:relative;${INLINE_EDGES}">inline words that wrap ${INLINE_KIDS} to the next line</span> tail</div>
        <div style="width:120px">text <span style="position:relative;${INLINE_EDGES}">aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk ${INLINE_KIDS} lll mmm</span> tail</div>
        <div style="width:400px">text <span style="position:relative;${INLINE_EDGES};font-size:30px">Big ${INLINE_KIDS}</span> tail</div>
        <div style="width:400px">text <span style="position:relative;${INLINE_EDGES};left:7px;top:5px">offset ${INLINE_KIDS} x</span> tail</div>
        <div style="width:400px">text <span style="position:relative;${INLINE_EDGES}">${INLINE_KIDS}</span> empty</div></div>`,
    'inline containing blocks in nested boxes': `<div style="contain:layout;padding:20px 30px;font:13px Arial">
        <div style="width:400px">text <b style="padding:0 6px">bold <span style="position:relative;${INLINE_EDGES}">in <em>deep ${INLINE_KIDS}</em> x</span> y</b> tail</div>
        <div style="width:400px;display:flex"><div style="padding:3px">text <span style="position:relative;${INLINE_EDGES}">in ${INLINE_KIDS} x</span> tail</div></div>
        <div style="width:400px">text <span style="position:relative;${INLINE_EDGES}">in <span style="display:inline-block;padding:4px">ib ${INLINE_KIDS}</span> x</span> tail</div>
        <div style="width:200px">text before more words here <span style="position:relative;${INLINE_EDGES}">xx <i style="position:absolute;left:0;top:0;width:100%;height:100%"></i>`
        + `<i style="position:absolute;right:2px;bottom:1px;width:3px;height:3px"></i>yyyyyyyyyyyyyyyyyy</span> tail</div></div>`
};
for (const width of WIDTHS) for (const [name, html] of Object.entries(INLINE_CB)) {
    await test(`${width}px containing blocks/${name}`, async () => {
        stage.style.width = `${width}px`;
        const element = document.createElement('div');
        element.innerHTML = html;
        stage.replaceChildren(element);
        await new Promise((r) => requestAnimationFrame(r));
        const mismatches = compareFlat(element, stage, EXACT_TOLERANCE).mismatches;
        report[`${width}px containing blocks/${name}`] = mismatches;
        assert(mismatches.length === 0, `${mismatches.length} boxes differ; first: ${JSON.stringify(mismatches.slice(0, 3))}`);
    });
}

// Text of a display: contents element or a slot has that element's style: its
// font and line height size the line as an inline box's would
const STYLED_TEXT = {
    'a slot styled by its shadow tree': `<div style="font:13px Arial"><template shadowrootmode="open"><style>slot { font-size: 30px; line-height: 40px }</style><div><slot></slot></div></template>hello text</div>
        <div style="font:13px Arial"><template shadowrootmode="open"><style>slot { color: red }</style><p style="margin:0"><slot></slot></p></template>plain text</div>
        <div style="font:13px Arial"><template shadowrootmode="open"><style>slot { font-size: 24px; text-transform: uppercase }</style><div><slot name="x">fallback words</slot></div></template></div>
        <div style="font:13px Arial"><template shadowrootmode="open"><style>slot { display: block; font-size: 30px; line-height: 40px }</style><slot></slot></template>block slot</div><div>after</div>`,
    'display contents text': `<div style="font:13px Arial"><span style="display:contents;font-size:30px;line-height:40px">hello text</span></div>
        <div style="font:20px Arial">a <span style="display:contents;font-size:8px">small text here</span> b</div>
        <div style="font:13px Arial;width:120px">before <span style="display:contents;font-size:22px;letter-spacing:1px">wrapping words over several lines</span> after</div>
        <div style="font:13px Arial">x <span style="font-size:20px;vertical-align:super">y <i style="display:contents;font-size:9px;line-height:30px">z w</i> v</span> t</div>
        <div style="font:13px Arial">x <b style="display:contents;font:bold 26px Georgia">Gg Hh</b> t</div>
        <div style="font:13px Arial"><span style="display:contents;font-size:24px">a <span style="display:contents;font-size:12px;line-height:50px">b c</span> d</span></div><div>after</div>`
};
for (const width of WIDTHS) for (const [name, html] of Object.entries(STYLED_TEXT)) {
    await test(`${width}px shadow/${name}`, async () => {
        stage.style.width = `${width}px`;
        const element = document.createElement('div');
        element.setHTMLUnsafe(html);
        stage.replaceChildren(element);
        await new Promise((r) => requestAnimationFrame(r));
        const mismatches = compareFlat(element, stage, EXACT_TOLERANCE).mismatches;
        report[`${width}px shadow/${name}`] = mismatches;
        assert(mismatches.length === 0, `${mismatches.length} boxes differ; first: ${JSON.stringify(mismatches.slice(0, 3))}`);
    });
}
window.__parityReport = report;

const passed = tests.filter((result) => result.passed).length;
const results = document.getElementById('results');
results.dataset.status = passed === tests.length ? 'pass' : 'fail';
document.documentElement.dataset.testStatus = passed === tests.length ? 'passed' : 'failed';
results.textContent = `${passed}/${tests.length} passed\n${tests.map((result) => (
    result.passed ? `PASS ${result.name}` : `FAIL ${result.name}\n  ${result.error}`
)).join('\n')}`;
