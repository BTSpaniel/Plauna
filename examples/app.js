// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: MIT

const runtime = document.body.dataset.runtime;
const shell = document.querySelector('#example');
shell.className = 'shell';
shell.innerHTML = `
  <header class="masthead"><a class="brand" href="./"><span class="mark">P</span>Plauna</a><span class="version" id="version">Loading runtime</span></header>
  <section class="intro"><p class="eyebrow">PARTICLE ENGINE · UI LIBRARY</p><h1>Your interface.<br><span>DOM or WebGPU.</span></h1><p class="lede">The same retained widgets, state, and native interaction. Change the rendering mode without rebuilding your application.</p></section>
  <section aria-label="Interactive Plauna example">
    <div class="toolbar"><label for="render-mode">Render mode <select id="render-mode"><option value="dom">DOM</option><option value="gpu">GPU</option><option value="auto">Auto</option></select></label><output class="active-mode" id="active-mode">Active: DOM</output><span class="spacer"></span><button class="quiet-button" id="theme" type="button">Switch theme</button><button class="quiet-button" id="release" type="button">Release resources</button></div>
    <div id="plauna-host"></div>
  </section>
  <section class="details" aria-label="How this example works"><div class="detail"><h2>01 / Retained widgets</h2><p>The counter and buttons are Plauna widgets in a VisualTree. Click or use Tab and Enter.</p></div><div class="detail"><h2>02 / Honest mode reporting</h2><p>GPU mode can fall back to DOM. The active mode above reports what the surface is using.</p></div><div class="detail"><h2>03 / Explicit ownership</h2><p>Release destroys the app and its visual tree. Reload the page to start again.</p></div></section>
  <p class="status" id="status" role="status">Initializing the application…</p>
  <footer><span class="runtime-tag" id="runtime-label"></span><span>Plauna v0.3.0-alpha · <a href="../README.md">Documentation</a> · <a href="https://github.com/BTSpaniel/Plauna">GitHub</a></span></footer>`;

const status = document.querySelector('#status');
const modeSelect = document.querySelector('#render-mode');
const activeMode = document.querySelector('#active-mode');
const themeButton = document.querySelector('#theme');
const releaseButton = document.querySelector('#release');
const host = document.querySelector('#plauna-host');
const listeners = new AbortController();
let app = null;
let released = false;
let modeObserver = null;

function report(message, error = false) {
  status.textContent = message;
  status.dataset.error = String(error);
  if (error) console.error('[Plauna example]', message);
}

function updateMode() {
  if (released || !app) return;
  const mode = app.getRenderMode();
  activeMode.textContent = `Active: ${mode.active.toUpperCase()}`;
  if (mode.requested === 'gpu' && mode.active === 'dom') {
    report('GPU was requested; the surface is using its DOM fallback. Inspect the browser console for GPU availability or rendering errors.');
  } else {
    report(`${runtime === 'compiled' ? 'Compiled API' : 'Source modules'} ready. Requested ${mode.requested}; active ${mode.active}.`);
  }
}

function release() {
  if (released) return;
  released = true;
  listeners.abort();
  modeObserver?.disconnect();
  app?.destroy();
  app?.visualTree.destroy();
  host.replaceChildren();
  modeSelect.disabled = themeButton.disabled = releaseButton.disabled = true;
  activeMode.textContent = 'Released';
  report('Resources released. Reload this page to initialize another application.');
  console.info('[Plauna example] Owned application and visual tree released.');
}

function releaseOnExit(event) {
  if (!event.persisted) release();
}

try {
  const api = runtime === 'compiled' ? globalThis.Plauna : await import('../index.js');
  if (!api || typeof api.createPlaunaApp !== 'function') {
    throw new Error('The public Plauna API did not load. Serve the complete export over HTTP.');
  }
  const { createPlaunaApp, UINode, Button, Text, PLAUNA_FULL } = api;
  document.querySelector('#version').textContent = PLAUNA_FULL;
  document.querySelector('#runtime-label').textContent = runtime === 'compiled' ? 'DIST / PLAUNA.JS' : 'SOURCE / INDEX.JS';
  app = await createPlaunaApp({ root: host, renderMode: 'dom', theme: 'dark', enableSmartContextMenu: false, consoleOptions: { showPanel: false } });

  const panel = new UINode('demo-panel', 'section');
  panel.setStyles({ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '18px', padding: '4px', width: '100%' });
  const label = new Text('demo-label', { content: 'A SMALL INTERACTION, TWO RENDERERS', variant: 'caption' });
  label.setStyles({ color: '#a99dd0', fontSize: '11px', letterSpacing: '1.5px' });
  const count = new Text('demo-count', { content: '0 interactions' });
  count.setStyles({ fontSize: '38px', lineHeight: '1.2', fontWeight: '600', color: 'var(--text-primary, #f2f5ff)' });
  count.ariaLive = 'polite';
  const description = new Text('demo-description', { content: 'Click the button. Change the renderer. Your count stays with the UI.' });
  description.setStyles({ fontSize: '13px', color: 'var(--text-secondary, #a0aec6)' });
  const actions = new UINode('demo-actions', 'div');
  actions.setStyles({ display: 'flex', gap: '12px', flexWrap: 'wrap' });
  let interactions = 0;
  const increment = new Button('demo-increment', { text: 'Add an interaction', onClick: () => { count.setText(`${++interactions} interaction${interactions === 1 ? '' : 's'}`); } });
  const reset = new Button('demo-reset', { text: 'Reset', variant: 'secondary', onClick: () => { interactions = 0; count.setText('0 interactions'); } });
  actions.appendChild(increment);
  actions.appendChild(reset);
  for (const node of [label, count, description, actions]) panel.appendChild(node);
  app.visualTree.setRoot(panel);
  app.domRenderer.render(app.visualTree);

  modeObserver = new MutationObserver(updateMode);
  modeObserver.observe(host, { subtree: true, attributes: true, attributeFilter: ['data-render-mode'] });
  modeSelect.addEventListener('change', async () => {
    modeSelect.disabled = true;
    report(`Requesting ${modeSelect.value} rendering…`);
    try { await app.setRenderMode(modeSelect.value); updateMode(); }
    catch (error) { report(error.message, true); }
    finally { if (!released) modeSelect.disabled = false; }
  }, { signal: listeners.signal });
  themeButton.addEventListener('click', async () => {
    themeButton.disabled = true;
    try { await app.toggleTheme(); if (!released) report(`Theme: ${app.currentThemeId}.`); }
    catch (error) { report(error.message, true); }
    finally { if (!released) themeButton.disabled = false; }
  }, { signal: listeners.signal });
  releaseButton.addEventListener('click', release, { signal: listeners.signal });
  addEventListener('pagehide', releaseOnExit, { signal: listeners.signal });
  updateMode();
  console.info('[Plauna example] Ready.', { runtime, version: PLAUNA_FULL });
} catch (error) {
  report(error.stack || error.message, true);
  modeSelect.disabled = themeButton.disabled = true;
  releaseButton.addEventListener('click', release, { once: true });
  addEventListener('pagehide', releaseOnExit, { signal: listeners.signal });
}
