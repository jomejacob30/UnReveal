/**
 * content.js — Runs in ISOLATED world at document_idle
 *
 * Architecture:
 *   1. Defines a two-layer CSS payload:
 *        A) Broad universal rule — strips blur/text-security from ANY element
 *           whose inline style or computed style applies them.  Catches sites
 *           that rotate class names on every deploy.
 *        B) Surgical class rules from debug logs for known targets.
 *   2. Recursively walks the DOM to find all shadow roots — open ones natively,
 *      closed ones via the property set by intercept.js.
 *   3. Injects the CSS into every discovered shadow root AND the main document.
 *   4. Attaches a MutationObserver inside each shadow root so dynamically
 *      rendered content is caught immediately.
 *   5. Listens for the custom event dispatched by intercept.js for real-time
 *      new shadow root attachment.
 *   6. Runs a periodic rescan every 3 s for the first 30 s to handle
 *      lazy-loaded / paginated content that appears well after idle.
 */

(function () {
  'use strict';

  const PROP_KEY = '__unblur_shadow_root__';
  const INJECTED_ATTR = 'data-unreveal-injected';
  const processedRoots = new WeakSet();

  // ─────────────────────────────────────────────────────────────────────────
  // CSS payload
  // ─────────────────────────────────────────────────────────────────────────

  const UNBLUR_CSS = `
    /* ── LAYER 1: Universal fallback ─────────────────────────────────────── */
    /* Catches any element with inline blur — class-name-rotation-proof.     */
    [style*="filter"][style*="blur"],
    [style*="-webkit-filter"][style*="blur"],
    [style*="text-security"],
    [style*="-webkit-text-security"] {
      filter: none !important;
      -webkit-filter: none !important;
      -webkit-text-security: none !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
                   Roboto, Helvetica, Arial, sans-serif !important;
      color: inherit !important;
      opacity: 1 !important;
    }

    /* ── LAYER 2: Surgical rules targeting known classes ─────────────────── */

    /* A) Strip filters from target elements and known containers */
    span.fc6omth,
    span.f18ev72d,
    strong.f1t69bad,
    strong.fp3q8eq,
    .base_f1hmg4t3,
    .base_f15zcxmp,
    .holder_fkhz08q {
      filter: none !important;
      -webkit-filter: none !important;
      backdrop-filter: none !important;
      -webkit-backdrop-filter: none !important;
      opacity: 1 !important;
      text-shadow: none !important;
      mask-image: none !important;
      -webkit-mask-image: none !important;
      clip-path: none !important;
      -webkit-text-security: none !important;
      user-select: text !important;
      -webkit-user-select: text !important;
    }

    /* B) Nuke pseudo-element overlays on blur-suspect classes */
    span.fc6omth::before,
    span.fc6omth::after,
    span.f18ev72d::before,
    span.f18ev72d::after,
    strong.f1t69bad::before,
    strong.f1t69bad::after,
    strong.fp3q8eq::before,
    strong.fp3q8eq::after,
    .base_f1hmg4t3::before,
    .base_f1hmg4t3::after {
      display: none !important;
      content: none !important;
      backdrop-filter: none !important;
      filter: none !important;
      background: transparent !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }

    /* C) Override redacted / obfuscation fonts */
    span.fc6omth.medium_fwla7bl.f18ev72d,
    strong.f1t69bad.medium_fwla7bl,
    strong.fp3q8eq.medium_fwla7bl {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
                   Roboto, Helvetica, Arial, sans-serif !important;
    }

    /* D) Force visibility on zero-width spacer siblings */
    span.f1on6otw.fdogkuf,
    span.flj7yxn.fdogkuf {
      display: inline !important;
      width: auto !important;
      overflow: visible !important;
    }
  `;

  // ─────────────────────────────────────────────────────────────────────────
  // Style injection
  // ─────────────────────────────────────────────────────────────────────────

  function injectStyles(root) {
    if (!root) return;

    // For the main document inject into <head>; for shadow roots inject
    // directly into the root node itself.
    const container = root === document ? document.head : root;
    if (!container) return;

    // Avoid double-injection.
    if (container.querySelector(`style[${INJECTED_ATTR}]`)) return;

    const style = document.createElement('style');
    style.setAttribute(INJECTED_ATTR, 'true');
    style.textContent = UNBLUR_CSS;
    container.appendChild(style);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DOM traversal helpers
  // ─────────────────────────────────────────────────────────────────────────

  function getShadowRoot(el) {
    // Open shadow roots are on .shadowRoot; closed ones are stored by intercept.js.
    return el.shadowRoot || el[PROP_KEY] || null;
  }

  function attachObserver(root) {
    if (processedRoots.has(root)) return;
    processedRoots.add(root);

    const observerTarget = root === document ? document.body : root;
    if (!observerTarget) return;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            processElement(node);
          }
        }
      }
    });

    observer.observe(observerTarget, { childList: true, subtree: true });
  }

  function processElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return;

    const shadow = getShadowRoot(el);
    if (shadow) {
      injectStyles(shadow);
      attachObserver(shadow);

      // Recurse into the shadow tree.
      for (const child of shadow.querySelectorAll('*')) {
        const childShadow = getShadowRoot(child);
        if (childShadow) processElement(child);
      }
    }

    // Recurse into light-DOM children (catches nested custom elements).
    for (const child of el.children) {
      const childShadow = getShadowRoot(child);
      if (childShadow) processElement(child);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Full-page scan
  // ─────────────────────────────────────────────────────────────────────────

  function fullScan() {
    injectStyles(document);
    attachObserver(document);

    for (const el of document.querySelectorAll('*')) {
      processElement(el);
    }

    // Also process hosts that were registered before document_idle.
    const registry = window.__unblur_shadow_hosts__;
    if (Array.isArray(registry)) {
      for (const ref of registry) {
        const host = typeof ref.deref === 'function' ? ref.deref() : ref;
        if (host) processElement(host);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Real-time new shadow root listener (from intercept.js)
  // ─────────────────────────────────────────────────────────────────────────

  document.addEventListener('__unblur_shadow_attached__', (e) => {
    if (e.target && e.target.nodeType === Node.ELEMENT_NODE) {
      processElement(e.target);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Bootstrap
  // ─────────────────────────────────────────────────────────────────────────

  fullScan();
  console.log('[UnReveal] content.js initialized — full scan complete');

  // Periodic rescans for the first 30 s to catch late-loading / paginated content.
  let elapsed = 0;
  const INTERVAL_MS = 3000;
  const MAX_ELAPSED_MS = 30000;

  const intervalId = setInterval(() => {
    fullScan();
    elapsed += INTERVAL_MS;
    if (elapsed >= MAX_ELAPSED_MS) {
      clearInterval(intervalId);
      console.log('[UnReveal] Periodic rescans complete');
    }
  }, INTERVAL_MS);

})();
