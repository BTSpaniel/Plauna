// SPDX-FileCopyrightText: 2026 Jake Wehmeier (BTSpaniel) <https://github.com/BTSpaniel>
//
// SPDX-License-Identifier: MIT

/**
 * ShowcaseApp - Thin shell that boots Plauna (PlaunaDevShell over PlaunaApp)
 * and mounts the WidgetGallery. The app's own smart context menu inspects
 * the previews.
 */

import { PlaunaDevShell } from '../boot.js';
import { Toast } from '../ui/ToastManager.js';
import { Notify } from '../notifications/NotificationSystem.js';
import { WidgetGallery } from '../ui/WidgetGallery.js';

export class ShowcaseApp {
  constructor(options = {}) {
    this.root = options.root || document.getElementById('root');
    this.statusElement = options.statusElement || null;
    this.logger = options.logger || null;
    this.shell = null;
    this.gallery = null;
  }

  async boot() {
    try {
      this._status('Booting Plauna...');

      this.shell = await PlaunaDevShell.boot(this.root, {
        logger: this.logger,
        enableSmartContextMenu: true
      });

      this._status('Mounting widget gallery...');

      Toast.initialize({ position: 'top-right', maxToasts: 5, defaultDuration: 4000 });
      Notify.initialize({ enableToasts: true, enableConsole: true, enableSounds: false, minLevel: 'info' });

      this.gallery = new WidgetGallery(this.shell);
      this.gallery.mount(this.root);

      this._status(null);

    } catch (error) {
      if (this.logger) this.logger.error('Failed to boot:', error);
      this._status(`Error: ${error.message}`, true);
      throw error;
    }
  }

  get smartContextMenu() {
    return this.shell?.app?.smartContextMenu ?? null;
  }

  _status(msg, isError = false) {
    const el = this.statusElement;
    if (!el) return;
    if (msg === null) {
      el.style.display = 'none';
    } else {
      el.style.display = '';
      el.textContent = msg;
      if (isError) el.style.color = '#ef4444';
    }
  }

  destroy() {
    this.gallery?.destroy?.();
    this.gallery = null;

    if (typeof Toast.dismissAll === 'function') {
      Toast.dismissAll();
    }

    this.shell?.destroy();
    this.shell = null;

    if (this.root) this.root.innerHTML = '';
  }
}

export function mountShowcaseApp(options = {}) {
  return new ShowcaseApp(options);
}
