"""The built site is static and can't send anything anywhere (same rules as KQL / Wazuh Workbench)."""
import html as htmllib
import json
import re

import pytest

import build as site_build
from conftest import run_core

# The only outbound links allowed in the HTML: the sister sites in the footer.
SISTER_SITES = {"https://kqlworkbench.bardsec.com/", "https://wazuhworkbench.bardsec.com/"}


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    out = site_build.build(tmp_path_factory.mktemp("site") / "dist")
    return out, (out / "index.html").read_text()


def test_csp_meta_and_headers(built):
    out, html = built
    assert "connect-src 'none'" in site_build.META_CSP and "default-src 'none'" in site_build.META_CSP
    meta = re.search(r'http-equiv="Content-Security-Policy" content="([^"]*)"', html)
    assert meta and htmllib.unescape(meta.group(1)) == site_build.META_CSP
    headers = (out / "_headers").read_text()
    assert f"Content-Security-Policy: {site_build.HEADER_CSP}" in headers
    assert "frame-ancestors 'none'" in site_build.HEADER_CSP
    for name, value in site_build.SECURITY_HEADERS:
        assert headers.count(f"  {name}: ") == 1, name  # one value per header
        assert f"{name}: {value}" in headers
    for page in ("/", "/index.html", "/404.html"):
        assert f"{page}\n  ! Cache-Control\n  Cache-Control: no-cache, no-transform" in headers


def test_no_inline_code_or_external_resources(built):
    out, html = built
    for tag in re.findall(r"<script\b[^>]*>", html):
        assert 'src="' in tag or 'type="application/json"' in tag, tag
    assert " style=" not in html and "<style" not in html
    assert not re.search(r"\son\w+=", html)
    for ref in re.findall(r'(?:src|href)="([^"#]+)"', html):
        if ref in SISTER_SITES:
            continue
        assert not re.match(r"(?:https?:)?//", ref), ref
        assert (out / ref.split("?")[0]).is_file(), ref


def test_assets_are_versioned(built):
    _, html = built
    for ref in re.findall(r'(?:src|href)="([^"#]+)"', html):
        if ref not in SISTER_SITES:
            assert re.search(r"\?v=[0-9a-f]{10}$", ref), ref


def test_shipped_js_and_css_make_no_requests(built):
    out, _ = built
    files = list(out.rglob("*.js")) + list(out.rglob("*.css"))
    assert {f.name for f in files} >= {"dork_core.js", "dork.js", "saved.js", "catalog.js", "meta_core.js", "meta.js"}
    for f in files:
        text = f.read_text()
        assert "sourceMappingURL" not in text, f
        if f.suffix == ".js":
            for api in ("fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource", "innerHTML",
                        "outerHTML", "insertAdjacentHTML", "document.write", "eval(", "new Function", "import("):
                assert api not in text, (f.name, api)
            # The only absolute URLs in shipped JS: Google's search endpoint, and the XMP namespace
            # identifier meta_core.js matches inside images (a label, never requested).
            urls = set(re.findall(r"https?://[^\s'\"`]+", text))
            assert urls <= {"https://www.google.com/search?q=", "http://ns.adobe.com/xap/1.0/\\0"}, (f.name, urls)
        else:
            assert not re.search(r"url\((?!['\"]?data:)", text), f


def test_catalog_json_is_embedded(built):
    _, html = built
    m = re.search(r'<script type="application/json" id="dork-data">(.*?)</script>', html, re.S)
    data = json.loads(m.group(1))
    assert len(data["catalog"]["entries"]) >= 15
    assert "</script" not in m.group(1).lower()


def test_maxlength_matches_core_limits(built):
    _, html = built
    limits = run_core()["limits"]
    assert site_build.MAX_LEN == limits["len"]
    for name in ("intitle", "inurl", "intext", "phrase", "anyof", "exclude"):
        assert re.search(rf'name="{name}" maxlength="{limits["len"]}"', html), name


def test_builder_has_a_control_for_every_field(built):
    _, html = built
    for f in run_core()["fields"]:
        assert f'name="{f}"' in html, f
        assert f'data-error="{f}"' in html, f


def test_404_and_noscript(built):
    out, html = built
    assert (out / "404.html").is_file()
    assert "<noscript>" in html


def test_metadata_tab(built):
    _, html = built
    assert 'data-view="metadata"' in html and 'href="#metadata"' in html
    assert re.search(r'<input[^>]*type="file"[^>]*id="m-files"[^>]*multiple', html)
    assert "up to 100 MB each" in html
    # Scripts load in dependency order: helpers, then the metadata core, then its page.
    order = [html.index(f'src="{n}?') for n in ("dork_core.js", "dork.js", "meta_core.js", "meta.js")]
    assert order == sorted(order)
