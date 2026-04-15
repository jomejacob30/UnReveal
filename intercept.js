/**
 * intercept.js — Runs in MAIN world at document_start
 *
 * Patches Element.prototype.attachShadow before any page script runs so that
 * closed shadow roots are captured and made accessible to content.js.
 *
 * Responsibilities:
 *   1. Intercept every attachShadow call (open AND closed).
 *   2. Store the shadow root on the host element under a well-known property
 *      so content.js can retrieve it from the ISOLATED world via the same key.
 *   3. Maintain a WeakRef registry (window.__unblur_shadow_hosts__) for the
 *      initial full scan performed by content.js.
 *   4. Dispatch a composed custom event on the host so content.js MutationObserver
 *      can react in real-time to shadow roots attached after document_idle.
 */

(function () {
  'use strict';

  const PROP_KEY = '__unblur_shadow_root__';

  // Initialise registry before any page script can clobber it.
  if (!Array.isArray(window.__unblur_shadow_hosts__)) {
    window.__unblur_shadow_hosts__ = [];
  }

  const _attachShadow = Element.prototype.attachShadow;

  Element.prototype.attachShadow = function attachShadow(init) {
    const shadow = _attachShadow.call(this, init);

    // Expose the shadow root regardless of mode so content.js can read it.
    try {
      Object.defineProperty(this, PROP_KEY, {
        value: shadow,
        configurable: true,
        writable: true,
      });
    } catch (_) {
      // Property already defined — update it.
      this[PROP_KEY] = shadow;
    }

    // Keep a weak reference so content.js can enumerate all hosts on first scan.
    window.__unblur_shadow_hosts__.push(new WeakRef(this));

    // Notify content.js immediately (composed: true crosses shadow boundaries).
    try {
      this.dispatchEvent(
        new CustomEvent('__unblur_shadow_attached__', {
          bubbles: true,
          composed: true,
        })
      );
    } catch (_) {
      // Dispatch can fail on detached nodes — safe to ignore.
    }

    return shadow;
  };

  // Also patch attachInternals in case a site uses it to defer shadow creation.
  // (No-op if not supported.)
  const _attachInternals = Element.prototype.attachInternals;
  if (typeof _attachInternals === 'function') {
    Element.prototype.attachInternals = function attachInternals() {
      const internals = _attachInternals.call(this);
      // Some browsers expose shadowRoot via internals after the fact;
      // re-expose it when available.
      const host = this;
      const originalGetter = Object.getOwnPropertyDescriptor(
        ElementInternals.prototype,
        'shadowRoot'
      )?.get;
      if (originalGetter) {
        Object.defineProperty(internals, 'shadowRoot', {
          get() {
            const sr = originalGetter.call(internals);
            if (sr) host[PROP_KEY] = sr;
            return sr;
          },
          configurable: true,
        });
      }
      return internals;
    };
  }

  console.log('[UnReveal] intercept.js active — attachShadow patched');
})();
