/**
 * content.js — Runs in ISOLATED world at document_idle
 *
 * Architecture:
 *   1. Defines a surgical CSS payload targeting the exact classes from
 *      the debug logs, plus defensive rules for pseudo-elements,
 *      redacted fonts, and -webkit-text-security.
 *   2. Recursively walks the DOM to find all shadow roots (open ones
 *      natively, closed ones via the property set by intercept.js).
 *   3. Injects the CSS into every discovered shadow root.
 *   4. Attaches a MutationObserver INSIDE each shadow root (not just
 *      document.body) so dynamically rendered content is caught.
 *   5. Listens for the custom event from intercept.js for real-time
 *      new shadow root attachment.
 */

(function () {
  'use strict';

  // ─── Configuration ──────────────────────────────────────────────

  // Property name set by intercept.js on shadow hosts
  const PROP_KEY = '__unblur_shadow_root__';

  // Marker attribute to prevent duplicate style injection
  const INJECTED_ATTR = 'data-unblur-injected';

  // Track processed roots to avoid duplicate observers
  const processedRoots = new WeakSet();

  // ─── CSS Payload ────────────────────────────────────────────────
  //
  // This CSS is designed to defeat FOUR distinct blur techniques:
  //   A) CSS filter / backdrop-filter on element or ancestors
  //   B) Pseudo-element overlays (::before / ::after with backdrop-filter)
  //   C) Redacted / obfuscation fonts (custom font-face that renders blobs)
  //   D) -webkit-text-security (renders chars as discs/circles)
  //
  // Selectors target the exact classes found in your debug session.
  // The universal fallback (*) is intentionally avoided to prevent
  // breaking icon fonts and page layout.

  const UNBLUR_CSS = `
    /* ── A) Strip filters from target elements and known containers ── */
    span.fc6omth,
    span.f18ev72d,
    strong.f1t69bad,
    strong.fp3q8eq,
    .base_f1hmg4t3,
    .base_f15zcxmp,
    .holder_fkhz08q,
    .ftgla1i {
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

    /* ── B) Nuke pseudo-element overlays on blur-suspect classes ── */
    span.fc6omth::before,
    span.fc6omth::after,
    span.f18ev72d::before,
    span.f18ev72d::after,
    strong.f1t69bad::before,
    strong.f1t69bad::after,
    strong.fp3q8eq::before,
    strong.fp3q8eq::after,
    .base_f1hmg4t3::before,
    .base_f1hmg4t3::after,
    .ftgla1i::before,
    .ftgla1i::after {
      display: none !important;
      content: none !important;
      backdrop-filter: none !important;
      filter: none !important;
      background: transparent !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }

    /* ── C) Override redacted / obfuscation fonts ── */
    /* Scoped ONLY to the blur-suspect spans, not globally */
    span.fc6omth.medium_fwla7bl.f18ev72d,
    strong.f1t69bad.medium_fwla7bl,
    strong.fp3q8eq.medium_fwla7bl {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
                   Roboto, Helvetica, Arial, sans-serif !important;
    }

    /* ── D) Force visibility on zero-width spacer siblings ── */
    span.f1on6otw.fdogkuf,
    span.flj7yxn.fdogkuf {
      display: inline !important;
      width: auto !important;
      overflow: visible !important;
    }
  `;

  // ─── Core Functions ─────────────────────────────────────────────

  /**
   * Injects the unblur CSS into a shadow root or document.
   * Idempotent: skips if already injected.
   */
  function injectStyles(root) {
    if (!root) return;

    // For shadow roots, check the marker attribute on a style tag
    // For document, check document.head
    const target = root === document ? document.head : root;
    if (!target) return;

    // Prevent double injection
    if (target.querySelector?.(`style[${INJECTED_ATTR}]`)) return;

    const style = document.createElement('style');
    style.setAttribute(INJECTED_ATTR, 'true');
    style.textContent = UNBLUR_CSS;
    target.appendChild(style);
  }

  /**
   * Attaches a MutationObserver to a root (document or shadow root)
   * that watches for new child elements and processes them.
   */
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

    observer.observe(observerTarget, {
      childList: true,
      subtree: true,
    });
  }

  /**
   * Gets the shadow root from an element, trying:
   *   1. Native .shadowRoot (works for open mode)
   *   2. The property set by intercept.js (works for closed mode)
   */
  function getShadowRoot(el) {
    return el.shadowRoot || el[PROP_KEY] || null;
  }

  /**
   * Processes a single element:
   *   - Checks if it's a shadow host
   *   - If so, injects styles and attaches an observer inside
   *   - Recursively processes children within that shadow root
   */
  function processElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return;

    const shadow = getShadowRoot(el);
    if (shadow) {
      injectStyles(shadow);
      attachObserver(shadow);

      // Recurse into shadow root's children
      const children = shadow.querySelectorAll('*');
      for (const child of children) {
        processElement(child);
      }
    }

    // Also check light DOM children (they might be shadow hosts too)
    if (el.children) {
      for (const child of el.children) {
        processElement(child);
      }
    }
  }

  /**
   * Full DOM scan: walks the entire document tree looking for
   * shadow hosts. Called once at startup and can be re-called
   * if needed.
   */
  function fullScan() {
    // Inject into the main document first
    injectStyles(document);
    attachObserver(document);

    // Walk every element in the document
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      processElement(el);
    }

    // Also check the registry from intercept.js for closed roots
    const registry = window.__unblur_shadow_hosts__;
    if (Array.isArray(registry)) {
      for (const ref of registry) {
        const host = ref.deref?.();
        if (host) processElement(host);
      }
    }
  }

  // ─── Event Listener for Real-Time Shadow Attachment ─────────────
  //
  // intercept.js dispatches '__unblur_shadow_attached__' on the host
  // element whenever attachShadow is called. We listen for it here
  // so newly created shadow roots get processed immediately, without
  // waiting for the MutationObserver cycle.

  document.addEventListener('__unblur_shadow_attached__', (e) => {
    if (e.target && e.target.nodeType === Node.ELEMENT_NODE) {
      processElement(e.target);
    }
  });

  // ─── Startup ────────────────────────────────────────────────────

  fullScan();
  console.log('[Unblur] Content script initialized — full scan complete');

  // Re-scan after a short delay to catch late-loading frameworks
  setTimeout(fullScan, 1500);
  setTimeout(fullScan, 4000);

})();
