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
from urllib.parse import urljoin
import xml.etree.ElementTree as ET

import trafilatura
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "trends.json")
ARTICLES = os.path.join(ROOT, "data", "articles")
WORD_CAP = 1500
UA = "NextMindTrendRadar/1.0 (+https://github.com/Songmint32/nextmind-site)"
HN_TOP = "https://hacker-news.firebaseio.com/v0/topstories.json"
HN_ITEM = "https://hacker-news.firebaseio.com/v0/item/{}.json"
HN_LIMIT = 30
MAX_AGE = timedelta(days=8)
# How many article pages to open when a feed has no picture.
# The rest wait for a later run. Results are remembered in imageCache.
PAGE_CAP = 36
PAGE_TIMEOUT = 5
PAGE_WORKERS = 6
PAGE_BYTES = 200000

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


IMG_TAG = re.compile(r"<img\b[^>]*?\bsrc=[\"']([^\"']+)[\"']", re.I)
META_IMAGE = re.compile(
    r"<meta\b[^>]*?(?:property|name)=[\"'](?:og:image(?::url)?|twitter:image(?::src)?)[\"'][^>]*?\bcontent=[\"']([^\"']+)[\"']"
    r"|<meta\b[^>]*?\bcontent=[\"']([^\"']+)[\"'][^>]*?(?:property|name)=[\"'](?:og:image(?::url)?|twitter:image(?::src)?)[\"']",
    re.I,
)


def usable_image(url, base=None):
    if not url:
        return ""
    url = html.unescape(url.strip())
    if base:
        url = urljoin(base, url)
    if not url.startswith("http"):
        return ""
    if url.startswith("data:"):
        return ""
    if len(url) > 2000:
        return ""
    return url


def raw_html(node):
    chunks = []
    for child in list(node):
        if local(child.tag) in ("encoded", "content", "description", "summary"):
            chunks.append("".join(child.itertext()))
    return "\n".join(chunks)


def image_from_feed(node, page_url):
    for child in list(node):
        name = local(child.tag)
        url = child.attrib.get("url") or ""
        medium = (child.attrib.get("medium") or "").lower()
        kind = (child.attrib.get("type") or "").lower()
        if name in ("content", "thumbnail") and url:
            if name == "thumbnail" or medium == "image" or kind.startswith("image") or not medium:
                found = usable_image(url, page_url)
                if found:
                    return found
        if name == "enclosure" and url and (kind.startswith("image") or re.search(r"\.(jpe?g|png|webp|gif)(\?|$)", url, re.I)):
            found = usable_image(url, page_url)
            if found:
                return found
    match = IMG_TAG.search(raw_html(node))
    if match:
        return usable_image(match.group(1), page_url)
    return ""


def image_from_page(page_url):
    if not page_url or "news.ycombinator.com" in page_url:
        return ""
    try:
        req = urllib.request.Request(
            page_url,
            headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml"},
        )
        with urllib.request.urlopen(req, timeout=PAGE_TIMEOUT) as response:
            kind = (response.headers.get("Content-Type") or "").lower()
            if "html" not in kind and "xml" not in kind and kind:
                return ""
            raw = response.read(PAGE_BYTES).decode("utf-8", "replace")
            final_url = response.geturl()
    except Exception:
        return ""
    match = META_IMAGE.search(raw)
    if not match:
        return ""
    found = match.group(1) or match.group(2) or ""
    return usable_image(found, final_url)


def load_image_cache():
    if not os.path.exists(OUT):
        return {}
    try:
        with open(OUT, encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {}
    cache = {}
    for key, value in (payload.get("imageCache") or {}).items():
        cache[key] = value if isinstance(value, str) else ""
    for item in payload.get("items") or []:
        url = canonical(item.get("url"))
        image = item.get("image") or ""
        if url and image and url not in cache:
            cache[url] = image
    return cache


def make_item(title, source, url, published, points=None, comments=None, image=""):
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
        "image": image or "",
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
        page = link_of(node)
        item = make_item(
            text_of(node, "title"),
            source,
            page,
            time_of(node),
            image=image_from_feed(node, page),
        )
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
            if not previous[1].get("image") and item.get("image"):
                previous[1]["image"] = item["image"]
            return
        if previous:
            old = previous[1]
            if not item.get("image") and old.get("image"):
                item["image"] = old["image"]
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
        if item.get("image"):
            record["image"] = item["image"]
        items_out.append(record)

    items_out.sort(key=lambda row: (row["heat"], row["publishedAt"]), reverse=True)

    cache = load_image_cache()
    for record in items_out:
        key = canonical(record["url"])
        if record.get("image"):
            cache[key] = record["image"]
        elif key in cache and cache[key]:
            record["image"] = cache[key]

    missing = [record for record in items_out if not record.get("image") and canonical(record["url"]) not in cache]
    missing.sort(key=lambda row: row["heat"], reverse=True)
    batch = missing[:PAGE_CAP]

    def lookup(record):
        found = image_from_page(record["url"])
        return canonical(record["url"]), found

    if batch:
        print("Looking up pictures for {} articles (cap {}).".format(len(batch), PAGE_CAP))
        with ThreadPoolExecutor(max_workers=PAGE_WORKERS) as pool:
            for key, found in pool.map(lookup, batch):
                cache[key] = found or ""
                if found:
                    for record in items_out:
                        if canonical(record["url"]) == key:
                            record["image"] = found

    kept_cache = {}
    for record in items_out:
        key = canonical(record["url"])
        if key in cache:
            kept_cache[key] = cache[key]

    if not items_out and os.path.exists(OUT):
        print("No stories fetched. Leaving the existing data file in place.")
        return 0

    save_articles(items_out)
    payload = {
        "updatedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "feeds": reports,
        "imageCache": kept_cache,
        "items": items_out,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    with_images = sum(1 for row in items_out if row.get("image"))
    print("Wrote {} stories ({} with pictures) to {}".format(len(items_out), with_images, OUT))
    return 0


def clean_article(text):
    text = re.sub(r"!\[[^\]]*\]\([^)]+\)", " ", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return re.sub(r"[ \t]{2,}", " ", text).strip()


def cap_words(text, limit=WORD_CAP):
    text = clean_article(text)
    words = text.split()
    if len(words) <= limit:
        return text
    return " ".join(words[:limit]).strip()


def article_file(art_id):
    return os.path.join(ARTICLES, art_id + ".json")


def write_article(payload):
    os.makedirs(ARTICLES, exist_ok=True)
    with open(article_file(payload["id"]), "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def extract_article(record):
    art_id = record["id"]
    if os.path.exists(article_file(art_id)):
        return "cached"
    url = record.get("url") or ""
    payload = {
        "id": art_id,
        "url": url,
        "title": record.get("title") or "",
        "source": record.get("source") or "",
        "image": record.get("image") or "",
        "ok": False,
        "text": "",
    }
    if (not url.startswith("http")) or ("news.ycombinator.com/item" in url):
        write_article(payload)
        return "skip"
    try:
        raw = fetch(url, timeout=12)
        html_text = raw.decode("utf-8", "replace")
        doc = trafilatura.bare_extraction(
            html_text,
            url=url,
            include_comments=False,
            include_tables=False,
            include_images=True,
            favor_precision=True,
        )
    except Exception as error:
        payload["error"] = str(error)[:180]
        write_article(payload)
        return "fail"
    if not doc:
        write_article(payload)
        return "fail"
    data = doc.as_dict() if hasattr(doc, "as_dict") else doc
    text = cap_words((data.get("text") or data.get("body") or "").strip())
    image = data.get("image") or payload["image"]
    if image and not record.get("image"):
        record["image"] = image
    payload["image"] = image or ""
    if len(text.split()) < 80:
        write_article(payload)
        return "short"
    payload["ok"] = True
    payload["text"] = text
    payload["words"] = len(text.split())
    write_article(payload)
    return "ok"


def save_articles(items):
    counts = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        for status in pool.map(extract_article, items):
            counts[status] = counts.get(status, 0) + 1
    print("Articles:", counts)


if __name__ == "__main__":
    sys.exit(main())
