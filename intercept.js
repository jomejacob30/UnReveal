/**
 * intercept.js — MAIN world, document_start
 *
 * Senior approach: make text directly selectable inside the popup.
 * No floating panel. No cloning. Native browser text selection.
 *
 * Grammarly blocks selection with 3 layers:
 *   1. CSS user-select:none        → override with !important
 *   2. selectstart preventDefault  → intercept in capture phase first
 *   3. mousedown clears selection  → intercept in capture phase first
 *
 * Since we run at document_start and intercept attachShadow itself,
 * our capture-phase listeners are registered BEFORE Grammarly's —
 * stopImmediatePropagation() prevents theirs from ever firing.
 */

(function () {
  'use strict';

  const PROP_KEY      = '__unblur_shadow_root__';
  const REGISTRY_KEY  = '__unblur_shadow_hosts__';
  const INJECTED_ATTR = 'data-unblur-injected';
  const processedRoots = new WeakSet();

  window[REGISTRY_KEY] = window[REGISTRY_KEY] || [];

  // ─── CSS ───────────────────────────────────────────────────────────────

  const UNBLUR_CSS = `
    /* Strip blur */
    .ftgla1i, .obscuredContent, .f1ll759f {
      filter: none !important;
      -webkit-filter: none !important;
    }
    /* Make everything inside selectable */
    .ftgla1i *, .obscuredContent *, .f1ll759f *,
    .ftgla1i, .obscuredContent, .f1ll759f,
    span.fc6omth, span.f18ev72d, strong.f1t69bad, strong.fp3q8eq,
    .base_f1hmg4t3, .base_f15zcxmp, .holder_fkhz08q,
    .visibleContent, .f2wnt2z, .visibleContent *, .f2wnt2z * {
      user-select: text !important;
      -webkit-user-select: text !important;
      pointer-events: auto !important;
      cursor: text !important;
      filter: none !important;
      -webkit-filter: none !important;
      opacity: 1 !important;
      -webkit-text-security: none !important;
    }
    /* Hide white haze overlay */
    .overlay.f1a2899a, .f1a2899a {
      opacity: 0 !important;
      pointer-events: none !important;
    }
    /* Fix obfuscated fonts */
    span.fc6omth.medium_fwla7bl, strong.f1t69bad.medium_fwla7bl,
    strong.fp3q8eq.medium_fwla7bl {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
                   Roboto, Helvetica, Arial, sans-serif !important;
    }
  `;

  // ─── CSS Injection ─────────────────────────────────────────────────────

  function injectCSS(root) {
    if (!root || root.querySelector?.(`style[${INJECTED_ATTR}]`)) return;
    const style = document.createElement('style');
    style.setAttribute(INJECTED_ATTR, 'true');
    style.textContent = UNBLUR_CSS;
    try { root.appendChild(style); } catch (e) {}
  }

  // ─── Direct Blur Removal ───────────────────────────────────────────────

  function unblurElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
    try {
      const f = window.getComputedStyle(el).filter || '';
      if (f !== 'none' && f.includes('blur')) {
        el.style.setProperty('filter', 'none', 'important');
        el.style.setProperty('-webkit-filter', 'none', 'important');
        el.style.setProperty('user-select', 'text', 'important');
        el.style.setProperty('-webkit-user-select', 'text', 'important');
        el.style.setProperty('pointer-events', 'auto', 'important');
        el.style.setProperty('cursor', 'text', 'important');
      }
      if (el.classList?.contains('f1a2899a')) {
        el.style.setProperty('opacity', '0', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
      }
    } catch (e) {}
  }

  // ─── Grammarly Reveal ──────────────────────────────────────────────────

  function revealGrammarly(root) {
    if (!root) return;
    try {
      root.querySelectorAll('.overlayContainer, .fkf0s66').forEach(container => {
        const obscured = container.querySelector('.obscuredContent, .f1ll759f');
        const visible  = container.querySelector('.visibleContent, .f2wnt2z');
        if (!obscured) return;

        // Remove blur from the text container
        const blurEl = obscured.querySelector('.ftgla1i');
        if (blurEl) {
          blurEl.style.setProperty('filter', 'none', 'important');
          blurEl.style.setProperty('user-select', 'text', 'important');
          blurEl.style.setProperty('-webkit-user-select', 'text', 'important');
          blurEl.style.setProperty('pointer-events', 'auto', 'important');
          blurEl.style.setProperty('cursor', 'text', 'important');
          // Apply to all children
          blurEl.querySelectorAll('*').forEach(c => {
            c.style.setProperty('user-select', 'text', 'important');
            c.style.setProperty('-webkit-user-select', 'text', 'important');
            c.style.setProperty('pointer-events', 'auto', 'important');
            c.style.setProperty('cursor', 'text', 'important');
          });
        }

        // Hide haze overlay
        obscured.querySelectorAll('.overlay, .f1a2899a').forEach(el => {
          el.style.setProperty('opacity', '0', 'important');
          el.style.setProperty('pointer-events', 'none', 'important');
        });

        // Clone into empty visibleContent
        if (visible && !visible.hasChildNodes() && blurEl) {
          const copy = blurEl.cloneNode(true);
          copy.style.setProperty('filter', 'none', 'important');
          copy.querySelectorAll('*').forEach(c => {
            c.style.setProperty('user-select', 'text', 'important');
            c.style.setProperty('-webkit-user-select', 'text', 'important');
            c.style.setProperty('pointer-events', 'auto', 'important');
            c.style.setProperty('cursor', 'text', 'important');
          });
          visible.appendChild(copy);
        }
      });
    } catch (e) {}
  }

  // ─── THE KEY FIX: Event Interception ──────────────────────────────────
  //
  // Grammarly attaches selectstart + mousedown listeners to block selection.
  // We intercept these events in CAPTURE PHASE (which runs before Grammarly's
  // listeners) and call stopImmediatePropagation() so Grammarly never sees them.
  //
  // We only do this when the event originates inside Grammarly's popup,
  // so we don't interfere with the rest of the page.

  function isInGrammarlyPopup(target) {
    if (!target) return false;
    // Walk up the composed path to check for grammarly-popups host
    try {
      const path = target.composedPath ? target.composedPath() : [];
      return path.some(el =>
        el.tagName === 'GRAMMARLY-POPUPS' ||
        el.tagName === 'GRAMMARLY-MIRROR' ||
        (el.classList && (
          el.classList.contains('ftgla1i') ||
          el.classList.contains('obscuredContent') ||
          el.classList.contains('f1ll759f') ||
          el.classList.contains('visibleContent') ||
          el.classList.contains('f2wnt2z')
        ))
      );
    } catch (e) {
      return false;
    }
  }

  function installDocumentInterceptors() {
    // selectstart: Grammarly calls preventDefault() here to block selection.
    // We stop it from reaching Grammarly's listener entirely.
    document.addEventListener('selectstart', (e) => {
      if (isInGrammarlyPopup(e.target)) {
        e.stopImmediatePropagation();
        // Do NOT call preventDefault — let browser selection proceed normally
      }
    }, true); // true = capture phase

    // mousedown: Grammarly uses this to clear any active selection.
    document.addEventListener('mousedown', (e) => {
      if (isInGrammarlyPopup(e.target)) {
        e.stopImmediatePropagation();
        // Do NOT call preventDefault — let normal focus/click proceed
      }
    }, true);

    // copy: ensure Ctrl+C works inside the popup
    document.addEventListener('copy', (e) => {
      if (isInGrammarlyPopup(e.target)) {
        e.stopImmediatePropagation();
      }
    }, true);

    // contextmenu: allow right-click → Copy inside popup
    document.addEventListener('contextmenu', (e) => {
      if (isInGrammarlyPopup(e.target)) {
        e.stopImmediatePropagation();
      }
    }, true);
  }

  function installShadowInterceptors(root) {
    // Same interceptors inside the shadow root itself —
    // catches events before they propagate to the host element
    ['selectstart', 'mousedown', 'copy', 'contextmenu'].forEach(evt => {
      root.addEventListener(evt, (e) => {
        e.stopImmediatePropagation();
        // Never preventDefault — we only stop Grammarly's handlers
      }, true);
    });
  }

  // ─── Shadow Root Processing ────────────────────────────────────────────

  function processShadowRoot(root) {
    if (!root || processedRoots.has(root)) return;
    processedRoots.add(root);

    injectCSS(root);
    installShadowInterceptors(root);
    root.querySelectorAll('*').forEach(unblurElement);
    revealGrammarly(root);

    let debounce = null;
    const observer = new MutationObserver((mutations) => {
      let changed = false;
      mutations.forEach(m => {
        if (m.type === 'childList') {
          m.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              unblurElement(node);
              node.querySelectorAll?.('*').forEach(unblurElement);
              changed = true;
            }
          });
        }
        if (m.type === 'attributes') {
          unblurElement(m.target);
          changed = true;
        }
      });
      if (changed) {
        clearTimeout(debounce);
        debounce = setTimeout(() => revealGrammarly(root), 50);
      }
    });

    observer.observe(root, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['style', 'class']
    });
  }

  // ─── DOM Scanner ───────────────────────────────────────────────────────

  function scanDOM() {
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      const root = node.shadowRoot || node[PROP_KEY];
      if (root) processShadowRoot(root);
      node = walker.nextNode();
    }
    (window[REGISTRY_KEY] || []).forEach(ref => {
      const host = ref.deref?.();
      const root = host?.shadowRoot || host?.[PROP_KEY];
      if (root) processShadowRoot(root);
    });
  }

  // ─── attachShadow Override ─────────────────────────────────────────────

  const originalAttachShadow = Element.prototype.attachShadow;

  Element.prototype.attachShadow = function (init) {
    const root = originalAttachShadow.call(this, init);
    processShadowRoot(root);
    try {
      Object.defineProperty(this, PROP_KEY, {
        value: root, configurable: false, enumerable: false, writable: false
      });
    } catch (e) {}
    window[REGISTRY_KEY].push(new WeakRef(this));
    this.dispatchEvent(new CustomEvent('__unblur_shadow_attached__', { bubbles: true }));
    return root;
  };

  // ─── Boot ──────────────────────────────────────────────────────────────

  // Install document-level interceptors immediately (before any page script)
  installDocumentInterceptors();

  if (document.documentElement) scanDOM();
  document.addEventListener('DOMContentLoaded', scanDOM);
  window.addEventListener('load', () => {
    scanDOM();
    setTimeout(scanDOM, 500);
    setTimeout(scanDOM, 1500);
    setTimeout(scanDOM, 3000);
  });
  setInterval(scanDOM, 5000);

  console.log('[Unblur] v2.2 — direct selection via capture-phase event interception');
})();
