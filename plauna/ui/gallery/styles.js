// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * The widget showcase's style sheet. It styles through the theme's CSS
 * variables, so a theme switch restyles the showcase too. The page content
 * is laid out and painted by Plauna itself in GPU mode, so it keeps to what
 * Plauna's style and layout engine supports (longhand backgrounds, grid,
 * flex, generated content, state selectors, media queries).
 */

export const GALLERY_STYLE_ID = 'plauna-gallery-styles';

export const GALLERY_CSS = `
#plauna-gallery {
    --pg-topbar-height: 56px;
    display: grid;
    grid-template-columns: 264px minmax(0, 1fr);
    grid-template-rows: auto minmax(0, 1fr);
    min-height: 100vh;
    background-color: var(--bg-primary);
    color: var(--text-primary);
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    font-size: 14px;
    line-height: 1.5;
}
#plauna-gallery *, #plauna-gallery *::before, #plauna-gallery *::after { box-sizing: border-box; }
#plauna-gallery [hidden] { display: none !important; }

/* Top bar */
.pg-topbar {
    grid-column: 1 / -1;
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px 16px;
    min-height: var(--pg-topbar-height);
    padding: 8px 20px;
    background-color: var(--bg-secondary);
    border-bottom: 1px solid var(--border-light);
}
.pg-brand { display: flex; align-items: baseline; gap: 10px; color: var(--text-primary); text-decoration: none; white-space: nowrap; }
.pg-brand-mark {
    display: inline-flex; align-items: center; justify-content: center;
    width: 26px; height: 26px; align-self: center;
    border-radius: 8px;
    background-image: linear-gradient(135deg, var(--color-primary), var(--color-info));
    color: var(--text-inverse); font-weight: 700; font-size: 14px;
}
.pg-brand-name { font-size: 16px; font-weight: 650; letter-spacing: -0.01em; }
.pg-brand-sub { font-size: 12px; color: var(--text-tertiary); }
.pg-search { position: relative; flex: 1 1 200px; max-width: 380px; }
.pg-search input {
    width: 100%; padding: 6px 34px 6px 32px;
    background-color: var(--bg-tertiary); color: var(--text-primary);
    border: 1px solid var(--border-medium); border-radius: var(--border-radius-md);
    font: inherit; font-size: 13px; outline: none;
}
.pg-search input:focus { border-color: var(--color-primary); }
.pg-search-icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--text-tertiary); font-size: 13px; pointer-events: none; }
.pg-search kbd {
    position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
    padding: 0 6px; border: 1px solid var(--border-medium); border-radius: 4px;
    font: 11px/18px ui-monospace, 'Cascadia Code', Consolas, monospace; color: var(--text-tertiary);
}
.pg-tools { margin-left: auto; display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.pg-tool-label { font-size: 11px; color: var(--text-tertiary); text-transform: uppercase; letter-spacing: 0.06em; }
.pg-segmented {
    display: inline-flex; padding: 2px; gap: 2px;
    background-color: var(--bg-tertiary);
    border: 1px solid var(--border-medium); border-radius: var(--border-radius-md);
}
.pg-segmented button {
    border: 0; border-radius: 4px; padding: 3px 10px;
    background-color: transparent; color: var(--text-secondary);
    font: inherit; font-size: 12px; font-weight: 500; cursor: pointer;
}
.pg-segmented button:hover { color: var(--text-primary); }
.pg-segmented button[aria-pressed="true"] { background-color: var(--color-primary); color: var(--text-inverse); }
.pg-mode-status {
    display: inline-block; width: 92px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font: 11px/1.4 ui-monospace, 'Cascadia Code', Consolas, monospace; color: var(--text-tertiary);
}
.pg-render-stats {
    position: fixed; right: 16px; bottom: 40px; z-index: var(--z-overlay); pointer-events: none;
    padding: 3px 8px; border: 1px solid var(--border-light); border-radius: var(--border-radius-md);
    background-color: var(--bg-secondary); color: var(--text-tertiary);
    font: 11px/1.5 ui-monospace, 'Cascadia Code', Consolas, monospace;
}
.pg-select {
    padding: 4px 8px; background-color: var(--bg-tertiary); color: var(--text-primary);
    border: 1px solid var(--border-medium); border-radius: var(--border-radius-md);
    font: inherit; font-size: 12px; cursor: pointer;
}
.pg-menu-button {
    display: none; align-items: center; justify-content: center;
    width: 32px; height: 32px; border: 1px solid var(--border-medium); border-radius: var(--border-radius-md);
    background-color: var(--bg-tertiary); color: var(--text-primary); font-size: 16px; cursor: pointer;
}

/* Sidebar */
.pg-sidebar {
    position: sticky;
    top: var(--pg-topbar-height);
    align-self: start;
    height: calc(100vh - var(--pg-topbar-height));
    overflow-y: auto;
    padding: 14px 10px 48px;
    background-color: var(--bg-secondary);
    border-right: 1px solid var(--border-light);
}
.pg-nav-section { margin-top: 14px; }
.pg-nav-heading {
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 10px 4px; font-size: 11px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-tertiary);
}
.pg-nav-list { list-style: none; margin: 0; padding: 0; }
.pg-nav-link {
    display: flex; align-items: center; gap: 8px;
    padding: 4px 10px; border-radius: var(--border-radius-md);
    border-left: 2px solid transparent;
    color: var(--text-secondary); text-decoration: none; font-size: 13px;
}
.pg-nav-link:hover { background-color: var(--bg-tertiary); color: var(--text-primary); }
.pg-nav-link[aria-current="page"] { background-color: var(--bg-tertiary); border-left-color: var(--color-primary); color: var(--color-primary); font-weight: 600; }
.pg-nav-icon { width: 18px; text-align: center; flex-shrink: 0; overflow: hidden; white-space: nowrap; }
.pg-nav-count { margin-left: auto; font-size: 11px; color: var(--text-tertiary); }
.pg-nav-empty { padding: 12px 10px; color: var(--text-tertiary); font-size: 13px; }

/* Content */
#plauna-gallery-surface { min-width: 0; }
#plauna-gallery-content { padding: 28px 32px 160px; max-width: 1320px; }
#plauna-gallery-content a { color: var(--color-primary); }
.pg-eyebrow { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-primary); }
.pg-lead { margin: 8px 0 0; max-width: 68ch; color: var(--text-secondary); font-size: 15px; }
.pg-error { font-size: 12px; color: var(--color-error); }
.pg-note { font-size: 12px; color: var(--text-tertiary); }

/* Overview */
.pg-hero { padding: 6px 0 4px; }
.pg-hero h1 { margin: 6px 0 0; font-size: 30px; line-height: 1.2; letter-spacing: -0.02em; }
.pg-stats { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 20px; }
.pg-stat {
    min-width: 132px; padding: 10px 14px;
    background-color: var(--bg-secondary); border: 1px solid var(--border-light); border-radius: var(--border-radius-lg);
}
.pg-stat-value { display: block; font-size: 22px; font-weight: 650; color: var(--text-primary); }
.pg-stat-label { font-size: 12px; color: var(--text-tertiary); }
.pg-category { margin-top: 36px; }
.pg-category-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 12px; margin-bottom: 14px; }
.pg-category-head h2 { margin: 0; font-size: 18px; }
.pg-category-head p { margin: 0; color: var(--text-tertiary); font-size: 13px; }
.pg-card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(232px, 1fr)); gap: 14px; }
.pg-card {
    position: relative; display: flex; flex-direction: column; min-width: 0;
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-light); border-radius: var(--border-radius-lg);
    overflow: hidden;
    transition: border-color var(--transition-fast), box-shadow var(--transition-fast);
}
.pg-card:hover { border-color: var(--color-primary); box-shadow: var(--shadow-md); }
.pg-card .plauna-story-preview {
    height: 128px; padding: 16px; overflow: hidden;
    display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 8px;
    background-color: var(--bg-primary); border-bottom: 1px solid var(--border-light);
}
.pg-card-body { display: flex; flex-direction: column; gap: 2px; padding: 10px 14px 12px; }
.pg-card-title { display: flex; align-items: center; gap: 8px; font-weight: 600; color: var(--text-primary); text-decoration: none; }
#plauna-gallery-content .pg-card-title { color: var(--text-primary); }
.pg-card-title::after { content: ''; position: absolute; inset: 0; }
.pg-card-desc { font-size: 12px; color: var(--text-tertiary); }
.pg-card-meta { font-size: 11px; color: var(--text-tertiary); }

/* Widget page */
.pg-crumbs { display: flex; gap: 6px; font-size: 12px; color: var(--text-tertiary); }
#plauna-gallery-content .pg-crumbs a { color: var(--text-tertiary); text-decoration: none; }
#plauna-gallery-content .pg-crumbs a:hover { color: var(--color-primary); }
.pg-title { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
.pg-title h1 { margin: 0; font-size: 28px; line-height: 1.2; letter-spacing: -0.02em; }
.pg-title-icon {
    display: inline-flex; align-items: center; justify-content: center;
    width: 40px; height: 40px; border-radius: 10px; font-size: 20px; overflow: hidden; white-space: nowrap;
    background-color: var(--bg-tertiary); border: 1px solid var(--border-light);
}
.pg-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 12px; }
.pg-pill {
    display: inline-flex; align-items: center; padding: 1px 8px;
    border: 1px solid var(--border-medium); border-radius: 999px;
    font-size: 11px; color: var(--text-secondary); background-color: var(--bg-secondary);
}
code.pg-pill { font-family: ui-monospace, 'Cascadia Code', Consolas, monospace; }
.pg-section-title { display: flex; align-items: baseline; gap: 10px; margin: 32px 0 12px; font-size: 16px; }
.pg-section-title span { font-size: 12px; font-weight: 400; color: var(--text-tertiary); }

.pg-playground-main { display: flex; flex-direction: column; min-width: 0; }
#plauna-story-picker { flex-wrap: wrap; }
.pg-tooltip-trigger {
    padding: 8px 14px; border: 1px solid var(--border-medium); border-radius: var(--border-radius-md);
    background-color: var(--bg-tertiary); color: var(--text-primary); font: inherit; cursor: pointer;
}
.pg-playground { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; margin-top: 22px; align-items: start; }
.pg-panel {
    display: flex; flex-direction: column; min-width: 0;
    background-color: var(--bg-secondary);
    border: 1px solid var(--border-light); border-radius: var(--border-radius-lg);
    overflow: hidden;
}
.pg-panel-head {
    display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;
    padding: 8px 12px; border-bottom: 1px solid var(--border-light);
}
.pg-panel-title { font-size: 13px; font-weight: 600; }
.pg-stage-tools { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.pg-canvas {
    display: flex; align-items: center; justify-content: center;
    min-height: 240px; padding: 36px 24px;
    background-color: var(--bg-primary);
}
.pg-canvas[data-background="grid"] {
    background-color: var(--bg-secondary);
    background-image: repeating-conic-gradient(var(--bg-tertiary) 0% 25%, var(--bg-primary) 0% 50%);
    background-size: 20px 20px;
}
.pg-canvas .plauna-story-preview {
    display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 12px;
    width: 100%; min-height: 48px;
}
.pg-canvas[data-width="768"] .plauna-story-preview { max-width: 768px; outline: 1px dashed var(--border-medium); outline-offset: 12px; }
.pg-canvas[data-width="390"] .plauna-story-preview { max-width: 390px; outline: 1px dashed var(--border-medium); outline-offset: 12px; }
.plauna-story-preview[data-for="skeleton"] { align-items: flex-start; justify-content: flex-start; }
.pg-controls-body { display: flex; flex-direction: column; }
.pg-field-group { display: flex; flex-direction: column; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--border-light); }
.pg-field-group h3 { margin: 0; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-tertiary); }
.pg-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.pg-field-label { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--text-secondary); }
.pg-field-label code { font: 11px ui-monospace, 'Cascadia Code', Consolas, monospace; color: var(--text-tertiary); }
.pg-choice { display: flex; flex-wrap: wrap; gap: 6px; }
.pg-json { display: flex; flex-direction: column; gap: 4px; }
.pg-json-note { font-size: 11px; color: var(--text-tertiary); }
.pg-json-note[data-state="invalid"] { color: var(--color-error); }
.pg-dock { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 16px; margin-top: 16px; }
.pg-code {
    margin: 0; padding: 12px 14px; overflow-x: auto; white-space: pre;
    font: 12px/1.6 ui-monospace, 'Cascadia Code', Consolas, monospace;
    color: var(--text-secondary); background-color: var(--bg-primary);
}
.pg-actions { list-style: none; margin: 0; padding: 6px 0; height: 196px; overflow-y: auto; background-color: var(--bg-primary); }
.pg-actions li { display: flex; gap: 10px; padding: 2px 14px; font: 12px/1.6 ui-monospace, 'Cascadia Code', Consolas, monospace; color: var(--text-secondary); }
.pg-actions time { color: var(--text-tertiary); }
.pg-actions b { color: var(--color-primary); font-weight: 600; }
.pg-actions-empty { padding: 12px 14px; font-size: 12px; color: var(--text-tertiary); }
.pg-text-button {
    border: 0; padding: 2px 6px; border-radius: 4px; background-color: transparent;
    color: var(--color-primary); font: inherit; font-size: 12px; cursor: pointer;
}
.pg-text-button:hover { background-color: var(--bg-tertiary); }

.pg-story-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.pg-story { display: flex; flex-direction: column; min-width: 0; background-color: var(--bg-secondary); border: 1px solid var(--border-light); border-radius: var(--border-radius-lg); }
.pg-story-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 8px 6px 14px; border-bottom: 1px solid var(--border-light); }
.pg-story-name { font-size: 12px; font-weight: 600; color: var(--text-secondary); }
.pg-story .plauna-story-preview {
    display: flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 10px;
    min-height: 112px; padding: 20px;
}

@media (max-width: 1180px) {
    .pg-playground { grid-template-columns: minmax(0, 1fr); }
    .pg-dock { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 820px) {
    #plauna-gallery { grid-template-columns: minmax(0, 1fr); }
    .pg-topbar { position: static; padding: 8px 16px; }
    .pg-menu-button { display: inline-flex; }
    .pg-brand-sub, .pg-tool-label, .pg-mode-status { display: none; }
    .pg-search { order: 3; flex-basis: 100%; max-width: none; }
    .pg-tools { margin-left: auto; }
    .pg-sidebar {
        position: fixed; left: 0; top: 0; bottom: 0; z-index: var(--z-overlay);
        width: 280px; height: auto; padding-top: 20px;
        transform: translateX(-100%);
        transition: transform var(--transition-base);
    }
    #plauna-gallery[data-nav-open] .pg-sidebar { transform: none; box-shadow: var(--shadow-xl); }
    #plauna-gallery-content { padding: 20px 16px 120px; }
    .pg-hero h1 { font-size: 24px; }
    .pg-title h1 { font-size: 22px; }
}
`;

/** Add the showcase's style sheet to `doc` once. */
export function installGalleryStyles(doc = document) {
    let style = doc.getElementById(GALLERY_STYLE_ID);
    if (!style) {
        style = doc.createElement('style');
        style.id = GALLERY_STYLE_ID;
        style.textContent = GALLERY_CSS;
        doc.head.appendChild(style);
    }
    return style;
}
