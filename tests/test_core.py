"""Query building (src/dork_core.js), run through node."""
import itertools
from urllib.parse import parse_qs, urlparse

import pytest

from conftest import run_core


def build(**spec):
    return run_core(build=[spec])["build"][0]


def q(**spec):
    r = build(**spec)
    assert r["errors"] == [], r["errors"]
    return r["query"]


def site(raw):
    return run_core(site=[raw])["site"][0]


# --- each field ------------------------------------------------------------------

def test_empty_spec_builds_nothing():
    r = build()
    assert r == {"query": "", "url": None, "parts": [], "errors": [], "warnings": []}
    assert build(site="  ", intitle="   ")["query"] == ""


def test_single_fields():
    assert q(site="example.org") == "site:example.org"
    assert q(filetype="xlsx") == "filetype:xlsx"
    assert q(intitle="login") == "intitle:login"
    assert q(inurl="admin") == "inurl:admin"
    assert q(intext="password") == "intext:password"
    assert q(phrase="internal use only") == '"internal use only"'
    assert q(anyof="ssn") == "ssn"
    assert q(exclude="news") == "-news"
    assert q(after="2024-01-01") == "after:2024-01-01"
    assert q(before="2024-06-30") == "before:2024-06-30"


def test_values_with_spaces_are_quoted():
    assert q(intitle="staff directory") == 'intitle:"staff directory"'
    assert q(inurl="wp admin") == 'inurl:"wp admin"'
    assert q(intext="  date   of birth ") == 'intext:"date of birth"'


def test_syntax_characters_are_quoted():
    assert q(intitle="(a|b)") == 'intitle:"(a|b)"'
    assert q(intext="-secret") == 'intext:"-secret"'
    assert q(intitle="~staff") == 'intitle:"~staff"'
    assert q(anyof="OR") == '"OR"'


def test_quotes_in_input_are_stripped():
    assert q(intitle='index "of') == 'intitle:"index of"'
    assert q(phrase='say "hi" now') == '"say hi now"'
    assert q(phrase="“curly” quotes") == '"curly quotes"'
    assert q(intext='"') == ""
    r = build(intitle='a" OR site:evil.com "b')
    assert r["query"] == 'intitle:"a OR site:evil.com b"'


def test_control_characters_are_stripped():
    assert q(intitle="staff\ndirectory\t\x00") == 'intitle:"staff directory"'


def test_any_of_list():
    assert q(anyof="ssn, social security number, date of birth") == \
        '(ssn OR "social security number" OR "date of birth")'
    assert q(anyof=" , ssn ,, ") == "ssn"
    assert q(anyof=", ,") == ""


def test_exclude_list():
    assert q(exclude="news, -press release, (draft)") == '-news -"press release" -"(draft)"'
    assert q(exclude="--x") == "-x"


def test_list_limits():
    many = ",".join(f"w{i}" for i in range(11))
    for field in ("anyof", "exclude"):
        r = build(**{field: many})
        assert r["url"] is None and r["errors"][0]["field"] == field


def test_filetype_allowlist():
    assert q(filetype="XLSX") == "filetype:xlsx"
    assert q(filetype=".pdf") == "filetype:pdf"
    for bad in ("exe", "xlsx OR site:x.com", "pdf ", "../x"):
        r = build(filetype=bad)
        if bad == "pdf ":
            assert r["query"] == "filetype:pdf"
            continue
        assert r["url"] is None and r["errors"][0]["field"] == "filetype", bad


def test_filetype_list_has_no_duplicates():
    types = run_core()["filetypes"]
    assert len(types) == len(set(types))
    assert all(t.isalnum() and t == t.lower() for t in types)


# --- site cleanup ------------------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    ("example.org", "example.org"),
    ("EXAMPLE.ORG", "example.org"),
    ("https://www.example.org/staff/directory?x=1#top", "www.example.org"),
    ("http://example.org:8080", "example.org"),
    ("example.org:", "example.org"),
    ("user:pw@example.org/path", "example.org"),
    ("site:example.org", "example.org"),
    ("*.example.org", "example.org"),
    ("example.org.", "example.org"),
    ("  example.co.uk  ", "example.co.uk"),
    ("my-company.example.co.uk", "my-company.example.co.uk"),
    ("xn--bcher-kva.example", "xn--bcher-kva.example"),
    ("ftp://files.example.org/", "files.example.org"),
])
def test_site_cleanup(raw, expected):
    assert site(raw) == {"value": expected}


@pytest.mark.parametrize("raw", [
    "localhost", "example", "-bad.org", "bad-.org", "exa mple.org", "example..org", "192.168.1.1",
    "example.123", "bücher.example", "a" * 64 + ".org", "example.org OR site:evil.com", ".org",
    "ex_ample.org",
])
def test_bad_sites_are_refused(raw):
    r = site(raw)
    assert r["value"] == "" and r["error"], raw
    b = build(site=raw)
    assert b["url"] is None and b["errors"][0]["field"] == "site"


def test_site_too_long():
    long = ".".join(["a" * 60] * 5) + ".org"
    assert site(long)["error"]
    assert build(site="x" * 400)["errors"][0]["field"] == "site"


def test_www_warning():
    r = build(site="www.example.org")
    assert any("example.org to include every subdomain" in w for w in r["warnings"])
    assert not any("www" in w for w in build(site="example.org")["warnings"])


def test_no_site_warning():
    assert any("whole web" in w for w in build(filetype="pdf")["warnings"])
    assert not any("whole web" in w for w in build(site="example.org", filetype="pdf")["warnings"])


# --- dates -----------------------------------------------------------------------

@pytest.mark.parametrize("bad", ["2024-02-30", "2024-13-01", "24-01-01", "2024/01/01", "yesterday", "2024-1-1"])
def test_bad_dates(bad):
    r = build(after=bad)
    assert r["url"] is None and r["errors"][0]["field"] == "after"


def test_leap_day_is_fine():
    assert q(after="2024-02-29") == "after:2024-02-29"


def test_date_order():
    assert q(after="2024-01-01", before="2024-02-01") == "after:2024-01-01 before:2024-02-01"
    for before in ("2024-01-01", "2023-12-31"):
        r = build(after="2024-01-01", before=before)
        assert r["url"] is None and r["errors"][0]["field"] == "before"


# --- length limits ---------------------------------------------------------------

@pytest.mark.parametrize("field", ["intitle", "inurl", "intext", "phrase", "anyof", "exclude"])
def test_length_limit(field):
    limit = run_core()["limits"]["len"]
    assert build(**{field: "a" * limit})["errors"] == []
    r = build(**{field: "a" * (limit + 1)})
    assert r["url"] is None and r["errors"][0]["field"] == field


def test_word_count_warning():
    r = build(site="example.org", intext=" ".join(["w"] * 20), phrase=" ".join(["p"] * 20))
    assert r["url"]  # still usable, just warned
    assert any("Google ignores" in w for w in r["warnings"])
    assert not any("Google ignores" in w for w in build(site="example.org", intitle="index of")["warnings"])


# --- ordering, URL, combinations -------------------------------------------------

def test_fixed_field_order():
    spec = dict(before="2025-01-01", after="2024-01-01", exclude="news", anyof="a, b", phrase="x y",
                intext="pw", inurl="admin", intitle="login", filetype="pdf", site="example.org")
    assert q(**spec) == ('site:example.org filetype:pdf intitle:login inurl:admin intext:pw "x y" (a OR b) '
                         '-news after:2024-01-01 before:2025-01-01')


def test_url_is_encoded_once():
    r = build(site="example.org", intitle="staff & directory", anyof="a+b, c")
    assert r["url"].startswith("https://www.google.com/search?q=")
    assert "%2520" not in r["url"] and " " not in r["url"]
    assert parse_qs(urlparse(r["url"]).query)["q"] == [r["query"]]
    assert urlparse(r["url"]).netloc == "www.google.com"


def test_errors_block_the_url_but_keep_good_parts():
    r = build(site="example.org", filetype="exe")
    assert r["url"] is None
    assert r["query"] == "site:example.org"


def test_every_field_combination_builds():
    """All 2^10 combinations of one value per field: no errors, fixed order, one part per field."""
    values = dict(site="https://www.example.org/x", filetype="docx", intitle="index of", inurl="admin",
                  intext="pw", phrase="internal use only", anyof="ssn, date of birth", exclude="news",
                  after="2023-01-01", before="2024-01-01")
    fields = run_core()["fields"]
    specs = []
    for n in range(len(fields) + 1):
        for combo in itertools.combinations(fields, n):
            specs.append({f: values[f] for f in combo})
    results = run_core(build=specs)["build"]
    assert len(results) == 1024
    for spec, r in zip(specs, results):
        assert r["errors"] == [], spec
        got = [p["field"] for p in r["parts"]]
        assert got == [f for f in fields if f in spec], spec
        assert (r["url"] is None) == (not spec)
        assert all(p["explain"] for p in r["parts"])


# --- share links -----------------------------------------------------------------

def test_share_link_roundtrip():
    specs = [{}, {"site": "example.org", "intitle": "staff directory", "anyof": "ü, 日本, emoji 🎒"},
             {"phrase": "a/b+c=d", "unknown": "dropped", "filetype": ""}]
    out = run_core(roundtrip=specs)["roundtrip"]
    assert out[0] == {}
    assert out[1] == specs[1]
    assert out[2] == {"phrase": "a/b+c=d"}


def test_bad_share_links_are_ignored():
    out = run_core(decode=["!!!", "e30", "WzFd", "eyJzaXRlIjo1fQ"])["decode"]
    assert out[0] is None          # not base64 / not JSON
    assert out[1] == {}            # {}
    assert out[2] == {}            # [1]
    assert out[3] == {}            # {"site": 5}: non-strings dropped


# --- operator-only tip -----------------------------------------------------------

def _tip(r):
    return any("no words in them" in w for w in r["warnings"])


def test_operator_only_queries_get_the_words_tip():
    # Google returns very few results for e.g. site:x filetype:xlsx with no words.
    assert _tip(build(site="example.org", filetype="xlsx"))
    assert _tip(build(site="example.org", inurl="admin", exclude="news"))
    assert _tip(build(site="example.org", after="2024-01-01"))


def test_queries_with_words_skip_the_tip():
    for field in run_core()["wordFields"]:
        assert not _tip(build(site="example.org", filetype="xlsx", **{field: "salary"})), field
    assert not _tip(build())


# --- searches CSV ----------------------------------------------------------------

def test_searches_csv():
    rows = [
        {"list": "history", "name": "", "at": 1700000000000, "spec": {"site": "example.org", "exclude": "news"}},
        {"list": "saved", "name": "=cmd|' /C calc'!A0", "at": 1700000000000,
         "spec": {"site": "example.org", "intitle": 'staff "dir"', "evil": "x"}},
        {"list": "saved", "name": "broken", "at": None, "spec": {"filetype": "exe"}},
    ]
    csv = run_core(searchesCsv=rows)["searchesCsv"]
    lines = csv.lstrip("﻿").split("\r\n")
    assert lines[0] == '"list","name","when","query","google_url"'
    assert lines[1].startswith('"history","","2023-11-14T22:13:20.000Z","site:example.org -news","https://www.google.com/search?q=')
    # name is quoted and formula-guarded
    assert lines[2].startswith('"saved","\'=cmd|\' /C calc\'!A0",')
    assert '"site:example.org intitle:""staff dir"""' in lines[2]  # rebuilt, quotes stripped then CSV-escaped
    assert "evil" not in csv
    assert lines[3] == '"saved","broken","","",""'   # invalid spec: no query, no URL
    assert csv.endswith("\r\n")


def test_searches_csv_guards_exclude_only_queries():
    csv = run_core(searchesCsv=[{"list": "history", "spec": {"exclude": "news"}}])["searchesCsv"]
    assert '"\'-news"' in csv
