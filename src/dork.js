// dorkface page: tabs (hash routing), shared helpers and the builder.
// Query logic lives in dork_core.js (DorkCore). Never makes network requests (and the
// page's CSP would block them anyway); the only thing that leaves is a Google link the user clicks.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const C = window.DorkCore;

  // --- helpers shared with catalog.js and saved.js --------------------------------
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };

  // sessionStorage / localStorage can throw (blocked storage, private mode, quota). Fail quietly.
  const store = {
    get(area, key, fallback) {
      try { const v = window[area].getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set(area, key, value) {
      try { window[area].setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
    },
    remove(area, key) {
      try { window[area].removeItem(key); } catch (e) { /* ignore */ }
    },
  };

  function flash(btn, text) {
    const old = btn.textContent;
    btn.textContent = text;
    setTimeout(() => { btn.textContent = old; }, 1400);
  }

  async function copy(text, btn) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (e) {
      // Older browsers / non-secure contexts: copy through a temporary textarea.
      const ta = el('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.className = 'position-fixed top-0 start-0 opacity-0';
      document.body.append(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
      ta.remove();
    }
    if (btn) flash(btn, ok ? 'Copied' : 'Copy failed');
  }

  // Colored query text built from DorkCore parts (textContent only, never HTML).
  function highlight(parts) {
    const frag = document.createDocumentFragment();
    parts.forEach((p, i) => {
      if (i) frag.append(' ');
      if (p.field === 'phrase') {
        frag.append(el('span', 'q-str', p.text));
      } else if (p.field === 'exclude') {
        frag.append(el('span', 'q-neg', p.text));
      } else if (p.field === 'anyof') {
        for (const tok of p.text.match(/"[^"]*"|\bOR\b|[()]|[^\s()]+|\s+/g) || []) {
          if (tok === 'OR') frag.append(el('span', 'q-kw', tok));
          else if (tok.startsWith('"')) frag.append(el('span', 'q-str', tok));
          else frag.append(tok);
        }
      } else {
        const at = p.text.indexOf(':');
        frag.append(el('span', 'q-op', p.text.slice(0, at + 1)));
        const rest = p.text.slice(at + 1);
        frag.append(rest.startsWith('"') ? el('span', 'q-str', rest) : rest);
      }
    });
    return frag;
  }

  // "Search on Google": a plain link opened in a new tab, with no referrer. Records history on click.
  function searchLink(result, spec, cls) {
    if (!result.url) {
      const b = el('button', `btn ${cls || 'btn-primary'}`, 'Search on Google ↗');
      b.type = 'button';
      b.disabled = true;
      return b;
    }
    const a = el('a', `btn ${cls || 'btn-primary'}`, 'Search on Google ↗');
    a.href = result.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.addEventListener('click', () => { if (window.DorkSaved) window.DorkSaved.addHistory(spec, result.query); });
    return a;
  }

  function button(text, cls, onClick) {
    const b = el('button', `btn ${cls}`, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  // --- tabs ------------------------------------------------------------------------
  const VIEWS = ['catalog', 'builder', 'metadata', 'saved'];
  function show(view) {
    document.querySelectorAll('[data-view]').forEach(v => { v.hidden = v.dataset.view !== view; });
    document.querySelectorAll('[data-tab]').forEach(a => {
      a.classList.toggle('active', a.dataset.tab === view);
      a.setAttribute('aria-selected', a.dataset.tab === view);
    });
    document.dispatchEvent(new CustomEvent('dork:view', {detail: view}));
  }

  function route() {
    const hash = location.hash.slice(1);
    // Share link: #b=<spec>. Load it into the builder, then tidy the address bar.
    if (hash.startsWith('b=')) {
      const spec = C.decodeSpec(hash.slice(2));
      if (spec) writeForm(spec);
      update();
      history.replaceState(null, '', '#builder');
      show('builder');
      return;
    }
    const tab = hash.split('/')[0];
    show(VIEWS.includes(tab) ? tab : 'home');
  }

  // --- builder ---------------------------------------------------------------------
  const DRAFT_KEY = 'dork.draft';  // sessionStorage: gone when the tab closes (shared computers)
  const form = $('b-form');
  const input = f => form.elements[f];

  for (const g of C.FILETYPES) {
    const og = el('optgroup');
    og.label = g.group;
    for (const [value, label] of g.types) {
      const o = el('option', null, `${label} (.${value})`);
      o.value = value;
      og.append(o);
    }
    input('filetype').append(og);
  }

  function readForm() {
    const spec = {};
    for (const f of C.FIELDS) {
      const v = input(f).value;
      if (v.trim()) spec[f] = v;
    }
    return spec;
  }

  function writeForm(spec) {
    for (const f of C.FIELDS) {
      const v = spec[f] || '';
      if (f === 'filetype' && v && !C.FILETYPES.some(g => g.types.some(t => t[0] === v))) {
        input(f).value = '';
      } else {
        input(f).value = v;
      }
    }
  }

  let current = {spec: {}, result: C.build({})};

  function update() {
    const spec = readForm();
    const r = C.build(spec);
    current = {spec, result: r};

    const pre = $('b-query');
    pre.replaceChildren();
    if (r.query) pre.append(highlight(r.parts));
    else pre.append(el('span', 'q-empty', 'Your query appears here as you fill in the form.'));

    const bad = new Map(r.errors.map(e => [e.field, e.message]));
    for (const f of C.FIELDS) {
      input(f).classList.toggle('is-invalid', bad.has(f));
      form.querySelector(`[data-error="${f}"]`).textContent = bad.get(f) || '';
    }

    const actions = $('b-actions');
    actions.replaceChildren(
      searchLink(r, spec),
      button('Copy query', 'btn-outline-secondary', e => copy(r.query, e.currentTarget)),
      button('Copy share link', 'btn-outline-secondary', e => copy(shareLink(spec), e.currentTarget)),
    );
    actions.querySelectorAll('button:not(:first-child)').forEach(b => { b.disabled = !r.query; });

    const warn = $('b-warnings');
    warn.replaceChildren(...r.warnings.map(w => el('div', 'alert alert-warning py-2 small mb-2', w)));
    if (r.errors.length) {
      warn.prepend(el('div', 'alert alert-danger py-2 small mb-2', 'Fix the highlighted fields to search.'));
    }

    const list = $('b-explain');
    list.replaceChildren(...r.parts.map(p => {
      const li = el('li', 'mb-1');
      li.append(el('code', 'explain-op', p.text.length > 28 ? p.text.slice(0, 27) + '…' : p.text), p.explain);
      return li;
    }));
    $('b-explain-box').hidden = !r.parts.length;
    $('b-save-box').hidden = !r.url;

    if (Object.keys(spec).length) store.set('sessionStorage', DRAFT_KEY, spec);
    else store.remove('sessionStorage', DRAFT_KEY);
  }

  function shareLink(spec) {
    return `${location.origin}${location.pathname}#b=${C.encodeSpec(spec)}`;
  }

  form.addEventListener('input', update);
  form.addEventListener('submit', e => e.preventDefault());
  $('b-clear').addEventListener('click', () => { form.reset(); update(); input('site').focus(); });
  $('b-save').addEventListener('click', e => {
    if (!current.result.url || !window.DorkSaved) return;
    const name = $('b-save-name').value.trim() || current.result.query;
    if (window.DorkSaved.save(name, current.spec, current.result.query)) {
      $('b-save-name').value = '';
      flash(e.currentTarget, 'Saved ✓');
    } else {
      flash(e.currentTarget, "Couldn't save");
    }
  });

  function openInBuilder(spec) {
    writeForm(spec || {});
    update();
    location.hash = '#builder';
  }

  window.Dork = {el, copy, highlight, searchLink, button, store, openInBuilder};

  writeForm(store.get('sessionStorage', DRAFT_KEY, {}) || {});
  update();
  window.addEventListener('hashchange', route);
  // catalog.js and saved.js load after this file; route once they've registered their listeners.
  document.addEventListener('DOMContentLoaded', route);
})();
