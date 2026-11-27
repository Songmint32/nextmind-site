// Reads data/show.json, data/episodes.json and data/transcripts/, checks them,
// and returns plain objects the templates can render without further checks.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const PLACEHOLDER = /^\s*PLACEHOLDER\b/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const TIME = /^(?:\d+:)?\d{1,2}:\d{2}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const STATUSES = ["published", "coming-soon"];

export function isPlaceholder(value) {
  return typeof value === "string" && PLACEHOLDER.test(value);
}

export function placeholderHint(value) {
  return String(value).replace(/^\s*PLACEHOLDER\b:?\s*/, "").trim();
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path}: ${error.message}`);
  }
}

// In a public build a placeholder is the same as an empty field, and a list
// item that still holds one is dropped. A preview build keeps both so the
// templates can draw them as marked placeholders.
function present(value, preview) {
  if (value === null || value === undefined || value === "") return null;
  if (isPlaceholder(value) && !preview) return null;
  return value;
}

function presentItems(list, preview) {
  if (!Array.isArray(list)) return [];
  return list.filter((item) => {
    if (!item || typeof item !== "object") return false;
    if (preview) return true;
    return !Object.values(item).some(isPlaceholder);
  });
}

export function timeToSeconds(time) {
  return String(time).split(":").reduce((total, part) => total * 60 + Number(part), 0);
}

function durationParts(duration) {
  if (!duration || isPlaceholder(duration) || !TIME.test(duration)) return null;
  const seconds = timeToSeconds(duration);
  return { hours: Math.floor(seconds / 3600), minutes: Math.floor((seconds % 3600) / 60), seconds: seconds % 60 };
}

function durationLabel(duration) {
  const parts = durationParts(duration);
  if (!parts) return null;
  if (parts.hours) return `${parts.hours} hr ${parts.minutes} min`;
  return `${parts.minutes} min`;
}

function durationIso(duration) {
  const parts = durationParts(duration);
  if (!parts) return null;
  return `PT${parts.hours ? parts.hours + "H" : ""}${parts.minutes}M${parts.seconds}S`;
}

function formatDate(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

// Transcript files are plain text. Paragraphs are separated by a blank line.
// A paragraph may start with a [1:02:03] timestamp and a "Speaker:" name.
function readTranscript(dir, slug) {
  for (const ext of [".md", ".txt"]) {
    const path = join(dir, slug + ext);
    if (!existsSync(path)) continue;
    const blocks = readFileSync(path, "utf8").replace(/\r\n?/g, "\n").split(/\n\s*\n/);
    const paragraphs = [];
    for (const raw of blocks) {
      let text = raw.trim().replace(/\s*\n\s*/g, " ");
      if (!text || text.startsWith("#")) continue;
      let time = null;
      let speaker = null;
      const stamp = text.match(/^\[((?:\d+:)?\d{1,2}:\d{2})\]\s*/);
      if (stamp) {
        time = stamp[1];
        text = text.slice(stamp[0].length);
      }
      const name = text.match(/^([A-Z][\w .'-]{0,30}):\s+/);
      if (name) {
        speaker = name[1];
        text = text.slice(name[0].length);
      }
      paragraphs.push({ time, seconds: time ? timeToSeconds(time) : null, speaker, text });
    }
    return paragraphs.length ? paragraphs : null;
  }
  return null;
}

export function loadSite(root, { preview = false, dataDir = "data" } = {}) {
  const errors = [];
  const warnings = [];
  const data = resolve(root, dataDir);
  const show = readJson(join(data, "show.json"));
  const raw = readJson(join(data, "episodes.json"));

  for (const key of ["name", "headline", "siteUrl"]) {
    if (!show[key]) errors.push(`data/show.json: "${key}" is required.`);
  }
  if (show.siteUrl && !show.siteUrl.endsWith("/")) show.siteUrl += "/";
  if (isPlaceholder(show.youtube)) warnings.push(`data/show.json: the YouTube channel URL is still a placeholder, so subscribe buttons are ${preview ? "marked" : "hidden"}.`);
  else if (show.youtube && !/^https:\/\/(www\.)?youtube\.com\//.test(show.youtube)) errors.push(`data/show.json: "youtube" should start with https://www.youtube.com/ (got ${show.youtube}).`);

  if (!Array.isArray(raw)) {
    throw new Error("data/episodes.json must be a list of episodes: [ { … }, { … } ].");
  }

  const seen = new Set();
  const episodes = raw.map((source, index) => {
    const where = `data/episodes.json, episode ${index + 1}${source && source.slug ? ` (${source.slug})` : ""}`;
    const fail = (message) => errors.push(`${where}: ${message}`);
    if (!source || typeof source !== "object") {
      fail("is not an object.");
      return null;
    }

    if (!source.slug || !SLUG.test(source.slug)) fail(`"slug" must be lowercase words joined by hyphens, e.g. "eli-lilly".`);
    else if (seen.has(source.slug)) fail(`the slug "${source.slug}" is used twice.`);
    seen.add(source.slug);
    for (const key of ["title", "sector"]) {
      if (!source[key] || isPlaceholder(source[key])) fail(`"${key}" is required.`);
    }
    if (!STATUSES.includes(source.status)) fail(`"status" must be one of: ${STATUSES.join(", ")}.`);

    const published = source.status === "published";
    const dateOk = typeof source.releaseDate === "string" && DATE.test(source.releaseDate);
    const idOk = typeof source.youtubeId === "string" && YOUTUBE_ID.test(source.youtubeId);
    if (source.releaseDate && !isPlaceholder(source.releaseDate) && !dateOk) fail(`"releaseDate" must look like 2027-03-14.`);
    if (source.youtubeId && !isPlaceholder(source.youtubeId) && !idOk) fail(`"youtubeId" must be the 11-character id from the video URL.`);
    if (published && !dateOk) fail(`a published episode needs a "releaseDate".`);
    if (published && !idOk) fail(`a published episode needs a "youtubeId".`);
    if (source.duration && !isPlaceholder(source.duration) && !TIME.test(source.duration)) fail(`"duration" must look like 1:24:10.`);
    if (source.cover && source.cover.color && !HEX.test(source.cover.color)) fail(`"cover.color" must be a hex color like #6b2a22.`);
    for (const chapter of source.chapters || []) {
      if (!isPlaceholder(chapter.time) && !TIME.test(String(chapter.time))) fail(`chapter time "${chapter.time}" must look like 0:00 or 1:02:03.`);
    }
    for (const item of source.sources || []) {
      if (!isPlaceholder(item.url) && !/^https?:\/\//.test(String(item.url))) fail(`source "${item.title}" needs a full https:// link.`);
    }

    const placeholders = JSON.stringify(source).match(/"\s*PLACEHOLDER\b/g);
    if (placeholders) warnings.push(`${where}: ${placeholders.length} placeholder field${placeholders.length === 1 ? "" : "s"}.`);

    const chapters = presentItems(source.chapters, preview).map((chapter) => ({
      ...chapter,
      seconds: isPlaceholder(chapter.time) ? null : timeToSeconds(chapter.time),
    }));
    const sources = presentItems(source.sources, preview);
    const groups = [];
    for (const item of sources) {
      const name = item.group || "Further reading";
      let group = groups.find((entry) => entry.name === name);
      if (!group) groups.push((group = { name, items: [] }));
      group.items.push(item);
    }

    const summary = (Array.isArray(source.summary) ? source.summary : [source.summary])
      .map((paragraph) => present(paragraph, preview))
      .filter(Boolean);

    const youtubeId = idOk ? source.youtubeId : null;
    return {
      slug: source.slug,
      status: source.status,
      published,
      number: Number.isInteger(source.number) ? source.number : null,
      title: source.title,
      company: present(source.company, preview),
      ticker: present(source.ticker, preview),
      sector: source.sector,
      category: present(source.category, preview),
      series: present(source.series, preview),
      releaseDate: dateOk ? source.releaseDate : null,
      releaseLabel: dateOk ? formatDate(source.releaseDate) : present(source.releaseDate, preview),
      duration: present(source.duration, preview),
      durationLabel: durationLabel(source.duration),
      durationIso: durationIso(source.duration),
      youtubeId,
      youtubeIdPlaceholder: !idOk && isPlaceholder(source.youtubeId) && preview ? source.youtubeId : null,
      logline: present(source.logline, preview),
      summary,
      chapters,
      keyNumbers: presentItems(source.keyNumbers, preview),
      sourceGroups: groups,
      sourceCount: sources.length,
      transcript: readTranscript(join(data, "transcripts"), source.slug),
      color: (source.cover && source.cover.color) || "#2a2826",
      artwork: present(source.artwork, false),
      order: index,
    };
  }).filter(Boolean);

  if (errors.length) {
    const error = new Error(`The episode data has ${errors.length} problem${errors.length === 1 ? "" : "s"}:\n  - ${errors.join("\n  - ")}`);
    error.isDataError = true;
    throw error;
  }

  // Newest first. Upcoming episodes lead, in the order they appear in the file.
  episodes.sort((a, b) => {
    if (a.published !== b.published) return a.published ? 1 : -1;
    if (!a.published) return a.order - b.order;
    return b.releaseDate.localeCompare(a.releaseDate) || a.order - b.order;
  });

  const youtube = present(show.youtube, preview);
  return {
    show: { ...show, youtube },
    episodes,
    warnings,
    preview,
  };
}
