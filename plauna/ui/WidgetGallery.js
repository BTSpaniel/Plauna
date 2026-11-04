// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * WidgetGallery - the Plauna widget showcase (plauna.html).
 *
 * Layout: a top bar (search, render mode, theme), a sidebar listing every
 * widget by category, and the page content. The content renders through a
 * RenderSurface, so DOM, GPU and auto modes show the whole showcase.
 *
 * Pages (hash routes):
 * - #/                        overview: every category, a live card per widget
 * - #/widget/<id>[/<story>]   one widget: its playground (story picker,
 *                             preview, controls, actions log, code) and
 *                             every story below it
 *
 * Stories come from each widget's static stories(). The playground's
 * controls are the widget's hand-written schema (gallery/schemas.js) plus
 * fields inferred from its stories' options (gallery/controls.js).
 */

import { PageTransition } from '../motion/PageTransition.js';
import { RenderSurface } from '../render/RenderSurface.js';
import { RENDER_MODES, normalizeRenderMode } from '../render/RenderModes.js';
import { searchWidgets } from '../widgets/index.js';
import { PLAUNA_VERSION } from '../../engine/version.js';
import { fieldsFor, readField, createControl } from './gallery/controls.js';
import { widgetSnippet } from './gallery/snippet.js';
import { installGalleryStyles } from './gallery/styles.js';

const RENDER_MODE_KEY = 'plauna.gallery.renderMode';
const MODE_LABELS = { dom: 'DOM', gpu: 'GPU', auto: 'Auto' };
const MAX_ACTIONS = 40;

function readRenderMode() {
    try {
        return localStorage.getItem(RENDER_MODE_KEY);
    } catch {
        return null;
    }
}

function writeRenderMode(mode) {
    try {
        localStorage.setItem(RENDER_MODE_KEY, mode);
    } catch {
        // Storage may be unavailable; the choice then lasts for this page
    }
}

let _galleryIdSequence = 0;

function _newGalleryId(prefix) {
    return `${prefix}-${Date.now()}-${++_galleryIdSequence}`;
}

function slug(text) {
    return String(text).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Story options may hold callbacks; plain objects and arrays are copied
function cloneValue(value) {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        const out = {};
        for (const [key, item] of Object.entries(value)) out[key] = cloneValue(item);
        return out;
    }
    return value;
}

function el(tag, className = null, text = undefined) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function isEditable(target) {
    return Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
}

function clockTime(date) {
    const pad = (value, size = 2) => String(value).padStart(size, '0');
    return `${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export class WidgetGallery {
    constructor(shell, options = {}) {
        this.shell = shell;
        // Previews render through a surface: DOM, GPU or auto
        this.renderMode = normalizeRenderMode(options.renderMode ?? readRenderMode(), 'dom');
        this.surface = null;
        // { page: 'overview' } or { page: 'widget', id, story }
        this.route = null;
        this._root = null;
        this._contentEl = null;
        this._navLinks = new Map();
        this._navSections = [];
        // One cleanup per widget instance on the current page
        this._disposers = [];
        this._playground = null;
        this._transition = null;
        this._listeners = [];
        this._statsTimer = null;
    }

    /** Build the showcase into `root` and show the page the URL names. */
    mount(root) {
        installGalleryStyles(root.ownerDocument || document);
        root.replaceChildren();

        const app = el('div');
        app.id = 'plauna-gallery';
        this._root = app;
        app.append(this._buildTopbar(), this._buildSidebar(), this._buildStats());

        this._contentEl = el('main');
        this._contentEl.id = 'plauna-gallery-content';
        this.surface = new RenderSurface({
            mode: this.renderMode,
            onModeChange: () => this._updateModeStatus()
        });
        this.surface.element.id = 'plauna-gallery-surface';
        this.surface.mount(this._contentEl);
        app.appendChild(this.surface.element);
        root.appendChild(app);
        this.surface.ready.then(() => this._updateModeStatus());

        this._transition = new PageTransition({ target: this._contentEl, type: 'cross-fade', duration: 180, reducedMotion: true });
        this._on(window, 'hashchange', () => this._route());
        this._on(document, 'keydown', (event) => this._onKey(event));
        this._statsTimer = setInterval(() => this._updateModeStatus(), 1000);
        this._route(true);
    }

    /** Show a widget's page (and a story in its playground). */
    open(widgetId, storyName = null) {
        location.hash = `#/widget/${widgetId}${storyName ? `/${slug(storyName)}` : ''}`;
    }

    /** Show the overview page. */
    showOverview() {
        location.hash = '#/';
    }

    // ── Top bar ───────────────────────────────────────────────────

    _buildTopbar() {
        const bar = el('header', 'pg-topbar');

        const menu = el('button', 'pg-menu-button', '☰');
        menu.type = 'button';
        menu.setAttribute('aria-label', 'Show the widget list');
        menu.setAttribute('aria-controls', 'plauna-gallery-nav');
        menu.setAttribute('aria-expanded', 'false');
        menu.addEventListener('click', () => this._toggleNav());
        this._menuButton = menu;

        const brand = el('a', 'pg-brand');
        brand.href = '#/';
        brand.append(
            el('span', 'pg-brand-mark', 'P'),
            el('span', 'pg-brand-name', 'Plauna'),
            el('span', 'pg-brand-sub', `Widget showcase · v${PLAUNA_VERSION}`)
        );

        const search = el('label', 'pg-search');
        const icon = el('span', 'pg-search-icon', '⌕');
        icon.setAttribute('aria-hidden', 'true');
        const input = el('input');
        input.type = 'search';
        input.id = 'plauna-gallery-search';
        input.placeholder = `Search ${this.shell.getAllWidgets().length} widgets`;
        input.autocomplete = 'off';
        input.setAttribute('aria-label', 'Search widgets');
        input.addEventListener('input', () => this._filterNav(input.value));
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                const first = [...this._navLinks.values()].find(({ item }) => !item.hidden);
                if (first) {
                    event.preventDefault();
                    this.open(first.link.dataset.widget);
                }
            } else if (event.key === 'Escape') {
                input.value = '';
                this._filterNav('');
                input.blur();
            }
        });
        const kbd = el('kbd', null, '/');
        kbd.setAttribute('aria-hidden', 'true');
        search.append(icon, input, kbd);
        this._searchInput = input;

        const tools = el('div', 'pg-tools');
        const modeGroup = el('div', 'pg-segmented');
        modeGroup.id = 'plauna-render-mode';
        modeGroup.setAttribute('role', 'group');
        modeGroup.setAttribute('aria-label', 'Render mode');
        this._modeButtons = new Map();
        for (const mode of RENDER_MODES) {
            const button = el('button', null, MODE_LABELS[mode] || mode);
            button.type = 'button';
            button.dataset.mode = mode;
            button.addEventListener('click', () => this.setRenderMode(mode));
            this._modeButtons.set(mode, button);
            modeGroup.appendChild(button);
        }
        this._updateModeButtons();
        // A fixed-width label, so switching modes never changes the top bar's layout
        this._modeStatus = el('span', 'pg-mode-status');
        this._modeStatus.id = 'plauna-render-active';

        const themeSelect = el('select', 'pg-select');
        themeSelect.id = 'plauna-theme-select';
        themeSelect.setAttribute('aria-label', 'Theme');
        const loading = el('option', null, 'Loading themes…');
        loading.disabled = true;
        themeSelect.appendChild(loading);
        this.shell.getAvailableThemes().then((themes) => {
            themeSelect.replaceChildren();
            const current = this.shell.getTheme();
            for (const theme of themes) {
                const option = el('option', null, theme.name);
                option.value = theme.id;
                option.selected = theme.id === current;
                themeSelect.appendChild(option);
            }
        }).catch(() => {
            loading.textContent = 'Themes unavailable';
            themeSelect.replaceChildren(loading);
        });
        themeSelect.addEventListener('change', async () => {
            themeSelect.disabled = true;
            try {
                await this.shell.setTheme(themeSelect.value);
            } finally {
                // Show the theme actually applied (a failed load falls back to dark)
                themeSelect.value = this.shell.getTheme();
                themeSelect.disabled = false;
            }
        });
        this._themeSelect = themeSelect;

        tools.append(
            el('span', 'pg-tool-label', 'Render'), modeGroup, this._modeStatus,
            el('span', 'pg-tool-label', 'Theme'), themeSelect
        );
        bar.append(menu, brand, search, tools);
        return bar;
    }

    /** GPU timings, floating over the page so they never move anything. */
    _buildStats() {
        const stats = el('div', 'pg-render-stats');
        stats.id = 'plauna-render-stats';
        stats.setAttribute('aria-hidden', 'true');
        stats.hidden = true;
        this._statsEl = stats;
        return stats;
    }

    /** Switch the showcase's render mode; resolves to the mode in use. */
    async setRenderMode(mode) {
        this.renderMode = normalizeRenderMode(mode, this.renderMode);
        writeRenderMode(this.renderMode);
        this._updateModeButtons();
        const active = this.surface ? await this.surface.setMode(this.renderMode) : 'dom';
        this._updateModeStatus();
        return active;
    }

    _updateModeButtons() {
        for (const [mode, button] of this._modeButtons || []) {
            button.setAttribute('aria-pressed', String(mode === this.renderMode));
        }
    }

    _updateModeStatus() {
        if (!this._modeStatus || !this.surface) return;
        const active = this.surface.activeMode;
        const requested = this.surface.mode;
        let text = active === 'gpu' ? 'GPU' : 'DOM';
        if (requested === 'auto') text = `auto → ${text}`;
        else if (requested !== active) text = 'DOM (no GPU)';
        if (this._modeStatus.textContent !== text) this._modeStatus.textContent = text;
        this._modeStatus.title = requested !== active && requested !== 'auto' ? 'WebGPU is unavailable here, so the page renders through the DOM' : `Rendering through ${active.toUpperCase()}`;
        this._modeStatus.dataset.active = active;
        if (this._statsEl) {
            this._statsEl.hidden = active !== 'gpu';
            if (active === 'gpu') {
                const stats = this.surface.stats;
                const line = `layout ${stats.lastLayoutMs.toFixed(1)} ms · paint ${stats.lastPaintMs.toFixed(1)} ms · ${stats.items} items`;
                if (this._statsEl.textContent !== line) this._statsEl.textContent = line;
            }
        }
    }

    // ── Sidebar ───────────────────────────────────────────────────

    _buildSidebar() {
        const nav = el('nav', 'pg-sidebar');
        nav.id = 'plauna-gallery-nav';
        this._nav = nav;
        nav.setAttribute('aria-label', 'Widgets');

        const overview = el('a', 'pg-nav-link');
        overview.href = '#/';
        overview.dataset.route = 'overview';
        overview.append(el('span', 'pg-nav-icon', '◆'), el('span', null, 'Overview'));
        this._overviewLink = overview;
        nav.appendChild(overview);

        for (const category of this.shell.getAllCategories()) {
            const section = el('section', 'pg-nav-section');
            section.dataset.category = category.id;
            const heading = el('div', 'pg-nav-heading');
            heading.append(el('span', null, category.name), el('span', null, String(category.items.length)));
            const list = el('ul', 'pg-nav-list');
            for (const WidgetClass of category.items) {
                const item = el('li');
                const link = el('a', 'pg-nav-link');
                link.href = `#/widget/${WidgetClass.id}`;
                link.dataset.widget = WidgetClass.id;
                link.append(
                    el('span', 'pg-nav-icon', WidgetClass.icon || '•'),
                    el('span', null, WidgetClass.name),
                    el('span', 'pg-nav-count', String(Object.keys(this._stories(WidgetClass)).length))
                );
                item.appendChild(link);
                list.appendChild(item);
                this._navLinks.set(WidgetClass.id, { link, item, section });
            }
            section.append(heading, list);
            nav.appendChild(section);
            this._navSections.push(section);
        }

        this._navEmpty = el('p', 'pg-nav-empty', 'No widgets match.');
        this._navEmpty.hidden = true;
        nav.appendChild(this._navEmpty);
        // On a phone the list is a drawer: picking a page closes it
        nav.addEventListener('click', (event) => {
            if (event.target.closest('a')) this._toggleNav(false);
        });
        return nav;
    }

    /** Show only the widgets matching `query`; returns how many are shown. */
    _filterNav(query) {
        const text = String(query || '').trim();
        const matches = text ? new Set(searchWidgets(text).map((WidgetClass) => WidgetClass.id)) : null;
        let shown = 0;
        for (const [id, { item }] of this._navLinks) {
            item.hidden = Boolean(matches) && !matches.has(id);
            if (!item.hidden) shown++;
        }
        for (const section of this._navSections) {
            section.hidden = ![...section.querySelectorAll('li')].some((item) => !item.hidden);
        }
        this._navEmpty.hidden = shown > 0;
        return shown;
    }

    _markNav(route) {
        if (route.page === 'overview') this._overviewLink.setAttribute('aria-current', 'page');
        else this._overviewLink.removeAttribute('aria-current');
        for (const [id, { link }] of this._navLinks) {
            if (route.page === 'widget' && route.id === id) {
                link.setAttribute('aria-current', 'page');
                this._revealInNav(link);
            } else {
                link.removeAttribute('aria-current');
            }
        }
    }

    /** Scroll the sidebar (only) so `link` is in view. */
    _revealInNav(link) {
        const nav = this._nav;
        const top = link.offsetTop;
        const bottom = top + link.offsetHeight;
        if (top < nav.scrollTop) nav.scrollTop = top - 8;
        else if (bottom > nav.scrollTop + nav.clientHeight) nav.scrollTop = bottom - nav.clientHeight + 8;
    }

    /** The element the page scrolls in: the nearest scrolling ancestor, else the document. */
    _scroller() {
        for (let node = this._root?.parentElement; node && node !== document.body; node = node.parentElement) {
            const overflow = getComputedStyle(node).overflowY;
            if (overflow === 'auto' || overflow === 'scroll') return node;
        }
        return document.scrollingElement || document.documentElement;
    }

    _toggleNav(open = !this._root.hasAttribute('data-nav-open')) {
        this._root.toggleAttribute('data-nav-open', open);
        this._menuButton.setAttribute('aria-expanded', String(open));
    }

    _onKey(event) {
        if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !isEditable(event.target)) {
            event.preventDefault();
            this._searchInput?.focus();
        } else if (event.key === 'Escape' && this._root?.hasAttribute('data-nav-open')) {
            this._toggleNav(false);
        }
    }

    // ── Routing ───────────────────────────────────────────────────

    _parseRoute() {
        const parts = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
        if (parts[0] === 'widget' && parts[1] && this.shell.getWidget(parts[1])) {
            return { page: 'widget', id: parts[1], story: parts[2] || null };
        }
        return { page: 'overview' };
    }

    _route(initial = false) {
        const next = this._parseRoute();
        const current = this.route;
        // Same widget: only the story in the playground changes
        if (current?.page === 'widget' && next.page === 'widget' && current.id === next.id && this._playground) {
            const story = Object.keys(this._playground.stories).find((name) => slug(name) === next.story);
            if (story && story !== this._playground.storyName) this._selectStory(story, false);
            this.route = next;
            return;
        }
        this.route = next;
        this._markNav(next);
        const render = () => this._renderPage(next);
        if (initial) render();
        else this._transition.start(render, { type: 'cross-fade' });
    }

    _renderPage(route) {
        // A newer navigation already replaced this one
        if (route !== this.route || !this._contentEl) return;
        this._disposePage();
        const content = this._contentEl;
        content.replaceChildren();
        if (route.page === 'widget') {
            const WidgetClass = this.shell.getWidget(route.id);
            this._renderWidget(content, WidgetClass, route);
            content.dataset.route = `widget/${route.id}`;
            document.title = `${WidgetClass.name} · Plauna widgets`;
        } else {
            this._renderOverview(content);
            content.dataset.route = 'overview';
            document.title = 'Plauna widgets';
        }
        this._scroller().scrollTop = 0;
        // A page transition snapshots the new page right after this: in GPU
        // mode paint it now, or the snapshot would still show the old page
        if (this.surface?.activeMode === 'gpu') {
            this.surface.invalidate(true);
            this.surface.frame();
        }
    }

    _disposePage() {
        const disposers = this._disposers;
        this._disposers = [];
        for (const dispose of disposers) dispose();
        this._playground = null;
    }

    /** Destroy every preview and control, and remove the showcase from the page. */
    destroy() {
        this._disposePage();
        clearInterval(this._statsTimer);
        this._statsTimer = null;
        for (const [target, type, fn] of this._listeners) target.removeEventListener(type, fn);
        this._listeners = [];
        this.surface?.destroy();
        this._root?.remove();
        this._root = null;
        this._contentEl = null;
        this.surface = null;
    }

    _on(target, type, fn) {
        target.addEventListener(type, fn);
        this._listeners.push([target, type, fn]);
    }

    // ── Overview ──────────────────────────────────────────────────

    _renderOverview(content) {
        const categories = this.shell.getAllCategories();
        const widgets = this.shell.getAllWidgets();
        const storyCount = widgets.reduce((sum, WidgetClass) => sum + Object.keys(this._stories(WidgetClass)).length, 0);

        const hero = el('section', 'pg-hero');
        hero.append(
            el('div', 'pg-eyebrow', 'Plauna widget library'),
            el('h1', null, 'Every widget, running live'),
            el('p', 'pg-lead', 'Each card is a working widget. Open one to try it in its playground: switch stories, change its options, watch the events it fires and copy the code. The whole page renders through Plauna, in DOM, GPU or auto mode.')
        );
        const stats = el('div', 'pg-stats');
        for (const [value, label] of [[widgets.length, 'widgets'], [categories.length, 'categories'], [storyCount, 'stories'], ['DOM · GPU · Auto', 'render modes']]) {
            const stat = el('div', 'pg-stat');
            stat.append(el('span', 'pg-stat-value', String(value)), el('span', 'pg-stat-label', label));
            stats.appendChild(stat);
        }
        hero.appendChild(stats);
        content.appendChild(hero);

        for (const category of categories) {
            const section = el('section', 'pg-category');
            section.dataset.category = category.id;
            const head = el('div', 'pg-category-head');
            head.append(el('h2', null, `${category.icon || ''} ${category.name}`.trim()), el('p', null, category.description || ''));
            const grid = el('div', 'pg-card-grid');
            for (const WidgetClass of category.items) grid.appendChild(this._buildCard(WidgetClass));
            section.append(head, grid);
            content.appendChild(section);
        }
    }

    _buildCard(WidgetClass) {
        const stories = this._stories(WidgetClass);
        const [storyName, storyOptions] = Object.entries(stories)[0] || ['Default', {}];
        const card = el('article', 'pg-card');
        card.dataset.card = WidgetClass.id;

        // A picture of the widget: the link covers the card, so the preview is inert
        const preview = el('div', 'plauna-story-preview');
        preview.dataset.for = WidgetClass.id;
        preview.inert = true;
        this._mountStory(WidgetClass, storyName, storyOptions, preview);

        const body = el('div', 'pg-card-body');
        const title = el('a', 'pg-card-title');
        title.href = `#/widget/${WidgetClass.id}`;
        title.append(el('span', null, WidgetClass.icon || ''), el('span', null, WidgetClass.name));
        const count = Object.keys(stories).length;
        body.append(
            title,
            el('span', 'pg-card-desc', WidgetClass.description || ''),
            el('span', 'pg-card-meta', `${count} ${count === 1 ? 'story' : 'stories'} · ${WidgetClass.id}`)
        );
        card.append(preview, body);
        return card;
    }

    // ── Widget page ───────────────────────────────────────────────

    _renderWidget(content, WidgetClass, route) {
        const stories = this._stories(WidgetClass);
        const names = Object.keys(stories);
        const category = this.shell.getAllCategories().find((entry) => entry.items.includes(WidgetClass));

        const crumbs = el('nav', 'pg-crumbs');
        crumbs.setAttribute('aria-label', 'Breadcrumb');
        const home = el('a', null, 'Widgets');
        home.href = '#/';
        crumbs.append(home, el('span', null, '/'), el('span', null, category?.name || ''), el('span', null, '/'), el('span', null, WidgetClass.name));

        const title = el('div', 'pg-title');
        title.append(el('span', 'pg-title-icon', WidgetClass.icon || '•'), el('h1', null, WidgetClass.name));
        const meta = el('div', 'pg-meta');
        meta.append(el('code', 'pg-pill', WidgetClass.id));
        if (category) meta.append(el('span', 'pg-pill', category.name));
        for (const tag of WidgetClass.tags || []) meta.append(el('span', 'pg-pill', `#${tag}`));
        content.append(crumbs, title, el('p', 'pg-lead', WidgetClass.description || ''), meta);

        const storyName = names.find((name) => slug(name) === route.story) || names[0];
        content.appendChild(this._buildPlayground(WidgetClass, stories, storyName));

        const heading = el('h2', 'pg-section-title');
        heading.append('All stories', el('span', null, `${names.length} from ${WidgetClass.name}.stories()`));
        const grid = el('div', 'pg-story-grid');
        for (const name of names) {
            const card = el('section', 'pg-story');
            card.dataset.story = slug(name);
            const head = el('div', 'pg-story-head');
            const open = el('button', 'pg-text-button', 'Open in playground');
            open.type = 'button';
            open.addEventListener('click', () => {
                this._selectStory(name);
                this._playground?.stage.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
            });
            head.append(el('span', 'pg-story-name', name), open);
            const preview = el('div', 'plauna-story-preview');
            preview.dataset.for = WidgetClass.id;
            this._mountStory(WidgetClass, name, stories[name], preview);
            card.append(head, preview);
            grid.appendChild(card);
        }
        content.append(heading, grid);
    }

    // ── Playground ────────────────────────────────────────────────

    _buildPlayground(WidgetClass, stories, storyName) {
        const wrap = el('section', 'pg-playground');
        wrap.setAttribute('aria-label', `${WidgetClass.name} playground`);

        // Stage: story picker, preview tools, the preview
        const stage = el('div', 'pg-panel pg-stage');
        const bar = el('div', 'pg-panel-head');
        const storyPicker = el('div', 'pg-segmented');
        storyPicker.id = 'plauna-story-picker';
        storyPicker.setAttribute('role', 'group');
        storyPicker.setAttribute('aria-label', 'Story');
        const storyButtons = new Map();
        for (const name of Object.keys(stories)) {
            const button = el('button', null, name);
            button.type = 'button';
            button.dataset.story = slug(name);
            button.addEventListener('click', () => this._selectStory(name));
            storyButtons.set(name, button);
            storyPicker.appendChild(button);
        }

        const canvas = el('div', 'pg-canvas');
        canvas.dataset.background = 'surface';
        canvas.dataset.width = 'fill';
        const toggle = (label, attribute, choices) => {
            const group = el('div', 'pg-segmented');
            group.setAttribute('role', 'group');
            group.setAttribute('aria-label', label);
            for (const [value, text] of choices) {
                const button = el('button', null, text);
                button.type = 'button';
                button.dataset.value = value;
                button.setAttribute('aria-pressed', String(canvas.dataset[attribute] === value));
                button.addEventListener('click', () => {
                    canvas.dataset[attribute] = value;
                    for (const other of group.children) other.setAttribute('aria-pressed', String(other === button));
                });
                group.appendChild(button);
            }
            return group;
        };
        const reset = el('button', 'pg-text-button', 'Reset');
        reset.type = 'button';
        reset.addEventListener('click', () => this._selectStory(this._playground.storyName, false));
        const tools = el('div', 'pg-stage-tools');
        tools.append(
            toggle('Preview background', 'background', [['surface', 'Surface'], ['grid', 'Grid']]),
            toggle('Preview width', 'width', [['fill', 'Fill'], ['768', '768'], ['390', '390']]),
            reset
        );
        bar.append(storyPicker, tools);

        const preview = el('div', 'plauna-story-preview');
        preview.id = 'plauna-playground-preview';
        preview.dataset.for = WidgetClass.id;
        canvas.appendChild(preview);
        stage.append(bar, canvas);

        // Code and actions under the stage
        const codePanel = el('div', 'pg-panel');
        const codeHead = el('div', 'pg-panel-head');
        const copy = el('button', 'pg-text-button', 'Copy');
        copy.type = 'button';
        const pre = el('pre', 'pg-code');
        const code = el('code');
        pre.appendChild(code);
        copy.addEventListener('click', () => {
            const done = (text) => {
                copy.textContent = text;
                setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
            };
            Promise.resolve(navigator.clipboard?.writeText(code.textContent))
                .then(() => done('Copied'), () => done('Copy failed'));
        });
        codeHead.append(el('span', 'pg-panel-title', 'Code'), copy);
        codePanel.append(codeHead, pre);

        const actionsPanel = el('div', 'pg-panel');
        const actionsHead = el('div', 'pg-panel-head');
        const clear = el('button', 'pg-text-button', 'Clear');
        clear.type = 'button';
        clear.addEventListener('click', () => this._renderActions(true));
        actionsHead.append(el('span', 'pg-panel-title', 'Actions'), clear);
        const actions = el('ul', 'pg-actions');
        actions.id = 'plauna-playground-actions';
        actions.setAttribute('aria-label', 'Events the widget fired');
        actionsPanel.append(actionsHead, actions);

        const dock = el('div', 'pg-dock');
        dock.append(codePanel, actionsPanel);
        const main = el('div', 'pg-playground-main');
        main.append(stage, dock);

        // Controls
        const controls = el('aside', 'pg-panel pg-controls');
        controls.id = 'plauna-playground-controls';
        const controlsHead = el('div', 'pg-panel-head');
        const controlsNote = el('span', 'pg-note');
        controlsHead.append(el('span', 'pg-panel-title', 'Controls'), controlsNote);
        const controlsBody = el('div', 'pg-controls-body');
        controls.append(controlsHead, controlsBody);

        wrap.append(main, controls);

        this._playground = {
            WidgetClass,
            stories,
            storyName: null,
            args: {},
            holder: null,
            fields: fieldsFor(WidgetClass, stories),
            controls: new Map(),
            actions: [],
            stage,
            preview,
            code,
            actionsEl: actions,
            storyButtons,
            controlsBody,
            controlsNote
        };
        for (const type of ['click', 'change', 'input']) {
            preview.addEventListener(type, (event) => this._logAction(event));
        }
        const playground = this._playground;
        this._disposers.push(() => this._disposePlayground(playground));
        this._selectStory(storyName, false);
        this._renderActions();
        return wrap;
    }

    /** Show `name` in the playground with its own options. */
    _selectStory(name, updateUrl = true) {
        const pg = this._playground;
        if (!pg || !(name in pg.stories)) return;
        pg.storyName = name;
        // Edited in place by the controls; the story keeps its options
        pg.args = cloneValue({ ...pg.stories[name] });
        for (const [storyName, button] of pg.storyButtons) {
            button.setAttribute('aria-pressed', String(storyName === name));
        }
        this._rebuildInstance();
        this._buildControls();
        if (updateUrl) {
            const hash = `#/widget/${pg.WidgetClass.id}/${slug(name)}`;
            history.replaceState?.(history.state, '', hash);
            this.route = { page: 'widget', id: pg.WidgetClass.id, story: slug(name) };
        }
    }

    /** Create the playground's widget again from its current options. */
    _rebuildInstance() {
        const pg = this._playground;
        const WidgetClass = pg.WidgetClass;
        if (pg.holder) this._disposeHolder(WidgetClass, pg.holder);
        const holder = { instance: null, dom: null, trigger: null };
        pg.holder = holder;
        try {
            holder.instance = new WidgetClass(_newGalleryId(`${WidgetClass.id}-playground`), cloneValue(pg.args));
            this._renderInto(WidgetClass, holder, pg.preview);
        } catch (error) {
            pg.preview.replaceChildren(el('span', 'pg-error', `Error: ${error.message}`));
        }
        this._syncControls();
        this._updateCode();
    }

    _buildControls() {
        const pg = this._playground;
        this._destroyControls(pg);
        pg.controlsBody.replaceChildren();
        const groups = new Map();
        for (const field of pg.fields) {
            const group = field.group || 'Options';
            if (!groups.has(group)) groups.set(group, []);
            groups.get(group).push(field);
        }
        for (const [groupName, fields] of groups) {
            const group = el('div', 'pg-field-group');
            group.appendChild(el('h3', null, groupName));
            for (const field of fields) {
                const row = el('div', 'pg-field');
                row.dataset.field = field.key;
                const label = el('div', 'pg-field-label');
                label.append(el('span', null, field.label), el('code', null, field.key));
                const control = createControl(field, {
                    instance: () => this._playground?.holder?.instance ?? null,
                    args: pg.args,
                    value: this._readField(field),
                    render: (widget) => this._mountControl(widget),
                    onChange: (value) => this._changeField(field, value)
                });
                row.append(label, control.element);
                group.appendChild(row);
                pg.controls.set(field.key, { field, control, row });
            }
            pg.controlsBody.appendChild(group);
        }
        if (!pg.fields.length) pg.controlsBody.appendChild(el('p', 'pg-actions-empty', 'This widget takes no options.'));
        pg.controlsNote.textContent = `${pg.fields.length} ${pg.fields.length === 1 ? 'option' : 'options'}`;
        this._syncControls();
    }

    _readField(field) {
        const pg = this._playground;
        try {
            return readField(field, pg.holder?.instance ?? null, pg.args);
        } catch {
            return pg.args[field.key];
        }
    }

    /** A control changed: apply it live through the schema, or build the widget again. */
    _changeField(field, value) {
        const pg = this._playground;
        if (!pg) return;
        if (value === undefined) delete pg.args[field.key];
        else pg.args[field.key] = value;
        const instance = pg.holder?.instance;
        if (typeof field.apply === 'function' && instance) {
            try {
                field.apply(instance, value, { values: pg.args, storyOptions: pg.args });
                this._renderInto(pg.WidgetClass, pg.holder, pg.preview);
            } catch (error) {
                pg.preview.replaceChildren(el('span', 'pg-error', `Error: ${error.message}`));
            }
            this._syncControls();
            this._updateCode();
        } else {
            this._rebuildInstance();
        }
    }

    _syncControls() {
        const pg = this._playground;
        if (!pg) return;
        const instance = pg.holder?.instance ?? null;
        for (const { field, control, row } of pg.controls.values()) {
            control.refresh?.();
            control.sync?.(this._readField(field));
            const visible = typeof field.visibleWhen !== 'function' || !instance || field.visibleWhen(instance);
            row.style.display = visible ? '' : 'none';
        }
    }

    _updateCode() {
        const pg = this._playground;
        if (pg) pg.code.textContent = widgetSnippet(pg.WidgetClass, pg.args);
    }

    _logAction(event) {
        const pg = this._playground;
        if (!pg) return;
        const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
        let what = target ? (target.getAttribute('role') || target.localName) : '';
        const text = target?.textContent?.trim().replace(/\s+/g, ' ');
        if (event.type === 'click' && text) what += ` "${text.slice(0, 28)}"`;
        if (event.type !== 'click' && target && 'value' in target) {
            const value = target.type === 'checkbox' || target.type === 'radio' ? target.checked : target.value;
            what += ` = ${JSON.stringify(value).slice(0, 40)}`;
        }
        pg.actions.unshift({ time: clockTime(new Date()), type: event.type, what });
        pg.actions.length = Math.min(pg.actions.length, MAX_ACTIONS);
        this._renderActions();
    }

    _renderActions(clear = false) {
        const pg = this._playground;
        if (!pg) return;
        if (clear) pg.actions = [];
        if (!pg.actions.length) {
            const empty = el('li', 'pg-actions-empty', 'Click, type or change the widget: its events show here.');
            pg.actionsEl.replaceChildren(empty);
            return;
        }
        pg.actionsEl.replaceChildren(...pg.actions.map((action) => {
            const item = el('li');
            item.append(el('time', null, action.time), el('b', null, action.type), el('span', null, action.what));
            return item;
        }));
    }

    _destroyControls(pg) {
        for (const { control } of pg.controls.values()) {
            for (const widget of control.widgets || []) widget.destroy?.();
        }
        pg.controls.clear();
    }

    _disposePlayground(pg) {
        if (pg.holder) this._disposeHolder(pg.WidgetClass, pg.holder);
        pg.holder = null;
        this._destroyControls(pg);
    }

    _mountControl(widget) {
        if (widget.buttonElement instanceof HTMLElement) return widget.buttonElement;
        return this.shell.render(widget) || widget.element || el('div');
    }

    // ── Story instances ───────────────────────────────────────────

    /** Create a story's widget, render it into `preview`; the page disposes it. */
    _mountStory(WidgetClass, storyName, storyOptions, preview) {
        const holder = { instance: null, dom: null, trigger: null };
        try {
            const id = _newGalleryId(`${WidgetClass.id}-${storyName.replace(/\s+/g, '-').toLowerCase()}`);
            holder.instance = new WidgetClass(id, storyOptions);
            this._renderInto(WidgetClass, holder, preview);
        } catch (error) {
            preview.replaceChildren(el('span', 'pg-error', `Error: ${error.message}`));
        }
        this._disposers.push(() => this._disposeHolder(WidgetClass, holder));
        return holder;
    }

    _renderInto(WidgetClass, holder, preview) {
        const instance = holder.instance;
        if (WidgetClass.id === 'tooltip') instance.detach?.();
        // Tooltips sit on <body>, outside the preview
        holder.dom?.remove();
        holder.trigger?.remove();
        holder.dom = null;
        holder.trigger = null;
        preview.replaceChildren();
        try {
            const dom = this.shell.render(instance);
            if (!dom) {
                preview.appendChild(el('span', 'pg-note', `${WidgetClass.name} renders no element`));
                return;
            }
            dom.setAttribute('data-widget', WidgetClass.id);
            if (WidgetClass.id === 'tooltip') {
                const trigger = el('button', 'pg-tooltip-trigger', 'Hover me');
                trigger.type = 'button';
                preview.appendChild(trigger);
                document.body.appendChild(dom);
                holder.dom = dom;
                holder.trigger = trigger;
                instance.attachTo?.(trigger);
            } else {
                preview.appendChild(dom);
                holder.dom = dom;
                if (WidgetClass.id === 'toast') requestAnimationFrame(() => instance.show?.());
            }
        } catch (error) {
            preview.replaceChildren(el('span', 'pg-error', `Error: ${error.message}`));
        }
    }

    _disposeHolder(WidgetClass, holder) {
        holder.dom?.remove();
        holder.trigger?.remove();
        holder.dom = null;
        holder.trigger = null;
        try {
            holder.instance?.destroy?.();
        } catch (error) {
            console.warn(`[WidgetGallery] ${WidgetClass.id} destroy() failed: ${error.message}`);
        }
        holder.instance = null;
    }

    _stories(WidgetClass) {
        if (typeof WidgetClass.stories === 'function') {
            try {
                const stories = WidgetClass.stories();
                if (stories && Object.keys(stories).length) return stories;
            } catch {
                // Fall back to the default options
            }
        }
        const defaults = typeof WidgetClass.getDefaultOptions === 'function' ? WidgetClass.getDefaultOptions() : {};
        return { Default: defaults };
    }
}
