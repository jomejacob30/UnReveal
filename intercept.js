/**
 * intercept.js — MAIN world, document_start
 * Version 2.3
 *
 * New in v2.3:
 *   - Yellow insert button (top-right of popup) applies the Grammarly
 *     suggestion directly into the document — no copy/paste needed
 *   - Get Plus + Dismiss buttons hidden from popup
 *   - Clean text extraction: walks DOM tree, skips strikethrough
 *     (f1t69bad / strikeoutHorizontal) elements, keeps regular +
 *     replacement (fp3q8eq) text
 *   - Original text extraction: used to find + replace the exact
 *     phrase in the document via Selection API + execCommand
 *   - Fallback: copies clean text to clipboard if direct insert fails
 *
 * Text classification (from DOM analysis):
 *   span.fc6omth              → regular text (KEEP)
 *   strong.f1t69bad           → strikethrough/deleted (SKIP)
 *   strong.fp3q8eq            → replacement/addition (KEEP, blue)
 *   span.fdogkuf              → spacer (SKIP)
 */

(function () {
  'use strict';

  const PROP_KEY      = '__unblur_shadow_root__';
  const REGISTRY_KEY  = '__unblur_shadow_hosts__';
  const INJECTED_ATTR = 'data-unblur-injected';
  const BTN_ATTR      = 'data-unblur-btn';
  const processedRoots = new WeakSet();

  window[REGISTRY_KEY] = window[REGISTRY_KEY] || [];

  // ─── CSS ───────────────────────────────────────────────────────────────

  const UNBLUR_CSS = `
    /* Strip blur */
    .ftgla1i, .obscuredContent, .f1ll759f {
      filter: none !important;
      -webkit-filter: none !important;
    }
    /* Make all suggestion text selectable */
    .ftgla1i, .ftgla1i *,
    .obscuredContent, .obscuredContent *,
    .f1ll759f, .f1ll759f *,
    span.fc6omth, span.f18ev72d,
    strong.f1t69bad, strong.fp3q8eq,
    .base_f1hmg4t3, .base_f15zcxmp, .holder_fkhz08q,
    .visibleContent, .visibleContent *,
    .f2wnt2z, .f2wnt2z * {
      filter: none !important;
      -webkit-filter: none !important;
      opacity: 1 !important;
      user-select: text !important;
      -webkit-user-select: text !important;
      pointer-events: auto !important;
      cursor: text !important;
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
    const s = document.createElement('style');
    s.setAttribute(INJECTED_ATTR, 'true');
    s.textContent = UNBLUR_CSS;
    try { root.appendChild(s); } catch (e) {}
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
      }
      if (el.classList?.contains('f1a2899a')) {
        el.style.setProperty('opacity', '0', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
      }
    } catch (e) {}
  }

  // ─── Text Extraction ───────────────────────────────────────────────────
  //
  // Walks the .ftgla1i DOM tree and classifies each element:
  //   f1t69bad / strikeoutHorizontal_f1hzeoet → DELETED text (skip)
  //   fp3q8eq                                 → REPLACEMENT text (keep)
  //   fc6omth                                 → REGULAR text (keep)
  //   fdogkuf                                 → SPACER (skip)

  function walkTree(rootEl, skipDeleted, skipReplacements) {
    let text = '';

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const cls = node.classList;

      // Strikethrough / deleted text
      if (cls.contains('f1t69bad') || cls.contains('strikeoutHorizontal_f1hzeoet')) {
        if (!skipDeleted) node.childNodes.forEach(walk);
        return;
      }
      // Replacement / addition text (blue)
      if (cls.contains('fp3q8eq')) {
        if (!skipReplacements) node.childNodes.forEach(walk);
        return;
      }
      // Spacer elements
      if (cls.contains('fdogkuf')) return;

      node.childNodes.forEach(walk);
    }

    walk(rootEl);
    return text.replace(/[ \t]{2,}/g, ' ').trim();
  }

  /**
   * Clean text: what the corrected sentence should look like.
   * Skips strikethrough (deleted), keeps regular + replacements.
   */
  function extractCleanText(root) {
    const obscured = root.querySelector('.obscuredContent, .f1ll759f');
    if (!obscured) return '';
    const el = obscured.querySelector('.ftgla1i') || obscured;
    return walkTree(el, true, false);   // skip deleted, keep replacements
  }

  /**
   * Original text: what is currently in the user's document.
   * Keeps strikethrough (was in original), skips replacements (additions).
   */
  function extractOriginalText(root) {
    const obscured = root.querySelector('.obscuredContent, .f1ll759f');
    if (!obscured) return '';
    const el = obscured.querySelector('.ftgla1i') || obscured;
    return walkTree(el, false, true);   // keep deleted, skip replacements
  }

  // ─── Document Insert ───────────────────────────────────────────────────
  //
  // Finds originalText in the active document and replaces it with cleanText.
  // Works for: <textarea>, <input>, contenteditable elements.
  // Falls back to clipboard copy if replacement fails.

  function replaceInTextNode(el, original, replacement) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let fullText = '';
    const segments = [];
    let node;

    while ((node = walker.nextNode())) {
      segments.push({ node, start: fullText.length });
      fullText += node.textContent;
    }

    const idx = fullText.indexOf(original);
    if (idx === -1) return false;

    const end = idx + original.length;
    const startSeg = segments.find(s => idx >= s.start && idx < s.start + s.node.textContent.length);
    const endSeg   = segments.find(s => end > s.start  && end <= s.start + s.node.textContent.length);
    if (!startSeg || !endSeg) return false;

    const range = document.createRange();
    range.setStart(startSeg.node, idx - startSeg.start);
    range.setEnd(endSeg.node, end - endSeg.start);

    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    el.focus();
    return document.execCommand('insertText', false, replacement);
  }

  function applyToDocument(originalText, cleanText) {
    if (!cleanText) return false;

    const active = document.activeElement;

    // Textarea / input
    if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
      const idx = active.value.indexOf(originalText);
      if (idx !== -1) {
        active.focus();
        active.setSelectionRange(idx, idx + originalText.length);
        const ok = document.execCommand('insertText', false, cleanText);
        if (ok) return true;
        // Manual fallback
        active.value = active.value.slice(0, idx) + cleanText + active.value.slice(idx + originalText.length);
        active.dispatchEvent(new Event('input', { bubbles: true }));
        active.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
    }

    // Contenteditable
    const editables = document.querySelectorAll('[contenteditable="true"], [contenteditable=""]');
    for (const el of editables) {
      const text = el.innerText || el.textContent || '';
      if (text.includes(originalText)) {
        if (replaceInTextNode(el, originalText, cleanText)) return true;
      }
    }

    return false;
  }

  function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none;top:0;left:0;';
    document.documentElement.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
  }

  // ─── Insert Button ─────────────────────────────────────────────────────

  function injectInsertButton(root) {
    if (!root) return;
    if (root.querySelector(`[${BTN_ATTR}]`)) return;

    // Hide Get Plus / Dismiss buttons
    root.querySelectorAll('button').forEach(btn => {
      const t = btn.textContent.trim();
      if (t.includes('Plus') || t.includes('Dismiss') || t.includes('Upgrade')) {
        btn.style.setProperty('display', 'none', 'important');
      }
    });

    // Find a suitable card container to anchor the button
    const card = (
      root.querySelector('.fhdmkk6') ||
      root.querySelector('.overlayContainer')?.closest('div[class]') ||
      root.querySelector('.overlayContainer')?.parentElement ||
      root.firstElementChild
    );
    if (!card) return;

    // ── Build the yellow insert button ──
    const btn = document.createElement('button');
    btn.setAttribute(BTN_ATTR, 'true');
    btn.title = 'Apply suggestion to document';

    // Down-arrow SVG icon (indicates "insert below / apply")
    btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"
      viewBox="0 0 24 24" fill="none" stroke="#1a1a1a"
      stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="8 17 12 21 16 17"/>
      <line x1="12" y1="3" x2="12" y2="21"/>
    </svg>`;

    btn.style.cssText = `
      all: initial !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      background: #f6b900 !important;
      border: none !important;
      border-radius: 8px !important;
      width: 34px !important;
      height: 34px !important;
      cursor: pointer !important;
      position: absolute !important;
      top: 10px !important;
      right: 10px !important;
      z-index: 99999 !important;
      box-shadow: 0 2px 10px rgba(0,0,0,0.35) !important;
      transition: transform 0.1s, background 0.15s !important;
      pointer-events: auto !important;
    `;

    // Stop Grammarly's mousedown from dismissing the popup on button click
    btn.addEventListener('mousedown', (e) => {
      e.stopImmediatePropagation();
      e.preventDefault();
    }, true);

    btn.addEventListener('click', (e) => {
      e.stopImmediatePropagation();
      e.preventDefault();

      const cleanText    = extractCleanText(root);
      const originalText = extractOriginalText(root);

      if (!cleanText) return;

      const applied = originalText ? applyToDocument(originalText, cleanText) : false;

      if (!applied) {
        // Fallback: copy to clipboard
        copyToClipboard(cleanText);
        // Visual: show clipboard icon
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"
          viewBox="0 0 24 24" fill="none" stroke="#1a1a1a"
          stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>`;
        btn.style.setProperty('background', '#4caf50', 'important');
        setTimeout(() => {
          btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"
            viewBox="0 0 24 24" fill="none" stroke="#1a1a1a"
            stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="8 17 12 21 16 17"/>
            <line x1="12" y1="3" x2="12" y2="21"/>
          </svg>`;
          btn.style.setProperty('background', '#f6b900', 'important');
        }, 1500);
      } else {
        // Visual: checkmark
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"
          viewBox="0 0 24 24" fill="none" stroke="#1a1a1a"
          stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>`;
        btn.style.setProperty('background', '#4caf50', 'important');
        setTimeout(() => {
          btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"
            viewBox="0 0 24 24" fill="none" stroke="#1a1a1a"
            stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="8 17 12 21 16 17"/>
            <line x1="12" y1="3" x2="12" y2="21"/>
          </svg>`;
          btn.style.setProperty('background', '#f6b900', 'important');
        }, 1500);
      }
    }, true);

    card.style.setProperty('position', 'relative', 'important');
    card.appendChild(btn);
  }

  // ─── Grammarly Reveal ──────────────────────────────────────────────────

  function revealGrammarly(root) {
    if (!root) return;
    try {
      const hasContent = !!root.querySelector('.overlayContainer, .fkf0s66');
      if (!hasContent) return;

      root.querySelectorAll('.overlayContainer, .fkf0s66').forEach(container => {
        const obscured = container.querySelector('.obscuredContent, .f1ll759f');
        const visible  = container.querySelector('.visibleContent, .f2wnt2z');
        if (!obscured) return;

        // Remove blur
        const blurEl = obscured.querySelector('.ftgla1i');
        if (blurEl) {
          blurEl.style.setProperty('filter', 'none', 'important');
          blurEl.style.setProperty('user-select', 'text', 'important');
          blurEl.style.setProperty('-webkit-user-select', 'text', 'important');
          blurEl.style.setProperty('pointer-events', 'auto', 'important');
          blurEl.querySelectorAll('*').forEach(c => {
            c.style.setProperty('user-select', 'text', 'important');
            c.style.setProperty('-webkit-user-select', 'text', 'important');
            c.style.setProperty('pointer-events', 'auto', 'important');
          });
        }

        // Hide haze
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
          });
          visible.appendChild(copy);
        }
      });

      // Inject insert button after content is present
      injectInsertButton(root);

    } catch (e) { console.error('[Unblur]', e); }
  }

  // ─── Event Interception (direct text selection) ────────────────────────

  function isInGrammarlyPopup(target) {
    try {
      const path = target?.composedPath?.() || [];
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
    } catch (e) { return false; }
  }

  function installDocumentInterceptors() {
    ['selectstart', 'mousedown', 'copy', 'contextmenu'].forEach(evt => {
      document.addEventListener(evt, (e) => {
        if (isInGrammarlyPopup(e.target)) {
          e.stopImmediatePropagation();
          // Never preventDefault — preserve native selection / copy
        }
      }, true);
    });
  }

  function installShadowInterceptors(root) {
    ['selectstart', 'mousedown', 'copy', 'contextmenu'].forEach(evt => {
      root.addEventListener(evt, (e) => {
        // Don't block events on our insert button
        if (e.target?.hasAttribute?.(BTN_ATTR)) return;
        e.stopImmediatePropagation();
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
        debounce = setTimeout(() => revealGrammarly(root), 80);
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

  console.log('[Unblur] v2.3 — insert button + clean text extraction active');
})();
