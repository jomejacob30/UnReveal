/**
 * intercept.js — MAIN world, document_start
 *
 * Expert-reviewed v2.1 — Three root causes fixed:
 *  1. TIMING: innerText was extracted before browser paint (empty string).
 *     Fix: requestAnimationFrame + offsetHeight reflow + 20ms delay.
 *  2. EVENT ISOLATION: stopPropagation alone doesn't block all Grammarly
 *     handlers. Fix: stopImmediatePropagation in capture phase on panel.
 *  3. CSS BLEED: Grammarly's styles bled into our panel.
 *     Fix: `all: revert` resets every inherited property on the panel.
 */

(function () {
  'use strict';

  const PROP_KEY      = '__unblur_shadow_root__';
  const REGISTRY_KEY  = '__unblur_shadow_hosts__';
  const INJECTED_ATTR = 'data-unblur-injected';
  const processedRoots = new WeakSet();

  window[REGISTRY_KEY] = window[REGISTRY_KEY] || [];

  // ─── CSS Payload ───────────────────────────────────────────────────────

  const UNBLUR_CSS = `
    .ftgla1i, .obscuredContent, .f1ll759f {
      filter: none !important;
      -webkit-filter: none !important;
      user-select: text !important;
      -webkit-user-select: text !important;
    }
    .overlay.f1a2899a, .f1a2899a {
      opacity: 0 !important;
      pointer-events: none !important;
    }
    span.fc6omth, span.f18ev72d, strong.f1t69bad, strong.fp3q8eq,
    .base_f1hmg4t3, .base_f15zcxmp, .holder_fkhz08q,
    .visibleContent, .f2wnt2z {
      filter: none !important;
      -webkit-filter: none !important;
      backdrop-filter: none !important;
      opacity: 1 !important;
      -webkit-text-security: none !important;
      user-select: text !important;
      -webkit-user-select: text !important;
    }
    span.fc6omth.medium_fwla7bl, strong.f1t69bad.medium_fwla7bl,
    strong.fp3q8eq.medium_fwla7bl {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI",
                   Roboto, Helvetica, Arial, sans-serif !important;
    }
  `;

  // ─── CSS Injection ─────────────────────────────────────────────────────

  function injectCSS(root) {
    if (!root) return;
    if (root.querySelector?.(`style[${INJECTED_ATTR}]`)) return;
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
      if (f && f !== 'none' && f.includes('blur')) {
        el.style.setProperty('filter', 'none', 'important');
        el.style.setProperty('-webkit-filter', 'none', 'important');
        el.style.setProperty('user-select', 'text', 'important');
        el.style.setProperty('-webkit-user-select', 'text', 'important');
        el.style.setProperty('pointer-events', 'auto', 'important');
      }
      if (el.classList.contains('f1a2899a') || el.classList.contains('f1fbtb6x')) {
        el.style.setProperty('opacity', '0', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
      }
    } catch (e) {}
  }

  // ─── Async Text Extraction (timing-safe) ──────────────────────────────
  // ROOT CAUSE FIX #1: innerText returns '' if called before browser paint.
  // requestAnimationFrame → microtask → setTimeout(20) ensures layout is done.

  function extractText(obscuredEl) {
    return new Promise((resolve) => {
      if (!obscuredEl) return resolve('');
      requestAnimationFrame(() => {
        Promise.resolve().then(() => {
          setTimeout(() => {
            const target = obscuredEl.querySelector('.ftgla1i') || obscuredEl;
            void target.offsetHeight; // force reflow so innerText is accurate
            const text = (target.innerText || target.textContent || '').trim();
            resolve(text);
          }, 20);
        });
      });
    });
  }

  // ─── Floating Panel ────────────────────────────────────────────────────
  // ROOT CAUSE FIX #2 & #3: Panel lives in main DOM (outside shadow root),
  // uses `all: revert` to escape Grammarly's CSS, and blocks ALL events
  // using capture-phase stopImmediatePropagation.

  let floatingPanel   = null;
  let dismissTimer    = null;
  let outsideListener = null;
  let lastText        = '';

  function copyToClipboard(text, btn) {
    const succeed = () => {
      btn.textContent = '✓ Copied!';
      btn.style.background = '#4caf50';
      setTimeout(() => { btn.textContent = 'Copy'; btn.style.background = '#f6b900'; }, 1500);
    };
    const fail = () => {
      // execCommand fallback for restricted contexts
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;top:0;left:0;';
      document.documentElement.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); succeed(); } catch (e) {}
      ta.remove();
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(succeed).catch(fail);
    } else {
      fail();
    }
  }

  function removePanel() {
    clearTimeout(dismissTimer);
    if (outsideListener) {
      document.removeEventListener('mousedown', outsideListener, true);
      outsideListener = null;
    }
    if (floatingPanel) {
      floatingPanel.remove();
      floatingPanel = null;
    }
    lastText = '';
  }

  function blockEvent(e) {
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function showPanel(text, hostEl) {
    if (!text) return;
    // Skip if same suggestion already showing
    if (text === lastText && floatingPanel) return;
    lastText = text;
    removePanel();

    const panel = document.createElement('div');
    panel.setAttribute('data-unblur-panel', 'true');

    // Position: anchor near the Grammarly popup
    let top = 80, left = 20;
    try {
      const rect = hostEl?.getBoundingClientRect();
      if (rect && rect.width > 0) {
        top  = Math.max(10, rect.top - 140);
        left = Math.max(10, Math.min(window.innerWidth - 420, rect.left));
      }
    } catch (e) {}

    // ROOT CAUSE FIX #3: `all: revert` nukes every inherited Grammarly style
    panel.style.cssText = `
      all: revert;
      position: fixed !important;
      top: ${top}px !important;
      left: ${left}px !important;
      z-index: 2147483647 !important;
      width: 380px !important;
      max-width: calc(100vw - 40px) !important;
      background: #1e1e2e !important;
      color: #cdd6f4 !important;
      border: 1px solid #45475a !important;
      border-radius: 12px !important;
      padding: 14px 16px !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif !important;
      font-size: 13px !important;
      line-height: 1.6 !important;
      box-shadow: 0 16px 48px rgba(0,0,0,0.5) !important;
      box-sizing: border-box !important;
      user-select: text !important;
      -webkit-user-select: text !important;
      cursor: default !important;
      word-wrap: break-word !important;
      white-space: pre-wrap !important;
    `;

    // ROOT CAUSE FIX #2: Block ALL events in capture phase
    ['mousedown','mouseup','click','dblclick','mousemove','touchstart','touchend','keydown']
      .forEach(evt => panel.addEventListener(evt, blockEvent, true));

    // ── Header ──
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;user-select:none;-webkit-user-select:none;';

    const label = document.createElement('span');
    label.style.cssText = 'font-size:10px;font-weight:700;letter-spacing:1px;color:#6c7086;text-transform:uppercase;';
    label.textContent = 'Grammarly Suggestion';

    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:6px;align-items:center;';

    const copyBtn = document.createElement('button');
    copyBtn.textContent = 'Copy';
    copyBtn.style.cssText = `
      all:revert;background:#f6b900;color:#1a1a1a;border:none;
      border-radius:6px;padding:4px 12px;font-size:11px;font-weight:700;
      cursor:pointer;font-family:inherit;user-select:none;-webkit-user-select:none;
    `;
    copyBtn.addEventListener('mousedown', blockEvent, true);
    copyBtn.addEventListener('click', (e) => {
      blockEvent(e);
      copyToClipboard(text, copyBtn);
    }, true);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `
      all:revert;background:none;color:#6c7086;border:none;
      font-size:14px;cursor:pointer;padding:2px 6px;border-radius:4px;
      font-family:inherit;user-select:none;-webkit-user-select:none;
    `;
    closeBtn.addEventListener('mousedown', blockEvent, true);
    closeBtn.addEventListener('click', (e) => { blockEvent(e); removePanel(); }, true);

    btns.appendChild(copyBtn);
    btns.appendChild(closeBtn);
    header.appendChild(label);
    header.appendChild(btns);

    // ── Text (fully selectable) ──
    const textEl = document.createElement('div');
    textEl.style.cssText = `
      user-select:text !important;-webkit-user-select:text !important;
      cursor:text !important;pointer-events:auto !important;
      color:#cdd6f4;line-height:1.6;word-wrap:break-word;white-space:pre-wrap;
    `;
    textEl.textContent = text;

    panel.appendChild(header);
    panel.appendChild(textEl);

    // Append to documentElement (not body) — avoids body-level Grammarly listeners
    document.documentElement.appendChild(panel);
    floatingPanel = panel;

    // Auto-dismiss after 15s
    dismissTimer = setTimeout(removePanel, 15000);

    // Click-outside dismissal — delayed so panel-creation click doesn't trigger it
    setTimeout(() => {
      outsideListener = (e) => {
        if (floatingPanel && !floatingPanel.contains(e.target)) {
          removePanel();
        }
      };
      document.addEventListener('mousedown', outsideListener, true);
    }, 200);
  }

  // ─── Grammarly Reveal ──────────────────────────────────────────────────

  function revealGrammarly(root) {
    if (!root) return;
    try {
      root.querySelectorAll('.overlayContainer, .fkf0s66').forEach(container => {
        const obscured = container.querySelector('.obscuredContent, .f1ll759f');
        const visible  = container.querySelector('.visibleContent, .f2wnt2z');
        if (!obscured) return;

        // Strip blur immediately (visual fix)
        const blurEl = obscured.querySelector('.ftgla1i');
        if (blurEl) {
          blurEl.style.setProperty('filter', 'none', 'important');
          blurEl.style.setProperty('-webkit-filter', 'none', 'important');
        }
        obscured.querySelectorAll('.overlay, .f1a2899a').forEach(el => {
          el.style.setProperty('opacity', '0', 'important');
          el.style.setProperty('pointer-events', 'none', 'important');
        });

        // Clone into visibleContent
        if (visible && !visible.hasChildNodes() && blurEl) {
          const copy = blurEl.cloneNode(true);
          copy.style.setProperty('filter', 'none', 'important');
          copy.querySelectorAll('*').forEach(c => {
            c.style.setProperty('user-select', 'text', 'important');
            c.style.setProperty('pointer-events', 'auto', 'important');
          });
          visible.appendChild(copy);
        }

        // Extract text AFTER paint and show panel
        extractText(obscured).then(text => {
          if (text) showPanel(text, root.host || document.querySelector('grammarly-popups'));
        });
      });
    } catch (e) {}
  }

  // ─── Shadow Root Processing ────────────────────────────────────────────

  function processShadowRoot(root) {
    if (!root || processedRoots.has(root)) return;
    processedRoots.add(root);

    injectCSS(root);
    root.querySelectorAll('*').forEach(unblurElement);
    revealGrammarly(root);

    let revealDebounce = null;
    const observer = new MutationObserver((mutations) => {
      let needsReveal = false;
      mutations.forEach(m => {
        if (m.type === 'childList') {
          m.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE) {
              unblurElement(node);
              node.querySelectorAll?.('*').forEach(unblurElement);
              needsReveal = true;
            }
          });
        }
        if (m.type === 'attributes') {
          unblurElement(m.target);
          needsReveal = true;
        }
      });
      if (needsReveal) {
        clearTimeout(revealDebounce);
        revealDebounce = setTimeout(() => revealGrammarly(root), 50);
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

  // ─── Multi-point scanning ──────────────────────────────────────────────

  if (document.documentElement) scanDOM();
  document.addEventListener('DOMContentLoaded', scanDOM);
  window.addEventListener('load', () => {
    scanDOM();
    setTimeout(scanDOM, 500);
    setTimeout(scanDOM, 1500);
    setTimeout(scanDOM, 3000);
  });
  setInterval(scanDOM, 5000);

  console.log('[Unblur] v2.1 — timing-safe, event-isolated, CSS-reset panel active');
})();
