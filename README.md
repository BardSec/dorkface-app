# dorkface

A free, browser-only tool for building Google "dork" queries, mainly for auditing what your own
organization has exposed online (e.g. `site:example.com filetype:xlsx`). Live at
**https://dork.bardsec.com** (Cloudflare Pages). Nothing you type leaves the page: dorkface only
writes a `google.com/search?q=…` link, and your browser opens it when you click.

A companion to [KQL Workbench](https://kqlworkbench.bardsec.com/) and
[Wazuh Workbench](https://wazuhworkbench.bardsec.com/), and built the same way.

## Features

- **Catalog** (`catalog.py`): 28 ready-made searches in 6 categories (exposed spreadsheets & data,
  sensitive documents, config/logs/backups, login & admin pages, directory listings, documents to
  check for metadata). Type your
  domain once; each entry shows its query, a "Search on Google" link, Copy, Open in builder, and
  what to do if it finds something. Searching needs a domain: the catalog is for your own site.
- **Builder**: `site:`, `filetype:` (allowlist), `intitle:`, `inurl:`, `intext:`, exact phrase,
  any-of (`OR` group), exclude (`-word`) and `after:`/`before:` dates. The query updates live, and
  each part is explained in plain English. Share links put the form in the URL fragment (`#b=…`),
  which browsers never send to servers.
- **Metadata**: drop in files downloaded from your site (PDF, docx/xlsx/pptx, odt/ods/odp, JPEG,
  PNG; up to 100 MB each, 500 per session) to see what they give away: authors, last editors,
  comment and tracked-change authors, usernames from paths, software and versions, internal paths,
  file servers, linked templates and workbooks, Excel's "saved from" folder, hidden sheets,
  Microsoft 365 tenant IDs and sensitivity labels, cameras, serial numbers and GPS positions. A
  summary groups each value across files. Files are read in the browser and never uploaded; results
  aren't stored. CSV export. Older binary Office formats (.doc/.xls/.ppt) aren't read yet.
- **Saved**: saved searches in `localStorage` (until deleted), history in `sessionStorage` (gone
  when the tab closes, for shared computers). Delete and clear-all controls.
- **Export**: "Save report as PDF" (Saved and Metadata tabs) builds a print-only report of this
  session's history, saved searches and metadata findings and opens the print dialog; "Save as PDF"
  writes it, with the Google links still clickable. Also "Searches as CSV" and the metadata CSV. CSV
  cells that start like a formula get a leading `'` (spreadsheet formula injection).

## How it works

- `src/dork_core.js` is the query builder: pure functions, no DOM. Rules: values with spaces or
  syntax characters (`( ) |`, leading `-`/`~`) are quoted; double quotes (straight and curly) and
  control characters are stripped; empty fields are left out; fields are joined in a fixed order;
  `site:` input is cleaned (scheme, user info, path, port, `*.` and trailing dots removed,
  lowercased) and must be an ASCII domain name; file types come from an allowlist; every field has a
  length limit; the URL is encoded once; Google's ~32-word limit gets a warning.
  Queries with no words (only `site:`, `filetype:`, `inurl:`…) get a tip to add some: Google returns
  very few results for operator-only searches (`site:tn.gov filetype:xlsx` showed 1 result, while adding
  `(salary OR payroll …)` showed many; `&filter=0` and a single common word didn't help). For the same
  reason every catalog entry with a file type also carries words (a test enforces it).
- `src/meta_core.js` reads metadata with no libraries: PDF Info dictionary and XMP (including
  compressed object streams and cross-reference streams, via the browser's `DecompressionStream`),
  zip-based Office/OpenDocument (a small zip reader), JPEG EXIF/GPS/XMP and PNG text chunks. Paths,
  usernames, servers and email addresses are then pulled out of every value.
- `src/dork.js` (tabs, builder, shared helpers), `src/catalog.js`, `src/saved.js`, `src/meta.js`,
  `src/report.js` are the page. DOM is built with `textContent` only.
- `build.py` renders `src/index.html` with the catalog as JSON and writes `dist/`: assets with
  `?v=<hash>`, a Pages `_headers` file and `404.html`.
- **Content-Security-Policy** `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:;
  connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`, so the page cannot
  make network requests. Also nosniff, `no-referrer`, COOP, Permissions-Policy, HSTS and
  `X-Frame-Options: DENY`. HTML is `no-cache, no-transform` (stops Cloudflare injecting its analytics
  beacon). Same policy as the workbenches. Bootstrap 5.3.3 is vendored. No cookies, no analytics.
- JavaScript is required (there's a `<noscript>` notice).

## Development

```bash
/opt/homebrew/bin/python3.14 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/pytest                      # needs node on PATH (tests drive dork_core.js through tests/js/run_core.js)
.venv/bin/python build.py             # -> dist/
python3 -m http.server 8765 -d dist   # preview at http://localhost:8765 (the _headers file only applies on Pages)
```

Tests: `test_core.py` (escaping, validation, site cleanup, dates, limits, all 1,024 field
combinations, share links, searches CSV), `test_catalog.py` (every entry complete and builds),
`test_meta.py` (sample PDFs, Office/OpenDocument files, JPEGs and PNGs built with the stdlib, plus
damaged and hostile files, summary and CSV escaping, through `tests/js/run_meta.js`), `test_site.py`
(CSP and headers, no inline code, no external resources, no network or HTML-injection APIs in
shipped JS, maxlength matches the core's limits, report wiring).

To add a catalog entry, add it to `CATALOG` in `catalog.py`; the tests check it.

## Deploy (Cloudflare Pages, direct upload)

Pages project `dorkface` on the EDTECHIRL account (same as the workbenches), live since
2026-11-22. The domain is a Pages custom domain plus a proxied CNAME `dork` → `dorkface.pages.dev`
in the bardsec.com zone. The project was created with the Pages API
(`POST /accounts/<id>/pages/projects`), not `wrangler pages project create`, which needs Workers
permissions this token doesn't have.

```bash
.venv/bin/python build.py
set -a; . ~/.secrets/api-keys.env; set +a
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN_EDTECHIRL_WRITE CLOUDFLARE_ACCOUNT_ID=0b8e26d70e71fcf59e0ce3f2bbce100e \
  WRANGLER_SEND_METRICS=false npx -y wrangler@4 pages deploy dist --project-name dorkface --branch main --commit-hash $(git rev-parse HEAD)
```

Check with `curl -sI https://dork.bardsec.com/` (one value per security header). Rollback:
Cloudflare dashboard → Workers & Pages → dorkface → Deployments.

No environment variables: the site has no configuration.
