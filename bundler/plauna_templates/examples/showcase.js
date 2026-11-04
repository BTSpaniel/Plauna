// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
// SPDX-License-Identifier: MIT

const root = document.querySelector('#root');
const status = document.querySelector('#status');
const runtime = new URL(location.href).searchParams.get('runtime') || 'source';
let showcase = null;
let closed = false;
let booting = false;

function dispose() {
  showcase?.destroy();
  showcase = null;
  delete globalThis.plaunaShowcase;
}

addEventListener('pagehide', event => {
  // A cached page keeps its live gallery for the next history traversal.
  if (event.persisted) return;
  closed = true;
  if (!booting) dispose();
});

try {
  let api;
  if (runtime === 'source') {
    api = await import('../index.js');
  } else if (runtime === 'compiled') {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('../dist/plauna.js', import.meta.url).href;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Cannot load ${script.src}`));
      document.head.append(script);
    });
    api = globalThis.Plauna;
  } else {
    throw new Error('Choose ?runtime=source or ?runtime=compiled.');
  }
  if (typeof api?.mountShowcaseApp !== 'function') throw new Error('Plauna showcase API is unavailable.');
  if (!closed) {
    showcase = api.mountShowcaseApp({ root, statusElement: status, logger: console });
    booting = true;
    await showcase.boot();
    await showcase.gallery.surface.ready;
    booting = false;
    if (closed) dispose();
    else {
      globalThis.plaunaShowcase = showcase;
      document.documentElement.dataset.plaunaShowcase = 'ready';
      document.documentElement.dataset.plaunaRuntime = runtime;
    }
  }
} catch (error) {
  booting = false;
  dispose();
  document.documentElement.dataset.plaunaShowcase = 'error';
  status.style.display = '';
  status.textContent = `Showcase failed: ${error.message}`;
  console.error('[Plauna showcase]', error);
}
