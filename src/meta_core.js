// dorkface metadata reader: file bytes -> the hidden details a document gives away
// (authors, usernames, software versions, internal paths and servers, GPS positions).
// Pure functions, no DOM, no libraries: loaded by the page (window.DorkMeta) and by node in
// the tests (tests/js/run_meta.js). Files are read locally; nothing is uploaded or fetched.
//
// Formats: PDF (Info dictionary + XMP, including compressed object streams), Office Open XML
// (docx/xlsx/pptx) and OpenDocument (odt/ods/odp) via a small zip reader, JPEG (EXIF/GPS, XMP)
// and PNG (text chunks, eXIf, XMP). Decompression uses the browser's DecompressionStream.
(function (root) {
  'use strict';

  const MAX_FILE = 100 * 1024 * 1024;     // bytes per file
  const MAX_FILES = 500;                  // files per session
  const MAX_INFLATE = 32 * 1024 * 1024;   // decompressed bytes per stream / zip entry
  const MAX_VALUE = 2000;                 // characters kept per value

  // Summary groups, in display order. Fields of other kinds ('date', 'other') show per file only.
  const KINDS = [
    ['person', 'People & usernames'],
    ['email', 'Email addresses'],
    ['server', 'Servers & hosts'],
    ['path', 'Internal paths & linked files'],
    ['software', 'Software & versions'],
    ['device', 'Devices'],
    ['org', 'Organizations & tenants'],
    ['location', 'Locations (GPS)'],
  ];
  const TYPE_LABELS = {pdf: 'PDF', docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint', odt: 'OpenDocument text',
    ods: 'OpenDocument spreadsheet', odp: 'OpenDocument presentation', zip: 'Zip', jpeg: 'JPEG', png: 'PNG',
    ole: 'Older Office file', unknown: 'Unknown'};

  // --- bytes and text ------------------------------------------------------------

  // One character per byte (offsets in the string match offsets in the file).
  function latin1(bytes, start = 0, end = bytes.length) {
    let out = '';
    for (let i = start; i < end; i += 0x8000) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(end, i + 0x8000)));
    }
    return out;
  }
  const utf8 = bytes => new TextDecoder('utf-8').decode(bytes);

  function concat(chunks, total) {
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
  }

  // Decompress zlib ('deflate') or raw deflate ('deflate-raw'). Damaged data or trailing junk
  // keeps whatever decompressed before the error; output is capped at MAX_INFLATE.
  async function inflate(bytes, format) {
    if (typeof DecompressionStream === 'undefined') return null;
    const ds = new DecompressionStream(format);
    const writer = ds.writable.getWriter();
    writer.write(bytes).catch(() => {});
    writer.close().catch(() => {});
    const reader = ds.readable.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
        if (total > MAX_INFLATE) { reader.cancel().catch(() => {}); break; }
      }
    } catch (e) { /* keep the partial output */ }
    return concat(chunks, total);
  }

  // --- collecting fields -----------------------------------------------------------

  function collector() {
    const fields = [];
    const seen = new Set();
    return {
      fields,
      add(label, value, kind = 'other') {
        if (value == null) return;
        let v = String(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/g, '')
          .replace(/\s+/g, ' ').trim();
        if (!v) return;
        if (v.length > MAX_VALUE) v = v.slice(0, MAX_VALUE) + '…';
        const key = `${label}\u0000${v}`;
        if (seen.has(key)) return;
        seen.add(key);
        fields.push({label, value: v, kind});
      },
    };
  }

  // Custom document properties. Microsoft 365 sensitivity labels (MSIP_Label_<guid>_*) carry the
  // organization's tenant ID and the label name.
  function customProp(out, name, value) {
    if (/^MSIP_Label_.*_SiteId$/i.test(name)) out.add('Microsoft 365 tenant ID', value, 'org');
    else if (/^MSIP_Label_.*_Name$/i.test(name)) out.add('Sensitivity label', value, 'other');
    else if (/^MSIP_Label_/i.test(name)) return;  // label GUIDs, timestamps, method: noise
    else out.add(`Custom: ${name}`, value);
  }

  // --- details hidden inside values: paths, usernames, servers, emails ------------------

  const PATH_PATTERNS = [
    /\bfile:\/\/[^\s"'<>]+/gi,                          // file:///C:/..., file://server/share
    /\\\\[A-Za-z0-9._$-]+(?:\\[^<>"|?*\r\n]*)?/g,      // \\server\share\...
    /(?<![A-Za-z0-9])[A-Za-z]:\\[^<>"|?*\r\n]*/g,       // C:\Users\...
    /(?<![A-Za-z0-9.:/])\/(?:Users|home|Volumes)\/[^\s"'<>]+/g,  // /Users/name/..., /home/name/...
  ];
  const NOT_USERS = new Set(['public', 'default', 'default user', 'all users', 'shared', 'desktop']);
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

  function derive(out) {
    for (const f of [...out.fields]) {
      if (f.kind === 'date') continue;
      const paths = [];
      for (const re of PATH_PATTERNS) {
        for (const m of f.value.matchAll(re)) paths.push(m[0].replace(/[\s.,;)]+$/, ''));
      }
      for (const p of paths) {
        if (f.kind !== 'path') out.add('Internal path', p, 'path');
        const unix = p.replace(/\\/g, '/');
        const user = unix.match(/\/(?:Users|home|Documents and Settings)\/([^/]+)/i);
        if (user && !NOT_USERS.has(user[1].toLowerCase()) && !user[1].includes('@')) {
          out.add('Username from path', user[1], 'person');
        }
        const server = unix.match(/^(?:file:)?\/\/+([A-Za-z0-9._$-]+)\//i);
        if (server && !/^[A-Za-z]:$/.test(server[1]) && server[1].toLowerCase() !== 'localhost') {
          out.add('Server from path', server[1], 'server');
        }
      }
      for (const m of f.value.matchAll(EMAIL)) out.add('Email address', m[0], 'email');
    }
  }

  // --- XML (regex-based: no DOMParser in node, and these files are small and regular) ----

  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
      e = e.toLowerCase();
      if (e[0] === '#') {
        const n = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        try { return String.fromCodePoint(n); } catch (err) { return ''; }
      }
      return {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"}[e];
    });
  }
  const xmlText = s => decodeEntities(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ').trim();
  // Inner XML of every <tag ...>...</tag>.
  function elements(xml, tag) {
    const re = new RegExp(`<${esc(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${esc(tag)}>`, 'g');
    return [...xml.matchAll(re)].map(m => m[1]);
  }
  // Every value of attribute `name` on any element.
  function attrValues(xml, name) {
    const re = new RegExp(`\\s${esc(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'g');
    return [...xml.matchAll(re)].map(m => decodeEntities(m[1] !== undefined ? m[1] : m[2]));
  }
  // Attributes of one tag's attribute string.
  function attrs(tagText) {
    const out = {};
    for (const m of tagText.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      out[m[1]] = decodeEntities(m[2] !== undefined ? m[2] : m[3]);
    }
    return out;
  }
  function textOf(xml, tag) {
    const v = elements(xml, tag).map(xmlText).filter(Boolean);
    return v.length ? v[0] : '';
  }

  // XMP: Adobe's XML metadata, found in PDFs, images and some Office exports.
  const XMP_PROPS = [
    ['dc:creator', 'Author (XMP)', 'person'],
    ['dc:title', 'Title (XMP)', 'other'],
    ['dc:description', 'Description (XMP)', 'other'],
    ['dc:rights', 'Rights (XMP)', 'other'],
    ['xmp:CreatorTool', 'Created with (XMP)', 'software'],
    ['pdf:Producer', 'PDF producer (XMP)', 'software'],
    ['pdf:Keywords', 'Keywords (XMP)', 'other'],
    ['xmp:CreateDate', 'Created (XMP)', 'date'],
    ['xmp:ModifyDate', 'Modified (XMP)', 'date'],
    ['photoshop:AuthorsPosition', 'Author position (XMP)', 'other'],
    ['photoshop:Credit', 'Credit (XMP)', 'person'],
    ['xmpMM:DocumentID', 'Document ID (XMP)', 'other'],
    ['stEvt:softwareAgent', 'Edited with (XMP history)', 'software'],
    ['exif:GPSLatitude', 'GPS latitude (XMP)', 'location'],
    ['exif:GPSLongitude', 'GPS longitude (XMP)', 'location'],
  ];
  function parseXmp(xml, out) {
    if (!xml || !/<x:xmpmeta|<rdf:RDF/.test(xml)) return false;
    for (const [prop, label, kind] of XMP_PROPS) {
      for (const inner of elements(xml, prop)) {
        const items = elements(inner, 'rdf:li');
        for (const v of (items.length ? items : [inner])) out.add(label, xmlText(v), kind);
      }
      for (const v of attrValues(xml, prop)) out.add(label, v, kind);
    }
    // Custom properties Office writes when exporting to PDF (pdfx:Name).
    for (const m of xml.matchAll(/<pdfx:([\w.-]+)(?:\s[^>]*)?>([\s\S]*?)<\/pdfx:\1>/g)) customProp(out, m[1], xmlText(m[2]));
    for (const m of xml.matchAll(/\spdfx:([\w.-]+)\s*=\s*"([^"]*)"/g)) customProp(out, m[1], decodeEntities(m[2]));
    return true;
  }

  // --- PDF -------------------------------------------------------------------------

  const PDF_WS = '\0\t\n\f\r ';
  const PDF_DELIM = '()<>[]{}/%';
  function skipWs(s, i) {
    for (;;) {
      while (i < s.length && PDF_WS.includes(s[i])) i++;
      if (s[i] !== '%') return i;
      while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++;
    }
  }
  const NUM = /[+-]?(?:\d+\.?\d*|\.\d+)/y;
  const REF_TAIL = /\s+(\d+)\s+R(?![A-Za-z0-9])/y;
  const ESCAPES = {n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92};

  function parseLiteral(s, i) {
    const out = [];
    let depth = 1;
    i++;
    while (i < s.length) {
      const c = s.charCodeAt(i);
      if (c === 0x5c) {
        const n = s[i + 1];
        i += 2;
        if (n === undefined) break;
        if (Object.prototype.hasOwnProperty.call(ESCAPES, n)) out.push(ESCAPES[n]);
        else if (n >= '0' && n <= '7') {
          let oct = n;
          while (oct.length < 3 && s[i] >= '0' && s[i] <= '7') oct += s[i++];
          out.push(parseInt(oct, 8) & 255);
        } else if (n === '\r') { if (s[i] === '\n') i++; } else if (n !== '\n') out.push(n.charCodeAt(0));
        continue;
      }
      if (c === 0x28) depth++;
      else if (c === 0x29 && --depth === 0) return {v: {t: 'str', b: out}, i: i + 1};
      out.push(c);
      i++;
    }
    return {v: {t: 'str', b: out}, i};
  }

  // One PDF object: dict, array, string, name, number, reference, boolean or null.
  function parseValue(s, i, depth = 0) {
    if (depth > 64) throw new Error('too deep');
    i = skipWs(s, i);
    const c = s[i];
    if (c === '<' && s[i + 1] === '<') {
      const d = Object.create(null);
      i += 2;
      for (;;) {
        i = skipWs(s, i);
        if (i >= s.length) throw new Error('unterminated dict');
        if (s[i] === '>' && s[i + 1] === '>') return {v: {t: 'dict', d}, i: i + 2};
        if (s[i] !== '/') throw new Error('bad dict key');
        const k = parseValue(s, i, depth + 1);
        const v = parseValue(s, k.i, depth + 1);
        d[k.v.v] = v.v;
        i = v.i;
      }
    }
    if (c === '<') {
      const end = s.indexOf('>', i);
      if (end < 0) throw new Error('unterminated hex');
      let hex = s.slice(i + 1, end).replace(/[^0-9a-fA-F]/g, '');
      if (hex.length % 2) hex += '0';
      const b = [];
      for (let k = 0; k < hex.length; k += 2) b.push(parseInt(hex.slice(k, k + 2), 16));
      return {v: {t: 'str', b}, i: end + 1};
    }
    if (c === '(') return parseLiteral(s, i);
    if (c === '/') {
      let j = i + 1;
      while (j < s.length && !PDF_WS.includes(s[j]) && !PDF_DELIM.includes(s[j])) j++;
      const v = s.slice(i + 1, j).replace(/#([0-9a-fA-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)));
      return {v: {t: 'name', v}, i: j};
    }
    if (c === '[') {
      const a = [];
      i++;
      for (;;) {
        i = skipWs(s, i);
        if (i >= s.length) throw new Error('unterminated array');
        if (s[i] === ']') return {v: {t: 'array', a}, i: i + 1};
        const r = parseValue(s, i, depth + 1);
        a.push(r.v);
        i = r.i;
      }
    }
    NUM.lastIndex = i;
    const num = NUM.exec(s);
    if (num) {
      const j = i + num[0].length;
      if (/^\d+$/.test(num[0])) {
        REF_TAIL.lastIndex = j;
        const ref = REF_TAIL.exec(s);
        if (ref) return {v: {t: 'ref', n: +num[0], g: +ref[1]}, i: REF_TAIL.lastIndex};
      }
      return {v: {t: 'num', v: +num[0]}, i: j};
    }
    for (const kw of ['true', 'false', 'null']) {
      if (s.startsWith(kw, i)) return {v: {t: 'kw', v: kw}, i: i + kw.length};
    }
    throw new Error('unexpected token');
  }

  // PDF text strings: UTF-16BE with a BOM, UTF-8 with a BOM, or PDFDocEncoding (~Latin-1).
  function pdfString(b) {
    if (b[0] === 0xFE && b[1] === 0xFF) {
      let out = '';
      for (let k = 2; k + 1 < b.length; k += 2) out += String.fromCharCode((b[k] << 8) | b[k + 1]);
      return out;
    }
    if (b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) return utf8(Uint8Array.from(b.slice(3)));
    return String.fromCharCode.apply(null, b);
  }

  // D:20210304102201-05'00' -> 2021-03-04 10:22:01 -05:00
  function pdfDate(v) {
    const m = v.match(/^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/);
    if (!m) return v;
    let out = m[1];
    if (m[2]) out += `-${m[2]}`;
    if (m[3]) out += `-${m[3]}`;
    if (m[4]) out += ` ${m[4]}:${m[5] || '00'}:${m[6] || '00'}`;
    if (m[7] && m[4]) out += /z/i.test(m[7]) ? ' UTC' : ` ${m[7]}${m[8] || '00'}:${m[9] || '00'}`;
    return out;
  }

  const PDF_INFO = {
    Title: ['Title', 'other'], Author: ['Author', 'person'], Subject: ['Subject', 'other'],
    Keywords: ['Keywords', 'other'], Creator: ['Created with', 'software'], Producer: ['PDF producer', 'software'],
    CreationDate: ['Created', 'date'], ModDate: ['Modified', 'date'], Company: ['Company', 'org'],
    Manager: ['Manager', 'person'], SourceModified: ['Source modified', 'date'], Trapped: null,
  };

  async function parsePdf(bytes, out, notes) {
    const s = latin1(bytes);
    const version = s.slice(0, 1024).match(/%PDF-(\d\.\d)/);
    if (version) out.add('PDF version', version[1]);

    // One pass over every "n g obj": later definitions (incremental updates) win. Stream data is
    // skipped, so binary content isn't mistaken for objects.
    const objects = new Map();
    const re = /(\d+)\s+(\d+)\s+obj(?![A-Za-z0-9])/g;
    let m;
    while ((m = re.exec(s))) {
      let r;
      try { r = parseValue(s, re.lastIndex); } catch (e) { continue; }
      const obj = {v: r.v};
      let j = skipWs(s, r.i);
      if (r.v.t === 'dict' && s.startsWith('stream', j)) {
        j += 6;
        if (s[j] === '\r') j++;
        if (s[j] === '\n') j++;
        const end = s.indexOf('endstream', j);
        if (end < 0) break;
        let e = end;
        if (s[e - 1] === '\n') e--;
        if (s[e - 1] === '\r') e--;
        obj.stream = [j, Math.max(j, e)];
        re.lastIndex = end + 9;
      } else {
        re.lastIndex = Math.max(re.lastIndex, r.i);
      }
      objects.set(+m[1], obj);
    }

    async function streamBytes(obj) {
      if (!obj || !obj.stream) return null;
      const raw = bytes.subarray(obj.stream[0], obj.stream[1]);
      const f = obj.v.d.Filter;
      const filters = !f ? [] : f.t === 'array' ? f.a.map(x => x.v) : [f.v];
      if (!filters.length) return raw;
      if (filters.length === 1 && (filters[0] === 'FlateDecode' || filters[0] === 'Fl')) return inflate(raw, 'deflate');
      return null;
    }

    // Objects inside compressed object streams (PDF 1.5+): only unpacked when something we need
    // isn't a top-level object.
    let unpacked = false;
    async function unpackObjectStreams() {
      if (unpacked) return;
      unpacked = true;
      let budget = 2000;
      for (const obj of [...objects.values()]) {
        const d = obj.v.d;
        if (!obj.stream || !d.Type || d.Type.v !== 'ObjStm' || budget-- <= 0) continue;
        const data = await streamBytes(obj);
        if (!data) continue;
        const t = latin1(data);
        const first = d.First && d.First.v;
        if (!Number.isInteger(first)) continue;
        const head = t.slice(0, first).trim().split(/\s+/).map(Number);
        for (let k = 0; k + 1 < head.length; k += 2) {
          if (objects.has(head[k])) continue;
          try { objects.set(head[k], {v: parseValue(t, first + head[k + 1]).v}); } catch (e) { /* skip */ }
        }
      }
    }
    async function get(ref) {
      if (!ref || ref.t !== 'ref') return null;
      if (!objects.has(ref.n)) await unpackObjectStreams();
      return objects.get(ref.n) || null;
    }
    const lastRef = key => {
      const all = [...s.matchAll(new RegExp(`/${key}\\s+(\\d+)\\s+(\\d+)\\s+R(?![A-Za-z0-9])`, 'g'))];
      return all.length ? {t: 'ref', n: +all[all.length - 1][1], g: +all[all.length - 1][2]} : null;
    };
    async function text(v) {
      if (!v) return '';
      if (v.t === 'ref') { const o = await get(v); return o && o.v.t !== 'ref' ? text(o.v) : ''; }
      if (v.t === 'str') return pdfString(v.b);
      if (v.t === 'name' || v.t === 'num' || v.t === 'kw') return String(v.v);
      if (v.t === 'array') return (await Promise.all(v.a.map(text))).filter(Boolean).join(', ');
      return '';
    }

    const encrypted = /\/Encrypt\s*(?:\d+\s+\d+\s+R|<<)/.test(s);
    if (encrypted) notes.push('This PDF is encrypted, so its document properties can’t be read. Any XMP metadata below was stored unencrypted.');

    // Document information dictionary (from the trailer or the cross-reference stream).
    const info = await get(lastRef('Info'));
    if (!encrypted && info && info.v.t === 'dict') {
      for (const [key, v] of Object.entries(info.v.d)) {
        const value = await text(v);
        if (!value) continue;
        const known = PDF_INFO[key];
        if (known === null) continue;
        if (known) out.add(known[0], known[1] === 'date' ? pdfDate(value) : value, known[1]);
        else customProp(out, key, /^D:\d{4}/.test(value) ? pdfDate(value) : value);
      }
    }

    // XMP metadata stream, linked from the document catalog.
    let xmpFound = false;
    const cat = await get(lastRef('Root'));
    if (cat && cat.v.t === 'dict' && cat.v.d.Metadata) {
      const meta = await get(cat.v.d.Metadata);
      const data = await streamBytes(meta);
      if (data) xmpFound = parseXmp(utf8(data), out);
    }
    if (!xmpFound) {
      const start = s.indexOf('<x:xmpmeta');
      const end = start >= 0 ? s.indexOf('</x:xmpmeta>', start) : -1;
      if (end > 0) parseXmp(utf8(bytes.subarray(start, end + 12)), out);
    }
    if (!objects.size) notes.push('No PDF objects found: the file may be damaged or truncated.');
  }

  // --- zip (Office Open XML, OpenDocument) -----------------------------------------------

  function readZip(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('This zip file is damaged or truncated.');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = new Map();
    for (let k = 0; k < count && p + 46 <= bytes.length; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const nlen = dv.getUint16(p + 28, true);
      const name = utf8(bytes.subarray(p + 46, p + 46 + nlen));
      entries.set(name.toLowerCase(), {
        name, method: dv.getUint16(p + 10, true), csize: dv.getUint32(p + 20, true), off: dv.getUint32(p + 42, true),
      });
      p += 46 + nlen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
    }
    async function read(name) {
      const e = entries.get(name.toLowerCase());
      if (!e || e.off + 30 > bytes.length || dv.getUint32(e.off, true) !== 0x04034b50) return null;
      const start = e.off + 30 + dv.getUint16(e.off + 26, true) + dv.getUint16(e.off + 28, true);
      const raw = bytes.subarray(start, Math.min(bytes.length, start + e.csize));
      if (e.method === 0) return raw.length > MAX_INFLATE ? raw.subarray(0, MAX_INFLATE) : raw;
      if (e.method === 8) return inflate(raw, 'deflate-raw');
      return null;
    }
    return {entries, read, text: async name => { const b = await read(name); return b ? utf8(b) : null; }};
  }

  const CORE_PROPS = [
    ['dc:creator', 'Author', 'person'], ['cp:lastModifiedBy', 'Last modified by', 'person'],
    ['dc:title', 'Title', 'other'], ['dc:subject', 'Subject', 'other'], ['cp:keywords', 'Keywords', 'other'],
    ['dc:description', 'Comments', 'other'], ['cp:category', 'Category', 'other'],
    ['cp:contentStatus', 'Status', 'other'], ['cp:revision', 'Revision', 'other'],
    ['dcterms:created', 'Created', 'date'], ['dcterms:modified', 'Modified', 'date'],
    ['cp:lastPrinted', 'Last printed', 'date'],
  ];
  // External relationships worth reporting (hyperlinks are ordinary web links, so they're left out).
  const LINK_TYPES = [
    [/attachedTemplate$/i, 'Attached template'], [/externalLinkPath$/i, 'Linked workbook'],
    [/oleObject$/i, 'Linked object'], [/subDocument$/i, 'Linked document'], [/frame$/i, 'Linked frame'],
    [/(image|audio|video|package)$/i, 'Linked file'],
  ];

  async function parseZip(bytes, out, notes) {
    const z = readZip(bytes);
    const has = n => z.entries.has(n.toLowerCase());
    let type = 'zip';
    if (has('word/document.xml')) type = 'docx';
    else if (has('xl/workbook.xml')) type = 'xlsx';
    else if (has('ppt/presentation.xml')) type = 'pptx';
    else if (has('meta.xml') || has('mimetype')) {
      const mime = (await z.text('mimetype')) || '';
      type = /presentation/.test(mime) ? 'odp' : /spreadsheet/.test(mime) ? 'ods' : 'odt';
    }
    if (type === 'zip') {
      notes.push('This is a zip file, but not an Office or OpenDocument file.');
      return type;
    }

    // Office Open XML document properties.
    const core = await z.text('docProps/core.xml');
    if (core) for (const [tag, label, kind] of CORE_PROPS) out.add(label, textOf(core, tag), kind);
    const app = await z.text('docProps/app.xml');
    if (app) {
      const name = textOf(app, 'Application');
      const version = textOf(app, 'AppVersion');
      out.add('Application', [name, version].filter(Boolean).join(' '), 'software');
      out.add('Company', textOf(app, 'Company'), 'org');
      out.add('Manager', textOf(app, 'Manager'), 'person');
      out.add('Template', textOf(app, 'Template'));
      const minutes = textOf(app, 'TotalTime');
      if (minutes && minutes !== '0') out.add('Editing time (minutes)', minutes);
      out.add('Hyperlink base', textOf(app, 'HyperlinkBase'), 'path');
    }
    const custom = await z.text('docProps/custom.xml');
    if (custom) {
      for (const m of custom.matchAll(/<property\b([^>]*)>([\s\S]*?)<\/property>/g)) {
        const name = attrs(m[1]).name;
        if (name) customProp(out, name, xmlText(m[2]));
      }
    }

    // Linked templates, workbooks and files (often on internal file servers).
    for (const e of z.entries.values()) {
      if (!e.name.toLowerCase().endsWith('.rels')) continue;
      const rels = await z.text(e.name);
      if (!rels) continue;
      for (const m of rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
        const a = attrs(m[1]);
        if (a.TargetMode !== 'External' || !a.Type || !a.Target) continue;
        const kind = LINK_TYPES.find(([re]) => re.test(a.Type));
        if (kind) out.add(kind[1], a.Target, 'path');
      }
    }

    if (type === 'docx') {
      const comments = await z.text('word/comments.xml');
      if (comments) {
        attrValues(comments, 'w:author').forEach(v => out.add('Comment author', v, 'person'));
        const n = (comments.match(/<w:comment\b/g) || []).length;
        if (n) out.add('Comments', String(n));
      }
      const doc = await z.text('word/document.xml');
      if (doc) {
        const changes = [...doc.matchAll(/<w:(?:ins|del)\b([^>]*)>/g)].map(m => attrs(m[1])['w:author']).filter(Boolean);
        changes.forEach(v => out.add('Tracked change by', v, 'person'));
        if (changes.length) out.add('Tracked changes', String(changes.length));
      }
      const people = await z.text('word/people.xml');
      if (people) {
        attrValues(people, 'w15:author').forEach(v => out.add('Reviewer', v, 'person'));
        attrValues(people, 'w15:userId').forEach(v => out.add('Reviewer account', v, 'person'));
      }
    } else if (type === 'xlsx') {
      const wb = await z.text('xl/workbook.xml');
      if (wb) {
        for (const m of wb.matchAll(/<x15ac:absPath\b([^>]*)\/?>/g)) out.add('Saved from folder', attrs(m[1]).url, 'path');
        const hidden = (wb.match(/<sheet\b[^>]*\bstate="(?:hidden|veryHidden)"/g) || []).length;
        if (hidden) out.add('Hidden sheets', String(hidden));
      }
      for (const e of z.entries.values()) {
        if (/^xl\/comments\d*\.xml$/i.test(e.name)) {
          const c = await z.text(e.name);
          if (c) elements(c, 'author').map(xmlText).forEach(v => out.add('Comment author', v, 'person'));
        } else if (/^xl\/persons\/person\d*\.xml$/i.test(e.name)) {
          const c = await z.text(e.name);
          if (c) {
            attrValues(c, 'displayName').forEach(v => out.add('Comment author', v, 'person'));
            attrValues(c, 'userId').forEach(v => out.add('Comment author account', v, 'person'));
          }
        }
      }
    } else if (type === 'pptx') {
      const ca = await z.text('ppt/commentAuthors.xml');
      if (ca) attrValues(ca, 'name').forEach(v => out.add('Comment author', v, 'person'));
      const au = await z.text('ppt/authors.xml');
      if (au) {
        attrValues(au, 'name').forEach(v => out.add('Comment author', v, 'person'));
        attrValues(au, 'userId').forEach(v => out.add('Comment author account', v, 'person'));
      }
    } else {
      // OpenDocument meta.xml
      const meta = await z.text('meta.xml');
      if (meta) {
        out.add('Author', textOf(meta, 'meta:initial-creator'), 'person');
        out.add('Last modified by', textOf(meta, 'dc:creator'), 'person');
        out.add('Last printed by', textOf(meta, 'meta:printed-by'), 'person');
        out.add('Application', textOf(meta, 'meta:generator'), 'software');
        out.add('Title', textOf(meta, 'dc:title'));
        out.add('Subject', textOf(meta, 'dc:subject'));
        out.add('Comments', textOf(meta, 'dc:description'));
        elements(meta, 'meta:keyword').map(xmlText).forEach(v => out.add('Keywords', v));
        out.add('Created', textOf(meta, 'meta:creation-date'), 'date');
        out.add('Modified', textOf(meta, 'dc:date'), 'date');
        out.add('Last printed', textOf(meta, 'meta:print-date'), 'date');
        out.add('Revision', textOf(meta, 'meta:editing-cycles'));
        out.add('Editing time', textOf(meta, 'meta:editing-duration'));
        for (const m of meta.matchAll(/<meta:template\b([^>]*)\/?>/g)) out.add('Template', attrs(m[1])['xlink:href'], 'path');
        for (const m of meta.matchAll(/<meta:user-defined\b([^>]*)>([\s\S]*?)<\/meta:user-defined>/g)) {
          const name = attrs(m[1])['meta:name'];
          if (name) customProp(out, name, xmlText(m[2]));
        }
      }
    }
    return type;
  }

  // --- images ---------------------------------------------------------------------------

  // EXIF (a TIFF structure) from JPEG APP1 or PNG eXIf.
  function parseTiff(t, out) {
    if (t.length < 8 || !((t[0] === 0x49 && t[1] === 0x49) || (t[0] === 0x4D && t[1] === 0x4D))) return;
    const le = t[0] === 0x49;
    const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
    const u16 = o => dv.getUint16(o, le);
    const u32 = o => dv.getUint32(o, le);
    const SIZES = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8};
    function ifd(off) {
      const tags = new Map();
      if (!off || off + 2 > t.length) return tags;
      const n = u16(off);
      for (let k = 0; k < n && k < 512; k++) {
        const e = off + 2 + k * 12;
        if (e + 12 > t.length) break;
        const type = u16(e + 2);
        const count = u32(e + 4);
        const size = (SIZES[type] || 0) * count;
        if (!size || size > 65536) continue;
        const vo = size <= 4 ? e + 8 : u32(e + 8);
        if (vo + size > t.length) continue;
        tags.set(u16(e), {type, count, vo});
      }
      return tags;
    }
    const str = f => f ? utf8(t.subarray(f.vo, f.vo + f.count)).replace(/\0[\s\S]*$/, '').trim() : '';
    const int = f => !f ? 0 : f.type === 3 ? u16(f.vo) : u32(f.vo);
    const rat = (f, k) => { const b = u32(f.vo + 8 * k + 4); return b ? u32(f.vo + 8 * k) / b : 0; };

    const ifd0 = ifd(u32(4));
    const make = str(ifd0.get(0x010F));
    const model = str(ifd0.get(0x0110));
    out.add('Camera', model.toLowerCase().startsWith(make.toLowerCase()) ? model : `${make} ${model}`, 'device');
    out.add('Software', str(ifd0.get(0x0131)), 'software');
    out.add('Modified', str(ifd0.get(0x0132)), 'date');
    out.add('Artist', str(ifd0.get(0x013B)), 'person');
    out.add('Copyright', str(ifd0.get(0x8298)));
    out.add('Description', str(ifd0.get(0x010E)));
    const xpAuthor = ifd0.get(0x9C9D);  // Windows "Authors" (UTF-16LE bytes)
    if (xpAuthor) {
      const b = t.subarray(xpAuthor.vo, xpAuthor.vo + xpAuthor.count);
      let s = '';
      for (let k = 0; k + 1 < b.length; k += 2) s += String.fromCharCode(b[k] | (b[k + 1] << 8));
      out.add('Author (Windows)', s.replace(/\0+$/, ''), 'person');
    }
    const exif = ifd(int(ifd0.get(0x8769)));
    out.add('Taken', str(exif.get(0x9003)), 'date');
    out.add('Camera owner', str(exif.get(0xA430)), 'person');
    out.add('Camera serial number', str(exif.get(0xA431)), 'device');
    out.add('Lens', str(exif.get(0xA434)), 'device');
    const gps = ifd(int(ifd0.get(0x8825)));
    const lat = gps.get(2), lon = gps.get(4);
    if (lat && lon && lat.type === 5 && lon.type === 5 && lat.count >= 3 && lon.count >= 3) {
      const deg = f => rat(f, 0) + rat(f, 1) / 60 + rat(f, 2) / 3600;
      const la = deg(lat) * (/S/i.test(str(gps.get(1))) ? -1 : 1);
      const lo = deg(lon) * (/W/i.test(str(gps.get(3))) ? -1 : 1);
      if (Math.abs(la) <= 90 && Math.abs(lo) <= 180 && (la || lo)) out.add('GPS position', `${la.toFixed(6)}, ${lo.toFixed(6)}`, 'location');
    }
  }

  function parseJpeg(bytes, out) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const XMP_ID = 'http://ns.adobe.com/xap/1.0/\0';
    let p = 2;
    while (p + 4 <= bytes.length && bytes[p] === 0xFF) {
      const marker = bytes[p + 1];
      if (marker === 0xD9 || marker === 0xDA) break;          // end of image / start of scan data
      if (marker === 0xFF) { p++; continue; }
      if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { p += 2; continue; }
      const size = dv.getUint16(p + 2);
      if (size < 2) break;
      const seg = bytes.subarray(p + 4, Math.min(bytes.length, p + 2 + size));
      if (marker === 0xE1 && latin1(seg, 0, Math.min(6, seg.length)) === 'Exif\0\0') parseTiff(seg.subarray(6), out);
      else if (marker === 0xE1 && latin1(seg, 0, Math.min(XMP_ID.length, seg.length)) === XMP_ID) parseXmp(utf8(seg.subarray(XMP_ID.length)), out);
      else if (marker === 0xFE) out.add('Comment', utf8(seg));
      p += 2 + size;
    }
  }

  const PNG_KEYS = {Author: ['Author', 'person'], Software: ['Software', 'software'], 'Creation Time': ['Created', 'date'],
    Title: ['Title', 'other'], Description: ['Description', 'other'], Comment: ['Comment', 'other'],
    Copyright: ['Copyright', 'other'], Source: ['Device', 'device'], Disclaimer: null, Warning: null};

  function parsePng(bytes, out) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let p = 8;
    while (p + 12 <= bytes.length) {
      const n = dv.getUint32(p);
      const type = latin1(bytes, p + 4, p + 8);
      const data = bytes.subarray(p + 8, Math.min(bytes.length, p + 8 + n));
      let kw = null, text = null;
      if (type === 'tEXt') {
        const z = data.indexOf(0);
        if (z > 0) { kw = latin1(data, 0, z); text = latin1(data, z + 1); }
      } else if (type === 'iTXt') {
        const z = data.indexOf(0);
        if (z > 0 && data[z + 1] === 0) {  // uncompressed only
          kw = latin1(data, 0, z);
          const lang = data.indexOf(0, z + 3);
          const trans = lang >= 0 ? data.indexOf(0, lang + 1) : -1;
          if (trans >= 0) text = utf8(data.subarray(trans + 1));
        }
      } else if (type === 'eXIf') {
        parseTiff(data, out);
      } else if (type === 'IEND') {
        break;
      }
      if (kw !== null && text !== null) {
        if (kw === 'XML:com.adobe.xmp') parseXmp(text, out);
        else if (PNG_KEYS[kw] !== null) {
          const [label, kind] = PNG_KEYS[kw] || [`Text: ${kw}`, 'other'];
          out.add(label, text, kind);
        }
      }
      p += 12 + n;
    }
  }

  // --- entry points -----------------------------------------------------------------------

  function sniff(bytes) {
    const head = latin1(bytes, 0, Math.min(1024, bytes.length));
    if (head.startsWith('PK\x03\x04') || head.startsWith('PK\x05\x06')) return 'zip';
    if (head.startsWith('\xFF\xD8\xFF')) return 'jpeg';
    if (head.startsWith('\x89PNG\r\n\x1a\n')) return 'png';
    if (head.startsWith('\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1')) return 'ole';
    if (head.includes('%PDF-')) return 'pdf';  // the header may follow some junk bytes
    return 'unknown';
  }

  // bytes: Uint8Array. Returns {name, size, type, typeLabel, fields: [{label, value, kind}], notes, error}.
  async function parse(bytes, name) {
    const out = collector();
    const notes = [];
    let type = 'unknown';
    let error = null;
    try {
      if (bytes.length > MAX_FILE) throw new Error(`Too large to read here (over ${MAX_FILE / 1024 / 1024} MB).`);
      if (!bytes.length) throw new Error('This file is empty.');
      type = sniff(bytes);
      if (type === 'pdf') await parsePdf(bytes, out, notes);
      else if (type === 'zip') type = await parseZip(bytes, out, notes);
      else if (type === 'jpeg') parseJpeg(bytes, out);
      else if (type === 'png') parsePng(bytes, out);
      else if (type === 'ole') notes.push('Older Office formats (.doc, .xls, .ppt) aren’t supported yet. Save as .docx/.xlsx/.pptx to check them, or use exiftool.');
      else notes.push('dorkface reads PDF, Word/Excel/PowerPoint (.docx, .xlsx, .pptx), OpenDocument, JPEG and PNG files.');
      derive(out);
    } catch (e) {
      error = e && e.message && !/^(too deep|unterminated|bad dict|unexpected)/.test(e.message)
        ? e.message : 'Couldn’t read this file. It may be damaged.';
    }
    if (!error && !out.fields.length && !notes.length) notes.push('No metadata found.');
    return {name: String(name || ''), size: bytes.length, type, typeLabel: TYPE_LABELS[type] || type,
      fields: out.fields, notes, error};
  }

  // Across files: kind -> [{value, files: [names]}], most files first.
  function summarize(results) {
    const groups = {};
    for (const [kind] of KINDS) groups[kind] = new Map();
    for (const r of results) {
      for (const f of r.fields) {
        const g = groups[f.kind];
        if (!g) continue;
        const key = f.value.toLowerCase();
        if (!g.has(key)) g.set(key, {value: f.value, files: []});
        const item = g.get(key);
        if (!item.files.includes(r.name)) item.files.push(r.name);
      }
    }
    const out = {};
    for (const [kind] of KINDS) {
      out[kind] = [...groups[kind].values()].sort((a, b) => b.files.length - a.files.length || a.value.localeCompare(b.value));
    }
    return out;
  }

  // CSV for Excel. Values come from untrusted files, so anything that starts like a formula
  // (= + - @ tab CR) is prefixed with ' to stop spreadsheet formula injection.
  function toCsv(results) {
    const cell = v => {
      let s = String(v == null ? '' : v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const rows = [['file', 'type', 'field', 'value', 'kind']];
    for (const r of results) {
      if (r.error) rows.push([r.name, r.typeLabel, 'Error', r.error, '']);
      for (const n of r.notes) rows.push([r.name, r.typeLabel, 'Note', n, '']);
      for (const f of r.fields) rows.push([r.name, r.typeLabel, f.label, f.value, f.kind]);
    }
    return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
  }

  const api = {parse, summarize, toCsv, pdfDate, KINDS, TYPE_LABELS, MAX_FILE, MAX_FILES};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DorkMeta = api;
})(this);
