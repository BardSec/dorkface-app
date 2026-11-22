"""Catalog entries (catalog.py) are complete and build clean queries."""
import re
from collections import Counter

from catalog import CATALOG, CATEGORIES
from conftest import run_core

REQUIRED = {"id", "category", "label", "description", "fields"}
OPTIONAL = {"next"}


def test_size_and_categories():
    assert len(CATALOG) >= 15
    used = Counter(e["category"] for e in CATALOG)
    assert len(used) >= 4
    assert set(used) == set(CATEGORIES), "every category has entries and every entry has a known category"


def test_entries_are_complete():
    ids = [e["id"] for e in CATALOG]
    assert len(ids) == len(set(ids))
    for e in CATALOG:
        assert REQUIRED <= set(e) <= REQUIRED | OPTIONAL, e["id"]
        assert re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", e["id"]), e["id"]
        assert e["label"].strip() and e["description"].strip(), e["id"]
        assert e["fields"] and "site" not in e["fields"], e["id"]
        assert all(isinstance(v, str) and v for v in e["fields"].values()), e["id"]


def test_entries_use_known_fields():
    fields = set(run_core()["fields"])
    for e in CATALOG:
        assert set(e["fields"]) <= fields, e["id"]


def test_every_entry_builds_with_a_domain():
    out = run_core(fromTemplate=[[e, "https://www.example.org/"] for e in CATALOG])["fromTemplate"]
    for e, r in zip(CATALOG, out):
        assert r["errors"] == [], (e["id"], r["errors"])
        assert r["query"].startswith("site:www.example.org "), e["id"]
        assert r["url"], e["id"]
        assert not any("Google ignores" in w for w in r["warnings"]), e["id"]


def test_entries_without_a_domain_warn():
    out = run_core(fromTemplate=[[e, ""] for e in CATALOG])["fromTemplate"]
    for e, r in zip(CATALOG, out):
        assert r["errors"] == [] and r["url"], e["id"]
        assert any("whole web" in w for w in r["warnings"]), e["id"]


def test_queries_are_distinct():
    out = run_core(fromTemplate=[[e, "example.org"] for e in CATALOG])["fromTemplate"]
    queries = [r["query"] for r in out]
    assert len(queries) == len(set(queries))
