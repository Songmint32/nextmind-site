#!/usr/bin/env python3
"""Fetch public tech headlines and write data/trends.json.

Edit FEEDS to add or remove an RSS source. Hacker News is separate
because it is a JSON API, not a feed. A source that fails is skipped.
The others are kept.

Headlines are written before article text is extracted. Extraction runs
one page at a time in a child process, because trafilatura/lxml can abort
the interpreter (SIGABRT) when several pages are parsed together. A crash
skips that page. This process still exits successfully so the new headlines
can be committed.
"""

import hashlib
import html
import json
import math
import os
import queue
import re
import subprocess
import sys
import threading
import time
import urllib.request
from urllib.parse import urljoin
import xml.etree.ElementTree as ET

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ARTICLE_ID = re.compile(r"[a-f0-9]{8,40}")
READY_TIMEOUT = 45
ARTICLE_TIMEOUT = 30
MAX_EXTRACT_FAILURES = 3
_TIMEOUT = object()


def trends_path():
    override = os.environ.get("NEXTMIND_TRENDS_OUT")
    if override:
        return override
    return os.path.join(ROOT, "data", "trends.json")


def articles_dir():
    override = os.environ.get("NEXTMIND_ARTICLES_DIR")
    if override:
        return override
    return os.path.join(ROOT, "data", "articles")
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
    path = trends_path()
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as handle:
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

    if not items_out and os.path.exists(trends_path()):
        print("No stories fetched. Leaving the existing data file in place.", flush=True)
        return 0

    # Headlines land on disk before any picture fetch or article extract.
    # A later native crash must not be required for this file to exist.
    write_output(now, reports, items_out, cache)
    report_write("Wrote", items_out)

    try:
        enrich_images(items_out, cache)
    except Exception as error:
        print("Picture lookup failed: {}".format(error), file=sys.stderr, flush=True)

    try:
        save_articles(items_out, cache)
    except Exception as error:
        print("Article extract failed: {}".format(error), file=sys.stderr, flush=True)

    try:
        write_output(now, reports, items_out, cache)
        report_write("Updated", items_out)
    except Exception as error:
        print("Could not refresh pictures in the data file: {}".format(error), file=sys.stderr, flush=True)
    return 0


def report_write(label, items_out):
    with_images = sum(1 for row in items_out if row.get("image"))
    print(
        "{} {} stories ({} with pictures) to {}".format(
            label, len(items_out), with_images, trends_path()
        ),
        flush=True,
    )


def kept_cache(items_out, cache):
    kept = {}
    for record in items_out:
        key = canonical(record["url"])
        if key in cache:
            kept[key] = cache[key]
    return kept


def write_output(now, reports, items_out, cache):
    payload = {
        "updatedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "feeds": reports,
        "imageCache": kept_cache(items_out, cache),
        "items": items_out,
    }
    path = trends_path()
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    temporary = path + ".tmp"
    try:
        with open(temporary, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
        os.replace(temporary, path)
    except Exception:
        try:
            os.remove(temporary)
        except OSError:
            pass
        raise


def lookup(record):
    found = image_from_page(record["url"])
    return canonical(record["url"]), found


def enrich_images(items_out, cache):
    missing = [
        record
        for record in items_out
        if not record.get("image") and canonical(record["url"]) not in cache
    ]
    missing.sort(key=lambda row: row["heat"], reverse=True)
    batch = missing[:PAGE_CAP]
    if not batch:
        return
    print("Looking up pictures for {} articles (cap {}).".format(len(batch), PAGE_CAP), flush=True)
    with ThreadPoolExecutor(max_workers=PAGE_WORKERS) as pool:
        for key, found in pool.map(lookup, batch):
            cache[key] = found or ""
            if found:
                for record in items_out:
                    if canonical(record["url"]) == key:
                        record["image"] = found


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
    if not ARTICLE_ID.fullmatch(art_id or ""):
        raise ValueError("bad article id")
    return os.path.join(articles_dir(), art_id + ".json")


def write_article(payload):
    os.makedirs(articles_dir(), exist_ok=True)
    with open(article_file(payload["id"]), "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def article_shell(record):
    return {
        "id": record["id"],
        "url": record.get("url") or "",
        "title": record.get("title") or "",
        "source": record.get("source") or "",
        "image": record.get("image") or "",
        "ok": False,
        "text": "",
    }


def extract_article(record, trafilatura_mod):
    art_id = record["id"]
    if os.path.exists(article_file(art_id)):
        return "cached", ""
    url = record.get("url") or ""
    payload = article_shell(record)
    if (not url.startswith("http")) or ("news.ycombinator.com/item" in url):
        write_article(payload)
        return "skip", ""
    try:
        raw = fetch(url, timeout=12)
        html_text = raw.decode("utf-8", "replace")
        doc = trafilatura_mod.bare_extraction(
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
        return "fail", ""
    if not doc:
        write_article(payload)
        return "fail", ""
    data = doc.as_dict() if hasattr(doc, "as_dict") else doc
    text = cap_words((data.get("text") or data.get("body") or "").strip())
    image = data.get("image") or payload["image"]
    payload["image"] = image or ""
    found = image if image and not record.get("image") else ""
    if len(text.split()) < 80:
        write_article(payload)
        return "short", found
    payload["ok"] = True
    payload["text"] = text
    payload["words"] = len(text.split())
    write_article(payload)
    return "ok", found


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def dry_extract(record):
    """Test hook. Production runs do not set NEXTMIND_EXTRACT_DRY."""
    title = record.get("title") or ""
    if title == "__abort__":
        os.abort()
    payload = article_shell(record)
    if title == "__fail__":
        payload["error"] = "dry fail"
        write_article(payload)
        return "fail", ""
    if title == "__image__":
        payload["image"] = "https://example.com/from-article.jpg"
        payload["ok"] = True
        payload["text"] = " ".join(["word"] * 80)
        payload["words"] = 80
        write_article(payload)
        return "ok", payload["image"]
    payload["ok"] = True
    payload["text"] = " ".join(["word"] * 80)
    payload["words"] = 80
    write_article(payload)
    return "ok", ""


def extract_worker_main():
    # A native abort here kills only this child. The parent keeps the headlines.
    if os.environ.get("NEXTMIND_EXTRACT_IMPORT_ABORT") == "1":
        os.abort()
    dry = os.environ.get("NEXTMIND_EXTRACT_DRY") == "1"
    trafilatura_mod = None
    if not dry:
        import trafilatura
        trafilatura_mod = trafilatura
    emit({"ready": True})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        record = {}
        try:
            record = json.loads(line)
            if dry:
                status, image = dry_extract(record)
            else:
                status, image = extract_article(record, trafilatura_mod)
        except Exception as error:
            status, image = "fail", ""
            if record.get("id") and not os.path.exists(article_file(record["id"])):
                try:
                    payload = article_shell(record)
                    payload["error"] = str(error)[:180]
                    write_article(payload)
                except (OSError, ValueError):
                    pass
        emit({"id": record.get("id") or "", "status": status, "image": image or ""})
    return 0


class LineReader:
    def __init__(self, stream):
        self._queue = queue.Queue()
        thread = threading.Thread(target=self._read, args=(stream,), daemon=True)
        thread.start()

    def _read(self, stream):
        try:
            while True:
                line = stream.readline()
                if line == "":
                    break
                self._queue.put(line)
        finally:
            self._queue.put(None)

    def read(self, timeout):
        try:
            return self._queue.get(timeout=timeout)
        except queue.Empty:
            return _TIMEOUT


def read_json(reader, timeout):
    deadline = time.monotonic() + timeout
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return None
        line = reader.read(remaining)
        if line is _TIMEOUT or line is None:
            return None
        line = line.strip()
        if not line:
            continue
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            continue


def worker_argv():
    return [sys.executable, os.path.abspath(__file__), "--extract-worker"]


def start_worker():
    proc = subprocess.Popen(
        worker_argv(),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=None,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    return proc, LineReader(proc.stdout)


def stop_worker(proc):
    if proc is None or proc.poll() is not None:
        if proc is not None:
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
        return
    try:
        proc.kill()
    except OSError:
        pass
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass


def worker_ready(proc, reader):
    message = read_json(reader, READY_TIMEOUT)
    if not message or proc.poll() not in (None, 0):
        return False
    return message.get("ready") is True


def send_record(proc, record):
    payload = json.dumps(
        {
            "id": record["id"],
            "url": record.get("url") or "",
            "title": record.get("title") or "",
            "source": record.get("source") or "",
            "image": record.get("image") or "",
        },
        ensure_ascii=False,
    )
    proc.stdin.write(payload + "\n")
    proc.stdin.flush()


def remember_image(record, cache, image):
    if not image or record.get("image"):
        return False
    record["image"] = image
    key = canonical(record["url"])
    if key:
        cache[key] = image
    return True


def note_crash(record, counts):
    try:
        path = article_file(record["id"])
    except ValueError:
        counts["crash"] = counts.get("crash", 0) + 1
        return
    if not os.path.exists(path):
        payload = article_shell(record)
        payload["error"] = "extractor crashed"
        try:
            write_article(payload)
        except (OSError, ValueError):
            pass
    counts["crash"] = counts.get("crash", 0) + 1


def save_articles(items, cache=None):
    """Extract article text one page at a time, outside this process.

    cache is the headline image cache. Newly found pictures are written onto
    the matching headline. Returns True when a picture was filled in.
    """
    if cache is None:
        cache = {}
    counts = {}
    pending = []
    images_changed = False

    def bump(status):
        counts[status] = counts.get(status, 0) + 1

    for record in items:
        try:
            path = article_file(record["id"])
        except ValueError:
            bump("skip")
            continue
        if os.path.exists(path):
            bump("cached")
            continue
        url = record.get("url") or ""
        if (not url.startswith("http")) or ("news.ycombinator.com/item" in url):
            write_article(article_shell(record))
            bump("skip")
            continue
        pending.append(record)

    proc = None
    if pending:
        proc, reader = start_worker()
        if not worker_ready(proc, reader):
            stop_worker(proc)
            proc, reader = start_worker()
            if not worker_ready(proc, reader):
                stop_worker(proc)
                proc = None
                print(
                    "Article extractor unavailable. Headlines were kept.",
                    file=sys.stderr,
                    flush=True,
                )

    consecutive = 0
    for record in pending:
        if proc is None:
            break
        try:
            send_record(proc, record)
            message = read_json(reader, ARTICLE_TIMEOUT)
        except (BrokenPipeError, OSError):
            message = None
        if (
            message
            and message.get("id") == record["id"]
            and message.get("status")
            and proc.poll() is None
        ):
            bump(message["status"])
            if remember_image(record, cache, message.get("image") or ""):
                images_changed = True
            consecutive = 0
            continue

        stop_worker(proc)
        note_crash(record, counts)
        consecutive += 1
        proc = None
        if consecutive >= MAX_EXTRACT_FAILURES:
            print(
                "Article extractor keeps failing. Leaving the rest for the next run.",
                file=sys.stderr,
                flush=True,
            )
            break
        proc, reader = start_worker()
        if not worker_ready(proc, reader):
            stop_worker(proc)
            proc = None
            print(
                "Article extractor unavailable. Headlines were kept.",
                file=sys.stderr,
                flush=True,
            )
            break

    if proc is not None and proc.poll() is None:
        try:
            proc.stdin.close()
        except OSError:
            pass
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            stop_worker(proc)

    print("Articles:", counts, flush=True)
    return images_changed


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--extract-worker":
        sys.exit(extract_worker_main())
    sys.exit(main())
