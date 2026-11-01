#!/usr/bin/env python3
"""Fetch public tech headlines and write data/trends.json.

Edit FEEDS to add or remove an RSS source. Hacker News is separate
because it is a JSON API, not a feed. The script uses only the Python
standard library. A source that fails is skipped. The others are kept.
"""

import hashlib
import html
import json
import math
import os
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "trends.json")
UA = "NextMindTrendRadar/1.0 (+https://github.com/Songmint32/nextmind-site)"
HN_TOP = "https://hacker-news.firebaseio.com/v0/topstories.json"
HN_ITEM = "https://hacker-news.firebaseio.com/v0/item/{}.json"
HN_LIMIT = 30
MAX_AGE = timedelta(days=8)

# name, url. These are public feeds. Change this list to follow different sites.
FEEDS = [
    ("The Verge", "https://www.theverge.com/rss/index.xml"),
    ("TechCrunch", "https://techcrunch.com/feed/"),
    ("Ars Technica", "https://feeds.arstechnica.com/arstechnica/index"),
    ("MIT Technology Review", "https://www.technologyreview.com/feed/"),
    ("NASA", "https://www.nasa.gov/rss/dyn/breaking_news.rss"),
    ("SpaceNews", "https://spacenews.com/feed/"),
]

# Order matters only for display. A story can match more than one topic.
TOPICS = [
    ("AI", r"\b(ai|a\.i\.|artificial intelligence|machine learning|deep learning|llm|gpt|openai|anthropic|chatgpt|claude|gemini|neural|generative)\b"),
    ("Chips", r"\b(chip|chips|semiconductor|semiconductors|nvidia|tsmc|amd|intel|qualcomm|gpu|cpu|foundry|wafer|lithography|microchip)\b"),
    ("Space", r"\b(nasa|spacex|rocket|satellite|orbit|astronaut|artemis|mars|jwst|space station|spaceflight|spacecraft|telescope|space)\b"),
    ("EV/Tesla", r"\b(tesla|rivian|lucid|cybertruck|electric vehicle|electric car|ev)\b"),
    ("Science", r"\b(scientists|scientific|physics|biology|quantum|genome|climate|astronomer|laboratory|peer-reviewed)\b"),
    ("Apps", r"\b(ios|android|iphone|app store|google play|saas|mobile app|apps)\b"),
]
TOPIC_RES = [(name, re.compile(pattern, re.I)) for name, pattern in TOPICS]


def fetch(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read()


def local(tag):
    return tag.rsplit("}", 1)[-1].lower()


def children(node, name):
    return [child for child in list(node) if local(child.tag) == name]


def text_of(node, name):
    found = children(node, name)
    if not found:
        return ""
    return clean("".join(found[0].itertext()))


def clean(value):
    value = html.unescape(value or "")
    value = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def parse_time(value):
    if not value:
        return None
    value = value.strip()
    try:
        when = parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        when = None
    if when is None:
        try:
            when = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return when.astimezone(timezone.utc)


def link_of(node):
    # RSS <link>text</link> or Atom <link href="..."/>.
    for child in children(node, "link"):
        href = child.attrib.get("href")
        rel = child.attrib.get("rel", "alternate")
        if href and rel in ("alternate", ""):
            return href.strip()
        if child.text and child.text.strip().startswith("http"):
            return child.text.strip()
    guid = text_of(node, "guid")
    if guid.startswith("http"):
        return guid
    return ""


def time_of(node):
    for name in ("published", "updated", "pubdate", "date", "dc:date"):
        when = parse_time(text_of(node, name.split(":")[-1]))
        if when:
            return when
    # dc:date keeps a namespace, so scan every child once.
    for child in list(node):
        if local(child.tag) in ("published", "updated", "pubdate", "date"):
            when = parse_time("".join(child.itertext()))
            if when:
                return when
    return None


def tags_for(title):
    found = []
    for name, pattern in TOPIC_RES:
        if pattern.search(title):
            found.append(name)
    return found


def canonical(url):
    url = (url or "").strip()
    url = url.split("#")[0]
    url = re.sub(r"[?&](utm_[^=]+|ref|src)=[^&]*", "", url, flags=re.I)
    return url.rstrip("/").lower()


def heat_score(published, now, points, comments):
    """100 when the story is new, 0 after 48 hours, plus a Hacker News bump."""
    age_hours = max(0.0, (now - published).total_seconds() / 3600.0)
    recency = max(0.0, 100.0 * (1.0 - age_hours / 48.0))
    boost = 0.0
    if points is not None:
        boost += math.log1p(points) * 8.0
    if comments is not None:
        boost += math.log1p(comments) * 4.0
    return int(round(recency + boost))


def make_item(title, source, url, published, points=None, comments=None):
    title = clean(title)
    url = (url or "").strip()
    if not title or not url or published is None:
        return None
    if not url.startswith("http"):
        return None
    return {
        "title": title,
        "source": source,
        "url": url,
        "published": published,
        "points": points,
        "comments": comments,
    }


def parse_feed(source, raw):
    root = ET.fromstring(raw)
    nodes = []
    # RSS items or Atom entries.
    for element in root.iter():
        if local(element.tag) in ("item", "entry"):
            nodes.append(element)
    items = []
    for node in nodes[:25]:
        item = make_item(text_of(node, "title"), source, link_of(node), time_of(node))
        if item:
            items.append(item)
    return items


def load_hn():
    raw_ids = json.loads(fetch(HN_TOP).decode("utf-8"))
    ids = raw_ids[:HN_LIMIT]

    def one(item_id):
        try:
            payload = json.loads(fetch(HN_ITEM.format(item_id), timeout=20).decode("utf-8"))
        except Exception:
            return None
        if not payload or payload.get("type") != "story" or payload.get("dead") or payload.get("deleted"):
            return None
        url = payload.get("url") or "https://news.ycombinator.com/item?id={}".format(item_id)
        published = datetime.fromtimestamp(payload.get("time", 0), tz=timezone.utc)
        return make_item(
            payload.get("title", ""),
            "Hacker News",
            url,
            published,
            points=payload.get("score"),
            comments=payload.get("descendants"),
        )

    items = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        for result in pool.map(one, ids):
            if result:
                items.append(result)
    return items


def main():
    now = datetime.now(timezone.utc)
    reports = []
    collected = []

    try:
        hn_items = load_hn()
        collected.extend(hn_items)
        reports.append({"source": "Hacker News", "ok": True, "count": len(hn_items)})
        print("Hacker News: {} stories".format(len(hn_items)))
    except Exception as error:
        reports.append({"source": "Hacker News", "ok": False, "error": str(error)})
        print("Hacker News failed: {}".format(error), file=sys.stderr)

    def load_feed(pair):
        source, url = pair
        try:
            items = parse_feed(source, fetch(url))
            return source, items, None
        except Exception as error:
            return source, [], str(error)

    with ThreadPoolExecutor(max_workers=6) as pool:
        for source, items, error in pool.map(load_feed, FEEDS):
            if error:
                reports.append({"source": source, "ok": False, "error": error})
                print("{} failed: {}".format(source, error), file=sys.stderr)
            else:
                collected.extend(items)
                reports.append({"source": source, "ok": True, "count": len(items)})
                print("{}: {} stories".format(source, len(items)))

    fresh = []
    for item in collected:
        if now - item["published"] <= MAX_AGE:
            fresh.append(item)

    # Prefer the copy that knows about Hacker News points when two stories match.
    by_url = {}
    by_title = {}

    def remember(score, item):
        url_key = canonical(item["url"])
        title_key = re.sub(r"[^a-z0-9]+", "", item["title"].lower())
        previous = by_url.get(url_key) or by_title.get(title_key)
        if previous and previous[0] >= score:
            return
        if previous:
            old = previous[1]
            by_url.pop(canonical(old["url"]), None)
            by_title.pop(re.sub(r"[^a-z0-9]+", "", old["title"].lower()), None)
        pair = (score, item)
        if url_key:
            by_url[url_key] = pair
        if title_key:
            by_title[title_key] = pair

    for item in fresh:
        remember(heat_score(item["published"], now, item["points"], item["comments"]), item)

    seen = set()
    ranked = []
    for pair in by_url.values():
        identity = canonical(pair[1]["url"])
        if identity in seen:
            continue
        seen.add(identity)
        ranked.append(pair)

    items_out = []
    for score, item in ranked:
        digest = hashlib.sha1(canonical(item["url"]).encode("utf-8")).hexdigest()[:12]
        record = {
            "id": digest,
            "title": item["title"],
            "source": item["source"],
            "url": item["url"],
            "publishedAt": item["published"].strftime("%Y-%m-%dT%H:%M:%SZ"),
            "topics": tags_for(item["title"]),
            "heat": score,
        }
        if item["points"] is not None:
            record["hnPoints"] = item["points"]
        if item["comments"] is not None:
            record["hnComments"] = item["comments"]
        items_out.append(record)

    items_out.sort(key=lambda row: (row["heat"], row["publishedAt"]), reverse=True)

    if not items_out and os.path.exists(OUT):
        print("No stories fetched. Leaving the existing data file in place.")
        return 0

    payload = {
        "updatedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "feeds": reports,
        "items": items_out,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    print("Wrote {} stories to {}".format(len(items_out), OUT))
    return 0


if __name__ == "__main__":
    sys.exit(main())
