# dorkface: application spec

Drafted 2026-11-20, re-planned 2026-11-22 for Cloudflare Pages. Items marked **(decided)** are settled; **(proposed)** can still change.

Modeled on the KQL Workbench and Wazuh Workbench (`~/Projects/kql/public_site`, `~/Projects/kql/wazuh_site`): a free, browser-only static site where nothing you type leaves the page.

## Purpose
dorkface helps non-experts build Google "dork" queries, mainly so they can audit what their own organization exposes online (e.g. `site:example.com filetype:xlsx`).

## Hard rules (decided)
- **Build the query only.** dorkface writes a `https://www.google.com/search?q=…` link and the user's browser opens it. Nothing on our side ever contacts Google.
- **Static site, no server code.** Hosted on Cloudflare Pages (free tier) at **https://dork.bardsec.com**. No Pages Functions, no database, no accounts.
- **Nothing you type leaves the page.** The CSP has `connect-src 'none'`, so the page cannot make network requests at all. Everything is same-origin; Bootstrap is vendored.
- **JavaScript is required.** A `<noscript>` message explains that. (The old "works without JS" goal is dropped: a static site has nowhere else to build the query.)

## Views (hash tabs, like the workbenches)
| Tab | What it does |
|---|---|
| `#home` | Short landing overview: what a dork is, "use this on your own organization", links into the other tabs. |
| `#catalog` | Ready-made dorks with plain-English labels, grouped by category (Exposed files, Login pages, Directory listings, Config & backups, Documents with sensitive words…). Each has fill-ins (usually just your domain), shows the query, and has "Search on Google", "Copy" and "Open in builder". **(decided)** |
| `#builder` | The query builder form with a live preview. **(decided)** |
| `#metadata` | Drop in downloaded files to see the metadata they expose (authors, usernames, software, internal paths, servers, GPS), summarized across files, read locally and never uploaded. **(decided, added 2026-11-22)** |
| `#saved` | Saved searches and recent history, with delete and clear-all controls. **(decided)** |

Export (added 2026-11-22): a print-only report of history, saved searches and metadata findings, saved as PDF through the browser's print dialog, plus CSV for searches and metadata.

### Builder fields
| Field | Operator | Status |
|---|---|---|
| Site / domain | `site:` | decided |
| File type | `filetype:` (allowlist dropdown: pdf, xlsx, xls, docx, doc, csv, txt, pptx, sql, log, env, bak, xml, json…) | decided |
| Words in title | `intitle:` | decided |
| Words in URL | `inurl:` | decided |
| Exact phrase | `"..."` | decided |
| Exclude words | `-word` | decided |
| Words in page text | `intext:` | proposed |
| Any of these words | `(a OR b)` | proposed |
| Date range | `after:` / `before:` | proposed |

### Actions
- **Search on Google:** a plain link (`target="_blank" rel="noopener noreferrer"`) to the built URL.
- **Copy query:** copies the query string.
- **Share link:** puts the builder state in the URL fragment (`#b=…`), which browsers never send to servers.

### Saved searches and history
- **Saved searches** (user clicks Save): `localStorage`.
- **History** (recorded automatically when you click Search): `sessionStorage`, so it's gone when the tab closes. This matters on shared computers (same reasoning as the workbench builder draft).
- Both have delete and clear-all controls. Nothing is sent anywhere.

## Query-building rules (decided; tested)
- Values with spaces get quoted: `intitle:"staff directory"`.
- Double quotes inside user input are stripped so they can't break the query.
- Empty fields are left out; fields are joined in a fixed order so output is predictable.
- `site:` input is cleaned up: scheme, `www.`-agnostic, path, port and trailing dots removed, lowercased, and it must look like a domain name (or `*.domain`).
- File types come from the allowlist, not free text.
- The URL is built with `encodeURIComponent` once. Google ignores words past about 32, so the page warns above that.
- Every field has a length limit.

## Code layout (proposed, mirrors wazuh_site)
```
build.py              # writes dist/: index.html, assets with ?v=<hash>, _headers, 404.html
catalog.py            # CATALOG: the template dorks (Python data, rendered into the page as JSON)
src/
  index.html          # Jinja template for the single page
  dork_core.js        # pure query builder: spec -> {query, url, warnings, errors}. No DOM.
  dork.js             # page wiring: tabs, builder form, live preview, copy, share links
  catalog.js          # catalog tab
  saved.js            # saved searches + history
  theme.js, dork.css, favicon.svg
  vendor/bootstrap-5.3.3.min.css
tests/
  js/run_core.js      # node runner: reads JSON on stdin, calls dork_core.js, prints JSON
  test_core.py        # escaping/validation edge cases through node
  test_catalog.py     # every catalog entry has a category, label, description; fills and builds
  test_site.py        # build output: CSP/headers, no inline code, no external refs, no fetch/XHR APIs
requirements.txt      # jinja2, pytest (project .venv only)
```
- The build and tests use Python (Jinja2 + pytest in `.venv`); the shipped site is plain HTML/CSS/JS.
- Look and feel copied from the workbenches (navbar, theme toggle, cards), and the footer links to KQL Workbench and Wazuh Workbench (and they link back). **(proposed)**

## Security headers (`_headers`, same policy as the workbenches)
- CSP: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'` (also as a `<meta>` minus `frame-ancestors`).
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, `Permissions-Policy` (camera, mic, geolocation, payment, usb off), HSTS 1 year, `X-Frame-Options: DENY`.
- HTML: `Cache-Control: no-cache, no-transform` (no-transform keeps Cloudflare from injecting its Web Analytics beacon). Assets: long-lived immutable cache via `?v=` hashes.
- `404.html` so unknown paths get a real 404.
- No cookies, no analytics.

## Deployment (decided)
- Cloudflare Pages project `dorkface`, **direct upload** with wrangler (no Git integration), EDTECHIRL account (same as the workbenches).
- Custom domain `dork.bardsec.com`: Pages custom domain + proxied CNAME `dork` → `dorkface.pages.dev` in the bardsec.com zone.
```bash
.venv/bin/python build.py          # -> dist/
set -a; . ~/.secrets/api-keys.env; set +a
CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN_EDTECHIRL_WRITE CLOUDFLARE_ACCOUNT_ID=<edtechirl account id> \
  WRANGLER_SEND_METRICS=false npx -y wrangler@4 pages deploy dist --project-name dorkface --branch main
```
- Verify with `curl -sI https://dork.bardsec.com/` (one value per security header). Rollback: dashboard → Workers & Pages → dorkface → Deployments.
- Local preview: `python3 -m http.server -d dist`.

## Out of scope for v1
- Fetching or showing search results
- Accounts or server-side storage
- Search engines other than Google
- Community-submitted templates

## Done when
- The builder makes correct queries for every field combination, with pytest (via node) covering the escaping and validation edge cases.
- At least 15 catalog dorks across 4 or more categories, each tested to build.
- `test_site.py` passes: headers present, no inline scripts/styles, no external URLs except the Google search link and the sister sites, no network APIs in shipped JS.
- Deployed to Pages and `curl -sI https://dork.bardsec.com/` shows the security headers.

## Superseded
The earlier Flask/Gunicorn/Docker/k3s plan is dropped. The infrastructure repo `~/Projects/dorkface` (Terraform, Ansible, k3s) is no longer needed for this app.
