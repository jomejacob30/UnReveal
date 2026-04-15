/**
 * intercept.js — MAIN world, document_start — v2.3.1
 *
 * Critical fixes from audit:
 *  1. Button now lives in MAIN DOM (fixed position) — no shadow DOM injection,
 *     no fragile class-name selectors, no z-index battles
 *  2. Track lastEditable via focusin BEFORE popup opens — fixes wrong
 *     document.activeElement at button-click time
 *  3. mousedown preventDefault on button — keeps focus on editor so
 *     replacement works immediately
 *  4. Text normalization — handles NBSP, line-breaks, tabs, multi-space
 *  5. Fuzzy-match fallback — collapses whitespace on both sides before indexOf
 *  6. Range API bounds-checking — no more IndexSizeError
 *  7. Get Plus / Dismiss hidden via CSS (reliable) not JS text-search
 *  8. Correct icon SVG matching user's design (chat bubble + dark circle + plus)
 */

(function () {
  'use strict';

  const PROP_KEY      = '__unblur_shadow_root__';
  const REGISTRY_KEY  = '__unblur_shadow_hosts__';
  const INJECTED_ATTR = 'data-unblur-injected';
  const BTN_ID        = '__unblur_insert_btn__';
  const processedRoots = new WeakSet();

  window[REGISTRY_KEY] = window[REGISTRY_KEY] || [];

  // ─── Icon SVG (matches user's design: chat bubble + dark circle + plus) ──

  const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" style="width:100%;height:100%;display:block;">
    <rect x="2" y="2" width="54" height="48" rx="10" fill="#f6b900"/>
    <rect x="10" y="12" width="38" height="5" rx="2.5" fill="#c8900a"/>
    <rect x="10" y="22" width="38" height="5" rx="2.5" fill="#c8900a"/>
    <rect x="10" y="32" width="38" height="5" rx="2.5" fill="#c8900a"/>
    <rect x="10" y="42" width="26" height="5" rx="2.5" fill="#c8900a"/>
    <path d="M10,48 L10,64 L26,48 Z" fill="#f6b900"/>
    <circle cx="60" cy="60" r="20" fill="#1e1e2e"/>
    <rect x="57" y="49" width="6" height="22" rx="3" fill="white"/>
    <rect x="49" y="57" width="22" height="6" rx="3" fill="white"/>
  </svg>`;

  // ─── CSS injected into every shadow root ──────────────────────────────

  const UNBLUR_CSS = `
    /* Strip blur */
    .ftgla1i, .obscuredContent, .f1ll759f {
      filter: none !important;
      -webkit-filter: none !important;
    }
    /* Make text selectable everywhere */
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
      -webkit-text-security: none !important;
    }
    /* Hide white haze */
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
    /* FIX: Hide Get Plus / Dismiss via CSS — reliable, no text-matching needed */
    button + button,
    button:last-of-type {
      display: none !important;
    }
  `;

  function injectCSS(root) {
    if (!root || root.querySelector?.(`style[${INJECTED_ATTR}]`)) return;
    const s = document.createElement('style');
    s.setAttribute(INJECTED_ATTR, 'true');
    s.textContent = UNBLUR_CSS;
    try { root.appendChild(s); } catch (e) {}
  }

  // ─── Track last focused editable (main doc + iframes) ───────────────────
  // Captures the editor element across Gmail iframes, Google Docs, etc.

  let lastEditable = null;

  function registerEditable(el) {
    if (!el) return;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      lastEditable = { el, type: 'input', doc: el.ownerDocument };
    } else if (el.isContentEditable || el.contentEditable === 'true') {
      lastEditable = { el, type: 'contenteditable', doc: el.ownerDocument };
    }
  }

  // Track in main document
  document.addEventListener('focusin', (e) => registerEditable(e.target), true);

  // Track inside iframes (Gmail compose lives in an iframe on some configurations)
  function installIframeTracking(iframe) {
    if (iframe._unblurTracked) return;
    iframe._unblurTracked = true;
    const attach = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc || doc === document) return;
        doc.addEventListener('focusin', (e) => registerEditable(e.target), true);
        // Also check if something is already focused
        if (doc.activeElement) registerEditable(doc.activeElement);
      } catch (e) { /* cross-origin */ }
    };
    if (iframe.contentDocument?.readyState === 'complete') attach();
    else iframe.addEventListener('load', attach);
  }

  function trackAllIframes() {
    document.querySelectorAll('iframe').forEach(installIframeTracking);
  }

  // Observe for new iframes being added (Gmail adds compose iframes dynamically)
  const iframeObserver = new MutationObserver(trackAllIframes);
  document.addEventListener('DOMContentLoaded', () => {
    trackAllIframes();
    iframeObserver.observe(document.body || document.documentElement, {
      childList: true, subtree: true
    });
  });
  window.addEventListener('load', trackAllIframes);

  // ─── Text normalisation ───────────────────────────────────────────────
  // FIX: collapses NBSP, tabs, line-breaks, multi-spaces for fuzzy matching

  function norm(s) {
    return (s || '')
      .replace(/\u00a0|\u200b|\u200c|\u200d/g, ' ') // special spaces/ZWS
      .replace(/[\r\n\t]+/g, ' ')                    // line breaks / tabs
      .replace(/\s{2,}/g, ' ')                       // multi-space
      .trim();
  }

  // ─── DOM Text Extraction ──────────────────────────────────────────────
  //
  //  skipDeleted=true  → skip f1t69bad/strikeoutHorizontal (gives CLEAN text)
  //  skipAdded=true    → skip fp3q8eq                      (gives ORIGINAL text)

  function walkTree(rootEl, skipDeleted, skipAdded) {
    let text = '';
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) { text += node.textContent; return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const cls = node.classList;
      if (cls.contains('f1t69bad') || cls.contains('strikeoutHorizontal_f1hzeoet')) {
        if (!skipDeleted) node.childNodes.forEach(walk);
        return;
      }
      if (cls.contains('fp3q8eq')) {
        if (!skipAdded) node.childNodes.forEach(walk);
        return;
      }
      if (cls.contains('fdogkuf')) return; // spacers
      node.childNodes.forEach(walk);
    }
    walk(rootEl);
    return norm(text);
  }

  function extractCleanText(root) {
    const obscured = root.querySelector('.obscuredContent, .f1ll759f');
    if (!obscured) return '';
    return walkTree(obscured.querySelector('.ftgla1i') || obscured, true, false);
  }

  function extractOriginalText(root) {
    const obscured = root.querySelector('.obscuredContent, .f1ll759f');
    if (!obscured) return '';
    return walkTree(obscured.querySelector('.ftgla1i') || obscured, false, true);
  }

  // ─── Text Replacement ─────────────────────────────────────────────────

  function replaceInInput(el, original, replacement) {
    const raw = el.value;
    // Try exact, then normalised-whitespace version
    let idx = raw.indexOf(original);
    let len = original.length;
    if (idx === -1) {
      const normRaw = norm(raw);
      const normOrig = norm(original);
      idx = normRaw.indexOf(normOrig);
      if (idx === -1) return false;
      // Map normalised index back to raw (count chars up to idx in normRaw)
      // Approximation: use raw indexOf with collapsed-space version
      const collapsed = original.replace(/\s+/g, ' ');
      idx = raw.indexOf(collapsed);
      len = collapsed.length;
      if (idx === -1) return false;
    }
    el.focus();
    el.setSelectionRange(idx, idx + len);
    // Try execCommand first (preserves undo history)
    if (!document.execCommand('insertText', false, replacement)) {
      el.value = raw.slice(0, idx) + replacement + raw.slice(idx + len);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }

  function replaceInContentEditable(el, original, replacement) {
    // Walk text nodes, build full-text map with raw positions
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let fullText = '';
    const segs = [];
    let node;
    while ((node = walker.nextNode())) {
      segs.push({ node, start: fullText.length, len: node.textContent.length });
      fullText += node.textContent;
    }

    // Try exact, then whitespace-collapsed
    let idx = fullText.indexOf(original);
    let matchLen = original.length;
    if (idx === -1) {
      const collapsed = original.replace(/\s+/g, ' ');
      idx = fullText.replace(/\s+/g, ' ').indexOf(collapsed);
      matchLen = collapsed.length;
      if (idx === -1) return false;
      // Remap: walk through fullText counting collapsed chars to find raw pos
      let rawIdx = 0, collapsedCount = 0;
      for (let i = 0; i < fullText.length; i++) {
        if (collapsedCount === idx) { rawIdx = i; break; }
        if (/\s/.test(fullText[i])) {
          collapsedCount++;
          while (i + 1 < fullText.length && /\s/.test(fullText[i + 1])) i++;
        } else {
          collapsedCount++;
        }
      }
      idx = rawIdx;
    }

    const end = idx + matchLen;

    // FIX: bounds-check before setting range
    const startSeg = segs.find(s => idx >= s.start && idx <= s.start + s.len);
    const endSeg   = segs.find(s => end >= s.start && end <= s.start + s.len);
    if (!startSeg || !endSeg) return false;

    const startOff = idx - startSeg.start;
    const endOff   = end - endSeg.start;
    if (startOff < 0 || startOff > startSeg.node.textContent.length) return false;
    if (endOff   < 0 || endOff   > endSeg.node.textContent.length)   return false;

    try {
      const range = document.createRange();
      range.setStart(startSeg.node, startOff);
      range.setEnd(endSeg.node, endOff);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      el.focus();
      if (!document.execCommand('insertText', false, replacement)) {
        // Manual fallback using Range deleteContents + insertNode
        range.deleteContents();
        range.insertNode(document.createTextNode(replacement));
        // Collapse selection to end
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // ─── Search a single document for editable elements ──────────────────

  function searchDoc(doc, originalText, cleanText) {
    if (!doc) return false;

    // textarea / input
    for (const el of doc.querySelectorAll('textarea, input[type="text"], input:not([type])')) {
      if (el.value && replaceInInput(el, originalText, cleanText)) return true;
    }

    // contenteditable — Gmail body, Outlook, Notion, etc.
    for (const el of doc.querySelectorAll('[contenteditable]:not([contenteditable="false"])')) {
      const txt = norm(el.textContent || '');
      if (txt.length > 5 && txt.includes(norm(originalText))) {
        if (replaceInContentEditable(el, originalText, cleanText)) return true;
      }
    }

    return false;
  }

  // ─── Search all same-origin iframes ───────────────────────────────────
  // Covers Gmail compose window, Outlook web, etc.

  function searchIframes(originalText, cleanText) {
    for (const iframe of document.querySelectorAll('iframe')) {
      try {
        const doc = iframe.contentDocument;
        if (!doc || doc === document) continue;
        if (searchDoc(doc, originalText, cleanText)) return true;

        // Nested iframes (Google Docs has .docs-texteventtarget-iframe inside)
        for (const inner of doc.querySelectorAll('iframe')) {
          try {
            const innerDoc = inner.contentDocument;
            if (innerDoc && searchDoc(innerDoc, originalText, cleanText)) return true;
          } catch (e) {}
        }
      } catch (e) { /* cross-origin — skip */ }
    }
    return false;
  }

  // ─── Google Docs specific ──────────────────────────────────────────────
  // Google Docs text model is canvas-based. Input goes through a transparent
  // contenteditable div inside .docs-texteventtarget-iframe.

  function tryGoogleDocs(originalText, cleanText) {
    // Find the Google Docs input surface iframe
    const targetIframe = document.querySelector('.docs-texteventtarget-iframe');
    if (!targetIframe) return false;
    try {
      const doc = targetIframe.contentDocument;
      if (!doc) return false;
      const editDiv = doc.querySelector('[contenteditable="true"]') || doc.body;
      if (!editDiv) return false;
      editDiv.focus();
      // Google Docs responds to execCommand on its input surface
      return document.execCommand('insertText', false, cleanText) ||
             replaceInContentEditable(editDiv, originalText, cleanText);
    } catch (e) { return false; }
  }

  function applyToDocument(originalText, cleanText) {
    if (!cleanText) return false;

    // Strategy 1: lastEditable — captured via focusin (works for most sites)
    if (lastEditable) {
      const { el, type, doc: elDoc } = lastEditable;
      const container = elDoc || document;
      if (el && container.contains(el)) {
        const ok = type === 'input'
          ? replaceInInput(el, originalText, cleanText)
          : replaceInContentEditable(el, originalText, cleanText);
        if (ok) return true;
      }
    }

    // Strategy 2: document.activeElement
    const active = document.activeElement;
    if (active && active !== document.body && active.tagName !== 'BODY') {
      if (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT') {
        if (replaceInInput(active, originalText, cleanText)) return true;
      } else if (active.isContentEditable) {
        if (replaceInContentEditable(active, originalText, cleanText)) return true;
      }
    }

    // Strategy 3: Google Docs specific
    if (tryGoogleDocs(originalText, cleanText)) return true;

    // Strategy 4: search main document
    if (searchDoc(document, originalText, cleanText)) return true;

    // Strategy 5: search same-origin iframes (Gmail, Outlook, etc.)
    if (searchIframes(originalText, cleanText)) return true;

    return false;
  }

  function copyToClipboard(text) {
    const succeed = () => {};
    const fail = () => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
      document.documentElement.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove();
    };
    navigator.clipboard?.writeText(text).then(succeed).catch(fail) ?? fail();
  }

  // ─── Insert Button (MAIN DOM, fixed position) ─────────────────────────
  // FIX: Button is in the MAIN DOM — Grammarly shadow DOM can't block its
  // events or affect its positioning. No fragile class-name selectors needed.

  let _btn = null;
  let _currentRoot = null;

  function getBtn() {
    if (_btn && document.documentElement.contains(_btn)) return _btn;
    const btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.title = 'Apply suggestion to document';
    btn.innerHTML = ICON_SVG;
    btn.style.cssText = `
      all: initial;
      position: fixed !important;
      z-index: 2147483647 !important;
      width: 44px !important;
      height: 44px !important;
      padding: 0 !important;
      margin: 0 !important;
      background: none !important;
      border: none !important;
      cursor: pointer !important;
      display: none !important;
      pointer-events: auto !important;
      overflow: visible !important;
      box-sizing: border-box !important;
    `;

    // FIX: preventDefault stops button from stealing focus from the editor
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    }, true);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!_currentRoot) return;

      const cleanText    = extractCleanText(_currentRoot);
      const originalText = extractOriginalText(_currentRoot);

      if (!cleanText) return;

      const applied = applyToDocument(originalText, cleanText);
      if (!applied) copyToClipboard(cleanText);

      // Visual feedback: check → then restore icon
      btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" style="width:100%;height:100%;display:block;">
        <circle cx="40" cy="40" r="38" fill="#4caf50"/>
        <polyline points="20,42 34,56 60,28" fill="none" stroke="white" stroke-width="8"
          stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
      setTimeout(() => { btn.innerHTML = ICON_SVG; }, 1500);
    }, true);

    document.documentElement.appendChild(btn);
    _btn = btn;
    return btn;
  }

  function getPopupRect(root) {
    // GRAMMARLY-POPUPS host is 0x0 with overflow:visible — useless for positioning.
    // Instead, get the bounding rect from the actual visible card INSIDE the shadow root.
    const candidates = [
      root.querySelector('.overlayContainer'),
      root.querySelector('.fkf0s66'),
      root.querySelector('[class*="holder"]'),
      root.querySelector('[class*="base"]'),
      root.firstElementChild,
    ];
    for (const el of candidates) {
      if (!el) continue;
      try {
        const r = el.getBoundingClientRect();
        if (r.width > 10 && r.height > 10) return r;
      } catch (e) {}
    }
    // Last resort: host element
    try {
      const r = root.host?.getBoundingClientRect?.();
      if (r && r.width > 10) return r;
    } catch (e) {}
    return null;
  }

  function showBtn(root) {
    const rect = getPopupRect(root);
    if (!rect) return;
    const btn = getBtn();
    _currentRoot = root;
    // Position at top-right corner of the popup card
    btn.style.setProperty('top',     `${rect.top + 6}px`,                       'important');
    btn.style.setProperty('right',   `${window.innerWidth - rect.right + 6}px`,  'important');
    btn.style.setProperty('display', 'block',                                    'important');
  }

  function hideBtn() {
    _btn?.style.setProperty('display', 'none', 'important');
    _currentRoot = null;
  }

  // ─── Direct Blur Removal ──────────────────────────────────────────────

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

  // ─── Grammarly Reveal ─────────────────────────────────────────────────

  function revealGrammarly(root) {
    if (!root) return;
    try {
      const hasOverlay = root.querySelector('.overlayContainer, .fkf0s66');
      if (!hasOverlay) { hideBtn(); return; }

      root.querySelectorAll('.overlayContainer, .fkf0s66').forEach(container => {
        const obscured = container.querySelector('.obscuredContent, .f1ll759f');
        const visible  = container.querySelector('.visibleContent, .f2wnt2z');
        if (!obscured) return;

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
        obscured.querySelectorAll('.overlay, .f1a2899a').forEach(el => {
          el.style.setProperty('opacity', '0', 'important');
          el.style.setProperty('pointer-events', 'none', 'important');
        });
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

      // Show insert button — uses actual popup card rect, not host element
      showBtn(root);

    } catch (e) { console.error('[Unblur]', e); }
  }

  // ─── Event Interception (allow text selection in popup) ───────────────

  function isInGrammarlyPopup(target) {
    try {
      const path = target?.composedPath?.() || [];
      return path.some(el =>
        el.tagName === 'GRAMMARLY-POPUPS' || el.tagName === 'GRAMMARLY-MIRROR' ||
        (el.classList && (
          el.classList.contains('ftgla1i') || el.classList.contains('obscuredContent') ||
          el.classList.contains('f1ll759f') || el.classList.contains('visibleContent') ||
          el.classList.contains('f2wnt2z')
        ))
      );
    } catch (e) { return false; }
  }

  function installDocumentInterceptors() {
    ['selectstart', 'copy', 'contextmenu'].forEach(evt => {
      document.addEventListener(evt, (e) => {
        if (isInGrammarlyPopup(e.target)) e.stopImmediatePropagation();
      }, true);
    });
    // mousedown: intercept only inside popup, not on our button
    document.addEventListener('mousedown', (e) => {
      if (e.target?.id === BTN_ID) return;
      if (isInGrammarlyPopup(e.target)) e.stopImmediatePropagation();
    }, true);
  }

  function installShadowInterceptors(root) {
    ['selectstart', 'mousedown', 'copy', 'contextmenu'].forEach(evt => {
      root.addEventListener(evt, (e) => {
        e.stopImmediatePropagation();
      }, true);
    });
  }

  // ─── Shadow Root Processing ───────────────────────────────────────────

  function processShadowRoot(root) {
    if (!root || processedRoots.has(root)) return;
    processedRoots.add(root);

    injectCSS(root);
    installShadowInterceptors(root);
    root.querySelectorAll('*').forEach(unblurElement);
    revealGrammarly(root);

    let debounce = null;
    const obs = new MutationObserver((mutations) => {
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
          // If nodes removed and popup is empty now, hide button
          if (m.removedNodes.length) {
            if (!root.querySelector('.overlayContainer')) hideBtn();
          }
        }
        if (m.type === 'attributes') { unblurElement(m.target); changed = true; }
      });
      if (changed) {
        clearTimeout(debounce);
        debounce = setTimeout(() => revealGrammarly(root), 80);
      }
    });
    obs.observe(root, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ['style', 'class']
    });
  }

  // ─── DOM Scanner ─────────────────────────────────────────────────────

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

  // ─── attachShadow Override ────────────────────────────────────────────

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

  // ─── Boot ─────────────────────────────────────────────────────────────

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

  console.log('[Unblur] v2.3.1 — fixed: focus tracking, range bounds, icon, main-DOM button');
})();
