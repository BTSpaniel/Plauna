// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

import { createPlaunaApp } from '../core/app.js';
import { ToastManager } from '../ui/ToastManager.js';
import { runtimeFrameDeltaSeconds } from '../../engine/core/math/FrameMath.js';
import { bounceWithinBounds, buildBackdropController, buildParticleObstacle, buildPretextMask, clampMagnitude, computeBoidSteering, computeMaskFlowForce, computeRectFlowForce, initializePretextParticles, resolvePretextMaskCollision, updatePressure } from './workbench/backdrop.js';
import { renderWidgetGallery } from './workbench/gallery.js';
import { destroyWorkbenchRenderer, initializeWorkbenchRenderer } from './workbench/renderer.js';
import { createShell, renderDesignCards, renderMarkup, renderPretextPanel, renderToolbar } from './workbench/shell.js';
import { AUTO_SAMPLE_TEXT, DESIGN_PRESETS, applyThemeVariables, createLabState, ensureStyles, getPreset, randomBetween, setThemedModalStylesSource } from './workbench/support.js';

export { buildBackdropController } from './workbench/backdrop.js';

export function mountPlaunaWorkbenchLab(options) {
    const {
        root,
        statusElement,
        logger,
        initializePlauna,
        createWorld,
        createEntity,
        setEntityComponent,
        getEntityComponent
    } = options;

    if (!root || !statusElement || !logger) {
        throw new Error('Plauna workbench lab requires root, statusElement, and logger');
    }

    ensureStyles();
    const elements = createShell(root, statusElement);
    renderMarkup(elements.plaunaRoot);
    renderToolbar(elements.plaunaRoot);
    renderDesignCards(elements.plaunaRoot);
    elements.plaunaRoot.classList.add('plauna-root--transparent');

    const backdrop = options.backdropController
        || buildBackdropController(elements.canvas, logger, options);
    const state = createLabState(elements, logger);
    state.toastManager = new ToastManager({ position: 'top-right', defaultDuration: 3000 });
    let destroyed = false;
    let booted = false;
    let lifecycleGeneration = 0;
    let bootPromise = null;
    let demoPromise = null;
    let interactionsAttached = false;
    const interactionCleanups = [];
    const rendererOwner = Symbol('plauna-workbench-renderer-owner');

    function lifecycleError() {
        const error = new Error('Plauna workbench lifecycle was revoked');
        error.code = 'PLAUNA_WORKBENCH_DESTROYED';
        return error;
    }

    function assertLifecycle(generation) {
        if (!destroyed && generation === lifecycleGeneration) return;
        throw lifecycleError();
    }

    function listen(target, type, handler, options) {
        target.addEventListener(type, handler, options);
        interactionCleanups.push(() => target.removeEventListener(type, handler, options));
    }

    function detachInteractions() {
        if (!interactionsAttached) return;
        interactionsAttached = false;
        for (const cleanup of interactionCleanups.splice(0)) {
            try { cleanup(); } catch (_) {}
        }
        clearTimeout(state.pointerIntent.settleTimer);
        state.pointerIntent.settleTimer = 0;
    }

    // Helper function to get current theme tokens for demo functions
    function getThemeTokens() {
        // Check if we have access to the Plauna theme manager
        if (state.plaunaApp?.themeManager) {
            const theme = state.plaunaApp.themeManager.getCurrentTheme();
            if (theme && theme.tokens) {
                return theme.tokens;
            }
        }
        
        // Fallback to CSS custom properties from the document
        const computedStyle = getComputedStyle(document.documentElement);
        
        // Get actual values from CSS variables
        const bgPrimary = computedStyle.getPropertyValue('--bg-primary').trim();
        const textPrimary = computedStyle.getPropertyValue('--text-primary').trim();
        
        // Check if we're in light theme by looking at the background color
        // Light theme typically has white/light backgrounds, dark theme has dark backgrounds
        const isLightTheme = bgPrimary && (
            bgPrimary.includes('255') || 
            bgPrimary.includes('f8') || 
            bgPrimary.includes('fa') ||
            bgPrimary.includes('fc') ||
            bgPrimary.includes('fe') ||
            bgPrimary === '#ffffff' ||
            bgPrimary === '#f8fafc' ||
            bgPrimary.startsWith('rgb(255') ||
            bgPrimary.startsWith('rgba(255')
        );
        
        // Also check text color as a secondary indicator
        const isDarkText = textPrimary && (
            textPrimary.includes('0') ||
            textPrimary.includes('1') ||
            textPrimary.includes('2') ||
            textPrimary === '#0f172a' ||
            textPrimary === '#1e293b' ||
            textPrimary.startsWith('rgb(0') ||
            textPrimary.startsWith('rgb(1') ||
            textPrimary.startsWith('rgb(2')
        );
        
        // Determine theme based on both background and text colors
        const useLightTheme = isLightTheme || isDarkText;
        
        // Set fallback values based on detected theme
        const fallbacks = useLightTheme ? {
            background: {
                primary: '#ffffff',
                secondary: '#f8fafc',
                tertiary: '#f1f5f9',
                inverse: '#0f172a'
            },
            text: {
                primary: '#0f172a',
                secondary: '#475569',
                tertiary: '#64748b',
                disabled: '#94a3b8'
            }
        } : {
            background: {
                primary: '#0f172a',
                secondary: '#1e293b',
                tertiary: '#334155',
                inverse: '#ffffff'
            },
            text: {
                primary: '#f8fafc',
                secondary: '#cbd5e1',
                tertiary: '#64748b',
                disabled: '#475569'
            }
        };
        
        return {
            colors: {
                background: {
                    primary: bgPrimary || fallbacks.background.primary,
                    secondary: computedStyle.getPropertyValue('--bg-secondary').trim() || fallbacks.background.secondary,
                    tertiary: computedStyle.getPropertyValue('--bg-tertiary').trim() || fallbacks.background.tertiary,
                    inverse: computedStyle.getPropertyValue('--bg-quaternary').trim() || fallbacks.background.inverse
                },
                text: {
                    primary: textPrimary || fallbacks.text.primary,
                    secondary: computedStyle.getPropertyValue('--text-secondary').trim() || fallbacks.text.secondary,
                    tertiary: computedStyle.getPropertyValue('--text-muted').trim() || fallbacks.text.tertiary,
                    disabled: computedStyle.getPropertyValue('--border-medium').trim() || fallbacks.text.disabled
                },
                primary: {
                    500: computedStyle.getPropertyValue('--accent-primary').trim() || '#3b82f6',
                    300: computedStyle.getPropertyValue('--accent-secondary').trim() || '#93c5fd'
                },
                warning: computedStyle.getPropertyValue('--accent-warning').trim() || '#f59e0b',
                error: computedStyle.getPropertyValue('--accent-error').trim() || '#ef4444',
                success: '#10b981'
            },
            spacing: {
                xs: '4px',
                sm: '8px',
                md: '16px',
                lg: '24px',
                xl: '32px',
                xxxl: '48px'
            },
            borderRadius: {
                sm: '4px',
                md: '8px',
                lg: '12px',
                xl: '16px'
            },
            fontSizes: {
                xs: '12px',
                sm: '14px',
                md: '16px',
                lg: '18px',
                xl: '20px'
            },
            fontWeights: {
                normal: '400',
                medium: '500',
                semibold: '600',
                bold: '700'
            }
        };
    }

    // Helper function to create theme-aware modal styles
    function createThemedModalStyles() {
        const tokens = getThemeTokens();
        return {
            background: tokens.colors.background.secondary || 'rgba(15, 23, 42, 0.95)',
            border: tokens.colors.text.disabled || 'rgba(99, 116, 141, 0.3)',
            text: tokens.colors.text.primary || '#e4e4e7',
            textSecondary: tokens.colors.text.secondary || '#94a3b8',
            accent: tokens.colors.primary[500] || '#3b82f6',
            accentHover: tokens.colors.primary[300] || '#60a5fa',
            colors: tokens.colors,
            spacing: tokens.spacing,
            borderRadius: tokens.borderRadius,
            fontSizes: tokens.fontSizes,
            fontWeights: tokens.fontWeights
        };
    }

    // Set global reference immediately for demo functions to access
    setThemedModalStylesSource(createThemedModalStyles);

    function renderOverview() {
        const overview = elements.plaunaRoot.querySelector('#overview');
        const layout = state.lastLayout;
        const surface = state.lastSurface;
        const fpsValue = state.fps > 0 ? String(state.fps) : '--';
        const cacheSize = state.plaunaApp ? state.plaunaApp.textService.measureCache.size : 0;
        overview.innerHTML = `
            <article class="plauna-metric">
                <div class="plauna-metric__label">Runtime</div>
                <div class="plauna-metric__value">${state.plaunaApp ? 'Live' : 'Booting'}</div>
                <div class="plauna-metric__detail">${state.plaunaApp ? 'Plauna app initialized' : 'Starting Plauna runtime...'}</div>
            </article>
            <article class="plauna-metric">
                <div class="plauna-metric__label">Text Width</div>
                <div class="plauna-metric__value">${layout ? `${Math.round(layout.width)}px` : '--'}</div>
                <div class="plauna-metric__detail">${layout ? `${layout.lineCount} lines · ${cacheSize} cached` : 'No sample measured yet'}</div>
            </article>
            <article class="plauna-metric">
                <div class="plauna-metric__label">Surface</div>
                <div class="plauna-metric__value">${surface ? surface.kind : 'none'}</div>
                <div class="plauna-metric__detail">${surface ? surface.id : 'No surface created yet'}</div>
            </article>
            <article class="plauna-metric">
                <div class="plauna-metric__label">Mode</div>
                <div class="plauna-metric__value">${state.activeDesign}</div>
                <div class="plauna-metric__detail">${state.autoCycle ? 'Auto-cycling presets' : 'Previewing layout'}</div>
            </article>
            <article class="plauna-metric">
                <div class="plauna-metric__label">Theme</div>
                <div class="plauna-metric__value">${state.activeTheme}</div>
                <div class="plauna-metric__detail">Use toolbar to toggle</div>
            </article>
            <article class="plauna-metric">
                <div class="plauna-metric__label">FPS</div>
                <div class="plauna-metric__value" id="fps-value">${fpsValue}</div>
                <div class="plauna-metric__detail">Particle animation loop</div>
            </article>
        `;
    }

    function refreshStageBounds() {
        const stage = elements.plaunaRoot.querySelector('#layout-stage');
        state.stageRect = {
            width: Math.max(320, stage.clientWidth),
            height: Math.max(280, stage.clientHeight)
        };
    }

    function toStageRect(panel) {
        const inset = 18;
        const usableWidth = Math.max(0, state.stageRect.width - inset * 2);
        const usableHeight = Math.max(0, state.stageRect.height - inset * 2);
        return {
            left: inset + panel.x * usableWidth,
            top: inset + panel.y * usableHeight,
            width: Math.max(44, panel.w * usableWidth),
            height: Math.max(32, panel.h * usableHeight)
        };
    }

    function updateOutlines(preset) {
        state.outlines.forEach((outline, index) => {
            const panel = preset.panels[index];
            if (!panel) {
                outline.style.opacity = '0';
                return;
            }
            const rect = toStageRect(panel);
            outline.style.opacity = '1';
            outline.style.left = `${rect.left}px`;
            outline.style.top = `${rect.top}px`;
            outline.style.width = `${rect.width}px`;
            outline.style.height = `${rect.height}px`;
            outline.dataset.tone = panel.tone || '';
            outline.querySelector('.plauna-stage__label').textContent = panel.label;
        });
        elements.plaunaRoot.querySelector('#stage-caption').textContent = `${preset.title} particle assembly`;
    }

    function retargetParticles(preset) {
        const panels = preset.panels.map((panel) => ({ panel, rect: toStageRect(panel) }));
        state.particleObstacles = panels.map(({ rect }) => buildParticleObstacle(rect, 14));
        state.particles.forEach((particle, index) => {
            const ambientBandY = 42 + (index % 3) * Math.max(18, state.stageRect.height * 0.015);
            particle.targetX = randomBetween(18, Math.max(24, state.stageRect.width - 18));
            particle.targetY = ambientBandY + randomBetween(-10, 10);
            particle.vx += randomBetween(-0.08, 0.08);
            particle.vy += randomBetween(-0.05, 0.05);
            particle.scale = randomBetween(0.72, 1.18);
            particle.element.dataset.tone = panels[index % panels.length].panel.tone || '';
        });
    }

    function updateActiveDesign(presetId) {
        refreshStageBounds();
        const preset = getPreset(presetId);
        state.activeDesign = preset.id;
        elements.plaunaRoot.querySelector('#design-badge').textContent = `Active: ${preset.title}`;
        elements.plaunaRoot.querySelector('#footer-status').textContent = `Previewing ${preset.title}.`;
        updateOutlines(preset);
        retargetParticles(preset);
        renderOverview();
        logger.info('Applied design preset', { preset: preset.id, title: preset.title, particleCount: state.particles.length });
        state.toastManager?.show(`Applied ${preset.title} layout`, 'info');
    }

    function animate() {
        if (destroyed || state.rafId) return;
        let lastTime = performance.now();
        const step = (now) => {
            if (destroyed) {
                state.rafId = 0;
                return;
            }
            const dt = runtimeFrameDeltaSeconds(now, lastTime, 0.032);
            lastTime = now;
            backdrop.render(now * 0.001);

            state.fpsFrames += 1;
            if (state.fpsLastTime === 0) state.fpsLastTime = now;
            const fpsDelta = now - state.fpsLastTime;
            if (fpsDelta >= 1000) {
                state.fps = Math.round((state.fpsFrames * 1000) / fpsDelta);
                state.fpsFrames = 0;
                state.fpsLastTime = now;
                const fpsEl = elements.plaunaRoot.querySelector('#fps-value');
                if (fpsEl) fpsEl.textContent = String(state.fps);
            }

            for (const particle of state.particles) {
                const dx = particle.targetX - particle.x;
                const dy = particle.targetY - particle.y;
                const seekX = dx * 3.2 * dt;
                const seekY = dy * 3.2 * dt;
                const flock = computeBoidSteering(state.particles, particle, 42, 0.42);
                const flow = computeRectFlowForce(particle, state.particleObstacles, 22);
                updatePressure(particle, flow.pressureInput, dt);
                particle.vx += seekX + flock.x + flow.forceX * (0.55 + particle.pressure * 0.08);
                particle.vy += seekY + flock.y + flow.forceY * (0.55 + particle.pressure * 0.08);
                const stageVelocity = clampMagnitude(particle.vx, particle.vy, 3.2 + particle.pressure * 1.5);
                particle.vx = stageVelocity.x * 0.92;
                particle.vy = stageVelocity.y * 0.92;
                particle.phase += dt * particle.jitter * 2.1;
                particle.x += particle.vx + Math.cos(particle.phase) * particle.jitter * (0.12 + particle.pressure * 0.05);
                particle.y += particle.vy + Math.sin(particle.phase) * particle.jitter * (0.08 + particle.pressure * 0.08);
                bounceWithinBounds(particle, -10, -10, state.stageRect.width + 10, state.stageRect.height + 10, 0.68);
                const pulse = 0.9 + Math.sin(particle.phase * 1.8) * 0.08;
                particle.element.style.transform = `translate3d(${particle.x}px, ${particle.y}px, 0) scale(${particle.scale * pulse})`;
                particle.element.style.opacity = String(0.14 + pulse * 0.22 + Math.min(0.18, particle.pressure * 0.08));
            }

            const previewStage = elements.plaunaRoot.querySelector('#pretext-preview-stage');
            if (previewStage) {
                const maxX = previewStage.clientWidth || 320;
                const maxY = previewStage.clientHeight || 140;
                for (const particle of state.pretextParticles) {
                    const dx = particle.targetX - particle.x;
                    const dy = particle.targetY - particle.y;
                    const seekX = dx * 4.6 * dt;
                    const seekY = dy * 4.6 * dt;
                    const flock = computeBoidSteering(state.pretextParticles, particle, 24, 0.34);
                    const flow = computeMaskFlowForce(particle, state.pretextMask);
                    updatePressure(particle, flow.pressureInput, dt);
                    particle.vx += seekX + flock.x + flow.forceX * (0.92 + particle.pressure * 0.18);
                    particle.vy += seekY + flock.y + flow.forceY * (0.92 + particle.pressure * 0.18);
                    const previewVelocity = clampMagnitude(particle.vx, particle.vy, 2.6 + particle.pressure * 1.7);
                    particle.vx = previewVelocity.x * 0.91;
                    particle.vy = previewVelocity.y * 0.91;
                    particle.phase += dt * particle.jitter * 2.4;
                    particle.x += particle.vx + Math.cos(particle.phase) * particle.jitter * (0.18 + particle.pressure * 0.06);
                    particle.y += particle.vy + Math.sin(particle.phase) * particle.jitter * (0.22 + particle.pressure * 0.08);
                    resolvePretextMaskCollision(particle, state.pretextMask);
                    bounceWithinBounds(particle, 2, 2, maxX - 2, maxY - 2, 0.74);
                    const pulse = 0.86 + Math.sin(particle.phase * 1.6) * 0.18;
                    particle.element.style.transform = `translate3d(${particle.x}px, ${particle.y}px, 0) scale(${particle.scale * pulse})`;
                    particle.element.style.opacity = String(0.22 + pulse * 0.44 + Math.min(0.2, particle.pressure * 0.08));
                }
            }
            if (!destroyed) state.rafId = requestAnimationFrame(step);
        };
        state.rafId = requestAnimationFrame(step);
    }

    async function runSmokeTests(generation = lifecycleGeneration) {
        assertLifecycle(generation);
        logger.info('Running Plauna smoke tests');
        const tests = [
            { name: 'Bootstrap initializePlauna export', run: () => typeof initializePlauna === 'function' },
            { name: 'Engine ECS helpers available', run: () => [createWorld, createEntity, setEntityComponent, getEntityComponent].every((fn) => typeof fn === 'function') },
            { name: 'Plauna module exports createPlaunaApp', run: async () => typeof createPlaunaApp === 'function' },
            {
                name: 'Plauna ECS component registration',
                run: async () => {
                    const world = createWorld({ name: 'PlaunaSmoke' });
                    const entity = createEntity(world);
                    const components = await import('../ecs/components.js');
                    setEntityComponent(world, entity, components.UIWorkspace.name, { id: 'smoke', label: 'Smoke' });
                    const component = getEntityComponent(world, entity, components.UIWorkspace.name);
                    return component?.id === 'smoke';
                }
            }
        ];

        let passed = 0;
        const failures = [];
        for (const test of tests) {
            try {
                const result = await test.run();
                assertLifecycle(generation);
                if (!result) {
                    throw new Error('returned false');
                }
                passed += 1;
                logger.info(`PASS ${test.name}`);
            } catch (error) {
                if (error?.code === 'PLAUNA_WORKBENCH_DESTROYED') throw error;
                failures.push({ name: test.name, message: error?.message || String(error) });
                logger.error(`FAIL ${test.name}`, { message: error?.message || String(error) });
            }
        }
        assertLifecycle(generation);
        logger.info('Smoke tests complete', { passed, total: tests.length });
        if (passed === tests.length) {
            state.toastManager?.show(`${passed}/${tests.length} smoke tests passed`, 'success');
        } else {
            state.toastManager?.show(`${passed}/${tests.length} smoke tests passed`, 'warning');
        }
        return { passed, total: tests.length, failures };
    }

    // Smoke tests plus the app's module tester report, for harnesses to gate on
    function getSelfCheckReport() {
        return {
            smoke: state.smokeReport ?? null,
            modules: state.plaunaApp?.moduleTestReport ?? null
        };
    }

    function initializeDemo() {
        if (destroyed) return Promise.reject(lifecycleError());
        if (state.plaunaApp) {
            return Promise.resolve(state.plaunaApp);
        }
        if (demoPromise) return demoPromise;
        const generation = lifecycleGeneration;
        let tracked;
        tracked = initializeDemoGeneration(generation).catch(error => {
            if (generation === lifecycleGeneration && state.plaunaApp) {
                try { state.plaunaApp.destroy?.(); } catch (_) {}
                state.plaunaApp = null;
            }
            destroyWorkbenchRenderer(rendererOwner);
            throw error;
        }).finally(() => {
            if (demoPromise === tracked) demoPromise = null;
        });
        demoPromise = tracked;
        return tracked;
    }

    async function initializeDemoGeneration(generation) {
        const candidateApp = await initializePlauna({
            root: elements.plaunaRoot,
            engine: { createEntity, setEntityComponent, getEntityComponent },
            editor: null,
            useCSS: true,
            textEngine: 'pretext',
            // The workbench is a development lab: inspectors, self-checks and hot reload
            enableDeveloperTools: true,
            enableModuleTester: true,
            enableHotReload: true
        });
        if (destroyed || generation !== lifecycleGeneration) {
            try { candidateApp?.destroy?.(); } catch (_) {}
            throw lifecycleError();
        }
        state.plaunaApp = candidateApp;

        logger.info('Plauna initialized', {
            initialized: state.plaunaApp.initialized,
            workspaces: state.plaunaApp.workspaces.size
        });

        // Initialize workbench renderer for real widget rendering
        const rendererHost = document.createElement('div');
        rendererHost.hidden = true;
        rendererHost.dataset.plaunaWorkbenchRendererHost = '1';
        elements.plaunaRoot.appendChild(rendererHost);
        initializeWorkbenchRenderer(rendererHost, state.plaunaApp.textService, rendererOwner);
        logger.info('Workbench renderer initialized');

        // Apply default theme on initialization
        const defaultTheme = 'dark'; // You can change this to 'light' or 'high-contrast'
        if (state.plaunaApp?.themeManager) {
            state.plaunaApp.themeManager.setTheme(defaultTheme);
            const theme = state.plaunaApp.themeManager.getCurrentTheme();
            applyThemeVariables(document.documentElement, theme && theme.tokens);
            applyThemeVariables(elements.plaunaRoot, theme && theme.tokens);
            elements.plaunaRoot.dataset.theme = defaultTheme;
            state.activeTheme = defaultTheme;
            logger.info('Default theme applied', { theme: defaultTheme });
        }

        state.plaunaApp.registerView('plauna-test-preview', {
            title: 'Preview',
            renderMode: 'dom',
            closable: true
        });
        state.plaunaApp.registerSurface('plauna-test-surface', {
            kind: 'viewport',
            shape: 'rect',
            interactive: true
        });
        state.plaunaApp.addAdvancedLayoutToInspector({ container: elements.plaunaRoot });
        elements.plaunaRoot.querySelector('#footer-status').textContent = 'Plauna initialized by default.';
        renderOverview();
        return state.plaunaApp;
    }

    async function measureSample() {
        const generation = lifecycleGeneration;
        assertLifecycle(generation);
        const app = await initializeDemo();
        assertLifecycle(generation);
        const handle = app.textService.prepare(AUTO_SAMPLE_TEXT, {
            fontFamily: 'Inter',
            fontSize: 14,
            fontWeight: 600,
            lineHeight: 20
        });
        state.lastLayout = app.textService.layout(handle, 280);
        renderOverview();
        elements.plaunaRoot.querySelector('#footer-status').textContent = `Measured sample: ${state.lastLayout.lineCount} lines, ${Math.round(state.lastLayout.width)}px wide.`;
        logger.info('Measured sample text', state.lastLayout);
        state.toastManager?.show(`Measured ${state.lastLayout.lineCount} lines at ${Math.round(state.lastLayout.width)}px`, 'info');
    }

    async function createSurfaceSample() {
        const generation = lifecycleGeneration;
        assertLifecycle(generation);
        const app = await initializeDemo();
        assertLifecycle(generation);
        state.lastSurface = app.createSurface({
            id: `test-surface-${app.surfaceManager.getAllSurfaces().length + 1}`,
            kind: 'viewport',
            shape: 'rect',
            interactive: true
        });
        elements.plaunaRoot.querySelector('#footer-chip').textContent = `Surface: ${state.lastSurface.id}`;
        renderOverview();
        logger.info('Created Plauna surface', state.lastSurface);
        state.toastManager?.show(`Surface ${state.lastSurface.id} created`, 'info');
    }

    function setConsolePeek(shouldPeek) {
        if (shouldPeek === state.consolePeek) {
            return;
        }
        state.consolePeek = shouldPeek;
        elements.consoleDrawer.dataset.consolePeek = shouldPeek ? '1' : '0';
        elements.consoleDrawer.classList.toggle('is-peeking', shouldPeek);
    }

    function applyTheme(themeId) {
        state.activeTheme = themeId;
        const themeLabels = { light: 'Light', dark: 'Dark', 'high-contrast': 'High Contrast' };
        const label = themeLabels[themeId] || themeId;
        if (state.plaunaApp?.themeManager) {
            state.plaunaApp.themeManager.setTheme(themeId);
            const theme = state.plaunaApp.themeManager.getCurrentTheme();
            applyThemeVariables(document.documentElement, theme && theme.tokens);
            applyThemeVariables(elements.plaunaRoot, theme && theme.tokens);
            elements.plaunaRoot.dataset.theme = themeId;
        }
        elements.plaunaRoot.querySelectorAll('.plauna-theme-btn').forEach((btn) => {
            btn.classList.toggle('plauna-btn--theme-active', btn.dataset.theme === themeId);
        });
        elements.plaunaRoot.querySelector('#design-badge').textContent = `Active: ${state.activeDesign} · ${label}`;
        renderOverview();
        state.toastManager?.show(`Switched to ${label} theme`, 'success');
        logger.info('Theme changed', { theme: themeId });
    }

    function runLiveMeasure() {
        if (!state.plaunaApp) return;
        const input = elements.plaunaRoot.querySelector('#pretext-input');
        const sizeEl = elements.plaunaRoot.querySelector('#pretext-size');
        const weightEl = elements.plaunaRoot.querySelector('#pretext-weight');
        const widthEl = elements.plaunaRoot.querySelector('#pretext-width');
        if (!input || !sizeEl || !weightEl || !widthEl) return;

        const text = input.value || '';
        const fontSize = parseInt(sizeEl.value, 10);
        const fontWeight = parseInt(weightEl.value, 10);
        const containerWidth = parseInt(widthEl.value, 10);
        const lineHeight = Math.round(fontSize * 1.45);

        try {
            const handle = state.plaunaApp.textService.prepare(text, {
                fontFamily: 'Inter',
                fontSize,
                fontWeight,
                lineHeight
            });
            const metrics = state.plaunaApp.textService.measure(handle);
            const layout = state.plaunaApp.textService.layout(handle, containerWidth);

            const set = (id, val) => {
                const el = elements.plaunaRoot.querySelector(id);
                if (el) el.textContent = val;
            };
            set('#pm-width', `${Math.round(layout.width)}px`);
            set('#pm-lines', String(layout.lineCount));
            set('#pm-height', `${Math.round(layout.height)}px`);
            set('#pm-ascent', metrics.ascent != null ? `${metrics.ascent.toFixed(1)}px` : '--');
            set('#pm-descent', metrics.descent != null ? `${metrics.descent.toFixed(1)}px` : '--');
            set('#pm-baseline', `${layout.metrics.baseline.toFixed(1)}px`);

            const track = elements.plaunaRoot.querySelector('#pretext-ruler-track');
            const textEl = elements.plaunaRoot.querySelector('#pretext-ruler-text');
            const labelEl = elements.plaunaRoot.querySelector('#pretext-ruler-label');
            const cacheChip = elements.plaunaRoot.querySelector('#pretext-cache-chip');
            const previewStage = elements.plaunaRoot.querySelector('#pretext-preview-stage');
            const previewLines = elements.plaunaRoot.querySelector('#pretext-preview-lines');
            const previewParticles = elements.plaunaRoot.querySelector('#pretext-preview-particles');
            if (track) {
                track.style.width = '100%';
                track.style.maxWidth = `${containerWidth}px`;
            }
            if (textEl) {
                textEl.style.width = `${Math.min(Math.round(layout.width), containerWidth)}px`;
            }
            if (labelEl) labelEl.textContent = `${containerWidth}px container · ${layout.lineCount} lines`;
            if (cacheChip) cacheChip.textContent = `Cache: ${state.plaunaApp.textService.measureCache.size} entries`;
            if (previewStage && previewLines && previewParticles) {
                previewStage.style.width = `${containerWidth}px`;
                previewStage.style.height = `${Math.max(120, layout.height + 28)}px`;
                previewLines.innerHTML = '';
                initializePretextParticles(previewParticles, state);

                const leftInset = 14;
                const topInset = 14;
                state.pretextObstacles = [];
                const lineEntries = [];

                layout.lines.forEach((line, index) => {
                    const lineHandle = state.plaunaApp.textService.prepare(line, {
                        fontFamily: 'Inter',
                        fontSize,
                        fontWeight,
                        lineHeight
                    });
                    const lineMetrics = state.plaunaApp.textService.measure(lineHandle);
                    const lineWidth = Math.min(containerWidth - leftInset * 2, Math.max(8, Math.ceil(lineMetrics.width)));
                    const lineElement = document.createElement('div');
                    lineElement.className = 'plauna-pretext-line';
                    lineElement.textContent = line;
                    lineElement.style.left = `${leftInset}px`;
                    lineElement.style.top = `${topInset + index * lineHeight}px`;
                    lineElement.style.width = `${lineWidth}px`;
                    lineElement.style.height = `${lineHeight}px`;
                    lineElement.style.fontSize = `${fontSize}px`;
                    lineElement.style.fontWeight = String(fontWeight);
                    lineElement.style.lineHeight = `${lineHeight}px`;
                    previewLines.appendChild(lineElement);
                    lineEntries.push({
                        text: line,
                        width: lineWidth,
                        left: leftInset,
                        top: topInset + index * lineHeight
                    });
                });

                state.pretextMask = buildPretextMask({
                    lines: lineEntries,
                    containerWidth,
                    fontSize,
                    fontWeight,
                    lineHeight
                });

                state.pretextParticles.forEach((particle, index) => {
                    if (!state.pretextMask || state.pretextMask.contourPoints.length === 0) {
                        particle.targetX = leftInset + randomBetween(0, Math.max(20, containerWidth - leftInset * 2));
                        particle.targetY = topInset + randomBetween(0, Math.max(20, lineHeight));
                        return;
                    }

                    const point = state.pretextMask.contourPoints[index % state.pretextMask.contourPoints.length];
                    particle.targetX = point.x + randomBetween(-3, 3);
                    particle.targetY = point.y + randomBetween(-3, 3);
                });
            }
        } catch (err) {
            logger.error('Live pretext measure failed', { message: err?.message });
        }
    }

    function toggleAutoCycle() {
        const PRESETS = DESIGN_PRESETS.map((p) => p.id);
        if (state.autoCycle) {
            clearInterval(state.autoCycleTimer);
            state.autoCycle = false;
            const btn = elements.plaunaRoot.querySelector('#auto-cycle-btn');
            if (btn) { btn.textContent = '\u25b6 Auto'; btn.classList.remove('plauna-btn--active'); }
            renderOverview();
            return;
        }
        state.autoCycle = true;
        const btn = elements.plaunaRoot.querySelector('#auto-cycle-btn');
        if (btn) { btn.textContent = '\u23f8 Auto'; btn.classList.add('plauna-btn--active'); }
        let cycleIndex = PRESETS.indexOf(state.activeDesign);
        state.autoCycleTimer = setInterval(() => {
            cycleIndex = (cycleIndex + 1) % PRESETS.length;
            updateActiveDesign(PRESETS[cycleIndex]);
        }, 3000);
        renderOverview();
    }

    function onRootClick(event) {
        if (destroyed) return;
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const action = target.dataset.action;
        const design = target.dataset.design;
        const themeId = target.dataset.theme;
        try {
            if (action === 'auto-cycle') toggleAutoCycle();
            else if (themeId) applyTheme(themeId);
            else if (design) updateActiveDesign(design);
        } catch (error) {
            logger.error('Plauna test action failed', { action: action || design, message: error?.message || String(error) });
            state.toastManager?.show(error?.message || 'Action failed', 'error');
        }
    }

    function onWindowResize() {
        if (destroyed) return;
        refreshStageBounds();
        backdrop.resize();
        updateActiveDesign(state.activeDesign);
    }

    function onDocumentPointerMove(event) {
        if (destroyed) return;
        const peekZone = 42;
        const settleDelayMs = 120;
        const slowSpeedThreshold = 0.06;
        const now = performance.now();
        const intent = state.pointerIntent;
        const dt = Math.max(1, now - (intent.lastTime || now));
        const dx = event.clientX - intent.lastX;
        const dy = event.clientY - intent.lastY;
        intent.speed = Math.hypot(dx, dy) / dt;
        intent.lastX = event.clientX;
        intent.lastY = event.clientY;
        intent.lastTime = now;

        const nearBottom = window.innerHeight - event.clientY <= peekZone;
        if (!nearBottom) {
            clearTimeout(intent.settleTimer);
            setConsolePeek(false);
            return;
        }

        clearTimeout(intent.settleTimer);
        if (intent.speed <= slowSpeedThreshold) {
            intent.settleTimer = window.setTimeout(() => {
                if (!destroyed && state.pointerIntent.speed <= slowSpeedThreshold) {
                    setConsolePeek(true);
                }
            }, settleDelayMs);
            return;
        }
        setConsolePeek(false);
    }

    function onDrawerPointerEnter() { if (!destroyed) setConsolePeek(true); }
    function onDrawerPointerLeave() { if (!destroyed) setConsolePeek(false); }
    function onRootInput() { if (!destroyed) runLiveMeasure(); }
    function onRootChange(event) {
        if (!destroyed && event.target.closest('#pretext-panel')) runLiveMeasure();
    }

    function attachInteractions() {
        if (destroyed || interactionsAttached) return false;
        interactionsAttached = true;
        listen(root, 'click', onRootClick);
        listen(window, 'resize', onWindowResize);
        listen(document, 'pointermove', onDocumentPointerMove);
        listen(elements.consoleDrawer, 'pointerenter', onDrawerPointerEnter);
        listen(elements.consoleDrawer, 'pointerleave', onDrawerPointerLeave);
        listen(elements.plaunaRoot, 'input', onRootInput);
        listen(elements.plaunaRoot, 'change', onRootChange);
        return true;
    }

    function boot() {
        if (destroyed) return Promise.reject(lifecycleError());
        if (booted) return Promise.resolve(true);
        if (bootPromise) return bootPromise;
        const generation = ++lifecycleGeneration;
        let tracked;
        tracked = bootGeneration(generation).finally(() => {
            if (bootPromise === tracked) bootPromise = null;
        });
        bootPromise = tracked;
        return tracked;
    }

    async function bootGeneration(generation) {
        await backdrop.initialize();
        assertLifecycle(generation);
        refreshStageBounds();
        renderPretextPanel(elements.plaunaRoot);
        renderWidgetGallery(elements.plaunaRoot, state.toastManager);
        renderOverview();
        attachInteractions();
        animate();
        await initializeDemo();
        assertLifecycle(generation);
        await measureSample();
        assertLifecycle(generation);
        runLiveMeasure();
        updateActiveDesign(state.activeDesign);
        state.smokeReport = await runSmokeTests(generation);
        assertLifecycle(generation);
        booted = true;
        logger.info('Plauna test harness ready');
        return true;
    }

    return {
        boot,
        destroy() {
            if (destroyed) return false;
            destroyed = true;
            booted = false;
            lifecycleGeneration += 1;
            if (state.rafId) cancelAnimationFrame(state.rafId);
            state.rafId = 0;
            if (state.autoCycleTimer) clearInterval(state.autoCycleTimer);
            state.autoCycleTimer = null;
            detachInteractions();
            backdrop.destroy();
            state.toastManager?.destroy?.();
            try { state.plaunaApp?.destroy?.(); } catch (_) {}
            state.plaunaApp = null;
            destroyWorkbenchRenderer(rendererOwner);
            return true;
        },
        initializeDemo,
        measureSample,
        createSurfaceSample,
        runSmokeTests,
        getSelfCheckReport,
        updateActiveDesign
    };
}
