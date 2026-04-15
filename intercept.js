/**
 * intercept.js — Runs in MAIN world at document_start
 *
 * Global strategy — works on ALL websites (Gmail, Google Docs, etc.):
 *
 * 1. Override attachShadow to capture future shadow roots
 * 2. Scan the DOM at multiple points (DOMContentLoaded, load, intervals)
 *    to catch shadow roots created before our script ran
 * 3. Watch for ANY element gaining a blur filter — not just specific classes
 * 4. Handle popups shown/hidden via CSS (not just DOM add/remove)
 * 5. Apply Grammarly-specific content reveal on top of generic blur removal
 */

(function () {
  'use strict';

  const PROP_KEY      = '__unblur_shadow_root__';
  const REGISTRY_KEY  = '__unblur_shadow_hosts__';
  const INJECTED_ATTR = 'data-unblur-injected';
  const processedRoots = new WeakSet();

  window[REGISTRY_KEY] = window[REGISTRY_KEY] || [];

  // ─── CSS Payload ──────────────────────────────────────────────────────
  // Injected into every shadow root as a first line of defence.
  // Works for any site — targets blur by class name where known,
  // plus a broad filter:none on the Grammarly-specific classes.

  const UNBLUR_CSS = `
    /* Generic: kill blur on any element that Grammarly blurs */
    .ftgla1i,
    .obscuredContent,
    .f1ll759f {
      filter: none !important;
      -webkit-filter: none !important;
      user-select: text !important;
      -webkit-user-select: text !important;
      pointer-events: auto !important;
      cursor: text !important;
    }

    /* Hide the white haze overlay */
    .overlay.f1a2899a,
    .f1a2899a {
      opacity: 0 !important;
      pointer-events: none !important;
    }

    /* Other known Grammarly blur targets */
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
      -webkit-user-select: text !important;
      pointer-events: auto !important;
    }

    /* Make the whole popup card selectable and draggable */
    grammarly-popups,
    grammarly-mirror,
    .overlayContainer,
    .fkf0s66 {
      user-select: text !important;
      -webkit-user-select: text !important;
      pointer-events: auto !important;
      cursor: text !important;
    }

    /* Restore font for redacted-font technique */
    span.fc6omth.medium_fwla7bl,
    strong.f1t69bad.medium_fwla7bl,
    strong.fp3q8eq.medium_fwla7bl {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
                   Roboto, Helvetica, Arial, sans-serif !important;
    }
  `;

  // ─── Inject CSS ────────────────────────────────────────────────────────

  function injectCSS(root) {
    if (!root) return;
    if (root.querySelector?.(`style[${INJECTED_ATTR}]`)) return;
    const style = document.createElement('style');
    style.setAttribute(INJECTED_ATTR, 'true');
    style.textContent = UNBLUR_CSS;
    try { root.appendChild(style); } catch (e) {}
  }

  // ─── Generic Blur Removal ──────────────────────────────────────────────
  // Directly sets inline style — always beats any CSS rule.

  function unblurElement(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
    try {
      const computed = window.getComputedStyle(el);
      const filter = computed.filter || computed.webkitFilter || '';

      if (filter && filter !== 'none' && filter.includes('blur')) {
        el.style.setProperty('filter', 'none', 'important');
        el.style.setProperty('-webkit-filter', 'none', 'important');
        el.style.setProperty('user-select', 'text', 'important');
        el.style.setProperty('-webkit-user-select', 'text', 'important');
        el.style.setProperty('pointer-events', 'auto', 'important');
        el.style.setProperty('cursor', 'text', 'important');
      }

      // Kill white haze overlays (opacity trick)
      if (
        (el.classList.contains('overlay') && el.classList.contains('f1a2899a')) ||
        el.classList.contains('f1fbtb6x')
      ) {
        el.style.setProperty('opacity', '0', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
      }
    } catch (e) {}
  }

  // ─── Floating Panel ────────────────────────────────────────────────────
  // Creates a real DOM element OUTSIDE Grammarly's shadow root so
  // Grammarly's JS event listeners can't block text selection or copying.

  let floatingPanel = null;
  let panelTimeout  = null;

  function showFloatingPanel(text, anchorEl) {
    if (!text || !text.trim()) return;

    // Remove old panel
    if (floatingPanel) floatingPanel.remove();

    const panel = document.createElement('div');
    panel.id = '__unblur_panel__';
    panel.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      background: #1e1e1e;
      color: #f0f0f0;
      border: 1px solid #444;
      border-radius: 10px;
      padding: 12px 14px;
      max-width: 380px;
      min-width: 200px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      font-size: 13px;
      line-height: 1.5;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      user-select: text;
      -webkit-user-select: text;
      cursor: text;
    `;

    // Position near the Grammarly popup
    const rect = anchorEl ? anchorEl.getBoundingClientRect() : null;
    if (rect) {
      const top  = Math.max(10, rect.top - 10);
      const left = Math.min(window.innerWidth - 400, rect.left);
      panel.style.top  = `${top}px`;
      panel.style.left = `${left}px`;
    } else {
      panel.style.top  = '80px';
      panel.style.right = '20px';
    }

    // Header
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
    header.innerHTML = `
      <span style="font-size:11px;color:#aaa;font-weight:600;letter-spacing:0.5px;">GRAMMARLY SUGGESTION</span>
    `;

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.style.cssText = `
      background: #f6b900; color: #1a1a1a; border: none; border-radius: 5px;
      padding: 3px 10px; font-size: 11px; font-weight: 700;
      cursor: pointer; pointer-events: auto;
    `;
    copyBtn.addEventListener('mousedown', (e) => e.stopPropagation());
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      });
    });
    header.appendChild(copyBtn);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `
      background: none; color: #888; border: none;
      font-size: 13px; cursor: pointer; margin-left: 6px;
      pointer-events: auto; padding: 2px 4px;
    `;
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.remove();
      floatingPanel = null;
    });
    header.appendChild(closeBtn);

    // Text content — fully selectable
    const textEl = document.createElement('div');
    textEl.style.cssText = `
      user-select: text; -webkit-user-select: text;
      cursor: text; pointer-events: auto;
      color: #f0f0f0; line-height: 1.6;
    `;
    textEl.textContent = text;

    panel.appendChild(header);
    panel.appendChild(textEl);

    // Stop panel from closing when clicking inside it
    panel.addEventListener('mousedown', (e) => e.stopPropagation());

    document.body.appendChild(panel);
    floatingPanel = panel;

    // Auto-dismiss after 12 seconds
    clearTimeout(panelTimeout);
    panelTimeout = setTimeout(() => {
      if (floatingPanel === panel) {
        panel.remove();
        floatingPanel = null;
      }
    }, 12000);
  }

  // ─── Grammarly Content Reveal ──────────────────────────────────────────
  // Removes blur, then shows floating panel with the suggestion text.

  function revealGrammarly(root) {
    if (!root) return;
    try {
      const containers = root.querySelectorAll('.overlayContainer, .fkf0s66');
      containers.forEach(container => {
        const obscured = container.querySelector('.obscuredContent, .f1ll759f');
        const visible  = container.querySelector('.visibleContent, .f2wnt2z');
        if (!obscured) return;

        // Remove blur from .ftgla1i inside obscured
        const blurTarget = obscured.querySelector('.ftgla1i');
        if (blurTarget) {
          blurTarget.style.setProperty('filter', 'none', 'important');
          blurTarget.style.setProperty('-webkit-filter', 'none', 'important');
        }

        // Hide overlay haze
        obscured.querySelectorAll('.overlay, .f1a2899a').forEach(el => {
          el.style.setProperty('opacity', '0', 'important');
          el.style.setProperty('pointer-events', 'none', 'important');
        });

        // Clone content into empty visibleContent
        if (visible && !visible.hasChildNodes() && obscured.hasChildNodes()) {
          const source = obscured.querySelector('.ftgla1i') || obscured;
          const copy = source.cloneNode(true);
          copy.style.setProperty('filter', 'none', 'important');
          copy.querySelectorAll('*').forEach(child => {
            child.style.setProperty('user-select', 'text', 'important');
            child.style.setProperty('pointer-events', 'auto', 'important');
          });
          visible.appendChild(copy);
        }

        // Extract plain text and show floating panel
        const source = obscured.querySelector('.ftgla1i') || obscured;
        const suggestionText = source.innerText || source.textContent || '';
        if (suggestionText.trim()) {
          // Find the Grammarly popup host to anchor panel position
          const host = root.host || document.querySelector('grammarly-popups');
          showFloatingPanel(suggestionText.trim(), host);
        }
      });
    } catch (e) {}
  }

  // ─── Full Shadow Root Processing ───────────────────────────────────────

  function processShadowRoot(root) {
    if (!root || processedRoots.has(root)) return;
    processedRoots.add(root);

    injectCSS(root);

    // Unblur all current elements
    root.querySelectorAll('*').forEach(unblurElement);
    revealGrammarly(root);

    // Watch for future additions AND attribute changes (display toggling)
    const observer = new MutationObserver((mutations) => {
      let needsReveal = false;
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              unblurElement(node);
              node.querySelectorAll?.('*').forEach(unblurElement);
              needsReveal = true;
            }
          });
        }
        if (mutation.type === 'attributes') {
          unblurElement(mutation.target);
          needsReveal = true;
        }
      }
      if (needsReveal) revealGrammarly(root);
    });

    observer.observe(root, {
      childList:  true,
      subtree:    true,
      attributes: true,
      attributeFilter: ['style', 'class']
    });
  }

  // ─── DOM Scanner ───────────────────────────────────────────────────────
  // Walks the entire document looking for shadow hosts we may have missed.
  // Handles both open shadow roots and ones captured by our attachShadow hook.

  function scanDOM() {
    const walker = document.createTreeWalker(
      document.documentElement,
      NodeFilter.SHOW_ELEMENT
    );
    let node = walker.nextNode();
    while (node) {
      const root = node.shadowRoot || node[PROP_KEY];
      if (root) {
        processShadowRoot(root);
        // Also recurse inside shadow root
        const innerWalker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        let inner = innerWalker.nextNode();
        while (inner) {
          const innerRoot = inner.shadowRoot || inner[PROP_KEY];
          if (innerRoot) processShadowRoot(innerRoot);
          inner = innerWalker.nextNode();
        }
      }
      node = walker.nextNode();
    }

    // Also check global registry from intercepted attachShadow calls
    const registry = window[REGISTRY_KEY];
    if (Array.isArray(registry)) {
      registry.forEach(ref => {
        const host = ref.deref?.();
        if (host) {
          const root = host.shadowRoot || host[PROP_KEY];
          if (root) processShadowRoot(root);
        }
      });
    }
  }

  // ─── attachShadow Override ─────────────────────────────────────────────

  const originalAttachShadow = Element.prototype.attachShadow;

  Element.prototype.attachShadow = function (init) {
    const root = originalAttachShadow.call(this, init);

    // Immediately process this new shadow root
    processShadowRoot(root);

    // Store reference
    try {
      Object.defineProperty(this, PROP_KEY, {
        value: root,
        configurable: false,
        enumerable: false,
        writable: false
      });
    } catch (e) {}

    window[REGISTRY_KEY].push(new WeakRef(this));

    this.dispatchEvent(
      new CustomEvent('__unblur_shadow_attached__', { bubbles: true })
    );

    return root;
  };

  // ─── Multi-Point Scanning ──────────────────────────────────────────────
  // Catches shadow roots created before our script, or by lazy-loading.

  // Immediately (some elements may already exist at document_start)
  if (document.documentElement) scanDOM();

  // After initial parse
  document.addEventListener('DOMContentLoaded', () => {
    scanDOM();
  });

  // After full load (images, iframes, etc.)
  window.addEventListener('load', () => {
    scanDOM();
    // Extra pass for late-loading extensions (Grammarly, etc.)
    setTimeout(scanDOM, 500);
    setTimeout(scanDOM, 1500);
    setTimeout(scanDOM, 3000);
  });

  // Periodic scan to catch any missed shadow roots from dynamic content
  // (e.g. Gmail's compose window opened mid-session)
  setInterval(scanDOM, 5000);

  console.log('[Unblur] v1.1 — global intercept active on all sites');
})();
