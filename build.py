"""Build dorkface into a static folder for Cloudflare Pages.

    .venv/bin/python build.py [OUT_DIR]      # default: dist/

Writes index.html (rendered from src/index.html with the catalog as JSON), the assets with
?v=<content hash> cache-busting, a Pages _headers file (CSP and security headers on every
response, plus cache rules) and a 404.html. Deploy OUT_DIR as-is; see README.

Same policy and header layout as KQL / Wazuh Workbench (~/Projects/kql/public_site/build.py).
"""
import hashlib
import shutil
import sys
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from catalog import CATALOG, catalog_client  # noqa: E402

SRC = ROOT / "src"

# Field limits mirrored from dork_core.js (MAX_SITE_LEN + room for a URL, MAX_LEN) for maxlength attributes.
MAX_SITE_INPUT = 353
MAX_LEN = 200
MAX_META_MB = 100  # meta_core.js MAX_FILE

# connect-src 'none' is the guarantee: the page cannot fetch, post, open websockets or
# send beacons. Everything else is same-origin static files. img-src data: is for
# Bootstrap's inline SVG icons (select arrows, validation icons).
_POLICY = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
]
META_CSP = "; ".join(_POLICY)
# frame-ancestors only works as a header (browsers ignore it in <meta>).
HEADER_CSP = "; ".join(_POLICY + ["frame-ancestors 'none'"])

SECURITY_HEADERS = [
    ("Content-Security-Policy", HEADER_CSP),
    ("X-Content-Type-Options", "nosniff"),
    ("Referrer-Policy", "no-referrer"),
    ("Cross-Origin-Opener-Policy", "same-origin"),
    ("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()"),
    ("Strict-Transport-Security", "max-age=31536000"),
    ("X-Frame-Options", "DENY"),
]
# Assets are referenced with ?v=<content hash>, so they can be cached for good.
ASSET_CACHE = "public, max-age=31536000, immutable"
# The page always revalidates so new builds show up. no-transform stops Cloudflare
# from injecting its Web Analytics beacon or rewriting the HTML.
PAGE_CACHE = "no-cache, no-transform"


def headers_file():
    """Cloudflare Pages _headers. Rules matching the same path are merged, so the page rules
    detach the asset Cache-Control ("! Name") before setting their own; the same goes for
    headers Pages adds by default that we set differently."""
    lines = ["/*"]
    for name, value in SECURITY_HEADERS:
        lines += [f"  ! {name}", f"  {name}: {value}"]
    lines += ["  ! Access-Control-Allow-Origin", f"  Cache-Control: {ASSET_CACHE}"]
    for path in ("/", "/index.html", "/404.html"):
        lines += [path, "  ! Cache-Control", f"  Cache-Control: {PAGE_CACHE}"]
    return "\n".join(lines) + "\n"


NOT_FOUND = """<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found · dorkface</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><p>Page not found. <a href="/">Go to dorkface</a>.</p></body></html>
"""

# published path -> source file
ASSETS = {
    "dork_core.js": SRC / "dork_core.js",
    "dork.js": SRC / "dork.js",
    "saved.js": SRC / "saved.js",
    "catalog.js": SRC / "catalog.js",
    "meta_core.js": SRC / "meta_core.js",
    "meta.js": SRC / "meta.js",
    "report.js": SRC / "report.js",
    "theme.js": SRC / "theme.js",
    "dork.css": SRC / "dork.css",
    "favicon.svg": SRC / "favicon.svg",
    "vendor/bootstrap-5.3.3.min.css": SRC / "vendor" / "bootstrap-5.3.3.min.css",
}


def _copy(src, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    if src.suffix == ".css":
        # Drop source-map references so devtools don't request files we don't ship.
        text = src.read_text(encoding="utf-8")
        dest.write_text("\n".join(l for l in text.splitlines() if "sourceMappingURL" not in l), encoding="utf-8")
    else:
        shutil.copyfile(src, dest)
    return hashlib.sha256(dest.read_bytes()).hexdigest()[:10]


def build(out):
    out = Path(out)
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    versions = {name: _copy(src, out / name) for name, src in ASSETS.items()}

    env = Environment(loader=FileSystemLoader(str(SRC)), autoescape=select_autoescape(["html"]))
    env.globals["asset"] = lambda name: f"{name}?v={versions[name]}"
    html = env.get_template("index.html").render(
        csp=META_CSP,
        data={"catalog": catalog_client()},
        catalog_count=len(CATALOG),
        max_site=MAX_SITE_INPUT,
        max_len=MAX_LEN,
        max_meta_mb=MAX_META_MB,
    )
    (out / "index.html").write_text(html, encoding="utf-8")
    (out / "_headers").write_text(headers_file(), encoding="utf-8")
    # With a 404.html, Pages returns a real 404 for unknown paths instead of serving index.html.
    (out / "404.html").write_text(NOT_FOUND, encoding="utf-8")
    return out


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "dist"
    print(f"Built {build(target)}")
