// dorkface report: everything from this session (search history, saved searches, metadata
// findings) laid out for printing, so the browser's "Save as PDF" turns it into a PDF.
// Built on demand into #report (shown only when printing) and cleared afterwards. Nothing is
// sent anywhere: printing to PDF happens in the browser. Also the searches CSV download.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const C = window.DorkCore;
  const M = window.DorkMeta;
  const {el} = window.Dork;

  const stamp = d => d.toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'});
  const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

  function data() {
    const saved = window.DorkSaved ? window.DorkSaved.getSaved() : [];
    const history = window.DorkSaved ? window.DorkSaved.getHistory() : [];
    const meta = window.DorkMetaPage ? window.DorkMetaPage.results() : [];
    return {saved, history, meta};
  }

  function table(head, rows, cls) {
    const t = el('table', `r-table ${cls}`);
    const thead = el('thead');
    const tr = el('tr');
    head.forEach(h => tr.append(el('th', null, h)));
    thead.append(tr);
    const tbody = el('tbody');
    rows.forEach(cells => {
      const row = el('tr');
      cells.forEach(c => { const td = el('td'); td.append(c); row.append(td); });
      tbody.append(row);
    });
    t.append(thead, tbody);
    return t;
  }

  // The query as a link to its Google search (links stay clickable in the saved PDF).
  function queryCell(spec) {
    const r = C.build(C.decodeSpec(C.encodeSpec(spec || {})) || {});
    if (!r.url) return el('span', 'r-mono', r.query || '(empty)');
    const a = el('a', 'r-mono', r.query);
    a.href = r.url;
    a.rel = 'noopener noreferrer';
    return a;
  }

  function searchSection(title, items, withName) {
    const s = el('section', 'r-section');
    s.append(el('h2', null, `${title} (${items.length})`));
    const rows = items.map(x => {
      const cells = [document.createTextNode(Number.isFinite(x.at) ? stamp(new Date(x.at)) : '')];
      if (withName) cells.push(document.createTextNode(x.name && x.name !== x.query ? x.name : ''));
      cells.push(queryCell(x.spec));
      return cells;
    });
    s.append(table(withName ? ['When', 'Name', 'Query'] : ['When', 'Query'], rows, withName ? 'r-saved' : 'r-history'));
    return s;
  }

  function metaSections(results) {
    const out = [];
    const summary = M.summarize(results);
    const sum = el('section', 'r-section');
    sum.append(el('h2', null, `Metadata summary (${plural(results.length, 'file')})`));
    const kinds = M.KINDS.filter(([k]) => summary[k].length);
    if (!kinds.length) sum.append(el('p', null, 'Nothing revealing found in these files.'));
    for (const [kind, label] of kinds) {
      sum.append(el('h3', null, label));
      sum.append(table(['Value', 'Files'], summary[kind].map(item => [
        document.createTextNode(item.value),
        document.createTextNode(`${item.files.length}: ${item.files.join(', ')}`),
      ], 'r-summary')));
    }
    out.push(sum);

    const files = el('section', 'r-section r-break');
    files.append(el('h2', null, 'Metadata by file'));
    for (const r of results) {
      const block = el('div', 'r-file');
      block.append(el('h3', null, `${r.name} (${r.typeLabel})`));
      if (r.error) block.append(el('p', 'r-note', r.error));
      r.notes.forEach(n => block.append(el('p', 'r-note', n)));
      if (r.fields.length) {
        block.append(table(['Field', 'Value'], r.fields.map(f => [
          document.createTextNode(f.label), document.createTextNode(f.value)]), 'r-fields'));
      }
      files.append(block);
    }
    out.push(files);
    return out;
  }

  function build() {
    const {saved, history, meta} = data();
    const now = new Date();
    const box = $('report');
    box.replaceChildren();
    const head = el('header', 'r-header');
    head.append(el('h1', null, 'dorkface report'));
    head.append(el('p', null, `Generated ${stamp(now)} in your browser.`));
    const parts = [];
    if (history.length) parts.push(`${plural(history.length, 'search', 'searches')} run this session`);
    if (saved.length) parts.push(plural(saved.length, 'saved search', 'saved searches'));
    if (meta.length) parts.push(plural(meta.length, 'file') + ' checked for metadata');
    head.append(el('p', null, parts.length ? `Contains ${parts.join(', ')}.` : 'Nothing to report yet.'));
    head.append(el('p', 'r-note', 'This report may list names, usernames, internal paths and other details found on ' +
      'your site. Store and share it like any other sensitive security finding.'));
    box.append(head);
    if (history.length) box.append(searchSection('Searches run this session', history, false));
    if (saved.length) box.append(searchSection('Saved searches', saved, true));
    if (meta.length) box.append(...metaSections(meta));
    return {now, empty: !parts.length};
  }

  // Open the print dialog; choosing "Save as PDF" there writes the file. The page title becomes
  // the suggested file name.
  function printReport(statusEl) {
    const {now, empty} = build();
    if (empty) {
      if (statusEl) statusEl.textContent = 'Nothing to export yet: run a search or check some files first.';
      $('report').replaceChildren();
      return;
    }
    const title = document.title;
    document.title = `dorkface report ${isoDay(now)}`;
    const restore = () => {
      document.title = title;
      $('report').replaceChildren();
      window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);
    window.print();
  }

  function download(text, name) {
    const url = URL.createObjectURL(new Blob([text], {type: 'text/csv;charset=utf-8'}));
    const a = el('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function searchesCsv() {
    const {saved, history} = data();
    const rows = [...history.map(x => ({list: 'history', name: '', at: x.at, spec: x.spec})),
      ...saved.map(x => ({list: 'saved', name: x.name, at: x.at, spec: x.spec}))];
    return {rows: rows.length, csv: C.searchesCsv(rows)};
  }

  document.querySelectorAll('[data-report="pdf"]').forEach(b => b.addEventListener('click', () => {
    printReport(document.getElementById(b.dataset.status));
  }));
  document.querySelectorAll('[data-report="searches-csv"]').forEach(b => b.addEventListener('click', () => {
    const {rows, csv} = searchesCsv();
    const status = document.getElementById(b.dataset.status);
    if (!rows) { if (status) status.textContent = 'No searches to export yet.'; return; }
    download(csv, `dorkface-searches-${isoDay(new Date())}.csv`);
  }));

  window.DorkReport = {build, printReport, download};
})();
