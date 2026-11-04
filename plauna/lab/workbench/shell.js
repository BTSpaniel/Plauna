// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Workbench lab shell: page frame, toolbar, design cards and the Pretext panel.
 * Split out of lab/workbench-lab.js.
 */

import { DESIGN_PRESETS } from './support.js';

export function createShell(root, statusElement) {
    root.classList.add('plauna-lab-page');
    document.documentElement.classList.add('plauna-lab-page');
    document.body.classList.add('plauna-lab-page');

    const shell = document.createElement('div');
    shell.className = 'plauna-lab';
    shell.innerHTML = `
        <div class="plauna-lab__backdrop">
            <canvas class="plauna-lab__canvas" data-plauna-lab-canvas></canvas>
        </div>
        <div class="plauna-lab__surface">
            <div class="plauna-lab__app" id="plauna-root"></div>
        </div>
    `;

    const consoleDrawer = document.createElement('aside');
    consoleDrawer.className = 'plauna-lab-console';
    consoleDrawer.dataset.consolePeek = '0';
    consoleDrawer.setAttribute('aria-label', 'Plauna test console');

    if (statusElement.parentNode === root) {
        root.removeChild(statusElement);
    }
    consoleDrawer.appendChild(statusElement);
    root.replaceChildren(shell, consoleDrawer);

    return {
        plaunaRoot: shell.querySelector('#plauna-root'),
        canvas: shell.querySelector('[data-plauna-lab-canvas]'),
        consoleDrawer
    };
}

export function renderMarkup(rootElement) {
    rootElement.innerHTML = `
        <div class="plauna-shell plauna-shell--lab">
            <header class="plauna-shell__header">
                <div class="plauna-shell__copy">
                    <div class="plauna-shell__badge">PLAUNA UI SYSTEM</div>
                    <h1 data-measure-text>Layout · Pretext · Motion · Theming · Widgets</h1>
                    <p data-measure-text>
                        Plauna is a retained-mode UI engine. It owns layout zones, design tokens,
                        canvas-based text measurement via Pretext, property transitions, toast
                        notifications, and the full widget library — so your pages stay thin.
                    </p>
                </div>
                <div class="plauna-shell__badge" id="design-badge">Active: Workbench</div>
            </header>
            <section class="plauna-shell__toolbar" id="plauna-toolbar"></section>
            <section class="plauna-shell__metrics" id="overview"></section>
            <main class="plauna-shell__main">
                <section class="plauna-stage" id="layout-stage" aria-label="Animated particle layout stage">
                    <div class="plauna-stage__ui" id="layout-stage-ui"></div>
                    <div class="plauna-stage__particles" id="particle-layer"></div>
                    <div class="plauna-stage__caption" id="stage-caption">Particle assembly idle</div>
                </section>
                <aside class="plauna-design-grid" id="design-grid"></aside>
            </main>
            <section class="plauna-pretext-panel" id="pretext-panel"></section>
            <section class="plauna-widget-gallery" id="widget-gallery"></section>
            <footer class="plauna-shell__footer">
                <span id="footer-status">Runtime not initialized.</span>
                <span class="plauna-chip" id="footer-chip">No surface</span>
            </footer>
        </div>
    `;
}

export function renderToolbar(rootElement) {
    const toolbar = rootElement.querySelector('#plauna-toolbar');
    toolbar.innerHTML = `
        <span class="plauna-toolbar__divider"></span>
        <button type="button" data-design="editor">Workbench</button>
        <button type="button" data-design="command">Command Deck</button>
        <button type="button" data-design="cards">Card Matrix</button>
        <button type="button" data-action="auto-cycle" id="auto-cycle-btn">▶ Auto</button>
        <span class="plauna-toolbar__divider"></span>
        <button type="button" data-theme="light" class="plauna-theme-btn">☀ Light</button>
        <button type="button" data-theme="dark" class="plauna-theme-btn">◑ Dark</button>
        <button type="button" data-theme="high-contrast" class="plauna-theme-btn">● Hi-Con</button>
    `;
}

export function renderDesignCards(rootElement) {
    const grid = rootElement.querySelector('#design-grid');
    grid.innerHTML = DESIGN_PRESETS.map((preset) => `
        <article class="plauna-design-card" data-theme="${preset.id}">
            <div class="plauna-chip">${preset.metric}</div>
            <div class="plauna-design-card__copy">
                <h2 data-measure-text>${preset.title}</h2>
                <p data-measure-text>${preset.summary}</p>
            </div>
            <div class="plauna-design-card__layout">
                <span class="plauna-chip">${preset.outlineHint}</span>
            </div>
            <div class="plauna-design-card__actions">
                <span>${preset.detail}</span>
                <button type="button" data-design="${preset.id}">Apply</button>
            </div>
        </article>
    `).join('');
}

export function renderPretextPanel(rootElement) {
    const panel = rootElement.querySelector('#pretext-panel');
    if (!panel) return;
    panel.innerHTML = `
        <div class="plauna-pretext-demo">
            <header class="plauna-pretext-demo__header">
                <span class="plauna-shell__badge">PRETEXT — Canvas Text Measurement</span>
                <span class="plauna-chip" id="pretext-cache-chip">Cache: 0 hits</span>
            </header>
            <div class="plauna-pretext-demo__body">
                <div class="plauna-pretext-demo__controls">
                    <label class="plauna-pretext-label">
                        Text
                        <textarea id="pretext-input" class="plauna-pretext-textarea" rows="3" spellcheck="false">Plauna measures this text on a canvas without touching the DOM — no layout thrash.</textarea>
                    </label>
                    <div class="plauna-pretext-row">
                        <label class="plauna-pretext-label">
                            Font size
                            <select id="pretext-size" class="plauna-pretext-select">
                                <option value="12">12px</option>
                                <option value="14" selected>14px</option>
                                <option value="16">16px</option>
                                <option value="18">18px</option>
                                <option value="24">24px</option>
                            </select>
                        </label>
                        <label class="plauna-pretext-label">
                            Font weight
                            <select id="pretext-weight" class="plauna-pretext-select">
                                <option value="400" selected>400 Regular</option>
                                <option value="600">600 Semibold</option>
                                <option value="700">700 Bold</option>
                            </select>
                        </label>
                        <label class="plauna-pretext-label">
                            Container width
                            <select id="pretext-width" class="plauna-pretext-select">
                                <option value="160">160px</option>
                                <option value="240">240px</option>
                                <option value="320" selected>320px</option>
                                <option value="480">480px</option>
                                <option value="640">640px</option>
                            </select>
                        </label>
                    </div>
                </div>
                <div class="plauna-pretext-demo__output">
                    <div class="plauna-pretext-metrics" id="pretext-metrics">
                        <div class="plauna-pretext-metric"><span class="plauna-pretext-metric__label">Width</span><span class="plauna-pretext-metric__value" id="pm-width">—</span></div>
                        <div class="plauna-pretext-metric"><span class="plauna-pretext-metric__label">Lines</span><span class="plauna-pretext-metric__value" id="pm-lines">—</span></div>
                        <div class="plauna-pretext-metric"><span class="plauna-pretext-metric__label">Height</span><span class="plauna-pretext-metric__value" id="pm-height">—</span></div>
                        <div class="plauna-pretext-metric"><span class="plauna-pretext-metric__label">Ascent</span><span class="plauna-pretext-metric__value" id="pm-ascent">—</span></div>
                        <div class="plauna-pretext-metric"><span class="plauna-pretext-metric__label">Descent</span><span class="plauna-pretext-metric__value" id="pm-descent">—</span></div>
                        <div class="plauna-pretext-metric"><span class="plauna-pretext-metric__label">Baseline</span><span class="plauna-pretext-metric__value" id="pm-baseline">—</span></div>
                    </div>
                    <div class="plauna-pretext-ruler" id="pretext-ruler">
                        <div class="plauna-pretext-ruler__track" id="pretext-ruler-track">
                            <div class="plauna-pretext-ruler__text" id="pretext-ruler-text"></div>
                        </div>
                        <div class="plauna-pretext-ruler__label" id="pretext-ruler-label">320px</div>
                    </div>
                    <div class="plauna-pretext-preview-stage" id="pretext-preview-stage">
                        <div class="plauna-pretext-preview-lines" id="pretext-preview-lines"></div>
                        <div class="plauna-pretext-preview-particles" id="pretext-preview-particles"></div>
                    </div>
                </div>
            </div>
        </div>
    `;
}
