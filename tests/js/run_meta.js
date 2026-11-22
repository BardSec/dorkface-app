// Reads {files: [[name, base64]...]} on stdin, runs src/meta_core.js on each, and prints
// {results, summary, csv} as JSON. Driven by tests/test_meta.py.
const path = require('path');
const M = require(path.join(__dirname, '../../src/meta_core.js'));
let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', async () => {
  const req = JSON.parse(input);
  const results = [];
  for (const [name, b64] of req.files || []) {
    results.push(await M.parse(new Uint8Array(Buffer.from(b64, 'base64')), name));
  }
  process.stdout.write(JSON.stringify({
    results, summary: M.summarize(results), csv: M.toCsv(results),
    dates: (req.dates || []).map(M.pdfDate), kinds: M.KINDS.map(k => k[0]),
  }));
});
