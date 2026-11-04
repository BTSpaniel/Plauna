// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * ============================================================================
 * PLAUNA DEV SHELL
 * ============================================================================
 *
 * PlaunaDevShell is the shell the widget showcase (plauna.html) boots. It is a
 * thin layer over PlaunaApp: the app owns the renderer, console, text service,
 * smart context menu and theme API; the shell adds the saved theme preference,
 * the widget registry for the gallery, and optional GPU workspaces.
 *
 * USAGE:
 *   const shell = await PlaunaDevShell.boot(document.body, { logger: console });
 *   await shell.setTheme('dark');
 *   const element = shell.render(new Button('save', { text: 'Save' }));
 *
 * THEMES:
 * - Themes live in plauna/themes/{id}/theme.json and may extend each other.
 * - PlaunaApp.setTheme() applies them as CSS variables on :root (ThemeLoader).
 * - Widgets style themselves from those variables; the shell injects no CSS.
 * - The chosen theme is saved with ThemePreference and restored at boot.
 *
 * WORKSPACES (OPTIONAL):
 * - Pass gpuDevice (plus gpuCanvas/gpuFormat) to get a WorkspaceManager for
 *   virtual desktops with DOM and GPU panels.
 */

import { createPlaunaApp } from './core/app.js';
import { widgets, getAllCategories, getAllWidgets, widgetRegistry } from './widgets/index.js';
import { themeLoader } from './themes/ThemeLoader.js';
import { readFileThemePreference, writeFileThemePreference } from './themes/ThemePreference.js';
import { WorkspaceManager } from './workspace/WorkspaceManager.js';

export class PlaunaDevShell {
    constructor(options = {}) {
        this.logger = options.logger || { info: console.log, warn: console.warn, error: console.error };
        this.app = null;
        this.widgets = widgets;
        this.widgetRegistry = widgetRegistry;
        this._workspaceManager = null;
        this._root = null;
    }

    /**
     * Static factory — boot the shell and return it ready to use.
     * @param {HTMLElement} root
     * @param {Object} options - logger, enableSmartContextMenu, consoleOptions,
     *   gpuDevice/gpuCanvas/gpuFormat
     * @returns {Promise<PlaunaDevShell>}
     */
    static async boot(root, options = {}) {
        const shell = new PlaunaDevShell(options);
        await shell._init(root, options);
        return shell;
    }

    async _init(root, options = {}) {
        this._root = root;

        // Saved theme, else the system color scheme
        const prefersDark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
        const initialTheme = readFileThemePreference() || (prefersDark ? 'dark' : 'light');

        this.app = await createPlaunaApp({
            root,
            useCSS: true,
            theme: initialTheme,
            enableSmartContextMenu: options.enableSmartContextMenu ?? true,
            consoleOptions: options.consoleOptions ?? {}
        });

        // Optional workspace layer for GPU panels
        const { gpuDevice, gpuCanvas, gpuFormat } = this._resolveGpuOptions(options);
        if (gpuDevice) {
            const container = document.createElement('div');
            container.id = 'plauna-workspace-container';
            Object.assign(container.style, { position: 'absolute', inset: '0', zIndex: '1', pointerEvents: 'none' });
            root.appendChild(container);
            this._workspaceManager = new WorkspaceManager({
                container,
                device: gpuDevice,
                format: gpuFormat || 'bgra8unorm',
                canvas: gpuCanvas,
                logger: this.logger
            });
            await this._workspaceManager.init();
            this.logger.info('[PlaunaDevShell] WorkspaceManager initialized');
        }

        // Pre-discover available themes in the background
        themeLoader.discover();

        this.logger.info(`PlaunaDevShell booted (theme: ${this.getTheme()})`);
    }

    _resolveGpuOptions(options) {
        return {
            gpuDevice: options.gpuDevice || options.device || null,
            gpuCanvas: options.gpuCanvas || options.canvas || null,
            gpuFormat: options.gpuFormat || options.format || null
        };
    }

    // ── Public API ────────────────────────────────────────────────

    getTheme() {
        return this.app?.getTheme() ?? null;
    }

    /** Apply and save a theme; returns the id that was applied (dark when the theme fails). */
    async setTheme(themeId) {
        const applied = await this.app.setTheme(themeId);
        try {
            writeFileThemePreference(applied);
        } catch {
            // Saving the preference is best-effort
        }
        return applied;
    }

    async toggleTheme() {
        return this.setTheme(this.getTheme() === 'dark' ? 'light' : 'dark');
    }

    onThemeChange(observer) {
        return this.app.onThemeChange(observer);
    }

    /** Returns metadata for all registered themes. */
    async getAvailableThemes() {
        return this.app.getAvailableThemes();
    }

    /** Apply per-session CSS variable overrides on top of the active theme. */
    applyOverrides(vars) {
        themeLoader.applyOverrides(vars);
    }

    clearOverrides() {
        themeLoader.clearOverrides();
    }

    get themeLoader() { return themeLoader; }

    /** Workspace manager for virtual desktops / multi-panel layouts (GPU only). */
    get workspaces() { return this._workspaceManager; }

    /** The renderer every showcase preview goes through (the app's DOMRenderer). */
    get widgetRenderer() { return this.app?.domRenderer ?? null; }

    getAllWidgets() { return getAllWidgets(); }
    getAllCategories() { return getAllCategories(); }
    getWidget(id) { return this.widgetRegistry.get(id); }

    /**
     * Render a UINode (widget) and return its element. The element keeps
     * itself in sync with the widget afterwards.
     * @param {UINode} uiNode
     * @returns {HTMLElement}
     */
    render(uiNode) {
        return this.app.render(uiNode);
    }

    destroy() {
        this._workspaceManager?.destroy?.();
        this._workspaceManager = null;
        this.app?.destroy();
        this.app = null;
    }
}
