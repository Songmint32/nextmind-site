#!/usr/bin/env python3
"""A crashing article extractor must not discard a headline write."""

import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

try:
    import resource

    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
except (ImportError, ValueError, OSError):
    pass


def record(art_id, title, url="https://example.com/story"):
    return {
        "id": art_id,
        "title": title,
        "source": "Test",
        "url": url,
        "image": "",
        "heat": 1,
        "publishedAt": "2026-11-03T00:00:00Z",
        "topics": [],
    }


def load(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def main():
    tmp = tempfile.mkdtemp(prefix="nextmind-extract-")
    try:
        articles = os.path.join(tmp, "articles")
        os.makedirs(articles)
        trends = os.path.join(tmp, "trends.json")
        os.environ["NEXTMIND_ARTICLES_DIR"] = articles
        os.environ["NEXTMIND_TRENDS_OUT"] = trends
        os.environ["NEXTMIND_EXTRACT_DRY"] = "1"
        os.environ.pop("NEXTMIND_EXTRACT_IMPORT_ABORT", None)

        import fetch_trends as ft

        now = datetime(2026, 11, 3, 5, 0, tzinfo=timezone.utc)
        headlines = [
            record("aaaaaaaaaaaa", "Kept"),
            record("bbbbbbbbbbbb", "__abort__"),
            record("cccccccccccc", "__image__"),
            record("dddddddddddd", "__fail__"),
            record("eeeeeeeeeeee", "Discussion", "https://news.ycombinator.com/item?id=1"),
        ]
        reports = [{"source": "Test", "ok": True, "count": len(headlines)}]
        ft.write_output(now, reports, headlines, {})
        changed = ft.save_articles(headlines, {})
        assert changed is True, changed
        assert headlines[2]["image"] == "https://example.com/from-article.jpg"

        kept = load(os.path.join(articles, "aaaaaaaaaaaa.json"))
        assert kept["ok"] is True
        crashed = load(os.path.join(articles, "bbbbbbbbbbbb.json"))
        assert crashed["ok"] is False
        assert crashed["error"] == "extractor crashed"
        pictured = load(os.path.join(articles, "cccccccccccc.json"))
        assert pictured["image"] == "https://example.com/from-article.jpg"
        failed = load(os.path.join(articles, "dddddddddddd.json"))
        assert failed["ok"] is False
        assert failed["error"] == "dry fail"
        skipped = load(os.path.join(articles, "eeeeeeeeeeee.json"))
        assert skipped["ok"] is False
        assert "error" not in skipped

        again = ft.save_articles(headlines, {})
        assert again is False

        os.environ["NEXTMIND_EXTRACT_IMPORT_ABORT"] = "1"
        os.environ.pop("NEXTMIND_EXTRACT_DRY", None)
        survivor = record("ffffffffffff", "Still here")
        ft.write_output(now, reports, headlines + [survivor], {})
        ft.save_articles([survivor], {})
        assert not os.path.exists(os.path.join(articles, "ffffffffffff.json"))
        saved = load(trends)
        assert saved["updatedAt"] == "2026-11-03T05:00:00Z"
        assert saved["feeds"][0]["source"] == "Test"
        assert any(item["id"] == "aaaaaaaaaaaa" for item in saved["items"])
        assert not os.path.exists(trends + ".tmp")

        os.environ.pop("NEXTMIND_EXTRACT_IMPORT_ABORT", None)
        os.environ["NEXTMIND_EXTRACT_DRY"] = "1"
        burst = [
            record("111111111111", "__abort__"),
            record("222222222222", "__abort__"),
            record("333333333333", "__abort__"),
            record("444444444444", "Left for later"),
        ]
        ft.save_articles(burst, {})
        for art_id in ("111111111111", "222222222222", "333333333333"):
            body = load(os.path.join(articles, art_id + ".json"))
            assert body["error"] == "extractor crashed"
        assert not os.path.exists(os.path.join(articles, "444444444444.json"))

        print("extract isolation ok")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
