// Reads {build: [spec...], site: [raw...], fromTemplate: [[entry, site]...], roundtrip: [spec...], decode: [text...]}
// on stdin and prints the results as JSON. Driven by tests/test_core.py and tests/test_catalog.py.
const path = require('path');
const C = require(path.join(__dirname, '../../src/dork_core.js'));
let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', () => {
  const req = JSON.parse(input);
  process.stdout.write(JSON.stringify({
    build: (req.build || []).map(s => C.build(s)),
    site: (req.site || []).map(s => C.cleanSite(s)),
    fromTemplate: (req.fromTemplate || []).map(([e, site]) => C.build(C.fromTemplate(e, site))),
    roundtrip: (req.roundtrip || []).map(s => C.decodeSpec(C.encodeSpec(s))),
    decode: (req.decode || []).map(t => C.decodeSpec(t)),
    searchesCsv: req.searchesCsv ? C.searchesCsv(req.searchesCsv) : null,
    filetypes: C.FILETYPES.flatMap(g => g.types.map(t => t[0])),
    fields: C.FIELDS,
    wordFields: C.WORD_FIELDS,
    limits: {words: C.MAX_WORDS, len: C.MAX_LEN, items: C.MAX_ITEMS},
  }));
});
