/**
 * intercept.js — Runs in MAIN world at document_start
 *
 * Strategy (based on DevTools analysis of Grammarly's DOM):
 *
 * Structure inside GRAMMARLY-POPUPS shadow root:
 *   .overlayContainer.fkf0s66
 *   ├── .obscuredContent.f1ll759f   ← has the REAL text, but blurred
 *   │   ├── .ftgla1i                ← filter: blur(6px) applied here
 *   │   │   └── [suggestion text]
 *   │   └── .overlay.f1a2899a      ← white haze overlay, opacity: 0.1
 *   └── .visibleContent.f2wnt2z    ← EMPTY (Grammarly withholds for free users)
 *
 * Fix:
 *   1. Remove blur from .ftgla1i
 *   2. Hide the white overlay (.f1a2899a)
 *   3. Clone obscured content into visibleContent so it renders on top
 *   4. Watch via MutationObserver so it works every time the popup opens
 */

(function () {
  'use strict';

  const PROP_KEY     = '__unblur_shadow_root__';
  const REGISTRY_KEY = '__unblur_shadow_hosts__';
  const INJECTED_ATTR = 'data-unblur-injected';

  window[REGISTRY_KEY] = window[REGISTRY_KEY] || [];

  // ─── CSS Payload ────────────────────────────────────────────────────

  const UNBLUR_CSS = `
    .ftgla1i {
      filter: none !important;
      -webkit-filter: none !important;
    }
    .overlay.f1a2899a,
    .f1a2899a.fqa53j6.f1fbtb6x {
      opacity: 0 !important;
      display: none !important;
    }
    .obscuredContent.f1ll759f {
      filter: none !important;
      -webkit-filter: none !important;
    }
    span.fc6omth,
    span.f18ev72d,
    strong.f1t69bad,
    strong.fp3q8eq,
    .base_f1hmg4t3,
    .base_f15zcxmp,
    .holder_fkhz08q,
    .visibleContent,
    .f2wnt2z {
      filter: none !important;
      -webkit-filter: none !important;
      backdrop-filter: none !important;
      opacity: 1 !important;
      -webkit-text-security: none !important;
      user-select: text !important;
    }
    span.fc6omth.medium_fwla7bl.f18ev72d,
    strong.f1t69bad.medium_fwla7bl,
    strong.fp3q8eq.medium_fwla7bl {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
                   Roboto, Helvetica, Arial, sans-serif !important;
    }
  `;

  // ─── CSS Injection ───────────────────────────────────────────────────

  function injectCSS(shadowRoot) {
    if (!shadowRoot) return;
    if (shadowRoot.querySelector(`style[${INJECTED_ATTR}]`)) return;
    const style = document.createElement('style');
    style.setAttribute(INJECTED_ATTR, 'true');
    style.textContent = UNBLUR_CSS;
    shadowRoot.appendChild(style);
  }

  // ─── Direct Blur Removal ─────────────────────────────────────────────
  // CSS may lose specificity battles. Direct inline style always wins.

  function removeBlurFromElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return;

    const computed = window.getComputedStyle(el);

    // Remove any blur filter
    if (computed.filter && computed.filter.includes('blur')) {
      el.style.setProperty('filter', 'none', 'important');
      el.style.setProperty('-webkit-filter', 'none', 'important');
    }

    // Hide white haze overlays
    if (el.classList.contains('f1a2899a') || el.classList.contains('f1fbtb6x')) {
      el.style.setProperty('opacity', '0', 'important');
      el.style.setProperty('display', 'none', 'important');
    }
  }

  // ─── Content Reveal ──────────────────────────────────────────────────
  // visibleContent is empty; obscuredContent has the real text.
  // Clone obscuredContent's inner text into visibleContent.

  function revealContent(shadowRoot) {
    const overlayContainer = shadowRoot.querySelector('.overlayContainer.fkf0s66');
    if (!overlayContainer) return;

    const obscured = overlayContainer.querySelector('.obscuredContent.f1ll759f');
    const visible  = overlayContainer.querySelector('.visibleContent.f2wnt2z');
    if (!obscured || !visible) return;

    // Remove blur from .ftgla1i inside obscured
    const blurTarget = obscured.querySelector('.ftgla1i');
    if (blurTarget) {
      blurTarget.style.setProperty('filter', 'none', 'important');
      blurTarget.style.setProperty('-webkit-filter', 'none', 'important');
    }

    // Hide white overlay inside obscured
    obscured.querySelectorAll('.overlay, .f1a2899a').forEach(el => {
      el.style.setProperty('opacity', '0', 'important');
      el.style.setProperty('display', 'none', 'important');
    });

    // If visibleContent is empty, clone obscured content into it
    if (!visible.hasChildNodes() && obscured.hasChildNodes()) {
      const clone = obscured.querySelector('.ftgla1i');
      if (clone) {
        const copy = clone.cloneNode(true);
        copy.style.setProperty('filter', 'none', 'important');
        visible.appendChild(copy);
      }
    }
  }

  // ─── Full Shadow Root Processing ─────────────────────────────────────

  function processShadowRoot(shadowRoot) {
    if (!shadowRoot) return;

    // 1. Inject CSS
    injectCSS(shadowRoot);

    // 2. Scan all elements and remove blur inline
    shadowRoot.querySelectorAll('*').forEach(removeBlurFromElement);

    // 3. Attempt content reveal for Grammarly popup structure
    revealContent(shadowRoot);

    // 4. Watch for dynamically added content inside this shadow root
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            removeBlurFromElement(node);
            node.querySelectorAll?.('*').forEach(removeBlurFromElement);
            // Re-attempt reveal when new nodes arrive
            revealContent(shadowRoot);
          }
        }
      }
    });

    observer.observe(shadowRoot, { childList: true, subtree: true });
  }

  // ─── attachShadow Override ────────────────────────────────────────────

  const originalAttachShadow = Element.prototype.attachShadow;

  Element.prototype.attachShadow = function (init) {
    const shadowRoot = originalAttachShadow.call(this, init);

    // Process immediately
    processShadowRoot(shadowRoot);

    // Store reference for content.js
    Object.defineProperty(this, PROP_KEY, {
      value: shadowRoot,
      configurable: false,
      enumerable: false,
      writable: false
    });

    window[REGISTRY_KEY].push(new WeakRef(this));

    this.dispatchEvent(
      new CustomEvent('__unblur_shadow_attached__', { bubbles: true })
    );

    return shadowRoot;
  };

  console.log('[Unblur] intercept.js loaded — attachShadow overridden with full unblur logic');
})();
