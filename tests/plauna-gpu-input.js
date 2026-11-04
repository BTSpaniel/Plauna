// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: LicenseRef-ParticleRealms-Alpha

/**
 * Fixture for tests/test_plauna_gpu_input.py: widgets in a GPU-mode render
 * surface, driven with real mouse, keyboard and wheel input. Exposes
 * globalThis.fixture once the surface paints.
 */

import { widgetRegistry } from '../plauna/widgets/index.js';
import { widgetRenderer } from '../plauna/widgets/WidgetRenderer.js';
import { themeLoader } from '../plauna/themes/ThemeLoader.js';
import { RenderSurface } from '../plauna/render/index.js';

await themeLoader.apply('dark');
const mode = new URL(location.href).searchParams.get('mode') || 'gpu';
const surface = new RenderSurface({ mode });
document.getElementById('stage').appendChild(surface.element);

const make = (id, options) => {
    const Widget = widgetRegistry.get(id);
    const instance = new Widget(`input-${id}`, options);
    const element = widgetRenderer.render(instance);
    const row = document.createElement('div');
    row.style.cssText = 'padding:8px 0';
    row.appendChild(element);
    surface.scene.appendChild(row);
    return instance;
};

const checkbox = make('checkbox', { label: 'Enable shadows', checked: false });
const field = make('input-field', { label: 'Scene name', placeholder: 'Untitled scene' });
const button = make('button', { text: 'Save', variant: 'primary' });
let clicks = 0;
button.addEventListener('click', () => { clicks++; });
const scroller = document.createElement('div');
scroller.id = 'scroller';
scroller.style.cssText = 'height:80px;overflow-y:auto;border:1px solid #445;';
scroller.innerHTML = Array.from({ length: 20 }, (_, i) => `<div style="height:24px;padding:2px 6px">Row ${i + 1}</div>`).join('');
surface.scene.appendChild(scroller);
const chip = document.createElement('span');
chip.className = 'chip';
chip.textContent = 'Hover me';
const chipRow = document.createElement('div');
chipRow.style.cssText = 'padding:8px 0';
chipRow.appendChild(chip);
surface.scene.appendChild(chipRow);
widgetRenderer.flush();
await surface.ready;
await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

/**
 * Page-coordinate box of an element where it is painted: Plauna's own layout
 * in GPU mode (what the canvas shows), the browser's in DOM mode.
 */
function rect(element) {
    const box = surface.layout?.boxes.get(element);
    if (!box) {
        const r = element.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height };
    }
    const origin = surface.element.getBoundingClientRect();
    return { x: origin.left + box.absX, y: origin.top + box.absY, width: box.width, height: box.height };
}

function settle() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function centre(element) {
    const r = rect(element);
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

globalThis.fixture = {
    surface,
    mode: () => surface.activeMode,
    checkbox: () => {
        const element = surface.scene.querySelector('[role="checkbox"]');
        return { checked: checkbox.checked, centre: centre(element), rect: rect(element) };
    },
    field: () => {
        const input = surface.scene.querySelector('input');
        return { value: input.value, focused: document.activeElement === input, centre: centre(input), rect: rect(input) };
    },
    button: () => {
        const element = surface.scene.querySelector('button');
        return { clicks, centre: centre(element), rect: rect(element) };
    },
    scroller: () => ({ scrollTop: scroller.scrollTop, centre: centre(scroller), rect: rect(scroller) }),
    chip: () => ({ hovered: chip.matches(':hover'), centre: centre(chip), rect: rect(chip) }),
    active: () => document.activeElement?.tagName || null,
    frames: () => surface.stats.frames,
    settle,
    // Mounts a circular progress (an SVG under a CSS rotate) and resolves true once its raster is in the atlas
    circularProgress: async () => {
        make('progress', { type: 'circular', value: 60, size: 'lg', showPercentage: false });
        widgetRenderer.flush();
        for (let i = 0; i < 120; i++) {
            await settle();
            if ([...surface.painter.atlas.entries.keys()].some((key) => key.startsWith('v|'))) return true;
        }
        return false;
    }
};
document.documentElement.dataset.fixture = 'ready';
