// HTML for every page. Layout lives here; episode content lives in data/.

import { isPlaceholder, placeholderHint } from "./load.mjs";

const esc = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Text that may still be a placeholder. Public builds never reach the
// placeholder branch because load.mjs has already removed those fields.
function text(value, fallback = "") {
  if (isPlaceholder(value)) {
    const hint = placeholderHint(value) || fallback;
    return `<span class="ph" title="Placeholder">${esc(hint || "Placeholder")}</span>`;
  }
  return esc(value);
}

const emphasis = (value) => esc(value).replace(/\*(.+?)\*/g, "<em>$1</em>");
const plain = (value) => String(value ?? "").replace(/\*/g, "");
const slugify = (value) => String(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const pad = (number) => String(number).padStart(2, "0");

const icon = {
  mark: `<svg class="mark" viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="96" fill="currentColor"/><polygon fill="var(--mark-glyph, #fff)" points="136,94 302,206 375,150 375,423 219,321 219,267 256,296 292,270 292,309 322,326 321,214 258,261 190,208 189,333 136,374"/></svg>`,
  youtube: `<svg class="yt" viewBox="0 0 20 14" aria-hidden="true"><rect width="20" height="14" rx="4" fill="currentColor"/><path d="M8 4.1v5.8L12.9 7Z" fill="#fff"/></svg>`,
  play: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5.6v12.8a.6.6 0 0 0 .9.5l10.2-6.4a.6.6 0 0 0 0-1L9.4 5.1a.6.6 0 0 0-.9.5Z" fill="currentColor"/></svg>`,
  arrow: `<svg class="arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8h8.5M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  out: `<svg class="out" viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 10.5 10.5 5.5M6.5 5.5h4v4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  search: `<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="m10.5 10.5 3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  grid: `<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1.25" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="2" width="5" height="5" rx="1.25" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="2" y="9" width="5" height="5" rx="1.25" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="9" width="5" height="5" rx="1.25" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`,
  list: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  share: `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.6 9.4 9.4 6.6M7.2 4.6l1.3-1.3a2.6 2.6 0 0 1 3.7 3.7l-1.3 1.3M8.8 11.4l-1.3 1.3a2.6 2.6 0 0 1-3.7-3.7l1.3-1.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
};

function subscribeUrl(show) {
  if (!show.youtube) return null;
  if (isPlaceholder(show.youtube)) return "#";
  const url = new URL(show.youtube);
  url.searchParams.set("sub_confirmation", "1");
  return url.toString();
}

function subscribeButton(show, { size = "", label = "Subscribe on YouTube", short = "" } = {}) {
  const href = subscribeUrl(show);
  if (!href) return "";
  const placeholder = href === "#" ? ` is-placeholder" title="Placeholder: add the channel URL to data/show.json` : "";
  const shortLabel = short ? `<span class="label-short">${esc(short)}</span><span class="label-long">${esc(label)}</span>` : esc(label);
  return `<a class="button button-primary ${size}${placeholder}" href="${esc(href)}" ${href === "#" ? "" : 'target="_blank" rel="noopener"'}>${icon.youtube}${shortLabel}</a>`;
}

function watchUrl(ep, seconds) {
  return `https://www.youtube.com/watch?v=${ep.youtubeId}${seconds ? `&t=${seconds}s` : ""}`;
}

function thumbnail(ep) {
  if (ep.artwork) return { src: ep.artwork, fallback: null };
  if (ep.youtubeId) return { src: `https://i.ytimg.com/vi/${ep.youtubeId}/maxresdefault.jpg`, fallback: `https://i.ytimg.com/vi/${ep.youtubeId}/hqdefault.jpg` };
  return null;
}

function statusLabel(ep) {
  if (ep.published) return ep.releaseLabel;
  return "Coming soon";
}

function ticker(ep) {
  if (!ep.ticker || isPlaceholder(ep.ticker)) return null;
  const [exchange, symbol] = ep.ticker.includes(":") ? ep.ticker.split(":").map((part) => part.trim()) : ["", ep.ticker.trim()];
  return { exchange, symbol };
}

// Without artwork an episode gets a drawn cover. The "card" cover carries the
// title, so a card does not repeat it. The "plate" cover sits next to a
// title that is already on the page, so it shows the ticker instead.
function cover(ep, root, { eager = false, transition = true, plate = false } = {}) {
  const image = thumbnail(ep);
  const name = transition ? `; view-transition-name: cover-${ep.slug}` : "";
  const symbol = ticker(ep);
  let art;
  if (image) {
    art = `<img src="${esc(image.src.startsWith("http") ? image.src : root + image.src)}" ${image.fallback ? `data-fallback="${esc(image.fallback)}"` : ""} alt="" width="1280" height="720" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
  } else if (plate) {
    art = `<span class="cover-art is-plate" aria-hidden="true">
        <span class="cover-row"><span>${esc(ep.sector)}</span><span>${symbol ? esc(symbol.exchange) : ""}</span></span>
        <span class="cover-symbol${symbol ? "" : " is-title"}">${esc(symbol ? symbol.symbol : ep.title)}</span>
        <span class="cover-row"><span class="cover-brand">${icon.mark}NextMind</span><span>${ep.number ? `No. ${pad(ep.number)}` : ""}</span></span>
      </span>`;
  } else {
    art = `<span class="cover-art" aria-hidden="true">
        <span class="cover-row"><span>${esc(ep.sector)}</span><span>${ep.number ? `No. ${pad(ep.number)}` : ""}</span></span>
        <span class="cover-title">${esc(ep.title)}</span>
        <span class="cover-initial">${esc(Array.from(ep.title)[0])}</span>
        <span class="cover-row"><span class="cover-brand">${icon.mark}NextMind</span><span>${symbol ? esc(ep.ticker) : ""}</span></span>
      </span>`;
  }
  return `<div class="cover${image ? " has-image" : ""}" style="--cover: ${esc(ep.color)}${name}">${art}</div>`;
}

function card(ep, root) {
  const search = [ep.title, ep.company, ep.ticker, ep.sector, ep.category, ep.logline, ep.series]
    .filter((value) => value && !isPlaceholder(value))
    .join(" ")
    .toLowerCase();
  return `<article class="card" data-sector="${esc(slugify(ep.sector))}" data-title="${esc(ep.title.toLowerCase())}" data-date="${esc(ep.releaseDate || "")}" data-search="${esc(search)}">
    <a class="card-link" href="${root}episodes/${ep.slug}/">
      ${cover(ep, root)}
      <span class="card-body">
        <span class="card-meta"><span>${esc(ep.category && !isPlaceholder(ep.category) ? ep.category : ep.sector)}</span><span class="${ep.published ? "" : "is-soon"}">${esc(statusLabel(ep))}</span></span>
        <span class="card-title${thumbnail(ep) ? "" : " is-on-cover"}">${esc(ep.title)}</span>
        ${ep.logline ? `<span class="card-logline">${text(ep.logline)}</span>` : ""}
      </span>
    </a>
  </article>`;
}

function grid(episodes, root, attrs = "") {
  return `<div class="episode-grid" data-count="${episodes.length}" ${attrs}>${episodes.map((ep) => card(ep, root)).join("")}</div>`;
}

function layout(site, page) {
  const { show, preview, assetVersion, year } = site;
  const { root, path, title, description, image, body, current, jsonLd } = page;
  const url = show.siteUrl + path;
  const shareImage = image ? (image.startsWith("http") ? image : show.siteUrl + image) : show.siteUrl + "assets/logo.png";
  const subscribe = subscribeUrl(show);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}">
  ${preview ? '<meta name="robots" content="noindex">' : ""}
  <link rel="canonical" href="${esc(url)}">
  <meta name="theme-color" content="#f3f1ec" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#141311" media="(prefers-color-scheme: dark)">
  <meta property="og:site_name" content="${esc(show.name)}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:type" content="${page.ogType || "website"}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="${esc(shareImage)}">
  <meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">
  <link rel="icon" href="${root}assets/logo.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="${root}assets/logo.png">
  <link rel="preload" href="${root}fonts/newsreader-display.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="${root}fonts/inter-400.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="${root}assets/show.css?v=${assetVersion}">
  <script>document.documentElement.classList.add("js")</script>
  ${page.headScript ? `<script>${page.headScript}</script>` : ""}
  ${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>` : ""}
</head>
<body>
  <a class="skip" href="#main">Skip to content</a>
  <header class="site-header">
    <div class="wrap header-inner">
      <a class="brand" href="${root}">${icon.mark}<span>${esc(show.name)}</span></a>
      <nav class="header-nav" aria-label="Main">
        <a class="nav-link" href="${root}episodes/"${current === "episodes" ? ' aria-current="page"' : ""}>Episodes</a>
        ${subscribe ? subscribeButton(show, { size: "button-small", label: "Subscribe", short: "" }) : ""}
      </nav>
    </div>
  </header>
  <main id="main">
${body}
  </main>
  <footer class="site-footer">
    <div class="wrap footer-inner">
      <a class="brand" href="${root}">${icon.mark}<span>${esc(show.name)}</span></a>
      <nav class="footer-nav" aria-label="Footer">
        <a href="${root}episodes/">Episodes</a>
        ${subscribe && subscribe !== "#" ? `<a href="${esc(show.youtube)}" target="_blank" rel="noopener">YouTube${icon.out}</a>` : ""}
        <a href="${root}tools.html">Tools</a>
      </nav>
      <p class="footer-note">© ${year} ${esc(show.name)}</p>
    </div>
  </footer>
  ${preview ? '<p class="preview-badge">Preview build · placeholders shown</p>' : ""}
  <script src="${root}assets/show.js?v=${assetVersion}" defer></script>
</body>
</html>
`;
}

export function renderHome(site) {
  const { show, episodes } = site;
  const root = "";
  const [featured, ...rest] = episodes;
  const subscribe = subscribeUrl(show);
  const heroActions = subscribe
    ? `${subscribeButton(show, { size: "button-large" })}<a class="button button-quiet button-large" href="episodes/">All episodes${icon.arrow}</a>`
    : `<a class="button button-primary button-large" href="episodes/">Browse episodes${icon.arrow}</a>`;

  const feature = featured
    ? `<section class="wrap feature" aria-labelledby="feature-title">
      <a class="feature-link" href="episodes/${featured.slug}/">
        <div class="feature-media">${cover(featured, root, { eager: true, plate: true })}</div>
        <div class="feature-body">
          <p class="eyebrow"><span class="dot" aria-hidden="true"></span>${featured.published ? "Latest episode" : "Up next"}</p>
          <h2 class="feature-title" id="feature-title">${esc(featured.title)}</h2>
          ${featured.logline ? `<p class="feature-logline">${text(featured.logline)}</p>` : ""}
          <p class="meta-line">${[featured.company, featured.category, featured.published ? featured.releaseLabel : null, featured.durationLabel].filter((v) => v && !isPlaceholder(v)).map(esc).join('<span aria-hidden="true">·</span>')}</p>
          <span class="text-link">${featured.published ? "Watch the episode" : "Episode page"}${icon.arrow}</span>
        </div>
      </a>
    </section>`
    : "";

  const more = rest.length
    ? `<section class="wrap home-episodes" aria-labelledby="more-title">
      <div class="section-head">
        <h2 class="section-title" id="more-title">More episodes</h2>
        <a class="text-link" href="episodes/">All episodes <span class="count">${episodes.length}</span>${icon.arrow}</a>
      </div>
      ${grid(rest.slice(0, 6), root)}
    </section>`
    : "";

  const about = (show.about || []).length
    ? `<section class="wrap" id="about" aria-labelledby="about-title">
      <div class="about">
        <h2 class="eyebrow" id="about-title">About the show</h2>
        <div class="about-body">
          ${show.about.map((p) => `<p>${emphasis(p)}</p>`).join("")}
          ${subscribe ? `<div class="about-actions">${subscribeButton(show)}</div>` : ""}
        </div>
      </div>
    </section>`
    : "";

  const body = `
    <section class="wrap hero">
      <h1 class="hero-title">${emphasis(show.headline)}</h1>
      <div class="hero-foot">
        ${show.intro ? `<p class="hero-intro">${emphasis(show.intro)}</p>` : ""}
        <div class="hero-actions">${heroActions}</div>
      </div>
    </section>
    ${feature}
    ${more}
    ${about}`;

  return layout(site, {
    root,
    path: "",
    title: `${show.name} · ${plain(show.headline)}`,
    // Links to the old single-page tools (/#radar, /#read/…) now land on tools.html.
    headScript: `if (/^#(overview|radar|studio|saved|voiceover|pricing|read\\/)/.test(location.hash)) location.replace("tools.html" + location.hash);`,
    description: plain(show.intro || show.headline),
    body,
    jsonLd: { "@context": "https://schema.org", "@type": "WebSite", name: show.name, url: show.siteUrl, description: plain(show.intro || show.headline) },
  });
}

export function renderIndex(site) {
  const { show, episodes } = site;
  const root = "../";
  const sectors = [];
  for (const ep of episodes) {
    const found = sectors.find((s) => s.name === ep.sector);
    if (found) found.count += 1;
    else sectors.push({ name: ep.sector, id: slugify(ep.sector), count: 1 });
  }
  sectors.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const total = `${episodes.length} episode${episodes.length === 1 ? "" : "s"}`;

  const body = `
    <section class="wrap index">
      <header class="index-head">
        <h1 class="page-title">Episodes</h1>
        <p class="index-count" data-episode-count aria-live="polite">${total}</p>
      </header>
      <div class="toolbar" data-toolbar>
        <div class="chips" role="group" aria-label="Sector">
          <button class="chip" type="button" data-sector="" aria-pressed="true">All<span class="chip-count">${episodes.length}</span></button>
          ${sectors.map((s) => `<button class="chip" type="button" data-sector="${esc(s.id)}" aria-pressed="false">${esc(s.name)}<span class="chip-count">${s.count}</span></button>`).join("")}
        </div>
        <div class="toolbar-end">
          <label class="search">
            ${icon.search}
            <input type="search" data-search placeholder="Search" aria-label="Search episodes" autocomplete="off" spellcheck="false" enterkeyhint="search">
            <kbd aria-hidden="true">/</kbd>
          </label>
          <label class="select">
            <span class="visually-hidden">Sort</span>
            <select data-sort aria-label="Sort episodes">
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="az">A–Z</option>
            </select>
          </label>
          <div class="segmented" role="group" aria-label="Layout">
            <button type="button" data-view="grid" aria-pressed="true" aria-label="Grid">${icon.grid}</button>
            <button type="button" data-view="list" aria-pressed="false" aria-label="List">${icon.list}</button>
          </div>
        </div>
      </div>
      ${grid(episodes, root, 'data-results data-layout="grid"')}
      <div class="empty" data-empty hidden>
        <p>No episodes match.</p>
        <button class="button button-quiet" type="button" data-clear>Clear filters</button>
      </div>
    </section>`;

  return layout(site, {
    root,
    path: "episodes/",
    title: `Episodes · ${show.name}`,
    description: `Every ${show.name} episode, by sector.`,
    body,
    current: "episodes",
  });
}

function player(ep, root) {
  if (ep.youtubeId) {
    const image = thumbnail(ep);
    return `<div class="player" data-player data-id="${esc(ep.youtubeId)}" data-title="${esc(ep.title)}" style="view-transition-name: cover-${ep.slug}">
      <a class="player-poster" href="${esc(watchUrl(ep))}" target="_blank" rel="noopener" aria-label="Play ${esc(ep.title)}">
        <img src="${esc(image.src.startsWith("http") ? image.src : root + image.src)}" ${image.fallback ? `data-fallback="${esc(image.fallback)}"` : ""} alt="" width="1280" height="720" fetchpriority="high" decoding="async">
        <span class="player-play">${icon.play}</span>
      </a>
    </div>`;
  }
  const placeholder = ep.youtubeIdPlaceholder
    ? `<span class="player-ph"><span class="ph">${esc(placeholderHint(ep.youtubeIdPlaceholder))}</span></span>`
    : "";
  return `<div class="player is-pending">${cover(ep, root, { eager: true, plate: true })}${placeholder}</div>`;
}

function facts(ep) {
  const rows = [
    ["Company", ep.company],
    ["Ticker", ep.ticker],
    ["Sector", ep.sector],
    ["Category", ep.category],
    ["Released", ep.releaseLabel],
    ["Length", ep.durationLabel || (isPlaceholder(ep.duration) ? ep.duration : null)],
  ].filter(([, value]) => value);
  return `<dl class="facts">${rows.map(([key, value]) => `<div><dt>${key}</dt><dd>${text(value)}</dd></div>`).join("")}</dl>`;
}

function seekLink(ep, seconds, label, className) {
  if (ep.youtubeId && seconds !== null) {
    return `<a class="${className}" href="${esc(watchUrl(ep, seconds))}" target="_blank" rel="noopener" data-seek="${seconds}">${label}</a>`;
  }
  return `<span class="${className}">${label}</span>`;
}

function sections(ep, preview) {
  const out = [];

  if (ep.summary.length) {
    out.push({
      id: "summary",
      title: "Summary",
      html: `<div class="prose">${ep.summary.map((p) => `<p>${text(p)}</p>`).join("")}</div>`,
    });
  }

  if (ep.keyNumbers.length) {
    out.push({
      id: "numbers",
      title: "Key numbers",
      html: `<dl class="numbers" data-count="${ep.keyNumbers.length}">${ep.keyNumbers
        .map(
          (n) => `<div class="number">
            <dt class="number-label">${text(n.label)}</dt>
            <dd class="number-value">${isPlaceholder(n.value) ? '<span class="ph ph-value">0.0</span>' : esc(n.value)}</dd>
            ${n.source ? `<dd class="number-source">${n.sourceUrl && !isPlaceholder(n.sourceUrl) ? `<a href="${esc(n.sourceUrl)}" target="_blank" rel="noopener">${text(n.source)}</a>` : text(n.source)}</dd>` : ""}
          </div>`
        )
        .join("")}</dl>`,
    });
  }

  if (ep.chapters.length) {
    out.push({
      id: "chapters",
      title: "Chapters",
      count: ep.chapters.length,
      html: `<ol class="chapters">${ep.chapters
        .map((c) => {
          const time = isPlaceholder(c.time) ? '<span class="ph ph-time">0:00</span>' : esc(c.time);
          const inner = `<span class="chapter-time">${time}</span><span class="chapter-title">${text(c.title)}</span>${ep.youtubeId ? icon.play : ""}`;
          return `<li>${seekLink(ep, c.seconds, inner, "chapter")}</li>`;
        })
        .join("")}</ol>`,
    });
  }

  if (ep.sourceGroups.length) {
    out.push({
      id: "sources",
      title: "Sources",
      count: ep.sourceCount,
      html: `<div class="sources">${ep.sourceGroups
        .map(
          (group) => `<div class="source-group">
            <h3 class="source-group-title">${text(group.name)}</h3>
            <ul>${group.items
              .map((s) => {
                const inner = `<span class="source-title">${text(s.title)}</span>${s.publisher ? `<span class="source-publisher">${text(s.publisher)}</span>` : ""}`;
                return isPlaceholder(s.url)
                  ? `<li><span class="source">${inner}</span></li>`
                  : `<li><a class="source" href="${esc(s.url)}" target="_blank" rel="noopener">${inner}${icon.out}</a></li>`;
              })
              .join("")}</ul>
          </div>`
        )
        .join("")}</div>`,
    });
  }

  if (ep.transcript) {
    const words = ep.transcript.reduce((total, p) => total + p.text.split(/\s+/).length, 0);
    out.push({
      id: "transcript",
      title: "Transcript",
      html: `<details class="transcript">
        <summary><span class="transcript-open">Read the transcript</span><span class="transcript-close">Hide the transcript</span><span class="transcript-length">${words.toLocaleString("en-US")} words<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 6.5 3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span></summary>
        <div class="transcript-body">${ep.transcript
          .map((p) => {
            const stamp = p.time ? seekLink(ep, p.seconds, esc(p.time), "transcript-time") : "";
            const speaker = p.speaker ? `<span class="transcript-speaker">${esc(p.speaker)}</span>` : "";
            return `<p>${stamp || speaker ? `<span class="transcript-meta">${speaker}${stamp}</span>` : ""}${esc(p.text)}</p>`;
          })
          .join("")}</div>
      </details>`,
    });
  } else if (preview) {
    out.push({
      id: "transcript",
      title: "Transcript",
      html: `<p><span class="ph">Optional: add data/transcripts/${esc(ep.slug)}.md and it appears here</span></p>`,
    });
  }

  return out;
}

function related(ep, episodes) {
  const others = episodes.filter((other) => other.slug !== ep.slug);
  const sameSeries = ep.series ? others.filter((o) => o.series === ep.series) : [];
  const sameSector = others.filter((o) => o.sector === ep.sector && !sameSeries.includes(o));
  const rest = others.filter((o) => !sameSeries.includes(o) && !sameSector.includes(o));
  return [...sameSeries, ...sameSector, ...rest].slice(0, 3);
}

export function renderEpisode(site, ep) {
  const { show, episodes } = site;
  const root = "../../";
  const list = sections(ep, site.preview);
  const metaItems = [
    ep.number ? `No. ${pad(ep.number)}` : null,
    ep.published ? ep.releaseLabel : null,
    ep.durationLabel,
  ].filter(Boolean);
  const status = ep.published
    ? `<p class="meta-line">${metaItems.map(esc).join('<span aria-hidden="true">·</span>')}</p>`
    : `<p class="eyebrow is-soon"><span class="dot" aria-hidden="true"></span>Coming soon</p>`;

  const actions = ep.published
    ? `<a class="button button-primary" href="${esc(watchUrl(ep))}" target="_blank" rel="noopener">${icon.youtube}Watch on YouTube</a>`
    : subscribeButton(show);

  const image = thumbnail(ep);
  const description = ep.logline && !isPlaceholder(ep.logline)
    ? plain(ep.logline)
    : `${ep.title}, a ${show.name} deep dive${ep.published ? "" : ". Coming soon"}.`;

  const more = related(ep, episodes);
  const body = `
    <article class="episode">
      <div class="wrap">
        <nav class="crumbs" aria-label="Breadcrumb"><a href="../">Episodes</a><span aria-hidden="true">/</span><a href="../?sector=${esc(slugify(ep.sector))}">${esc(ep.sector)}</a></nav>
        <header class="ep-head">
          <h1 class="ep-title">${esc(ep.title)}</h1>
          ${ep.logline ? `<p class="ep-logline">${text(ep.logline)}</p>` : ""}
          <div class="ep-bar">
            ${status}
            <div class="ep-actions">
              ${actions}
              <button class="button button-quiet" type="button" data-share>${icon.share}<span data-share-label>Copy link</span></button>
            </div>
          </div>
        </header>
        <div class="ep-media">${player(ep, root)}</div>
        ${facts(ep)}
        ${list.length
          ? `<div class="ep-layout">
          <div class="ep-main">
            ${list
              .map(
                (s) => `<section class="ep-section" id="${s.id}" aria-labelledby="${s.id}-title">
              <h2 class="ep-section-title" id="${s.id}-title">${s.title}${s.count ? `<span class="count">${s.count}</span>` : ""}</h2>
              ${s.html}
            </section>`
              )
              .join("")}
          </div>
          <aside class="ep-aside">
            <nav class="toc" aria-label="On this page">
              <p class="toc-title">On this page</p>
              <ul>${list.map((s) => `<li><a href="#${s.id}">${s.title}</a></li>`).join("")}</ul>
            </nav>
          </aside>
        </div>`
          : ""}
      </div>
      ${more.length
        ? `<section class="wrap home-episodes related" aria-labelledby="related-title">
        <div class="section-head">
          <h2 class="section-title" id="related-title">More episodes</h2>
          <a class="text-link" href="../">All episodes${icon.arrow}</a>
        </div>
        ${grid(more, root)}
      </section>`
        : ""}
    </article>`;

  const jsonLd = ep.published
    ? {
        "@context": "https://schema.org",
        "@type": "VideoObject",
        name: `${ep.title} | ${show.name}`,
        description,
        thumbnailUrl: image ? [image.src.startsWith("http") ? image.src : show.siteUrl + image.src] : undefined,
        uploadDate: ep.releaseDate,
        duration: ep.durationIso || undefined,
        embedUrl: `https://www.youtube.com/embed/${ep.youtubeId}`,
        url: show.siteUrl + `episodes/${ep.slug}/`,
      }
    : null;

  return layout(site, {
    root,
    path: `episodes/${ep.slug}/`,
    title: `${ep.title} · ${show.name}`,
    description,
    image: image ? image.src : null,
    ogType: ep.published ? "video.episode" : "website",
    body,
    current: "episodes",
    jsonLd,
  });
}

export function renderNotFound(site) {
  const root = new URL(site.show.siteUrl).pathname;
  const body = `
    <section class="wrap not-found">
      <p class="eyebrow">404</p>
      <h1 class="page-title">This page isn’t here.</h1>
      <p class="hero-intro">It may have moved when an episode was renamed.</p>
      <div class="hero-actions"><a class="button button-primary" href="${root}episodes/">Browse episodes${icon.arrow}</a></div>
    </section>`;
  return layout(site, { root, path: "404.html", title: `Not found · ${site.show.name}`, description: "Page not found.", body });
}

export function renderSitemap(site) {
  const urls = ["", "episodes/", ...site.episodes.map((ep) => `episodes/${ep.slug}/`)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((path) => `  <url><loc>${esc(site.show.siteUrl + path)}</loc></url>`).join("\n")}
</urlset>
`;
}
