// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * Shared constants, presets, lab state and theme helpers for the Plauna workbench lab.
 * Split out of lab/workbench-lab.js.
 */

import { uniformDistribution } from '../../../engine/core/math/MathRandom.js';

const PARTICLE_COUNT = 240;
export const PRETEXT_PARTICLE_COUNT = 96;
const OUTLINE_COUNT = 6;
const STYLE_HREF = new URL('../../styles/plauna.css', import.meta.url).href;
export const AUTO_SAMPLE_TEXT = 'Plauna should measure dense UI copy without a hidden DOM probe.';

export const DESIGN_PRESETS = [
    {
        id: 'editor',
        title: 'Workbench',
        summary: 'Closest to the editor shell. Split panes, utility density, stable navigation.',
        metric: '3 zones',
        detail: 'Inspector + center document + diagnostics',
        outlineHint: 'Split docked layout',
        panels: [
            { label: 'Tools', tone: 'accent', x: 0.02, y: 0.08, w: 0.2, h: 0.76 },
            { label: 'Viewport', tone: '', x: 0.25, y: 0.08, w: 0.5, h: 0.76 },
            { label: 'Inspect', tone: 'warning', x: 0.78, y: 0.08, w: 0.2, h: 0.48 },
            { label: 'Console', tone: 'success', x: 0.25, y: 0.87, w: 0.73, h: 0.11 }
        ]
    },
    {
        id: 'command',
        title: 'Command Deck',
        summary: 'Top-heavy control bar and a single narrative workspace. Good for focused tools.',
        metric: '1 flow',
        detail: 'Actions first, content second, logs pinned',
        outlineHint: 'Single-story focus',
        panels: [
            { label: 'Commands', tone: 'warning', x: 0.04, y: 0.08, w: 0.92, h: 0.16 },
            { label: 'Primary', tone: 'accent', x: 0.04, y: 0.3, w: 0.92, h: 0.48 },
            { label: 'Output', tone: 'success', x: 0.04, y: 0.83, w: 0.92, h: 0.13 }
        ]
    },
    {
        id: 'cards',
        title: 'Card Matrix',
        summary: 'Feature dashboard with modular cards. Better for browsing and snapshots.',
        metric: '6 cards',
        detail: 'Parallel previews, less docked chrome',
        outlineHint: 'Parallel dashboard tiles',
        panels: [
            { label: 'Hero', tone: 'accent', x: 0.04, y: 0.08, w: 0.92, h: 0.16 },
            { label: 'Card A', tone: 'success', x: 0.04, y: 0.31, w: 0.28, h: 0.24 },
            { label: 'Card B', tone: '', x: 0.36, y: 0.31, w: 0.28, h: 0.24 },
            { label: 'Card C', tone: 'warning', x: 0.68, y: 0.31, w: 0.28, h: 0.24 },
            { label: 'Card D', tone: '', x: 0.04, y: 0.62, w: 0.28, h: 0.24 },
            { label: 'Card E', tone: 'accent', x: 0.36, y: 0.62, w: 0.28, h: 0.24 },
            { label: 'Card F', tone: 'success', x: 0.68, y: 0.62, w: 0.28, h: 0.24 }
        ]
    }
];

export function randomBetween(min, max) {
    return uniformDistribution(min, max, Math.random);
}

export function getPreset(presetId) {
    return DESIGN_PRESETS.find((item) => item.id === presetId) || DESIGN_PRESETS[0];
}

export function ensureStyles() {
    if (document.querySelector('link[data-plauna-styles="1"]')) {
        return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = STYLE_HREF;
    link.dataset.plaunaStyles = '1';
    document.head.appendChild(link);
}

export function createLabState(elements, logger) {
    const outlines = [];
    const particles = [];
    const uiLayer = elements.plaunaRoot.querySelector('#layout-stage-ui');
    const particleLayer = elements.plaunaRoot.querySelector('#particle-layer');
    const stageElement = elements.plaunaRoot.querySelector('#layout-stage');

    for (let index = 0; index < OUTLINE_COUNT; index += 1) {
        const outline = document.createElement('div');
        outline.className = 'plauna-stage__outline';
        outline.style.opacity = '0';
        outline.innerHTML = '<span class="plauna-stage__label"></span>';
        uiLayer.appendChild(outline);
        outlines.push(outline);
    }

    for (let index = 0; index < PARTICLE_COUNT; index += 1) {
        const particle = document.createElement('div');
        particle.className = 'plauna-stage__particle';
        const x = randomBetween(0, stageElement.clientWidth || 600);
        const y = randomBetween(0, stageElement.clientHeight || 320);
        particle.style.transform = `translate3d(${x}px, ${y}px, 0) scale(1)`;
        particleLayer.appendChild(particle);
        particles.push({
            element: particle,
            x,
            y,
            vx: randomBetween(-8, 8),
            vy: randomBetween(-8, 8),
            targetX: x,
            targetY: y,
            jitter: randomBetween(0.8, 1.7),
            phase: randomBetween(0, Math.PI * 2),
            scale: randomBetween(0.7, 1.45),
            pressure: 0,
            slither: randomBetween(-1, 1)
        });
    }

    logger.info('Plauna lab shell mounted', { particles: particles.length, outlines: outlines.length });
    return {
        outlines,
        particles,
        pretextParticles: [],
        pretextObstacles: [],
        pretextMask: null,
        stageRect: { width: 0, height: 0 },
        particleObstacles: [],
        activeDesign: 'editor',
        activeTheme: 'dark',
        lastLayout: null,
        lastSurface: null,
        plaunaApp: null,
        toastManager: null,
        rafId: 0,
        consolePeek: false,
        autoCycle: false,
        autoCycleTimer: 0,
        fps: 0,
        fpsFrames: 0,
        fpsLastTime: 0,
        pointerIntent: {
            lastX: 0,
            lastY: 0,
            lastTime: 0,
            speed: Infinity,
            settleTimer: 0
        }
    };
}

export function applyThemeVariables(target, themeTokens) {
    if (!target || !themeTokens || !themeTokens.colors) {
        return;
    }

    const colors = themeTokens.colors;
    const shadows = themeTokens.shadows || {};
    const variables = {
        '--bg-primary': colors.background && colors.background.primary,
        '--bg-secondary': colors.background && colors.background.secondary,
        '--bg-tertiary': colors.background && colors.background.tertiary,
        '--bg-quaternary': colors.background && colors.background.inverse,
        '--text-primary': colors.text && colors.text.primary,
        '--text-secondary': colors.text && colors.text.secondary,
        '--text-muted': colors.text && colors.text.tertiary,
        '--border-subtle': colors.background && colors.background.tertiary,
        '--border-medium': colors.text && colors.text.disabled,
        '--accent-primary': colors.primary && colors.primary[500],
        '--accent-secondary': colors.primary && colors.primary[300],
        '--accent-warning': colors.warning,
        '--accent-error': colors.error,
        '--shadow-md': shadows.md,
        '--shadow-lg': shadows.lg
    };

    for (const [name, value] of Object.entries(variables)) {
        if (value) {
            target.style.setProperty(name, value);
        }
    }
}

// Global reference to the themed modal styles function
let globalCreateThemedModalStyles = null;

// The mounted lab installs its theme-aware style source here
export function setThemedModalStylesSource(source) {
    globalCreateThemedModalStyles = source;
}

// Global wrapper function for demo functions to access
export function createThemedModalStyles() {
    if (globalCreateThemedModalStyles) {
        try {
            const result = globalCreateThemedModalStyles();
            // Ensure the result has all required properties
            if (!result.spacing || !result.borderRadius) {
                console.warn('Theme result missing properties, using fallback');
                return getFallbackTheme();
            }
            return result;
        } catch (error) {
            console.error('Error getting theme:', error);
            return getFallbackTheme();
        }
    }
    // Fallback if not initialized yet
    return getFallbackTheme();
}

// Helper function for fallback theme
function getFallbackTheme() {
    return {
        background: 'rgba(15, 23, 42, 0.95)',
        border: 'rgba(99, 116, 141, 0.3)',
        text: '#e4e4e7',
        textSecondary: '#94a3b8',
        accent: '#3b82f6',
        accentHover: '#60a5fa',
        colors: {
            background: { primary: '#0f172a', secondary: '#1e293b', tertiary: '#334155', inverse: '#ffffff' },
            text: { primary: '#f8fafc', secondary: '#cbd5e1', tertiary: '#64748b', disabled: '#475569' },
            primary: { 500: '#3b82f6', 300: '#93c5fd' },
            warning: '#f59e0b',
            error: '#ef4444',
            success: '#10b981'
        },
        spacing: { xs: '4px', sm: '8px', md: '16px', lg: '24px', xl: '32px', xxxl: '48px' },
        borderRadius: { sm: '4px', md: '8px', lg: '12px', xl: '16px' },
        fontSizes: { xs: '12px', sm: '14px', md: '16px', lg: '18px', xl: '20px' },
        fontWeights: { normal: '400', medium: '500', semibold: '600', bold: '700' }
    };
}
