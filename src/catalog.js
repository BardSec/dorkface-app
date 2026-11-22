// dorkface Catalog tab: ready-made searches (catalog.py, rendered into the page as JSON).
// The user types their domain once; every entry gets site:<domain>. Searching needs a
// domain: the catalog is for auditing your own organization, not the whole web.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const C = window.DorkCore;
  const {el, copy, highlight, searchLink, button, store, openInBuilder} = window.Dork;
  const {categories, entries} = JSON.parse($('dork-data').textContent).catalog;

  const DOMAIN_KEY = 'dork.domain';  // sessionStorage, like the builder draft
  let category = '';

  const siteInput = $('c-site');
  siteInput.value = store.get('sessionStorage', DOMAIN_KEY, '') || '';

  function chips() {
    const box = $('c-cats');
    box.replaceChildren(...['', ...categories].map(cat => {
      const b = button(cat || 'All', `btn-sm rounded-pill cat-chip${cat === category ? ' active' : ''}`, () => {
        category = cat;
        chips();
        render();
      });
      b.setAttribute('aria-pressed', cat === category);
      return b;
    }));
  }

  function render() {
    const raw = siteInput.value.trim();
    const site = raw ? C.cleanSite(raw) : {value: ''};
    siteInput.classList.toggle('is-invalid', Boolean(site.error));
    $('c-site-error').textContent = site.error || '';
    if (raw) store.set('sessionStorage', DOMAIN_KEY, raw); else store.remove('sessionStorage', DOMAIN_KEY);
    const ready = Boolean(site.value);

    const needle = $('c-filter').value.trim().toLowerCase();
    const shown = entries.filter(e => (!category || e.category === category) &&
      (!needle || `${e.label} ${e.description} ${e.category}`.toLowerCase().includes(needle)));

    const out = [];
    if (!ready) {
      out.push(el('div', 'alert alert-info py-2 small', 'Enter your domain above to run these searches.'));
    }
    for (const cat of categories) {
      const group = shown.filter(e => e.category === cat);
      if (!group.length) continue;
      out.push(el('h2', 'c-cat-head', cat));
      for (const e of group) out.push(card(e, site.value, ready));
    }
    if (!shown.length) out.push(el('p', 'text-body-secondary small', 'No searches match that filter.'));
    $('c-list').replaceChildren(...out);
  }

  function card(entry, site, ready) {
    const spec = C.fromTemplate(entry, site);
    const r = C.build(spec);
    const box = el('div', 'c-card');
    box.id = `c-${entry.id}`;
    box.append(el('h3', 'h6 mb-1', entry.label), el('p', 'small text-body-secondary mb-2', entry.description));

    const code = el('div', 'code-block mb-2');
    const pre = el('pre', 'mb-0 font-monospace small');
    pre.append(highlight(r.parts));
    code.append(pre);
    box.append(code);

    const actions = el('div', 'd-flex flex-wrap gap-1');
    const go = searchLink(ready ? r : {url: null}, spec, 'btn-sm btn-primary');
    if (!ready) go.title = 'Enter your domain first';
    const cp = button('Copy', 'btn-sm btn-outline-secondary', ev => copy(r.query, ev.currentTarget));
    actions.append(go, cp, button('Open in builder', 'btn-sm btn-outline-secondary', () => openInBuilder(spec)));
    box.append(actions);

    if (entry.next) box.append(el('p', 'small text-body-secondary mt-2 mb-0 c-next', `If it finds something: ${entry.next}`));
    return box;
  }

  siteInput.addEventListener('input', render);
  $('c-filter').addEventListener('input', render);
  chips();
  render();
})();
