// dorkface Saved tab: saved searches (localStorage, until deleted) and history
// (sessionStorage, gone when the tab closes, which matters on shared computers).
// Stored entries are re-checked with DorkCore.build before use, so an edited or stale
// entry can't produce a query the builder wouldn't.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const C = window.DorkCore;
  const {el, copy, highlight, searchLink, button, store, openInBuilder} = window.Dork;

  const SAVED_KEY = 'dork.saved';
  const HISTORY_KEY = 'dork.history';
  const MAX_SAVED = 100;
  const MAX_HISTORY = 50;

  const list = (area, key) => {
    const v = store.get(area, key, []);
    return Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && x.spec && typeof x.spec === 'object') : [];
  };
  const getSaved = () => list('localStorage', SAVED_KEY);
  const getHistory = () => list('sessionStorage', HISTORY_KEY);
  const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  function save(name, spec, query) {
    const items = getSaved().filter(x => x.query !== query);
    items.unshift({id: newId(), name: String(name).slice(0, 80), spec, query, at: Date.now()});
    const ok = store.set('localStorage', SAVED_KEY, items.slice(0, MAX_SAVED));
    render();
    return ok;
  }

  function addHistory(spec, query) {
    const items = getHistory().filter(x => x.query !== query);
    items.unshift({id: newId(), spec, query, at: Date.now()});
    store.set('sessionStorage', HISTORY_KEY, items.slice(0, MAX_HISTORY));
    render();
  }

  function remove(area, key, id) {
    store.set(area, key, list(area, key).filter(x => x.id !== id));
    render();
  }

  const when = t => {
    const d = new Date(t);
    return isNaN(d) ? '' : d.toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'});
  };

  function item(entry, kind) {
    // Rebuild from the stored spec (cleaned the same way share links are).
    const spec = C.decodeSpec(C.encodeSpec(entry.spec)) || {};
    const r = C.build(spec);
    const box = el('div', 's-item');
    const head = el('div', 'd-flex flex-wrap align-items-baseline gap-2 mb-1');
    if (kind === 'saved' && entry.name && entry.name !== r.query) head.append(el('strong', 'me-1', entry.name));
    head.append(el('span', 'small text-body-secondary ms-auto', when(entry.at)));
    box.append(head);

    const code = el('div', 'code-block mb-2');
    const q = el('pre', 'mb-0 font-monospace small');
    if (r.query) q.append(highlight(r.parts)); else q.append(el('span', 'q-empty', '(empty search)'));
    code.append(q);
    box.append(code);

    const actions = el('div', 'd-flex flex-wrap gap-1');
    actions.append(
      searchLink(r, spec, 'btn-sm btn-primary'),
      button('Open in builder', 'btn-sm btn-outline-secondary', () => openInBuilder(spec)),
      button('Copy', 'btn-sm btn-outline-secondary', e => copy(r.query, e.currentTarget)),
    );
    if (kind === 'history' && r.url) {
      actions.append(button('Save', 'btn-sm btn-outline-secondary', e => {
        save(r.query, spec, r.query);
        e.currentTarget.textContent = 'Saved ✓';
      }));
    }
    actions.append(button(kind === 'saved' ? 'Delete' : 'Remove', 'btn-sm btn-outline-danger ms-auto', () => {
      if (kind === 'saved') remove('localStorage', SAVED_KEY, entry.id);
      else remove('sessionStorage', HISTORY_KEY, entry.id);
    }));
    box.append(actions);
    return box;
  }

  function render() {
    const saved = getSaved();
    const history = getHistory();
    $('s-saved').replaceChildren(...(saved.length ? saved.map(x => item(x, 'saved'))
      : [el('p', 'small text-body-secondary', 'Nothing saved yet. Use “Save this search” in the builder.')]));
    $('s-history').replaceChildren(...(history.length ? history.map(x => item(x, 'history'))
      : [el('p', 'small text-body-secondary', 'No searches opened from this tab yet.')]));
    $('s-clear-saved').hidden = !saved.length;
    $('s-clear-history').hidden = !history.length;
  }

  // Clear-all buttons need a second click within a few seconds (no browser dialogs).
  function confirmClick(btn, label, action) {
    const original = btn.textContent;
    let armed = null;
    btn.addEventListener('click', () => {
      if (armed) {
        clearTimeout(armed);
        armed = null;
        btn.textContent = original;
        action();
        return;
      }
      btn.textContent = label;
      armed = setTimeout(() => { armed = null; btn.textContent = original; }, 4000);
    });
  }
  confirmClick($('s-clear-saved'), 'Click again to delete all', () => { store.remove('localStorage', SAVED_KEY); render(); });
  confirmClick($('s-clear-history'), 'Click again to clear', () => { store.remove('sessionStorage', HISTORY_KEY); render(); });

  // Another tab changed saved searches: keep this one in step.
  window.addEventListener('storage', e => { if (e.key === SAVED_KEY || e.key === null) render(); });
  document.addEventListener('dork:view', e => { if (e.detail === 'saved') render(); });

  window.DorkSaved = {save, addHistory, getSaved, getHistory};
  render();
})();
