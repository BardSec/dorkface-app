# dorkface

A free, browser-only tool for building Google "dork" queries, mainly for auditing what your own
organization has exposed online (e.g. `site:yourdistrict.org filetype:xlsx`). It will be live at
**https://dork.bardsec.com** (Cloudflare Pages). Nothing you type leaves the page: dorkface only
writes a `google.com/search?q=…` link, and your browser opens it when you click.

A companion to [KQL Workbench](https://kqlworkbench.bardsec.com/) and
[Wazuh Workbench](https://wazuhworkbench.bardsec.com/), and built the same way.

## Features

- **Catalog** (`catalog.py`): 25 ready-made searches in 5 categories (exposed spreadsheets & data,
  sensitive documents, config/logs/backups, login & admin pages, directory listings). Type your
  domain once; each entry shows its query, a "Search on Google" link, Copy, Open in builder, and
  what to do if it finds something. Searching needs a domain: the catalog is for your own site.
- **Builder**: `site:`, `filetype:` (allowlist), `intitle:`, `inurl:`, `intext:`, exact phrase,
  any-of (`OR` group), exclude (`-word`) and `after:`/`before:` dates. The query updates live, and
  each part is explained in plain English. Share links put the form in the URL fragment (`#b=…`),
  which browsers never send to servers.
- **Saved**: saved searches in `localStorage` (until deleted), history in `sessionStorage` (gone
  when the tab closes, for shared school computers). Delete and clear-all controls.

## How it works

- `src/dork_core.js` is the query builder: pure functions, no DOM. Rules: values with spaces or
  syntax characters (`( ) |`, leading `-`/`~`) are quoted; double quotes (straight and curly) and
  control characters are stripped; empty fields are left out; fields are joined in a fixed order;
  `site:` input is cleaned (scheme, user info, path, port, `*.` and trailing dots removed,
  lowercased) and must be an ASCII domain name; file types come from an allowlist; every field has a
  length limit; the URL is encoded once; Google's ~32-word limit gets a warning.
- `src/dork.js` (tabs, builder, shared helpers), `src/catalog.js`, `src/saved.js` are the page.
  DOM is built with `textContent` only.
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
combinations, share links), `test_catalog.py` (every entry complete and builds), `test_site.py`
(CSP and headers, no inline code, no external resources, no network or HTML-injection APIs in
shipped JS, maxlength matches the core's limits).

To add a catalog entry, add it to `CATALOG` in `catalog.py`; the tests check it.

## Deploy (Cloudflare Pages, direct upload)

Not deployed yet. Planned: Pages project `dorkface` on the EDTECHIRL account (same as the
workbenches), custom domain `dork.bardsec.com` (Pages custom domain + proxied CNAME
`dork` → `dorkface.pages.dev` in the bardsec.com zone).

```bash
.venv/bin/python build.py
set -a; . ~/.secrets/api-keys.env; set +a
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN_EDTECHIRL_WRITE CLOUDFLARE_ACCOUNT_ID=<EDTECHIRL account id> \
  WRANGLER_SEND_METRICS=false npx -y wrangler@4 pages deploy dist --project-name dorkface --branch main
```

Check with `curl -sI https://dork.bardsec.com/` (one value per security header). Rollback:
Cloudflare dashboard → Workers & Pages → dorkface → Deployments.

No environment variables: the site has no configuration.
