// dorkface Metadata tab: drop files, read their metadata locally (meta_core.js), show a
// summary across files plus per-file details, and export CSV.
// Files are read with the File API and never uploaded (the CSP blocks network requests anyway).
// Results aren't stored: files can be sensitive, so a reload starts clean.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const M = window.DorkMeta;
  const {el, button} = window.Dork;

  const KIND_LABELS = Object.fromEntries(M.KINDS);
  const MONO = new Set(['path', 'server', 'email', 'location']);
  const SHOW = 25;  // summary values shown before "show all"

  let results = [];
  let chain = Promise.resolve();
  const zone = $('m-drop');
  const input = $('m-files');

  const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  zone.addEventListener('dragenter', e => { if (hasFiles(e)) { e.preventDefault(); zone.classList.add('over'); } });
  zone.addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); zone.classList.add('over'); } });
  zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('over'); });
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('over');
    if (e.dataTransfer.files.length) add(e.dataTransfer.files);
  });
  // A file dropped anywhere else would make the browser open it and leave the page.
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', e => { if (hasFiles(e) && !zone.contains(e.target)) e.preventDefault(); });
  input.addEventListener('change', () => {
    const files = [...input.files];
    input.value = '';
    if (files.length) add(files);
  });

  const status = text => { $('m-status').textContent = text; };
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function add(fileList) {
    const files = [...fileList];
    chain = chain.then(async () => {
      const room = M.MAX_FILES - results.length;
      const take = files.slice(0, Math.max(0, room));
      for (let i = 0; i < take.length; i++) {
        const f = take[i];
        status(`Reading ${i + 1} of ${take.length}: ${f.name}`);
        let r;
        if (f.size > M.MAX_FILE) {
          r = {name: f.name, size: f.size, type: 'unknown', typeLabel: 'Too large', fields: [], notes: [],
            error: `Too large to read here (over ${M.MAX_FILE / 1024 / 1024} MB).`};
        } else {
          try {
            r = await M.parse(new Uint8Array(await f.arrayBuffer()), f.name);
          } catch (e) {
            r = {name: f.name, size: f.size, type: 'unknown', typeLabel: 'Unknown', fields: [], notes: [],
              error: 'Couldn’t read this file.'};
          }
        }
        results.push(r);
        render();
      }
      const skipped = files.length - take.length;
      status(`${plural(results.length, 'file')} read in your browser. Nothing was uploaded.` +
        (skipped > 0 ? ` ${plural(skipped, 'file')} skipped (limit ${M.MAX_FILES}).` : ''));
    });
  }

  function summaryCard(kind, items) {
    const card = el('div', 'b-section h-100 mb-0');
    const head = el('div', 'b-head d-flex justify-content-between gap-2');
    head.append(el('span', null, KIND_LABELS[kind]), el('span', 'badge text-bg-secondary align-self-center', String(items.length)));
    card.append(head);
    const list = el('ul', 'list-unstyled small mb-0 m-list');
    const fill = n => {
      list.replaceChildren(...items.slice(0, n).map(item => {
        const li = el('li', 'd-flex justify-content-between gap-2');
        li.append(el('span', MONO.has(kind) ? 'font-monospace m-value' : 'm-value', item.value));
        const count = el('span', 'text-body-secondary text-nowrap', plural(item.files.length, 'file'));
        count.title = item.files.join('\n');
        li.append(count);
        return li;
      }));
    };
    fill(SHOW);
    card.append(list);
    if (items.length > SHOW) {
      const more = button(`Show all ${items.length}`, 'btn-link btn-sm p-0 mt-1', () => { fill(items.length); more.remove(); });
      card.append(more);
    }
    return card;
  }

  function fileDetails(r) {
    const d = el('details', 'm-file');
    const s = el('summary');
    s.append(el('span', 'fw-semibold me-2 m-value', r.name), el('span', 'badge text-bg-light border me-2', r.typeLabel));
    const interesting = r.fields.filter(f => KIND_LABELS[f.kind]).length;
    s.append(el('span', `small ${r.error ? 'text-danger' : 'text-body-secondary'}`,
      r.error ? r.error : `${plural(r.fields.length, 'field')}${interesting ? `, ${interesting} worth a look` : ''}`));
    d.append(s);
    for (const n of r.notes) d.append(el('div', 'small text-body-secondary mt-2', n));
    if (r.fields.length) {
      const table = el('table', 'table table-sm small mb-0 mt-2');
      const tbody = el('tbody');
      for (const f of r.fields) {
        const tr = el('tr');
        const label = el('th', 'fw-normal text-body-secondary m-label', f.label);
        const value = el('td', MONO.has(f.kind) ? 'font-monospace m-value' : 'm-value', f.value);
        const kind = el('td', 'text-end');
        if (KIND_LABELS[f.kind]) kind.append(el('span', `badge m-kind m-kind-${f.kind}`, f.kind));
        tr.append(label, value, kind);
        tbody.append(tr);
      }
      table.append(tbody);
      d.append(table);
    }
    return d;
  }

  function render() {
    $('m-csv').disabled = $('m-clear').disabled = !results.length;
    const summary = M.summarize(results);
    const cards = M.KINDS.filter(([kind]) => summary[kind].length).map(([kind]) => {
      const col = el('div', 'col-md-6 col-xl-4');
      col.append(summaryCard(kind, summary[kind]));
      return col;
    });
    const sumBox = $('m-summary');
    sumBox.replaceChildren();
    if (results.length) {
      sumBox.append(el('h2', 'h5 mb-2', 'What these files reveal'));
      if (cards.length) {
        const row = el('div', 'row g-3 mb-4');
        row.append(...cards);
        sumBox.append(row);
      } else {
        sumBox.append(el('p', 'small text-body-secondary mb-4', 'Nothing revealing found in these files.'));
      }
    }
    const list = $('m-results');
    list.replaceChildren();
    if (results.length) {
      list.append(el('h2', 'h5 mb-2', 'Files'));
      list.append(...results.map(fileDetails));
    }
  }

  $('m-csv').addEventListener('click', () => {
    const blob = new Blob([M.toCsv(results)], {type: 'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = el('a');
    a.href = url;
    a.download = 'dorkface-metadata.csv';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  });
  $('m-clear').addEventListener('click', () => {
    chain = chain.then(() => { results = []; render(); status(''); });
  });

  // For the report (report.js).
  window.DorkMetaPage = {results: () => results.slice()};

  render();
})();
