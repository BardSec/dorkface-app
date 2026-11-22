// dorkface query builder: a form spec -> a Google query string and search URL.
// Pure functions, no DOM: loaded by the page (window.DorkCore) and by node in the tests
// (tests/js/run_core.js). Never makes network requests; the page only links to the URL.
(function (root) {
  'use strict';

  const SEARCH_URL = 'https://www.google.com/search?q=';
  // Google ignores words past about 32 (operators count as words).
  const MAX_WORDS = 32;
  const MAX_LEN = 200;        // per text field
  const MAX_SITE_LEN = 253;   // longest DNS name
  const MAX_ITEMS = 10;       // "any of" / "exclude" list entries

  // File types offered in the dropdown. Anything else is refused (no free text).
  const FILETYPES = [
    {group: 'Documents', types: [
      ['pdf', 'PDF'], ['doc', 'Word (old .doc)'], ['docx', 'Word'], ['odt', 'OpenDocument text'],
      ['rtf', 'Rich text'], ['txt', 'Plain text'], ['ppt', 'PowerPoint (old .ppt)'], ['pptx', 'PowerPoint']]},
    {group: 'Spreadsheets & data', types: [
      ['xlsx', 'Excel'], ['xls', 'Excel (old .xls)'], ['ods', 'OpenDocument spreadsheet'], ['csv', 'CSV'],
      ['json', 'JSON'], ['xml', 'XML'], ['sql', 'SQL dump']]},
    {group: 'Config, logs & backups', types: [
      ['env', '.env settings'], ['conf', '.conf'], ['cfg', '.cfg'], ['ini', '.ini'], ['yml', 'YAML (.yml)'],
      ['yaml', 'YAML (.yaml)'], ['config', '.config'], ['log', 'Log file'], ['bak', 'Backup (.bak)']]},
    {group: 'Scripts', types: [['ps1', 'PowerShell'], ['sh', 'Shell script'], ['bat', 'Batch file']]},
  ];
  const FILETYPE_SET = new Set(FILETYPES.flatMap(g => g.types.map(t => t[0])));

  // Field order in the finished query (fixed, so output is predictable).
  const FIELDS = ['site', 'filetype', 'intitle', 'inurl', 'intext', 'phrase', 'anyof', 'exclude', 'after', 'before'];

  // Strip characters that could break out of a quoted value or the query:
  // straight and curly double quotes, control characters. Then collapse whitespace.
  function clean(value) {
    return String(value == null ? '' : value)
      .replace(/["“”„‟″＂]/g, ' ')
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Quote a value when Google would otherwise read it as several terms or as syntax:
  // spaces, parentheses, |, or a leading - / ~ (exclude / synonym).
  function term(value) {
    return /[\s()|]/.test(value) || /^[-~]/.test(value) || /^(OR|AND)$/.test(value) ? `"${value}"` : value;
  }

  // Comma-separated lists ("any of", "exclude"). A leading - typed by the user is dropped.
  function items(value) {
    return clean(value).split(',').map(s => s.trim().replace(/^-+\s*/, '').trim()).filter(Boolean);
  }

  // "WWW.Example.org:443/path?x" (with or without a scheme) -> "www.example.org". Returns {value, error}.
  function cleanSite(raw) {
    let s = clean(raw).toLowerCase();
    if (!s) return {value: ''};
    s = s.replace(/^site:/, '')
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')   // scheme
      .replace(/^[^/?#@]*@/, '')                // user:pass@
      .replace(/[/?#].*$/, '')                  // path, query, fragment
      .replace(/:\d*$/, '')                     // port
      .replace(/^\*\./, '')                     // *.example.org: site: already covers subdomains
      .replace(/\.+$/, '');                     // trailing dot
    if (s.length > MAX_SITE_LEN) return {value: '', error: 'That domain is too long.'};
    const label = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
    const ok = new RegExp(`^(?:${label}\\.)+(?=[a-z0-9-]*[a-z])${label}$`).test(s);
    if (!ok) {
      return {value: '', error: /[^\x00-\x7f]/.test(s)
        ? 'Use the plain ASCII form of the domain (e.g. xn--…), not accented letters.'
        : 'Enter a domain like example.com (a web address works too; the path is dropped).'};
    }
    return {value: s};
  }

  function validDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !isNaN(d) && d.toISOString().slice(0, 10) === s;
  }

  // Count words the way Google roughly does: each whitespace-separated piece,
  // with a quoted phrase counting every word inside it.
  function wordCount(query) {
    return query.split(/\s+/).filter(w => w.replace(/[()"|]/g, '')).filter(w => w !== 'OR').length;
  }

  // spec: {site, filetype, intitle, inurl, intext, phrase, anyof, exclude, after, before} (all strings, all optional).
  // Returns {query, url, parts: [{field, text, explain}], errors: [{field, message}], warnings: [string]}.
  // url is null when the query is empty or any field has an error.
  function build(spec) {
    spec = spec || {};
    const parts = [];
    const errors = [];
    const warnings = [];
    const err = (field, message) => errors.push({field, message});
    const tooLong = (field, max) => {
      const raw = String(spec[field] == null ? '' : spec[field]);
      if (raw.length > max) { err(field, `Keep this under ${max} characters.`); return true; }
      return false;
    };

    for (const field of FIELDS) {
      const raw = spec[field];
      if (raw == null || String(raw).trim() === '') continue;
      if (field === 'site') {
        if (tooLong(field, MAX_SITE_LEN + 100)) continue;  // allow room for https:// and a path
        const s = cleanSite(raw);
        if (s.error) { err(field, s.error); continue; }
        parts.push({field, text: `site:${s.value}`, explain: `Only pages on ${s.value} and its subdomains`});
        if (s.value.startsWith('www.')) {
          warnings.push(`site:${s.value} only covers the www host. Use ${s.value.slice(4)} to include every subdomain.`);
        }
      } else if (field === 'filetype') {
        const t = clean(raw).toLowerCase().replace(/^\./, '');
        if (!FILETYPE_SET.has(t)) { err(field, 'Pick a file type from the list.'); continue; }
        parts.push({field, text: `filetype:${t}`, explain: `Only .${t} files`});
      } else if (field === 'intitle' || field === 'inurl' || field === 'intext') {
        if (tooLong(field, MAX_LEN)) continue;
        const v = clean(raw);
        if (!v) continue;
        const where = {intitle: 'page title', inurl: 'web address', intext: 'page text'}[field];
        parts.push({field, text: `${field}:${term(v)}`, explain: `“${v}” appears in the ${where}`});
      } else if (field === 'phrase') {
        if (tooLong(field, MAX_LEN)) continue;
        const v = clean(raw);
        if (!v) continue;
        parts.push({field, text: `"${v}"`, explain: `The exact phrase “${v}” appears on the page`});
      } else if (field === 'anyof' || field === 'exclude') {
        if (tooLong(field, MAX_LEN)) continue;
        const list = items(raw);
        if (!list.length) continue;
        if (list.length > MAX_ITEMS) { err(field, `Use at most ${MAX_ITEMS} entries.`); continue; }
        if (field === 'anyof') {
          const text = list.length === 1 ? term(list[0]) : `(${list.map(term).join(' OR ')})`;
          parts.push({field, text, explain: list.length === 1
            ? `“${list[0]}” appears on the page`
            : `At least one of: ${list.map(x => `“${x}”`).join(', ')}`});
        } else {
          parts.push({field, text: list.map(x => `-${term(x)}`).join(' '),
            explain: `Leave out pages with ${list.map(x => `“${x}”`).join(' or ')}`});
        }
      } else if (field === 'after' || field === 'before') {
        const v = clean(raw);
        if (!validDate(v)) { err(field, 'Use a date like 2024-08-01.'); continue; }
        parts.push({field, text: `${field}:${v}`, explain: `Indexed ${field} ${v} (Google's date, approximate)`});
      }
    }

    const after = clean(spec.after), before = clean(spec.before);
    if (validDate(after) && validDate(before) && after >= before) {
      err('before', 'The “before” date must be later than the “after” date.');
    }

    const query = parts.map(p => p.text).join(' ');
    const words = query ? wordCount(query) : 0;
    if (words > MAX_WORDS) {
      warnings.push(`This query has about ${words} words. Google ignores everything after roughly ${MAX_WORDS}.`);
    }
    if (query && !parts.some(p => p.field === 'site')) {
      warnings.push('No site: set, so this searches the whole web. Add your domain to audit your own organization.');
    }
    const url = query && !errors.length ? SEARCH_URL + encodeURIComponent(query) : null;
    return {query, url, parts, errors, warnings};
  }

  // A catalog entry plus the user's domain -> a builder spec. Fields the entry sets
  // win over nothing; the domain fills site:.
  function fromTemplate(entry, site) {
    return Object.assign({}, entry.fields, {site: site || ''});
  }

  // Share links: the spec goes in the URL fragment (#b=…), which browsers never send to servers.
  function encodeSpec(spec) {
    const slim = {};
    for (const f of FIELDS) if (spec && spec[f]) slim[f] = String(spec[f]);
    const json = JSON.stringify(slim);
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeSpec(text) {
    try {
      const bin = atob(String(text).replace(/-/g, '+').replace(/_/g, '/'));
      const obj = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))));
      const spec = {};
      if (obj && typeof obj === 'object') {
        for (const f of FIELDS) if (typeof obj[f] === 'string') spec[f] = obj[f].slice(0, MAX_SITE_LEN + 100);
      }
      return spec;
    } catch (e) {
      return null;
    }
  }

  const api = {build, cleanSite, fromTemplate, encodeSpec, decodeSpec, clean,
    FIELDS, FILETYPES, MAX_WORDS, MAX_LEN, MAX_SITE_LEN, MAX_ITEMS, SEARCH_URL};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DorkCore = api;
})(this);
