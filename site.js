/* NextMind app behavior.
   Trend Radar reads data/trends.json, which a scheduled job refreshes.
   Voiceover uses the browser's own speech, not a paid voice service.
   If this file does not run, the sections stay on the page but the tools do not. */
(function () {
  var views = {
    overview: { crumb: "Overview", lede: "" },
    radar: { crumb: "Trend Radar", lede: "" },
    studio: { crumb: "Script Studio", lede: "" },
    saved: { crumb: "Saved", lede: "" },
    voiceover: { crumb: "Voiceover", lede: "" },
    pricing: { crumb: "Pricing", lede: "" },
    about: { crumb: "About", lede: "" },
    read: { crumb: "Story", lede: "" }
  };

  var HEAT_HN = "Heat starts at 100 when a story is new and falls to 0 after 48 hours. This one also adds Hacker News points and comments.";
  var HEAT_TIME = "Heat starts at 100 when a story is new and falls to 0 after 48 hours. This source has no points, so the score is recency only.";

  var state = { topic: "", source: "", range: "24h", sort: "heat", query: "" };
  var BATCH = 20;
  var shown = BATCH;
  var sections = [
    ["overview", "Overview"],
    ["radar", "Trend Radar"],
    ["studio", "Script Studio"],
    ["saved", "Saved"],
    ["voiceover", "Voiceover"],
    ["pricing", "Pricing"],
    ["about", "About"]
  ];
  var trends = null;
  var speaking = false;
  var picked = [];
  var studioStories = [];
  var studioRoundup = false;
  var studioNeedsDraft = false;

  var month = document.getElementById("month-label");
  var crumb = document.getElementById("crumb");
  var lede = document.getElementById("lede");
  var sidebar = document.getElementById("sidebar");
  var menuBtn = document.querySelector(".menu-btn");
  var palette = document.getElementById("palette");
  var paletteInput = document.getElementById("palette-input");

  if (month) {
    var label = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
    if (label) month.textContent = label;
  }

  function parseHash() {
    var hash = (location.hash || "").replace(/^#/, "");
    if (hash.indexOf("read/") === 0) return { view: "read", id: decodeURIComponent(hash.slice(5)) };
    return { view: views[hash] ? hash : "overview", id: "" };
  }

  function viewFromHash() {
    return parseHash().view;
  }

  function menuIsOverlay() {
    return menuBtn && getComputedStyle(menuBtn).display !== "none";
  }

  function focusableIn(root) {
    return Array.prototype.filter.call(
      root.querySelectorAll("a[href], button:not([disabled]), input, select, textarea"),
      function (el) { return !el.hidden && el.offsetParent !== null; }
    );
  }

  function setMenu(open) {
    if (!sidebar || !menuBtn) return;
    var overlay = menuIsOverlay();
    sidebar.classList.toggle("is-open", open && overlay);
    menuBtn.setAttribute("aria-expanded", open && overlay ? "true" : "false");
    var main = document.getElementById("content");
    if (main) main.setAttribute("aria-hidden", open && overlay ? "true" : "false");
    if (open && overlay) {
      var items = focusableIn(sidebar);
      if (items[0]) items[0].focus();
    } else if (overlay && document.activeElement && sidebar.contains(document.activeElement)) {
      menuBtn.focus();
    }
  }

  function show(name) {
    var info = views[name] || views.overview;
    document.querySelectorAll("[data-view-panel]").forEach(function (panel) {
      panel.classList.toggle("is-active", panel.getAttribute("data-view-panel") === name);
    });
    if (crumb) crumb.textContent = info.crumb;
    var title = document.getElementById("view-title");
    if (title) title.textContent = info.crumb;
    if (lede) {
      lede.textContent = info.lede || "";
      lede.hidden = !info.lede;
    }
    document.body.classList.toggle("is-reading", name === "read");
    var activeNav = name === "read" ? "radar" : name;
    document.querySelectorAll(".nav a[data-view]").forEach(function (link) {
      if (link.getAttribute("data-view") === activeNav) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    setMenu(false);
    if (name === "radar") renderRadar();
    if (name === "overview") renderOverview();
    if (name === "voiceover") {
      var savedScript = sessionStorage.getItem("nextmind-script");
      var script = document.getElementById("script");
      if (savedScript != null && script) {
        script.value = savedScript;
        sessionStorage.removeItem("nextmind-script");
        updateScript();
      }
    }
    if (name === "studio") renderStudio();
    if (name === "saved") renderSaved();
    if (name === "read") loadReader(parseHash().id);
  }

  function showAndStay(name) {
    show(name);
    requestAnimationFrame(function () { window.scrollTo(0, 0); });
  }

  function go(name) {
    if (!views[name]) name = "overview";
    if (location.hash !== "#" + name) location.hash = name;
    else showAndStay(name);
  }

  document.querySelectorAll("[data-view]").forEach(function (el) {
    el.addEventListener("click", function (event) {
      if (el.closest("#palette")) return;
      event.preventDefault();
      go(el.getAttribute("data-view"));
    });
  });

  document.querySelectorAll("[data-jump-topic]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      state.topic = btn.getAttribute("data-jump-topic") || "";
      shown = BATCH;
      syncTopicChips();
      go("radar");
    });
  });

  if (menuBtn) {
    menuBtn.addEventListener("click", function () {
      setMenu(!sidebar.classList.contains("is-open"));
    });
  }
  document.addEventListener("click", function (event) {
    if (!sidebar || !sidebar.classList.contains("is-open")) return;
    if (sidebar.contains(event.target) || (menuBtn && menuBtn.contains(event.target))) return;
    setMenu(false);
  });
  document.addEventListener("keydown", function (event) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openSearch();
      return;
    }
    if (event.key === "Escape" && sidebar && sidebar.classList.contains("is-open")) {
      setMenu(false);
      return;
    }
    if (event.key !== "Tab" || !sidebar || !sidebar.classList.contains("is-open")) return;
    var items = focusableIn(sidebar);
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  function openSearch() {
    if (!palette || !palette.showModal) return;
    setMenu(false);
    if (paletteInput) paletteInput.value = "";
    renderPalette("");
    palette.showModal();
    if (paletteInput) paletteInput.focus();
  }
  document.querySelectorAll("[data-open-search]").forEach(function (btn) {
    btn.addEventListener("click", openSearch);
  });
  function renderPalette(value) {
    var list = document.getElementById("palette-list");
    if (!list) return;
    var query = value.trim().toLowerCase();
    list.textContent = "";
    sections.forEach(function (pair) {
      if (query && pair[1].toLowerCase().indexOf(query) === -1) return;
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = pair[1];
      button.addEventListener("click", function () {
        if (palette.close) palette.close();
        go(pair[0]);
      });
      list.appendChild(button);
    });
    var matches = [];
    if (query && trends && trends.items) {
      matches = trends.items.filter(function (item) {
        return (item.title + " " + item.source).toLowerCase().indexOf(query) !== -1;
      }).slice(0, 8);
    }
    matches.forEach(function (item) {
      var button = document.createElement("button");
      button.type = "button";
      button.textContent = item.title + " — " + item.source;
      button.addEventListener("click", function () {
        if (palette.close) palette.close();
        applyTrendQuery(query);
      });
      list.appendChild(button);
    });
    if (!list.children.length) {
      var empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = query ? "No headlines match that search." : "Type to search headlines.";
      list.appendChild(empty);
    }
  }
  function applyTrendQuery(query) {
    state.query = query;
    state.topic = "";
    state.range = "7d";
    shown = BATCH;
    var searchBox = document.getElementById("radar-search");
    if (searchBox) searchBox.value = query;
    syncTopicChips();
    document.querySelectorAll(".chip[data-range]").forEach(function (chip) {
      chip.classList.toggle("is-on", chip.getAttribute("data-range") === "7d");
    });
    go("radar");
  }
  if (paletteInput) {
    paletteInput.addEventListener("input", function () { renderPalette(paletteInput.value); });
    paletteInput.addEventListener("keydown", function (event) {
      if (event.key !== "Enter") return;
      event.preventDefault();
      var first = document.querySelector("#palette-list button");
      if (first) first.click();
      else if (paletteInput.value.trim()) applyTrendQuery(paletteInput.value.trim());
    });
  }

  function loadTrends() {
    return fetch("data/trends.json", { cache: "no-cache" })
      .then(function (response) {
        if (!response.ok) throw new Error("Could not load headlines (" + response.status + ").");
        return response.json();
      })
      .then(function (data) {
        trends = data && Array.isArray(data.items) ? data : { updatedAt: "", feeds: [], items: [] };
        fillSources();
        updateRoundupBar();
        renderOverview();
        renderRadar();
        if (viewFromHash() === "read") loadReader(parseHash().id, { focus: false });
      })
      .catch(function (error) {
        var message = error && error.message ? error.message : "Could not load headlines.";
        setText("overview-trends", message);
        setText("radar-list", message);
        setText("radar-updated", "Headlines are unavailable.");
      });
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = "";
    var p = document.createElement("p");
    p.className = "empty";
    p.textContent = text;
    el.appendChild(p);
  }

  function ageMs(item, now) {
    var published = Date.parse(item.publishedAt);
    if (isNaN(published)) return Infinity;
    return now - published;
  }

  function rangeMs() {
    if (state.range === "6h") return 6 * 3600 * 1000;
    if (state.range === "7d") return 7 * 24 * 3600 * 1000;
    return 24 * 3600 * 1000;
  }

  function filtered(limitHours) {
    var now = Date.now();
    var maxAge = limitHours ? limitHours * 3600 * 1000 : rangeMs();
    var query = state.query.trim().toLowerCase();
    var items = (trends && trends.items ? trends.items : []).filter(function (item) {
      var age = ageMs(item, now);
      if (age < -5 * 60 * 1000 || age > maxAge) return false;
      if (state.topic && (item.topics || []).indexOf(state.topic) === -1) return false;
      if (state.source && item.source !== state.source) return false;
      if (query) {
        var hay = (item.title + " " + item.source).toLowerCase();
        if (hay.indexOf(query) === -1) return false;
      }
      return true;
    });
    items.sort(function (a, b) {
      if (state.sort === "new") return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
      if (b.heat !== a.heat) return b.heat - a.heat;
      return Date.parse(b.publishedAt) - Date.parse(a.publishedAt);
    });
    return items;
  }

  function timeAgo(iso) {
    var delta = Date.now() - Date.parse(iso);
    if (isNaN(delta)) return "";
    var mins = Math.round(delta / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    var hours = Math.round(mins / 60);
    if (hours < 48) return hours + "h ago";
    return Math.round(hours / 24) + "d ago";
  }

  function localStamp(iso) {
    var when = new Date(iso);
    if (isNaN(when.getTime())) return { clock: "", full: "" };
    return {
      clock: when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
      full: when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    };
  }

  function ideaText(item) {
    return item.title + "\n" + item.source + " — " + item.url;
  }

  function copyIdea(item, button) {
    var text = ideaText(item);
    var done = function () {
      var previous = button.textContent;
      button.textContent = "Copied";
      setTimeout(function () { button.textContent = previous; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done, button); });
    } else {
      fallbackCopy(text, done, button);
    }
  }

  function fallbackCopy(text, done, button) {
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand("copy"); } catch (error) { ok = false; }
    document.body.removeChild(area);
    if (ok) done();
    else button.textContent = "Copy failed";
  }

  function storyKey(item) {
    return item && (item.id || item.url || item.title) || "";
  }

  function storySnapshot(item) {
    var source = item.source || "Unknown source";
    var title = item.title || "Untitled";
    return {
      id: storyKey(item),
      title: title,
      source: source,
      url: item.url || "",
      topics: item.topics || [],
      summary: item.summary || ("Headline from " + source + ": " + title),
      publishedAt: item.publishedAt || "",
      text: item.text || "",
      image: item.image || ""
    };
  }

  function readStore(key) {
    try {
      var parsed = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  }

  function writeStore(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function isSaved(item) {
    var key = storyKey(item);
    return readStore("nextmind-saved").some(function (row) { return row.id === key; });
  }

  function toggleSaved(item) {
    var key = storyKey(item);
    var rows = readStore("nextmind-saved").filter(function (row) { return row.id !== key; });
    if (!isSaved(item)) rows.unshift(storySnapshot(item));
    writeStore("nextmind-saved", rows);
    renderRadar();
    renderOverview();
    renderSaved();
  }

  function togglePick(item, box) {
    var key = storyKey(item);
    var has = picked.indexOf(key) !== -1;
    if (box.checked && !has) {
      if (picked.length >= 5) {
        box.checked = false;
        var note = document.getElementById("roundup-count");
        if (note) note.textContent = "You can select up to 5 stories.";
        return;
      }
      picked.push(key);
    } else if (!box.checked && has) {
      picked = picked.filter(function (id) { return id !== key; });
    }
    updateRoundupBar();
  }

  function pickedStories() {
    var items = trends && trends.items ? trends.items : [];
    return picked.map(function (id) {
      for (var i = 0; i < items.length; i++) {
        if (storyKey(items[i]) === id) return storySnapshot(items[i]);
      }
      return null;
    }).filter(Boolean);
  }

  function updateRoundupBar() {
    var bar = document.getElementById("roundup-bar");
    var count = document.getElementById("roundup-count");
    var goBtn = document.getElementById("roundup-go");
    if (count) count.textContent = picked.length + " of 5 selected";
    if (bar) bar.hidden = picked.length === 0;
    if (goBtn) goBtn.disabled = picked.length === 0;
  }

  function queueStudio(stories, roundup) {
    studioStories = (stories || []).slice(0, 5);
    studioRoundup = !!roundup || studioStories.length > 1;
    studioNeedsDraft = true;
    go("studio");
  }

  function studioOptions() {
    var formatBtn = document.querySelector(".chip[data-format].is-on");
    var toneBtn = document.querySelector(".chip[data-tone].is-on");
    return {
      format: formatBtn ? formatBtn.getAttribute("data-format") : "30s",
      tone: toneBtn ? toneBtn.getAttribute("data-tone") : "neutral",
      roundup: studioRoundup || studioStories.length > 1
    };
  }

  function clock(seconds) {
    var safe = Math.max(0, seconds || 0);
    var mins = Math.floor(safe / 60);
    var rest = safe % 60;
    return mins + ":" + (rest < 10 ? "0" : "") + rest;
  }

  function renderStudio() {
    var box = document.getElementById("studio-sources");
    var output = document.getElementById("studio-output");
    var status = document.getElementById("studio-status");
    if (box) {
      box.textContent = "";
      if (!studioStories.length) {
        var empty = document.createElement("p");
        empty.className = "empty";
        empty.textContent = "Choose Make script on a headline, or select up to 5 stories for a daily roundup.";
        box.appendChild(empty);
      } else {
        studioStories.forEach(function (story) {
          var card = document.createElement("article");
          card.className = "card";
          var title = document.createElement("h2");
          title.textContent = story.title;
          var meta = document.createElement("p");
          meta.textContent = story.source + (story.url ? " · " + story.url : "");
          var summary = document.createElement("p");
          summary.textContent = story.summary;
          card.appendChild(title);
          card.appendChild(meta);
          card.appendChild(summary);
          box.appendChild(card);
        });
      }
    }
    if (studioNeedsDraft) {
      studioNeedsDraft = false;
      buildStudioDraft();
    } else {
      updateStudioCounts();
    }
    renderDrafts();
  }

  function buildStudioDraft() {
    var output = document.getElementById("studio-output");
    var status = document.getElementById("studio-status");
    if (!output || !window.generateScript) return;
    var result = window.generateScript(studioStories, studioOptions());
    Promise.resolve(result).then(function (draft) {
      output.value = draft && draft.text ? draft.text : "";
      updateStudioCounts();
      var label = document.getElementById("studio-label");
      if (label) label.textContent = (draft && draft.label) || "Template draft · AI scripts coming soon";
      if (status) status.textContent = draft && draft.error ? draft.error : "";
    }).catch(function (error) {
      if (status) status.textContent = error && error.message ? error.message : "The draft could not be built.";
    });
  }

  function updateStudioCounts() {
    var output = document.getElementById("studio-output");
    var counts = document.getElementById("studio-counts");
    if (!output || !counts) return;
    var text = output.value.trim();
    var words = text ? text.split(/\s+/).length : 0;
    counts.textContent = words + " words · about " + clock(Math.round(words / 150 * 60)) + " at 150 words per minute";
  }

  function renderDrafts() {
    var list = document.getElementById("draft-list");
    if (!list) return;
    var drafts = readStore("nextmind-drafts");
    list.textContent = "";
    if (!drafts.length) {
      var empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No drafts yet. Save the script above and it stays in this browser.";
      list.appendChild(empty);
      return;
    }
    drafts.forEach(function (draft) {
      var row = document.createElement("article");
      row.className = "card draft-row";
      var name = document.createElement("input");
      name.type = "text";
      name.value = draft.name || "Draft";
      name.setAttribute("aria-label", "Draft name");
      name.addEventListener("change", function () {
        var next = readStore("nextmind-drafts").map(function (item) {
          if (item.id === draft.id) item.name = name.value.trim() || "Draft";
          return item;
        });
        writeStore("nextmind-drafts", next);
      });
      var open = document.createElement("button");
      open.type = "button";
      open.className = "btn";
      open.textContent = "Open";
      open.addEventListener("click", function () {
        var output = document.getElementById("studio-output");
        if (output) output.value = draft.text || "";
        updateStudioCounts();
        go("studio");
      });
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn";
      remove.textContent = "Delete";
      remove.addEventListener("click", function () {
        writeStore("nextmind-drafts", readStore("nextmind-drafts").filter(function (item) { return item.id !== draft.id; }));
        renderDrafts();
      });
      row.appendChild(name);
      row.appendChild(open);
      row.appendChild(remove);
      list.appendChild(row);
    });
  }

  function renderSaved() {
    var list = document.getElementById("saved-list");
    if (!list) return;
    var rows = readStore("nextmind-saved");
    list.textContent = "";
    if (!rows.length) {
      var empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No saved stories yet. Use Save on a headline.";
      list.appendChild(empty);
      return;
    }
    rows.forEach(function (story) {
      var card = document.createElement("article");
      card.className = "card";
      var title = document.createElement("button");
      title.type = "button";
      title.className = "story-title";
      title.textContent = story.title;
      title.addEventListener("click", function () { openReader(story); });
      var meta = document.createElement("p");
      meta.textContent = story.source || "";
      var actions = document.createElement("div");
      actions.className = "button-row";
      var make = document.createElement("button");
      make.type = "button";
      make.className = "btn";
      make.textContent = "Make script";
      make.addEventListener("click", function () { queueStudio([story], false); });
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn";
      remove.textContent = "Remove";
      remove.addEventListener("click", function () {
        writeStore("nextmind-saved", readStore("nextmind-saved").filter(function (item) { return item.id !== story.id; }));
        renderSaved();
        renderRadar();
        renderOverview();
      });
      actions.appendChild(make);
      actions.appendChild(remove);
      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(actions);
      list.appendChild(card);
    });
  }

  function copyText(text, button, doneLabel) {
    var previous = button.textContent;
    var done = function () {
      button.textContent = doneLabel || "Copied";
      setTimeout(function () { button.textContent = previous; }, 1600);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done, button); });
    } else {
      fallbackCopy(text, done, button);
    }
  }

  function postText(item) {
    var tags = (item.topics || []).map(function (topic) {
      return "#" + String(topic).replace(/[^A-Za-z0-9]+/g, "");
    }).filter(Boolean).join(" ");
    return item.title + "\n\nvia " + item.source + "\n" + item.url + (tags ? "\n\n" + tags : "");
  }

  function copyPost(item, button) {
    copyText(postText(item), button, "Copied");
  }

  function fillSources() {
    var select = document.getElementById("radar-source");
    if (!select || !trends) return;
    var current = state.source;
    var names = {};
    (trends.items || []).forEach(function (item) { if (item.source) names[item.source] = true; });
    select.textContent = "";
    var all = document.createElement("option");
    all.value = "";
    all.textContent = "All sources";
    select.appendChild(all);
    Object.keys(names).sort().forEach(function (name) {
      var option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });
    select.value = names[current] ? current : "";
    state.source = select.value;
  }

  function thumbFor(item) {
    var topic = item.topics && item.topics[0];
    var box = document.createElement("div");
    box.className = "thumb";
    if (topic) box.setAttribute("data-topic", topic);
    var fallback = document.createElement("span");
    fallback.className = "thumb-fallback";
    fallback.textContent = (item.source || "?").trim().charAt(0).toUpperCase() || "?";
    if (item.image) {
      var img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.referrerPolicy = "no-referrer";
      img.src = item.image;
      fallback.hidden = true;
      img.addEventListener("error", function () {
        img.remove();
        fallback.hidden = false;
      });
      box.appendChild(img);
    }
    box.appendChild(fallback);
    return box;
  }

  function openReader(item) {
    if (!item || !item.id) return;
    location.hash = "read/" + encodeURIComponent(item.id);
  }

  function findItem(id) {
    var items = trends && trends.items ? trends.items : [];
    var i;
    for (i = 0; i < items.length; i++) if (storyKey(items[i]) === id) return items[i];
    var saved = readStore("nextmind-saved");
    for (i = 0; i < saved.length; i++) if (saved[i].id === id) return saved[i];
    return null;
  }

  var readerCache = {};
  var readerRequest = 0;

  function readerStory(item, article) {
    var text = article && article.ok && article.text ? article.text : "";
    return {
      id: item.id,
      title: (article && article.title) || item.title,
      url: item.url,
      source: item.source,
      topics: item.topics || [],
      summary: item.summary || "",
      text: text
    };
  }

  function paintReader(item, article) {
    var shell = document.getElementById("reader");
    if (!shell) return;
    shell.innerHTML = "";
    var shown = {
      image: (article && article.image) || item.image,
      source: item.source,
      title: item.title,
      topics: item.topics
    };
    var hero = thumbFor(shown);
    hero.classList.add("reader-hero");
    var meta = document.createElement("p");
    meta.className = "reader-meta";
    var stamp = localStamp(item.publishedAt);
    meta.textContent = [item.source, timeAgo(item.publishedAt), stamp.clock].filter(Boolean).join(" · ");
    shell.appendChild(meta);
    shell.appendChild(hero);
    var body = document.createElement("div");
    body.className = "reader-body";
    var pending = article == null;
    var text = article && article.ok && article.text ? article.text : "";
    if (!text) text = item.summary || (pending ? "" : "Couldn't read this article.");
    text.split(/\n+/).forEach(function (para) {
      var p = document.createElement("p");
      p.textContent = para.trim();
      if (p.textContent) body.appendChild(p);
    });
    shell.appendChild(body);
    var actions = document.createElement("div");
    actions.className = "reader-actions";
    var make = document.createElement("button");
    make.type = "button";
    make.className = "btn primary";
    make.textContent = "Make script";
    make.addEventListener("click", function () { queueStudio([readerStory(item, article)], false); });
    var save = document.createElement("button");
    save.type = "button";
    save.className = "btn";
    save.textContent = isSaved(item) ? "Saved" : "Save";
    save.addEventListener("click", function () {
      var story = readerStory(item, article);
      toggleSaved(story);
      save.textContent = isSaved(story) ? "Saved" : "Save";
    });
    actions.appendChild(make);
    actions.appendChild(save);
    shell.appendChild(actions);
    if (item.url) {
      var original = document.createElement("p");
      original.className = "reader-original";
      var link = document.createElement("a");
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "Original";
      original.appendChild(link);
      shell.appendChild(original);
    }
  }

  function setReaderTitle(text) {
    var title = document.getElementById("view-title");
    if (!title) return;
    title.textContent = text || "Story";
  }

  function loadReader(id, opts) {
    var focusTitle = !opts || opts.focus !== false;
    var req = ++readerRequest;
    var shell = document.getElementById("reader");
    var status = document.getElementById("reader-status");
    if (!shell) return;
    if (!id || !/^[a-f0-9]{8,40}$/i.test(id)) {
      shell.innerHTML = "";
      if (status) status.textContent = "That story link is not valid.";
      return;
    }
    if (status) status.textContent = "";
    var item = findItem(id) || { id: id, title: "Story", source: "", url: "", publishedAt: "", topics: [], summary: "" };
    paintReader(item, null);
    setReaderTitle(item.title);
    var title = document.getElementById("view-title");
    if (focusTitle && title) {
      title.tabIndex = -1;
      title.focus();
    }
    if (readerCache[id]) {
      paintReader(item, readerCache[id]);
      return;
    }
    fetch("data/articles/" + encodeURIComponent(id) + ".json")
      .then(function (res) {
        if (!res.ok) throw new Error("missing");
        return res.json();
      })
      .then(function (article) {
        if (req !== readerRequest) return;
        readerCache[id] = article;
        var resolved = findItem(id) || item;
        paintReader(resolved, article);
        setReaderTitle((article && article.title) || resolved.title);
      })
      .catch(function () {
        if (req !== readerRequest) return;
        paintReader(findItem(id) || item, { ok: false, text: "" });
      });
  }

  function trendCard(item, compact) {
    var card = document.createElement("article");
    card.className = compact ? "trend compact" : "trend";
    var opener = document.createElement("button");
    opener.type = "button";
    opener.className = "thumb-hit";
    opener.setAttribute("aria-label", "Read " + item.title);
    opener.appendChild(thumbFor(item));
    opener.addEventListener("click", function () { openReader(item); });
    card.appendChild(opener);
    var body = document.createElement("div");
    body.className = "trend-body";
    var top = document.createElement("div");
    top.className = "trend-top";
    var source = document.createElement("p");
    source.className = "meta";
    var stamp = localStamp(item.publishedAt);
    var time = document.createElement("time");
    time.dateTime = item.publishedAt;
    time.textContent = timeAgo(item.publishedAt);
    if (stamp.full) time.title = stamp.full;
    source.appendChild(document.createTextNode(item.source + " · "));
    source.appendChild(time);
    if (stamp.clock) source.appendChild(document.createTextNode(" · " + stamp.clock));
    var heat = document.createElement("button");
    heat.type = "button";
    heat.className = "heat";
    heat.setAttribute("aria-label", "Heat " + item.heat + ". " + (item.hnPoints != null ? HEAT_HN : HEAT_TIME));
    heat.appendChild(document.createTextNode("Heat " + item.heat));
    var tip = document.createElement("span");
    tip.className = "heat-tip";
    tip.setAttribute("role", "tooltip");
    tip.textContent = item.hnPoints != null ? HEAT_HN : HEAT_TIME;
    heat.appendChild(tip);
    top.appendChild(source);
    top.appendChild(heat);

    var title = document.createElement("button");
    title.type = "button";
    title.className = "story-title";
    title.textContent = item.title;
    title.title = item.title;
    title.addEventListener("click", function () { openReader(item); });
    body.appendChild(top);
    body.appendChild(title);

    if (item.topics && item.topics.length) {
      var tags = document.createElement("div");
      tags.className = "topics-inline";
      item.topics.forEach(function (topic) {
        var tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = topic;
        tags.appendChild(tag);
      });
      body.appendChild(tags);
    }

    var actions = document.createElement("div");
    actions.className = "trend-actions";
    var copy = document.createElement("button");
    copy.type = "button";
    copy.className = "mini";
    copy.textContent = "Copy as post";
    copy.addEventListener("click", function () { copyPost(item, copy); });
    var make = document.createElement("button");
    make.type = "button";
    make.className = "mini";
    make.textContent = "Make script";
    make.addEventListener("click", function () { queueStudio([storySnapshot(item)], false); });
    var save = document.createElement("button");
    save.type = "button";
    save.className = "mini";
    var savedNow = isSaved(item);
    save.textContent = savedNow ? "Saved" : "Save";
    save.setAttribute("aria-pressed", savedNow ? "true" : "false");
    save.addEventListener("click", function () { toggleSaved(item); });
    var selectLabel = document.createElement("label");
    selectLabel.className = "select-story";
    var select = document.createElement("input");
    select.type = "checkbox";
    select.checked = picked.indexOf(storyKey(item)) !== -1;
    select.addEventListener("change", function () { togglePick(item, select); });
    selectLabel.appendChild(select);
    selectLabel.appendChild(document.createTextNode(" Select for roundup"));
    actions.appendChild(copy);
    actions.appendChild(make);
    actions.appendChild(save);
    actions.appendChild(selectLabel);
    body.appendChild(actions);
    card.appendChild(body);
    return card;
  }

  function renderOverview() {
    var box = document.getElementById("overview-trends");
    if (!box || !trends) return;
    var saved = { topic: state.topic, source: state.source, range: state.range, sort: state.sort, query: state.query };
    state.topic = "";
    state.source = "";
    state.range = "24h";
    state.sort = "heat";
    state.query = "";
    var top = filtered().slice(0, 4);
    state.topic = saved.topic;
    state.source = saved.source;
    state.range = saved.range;
    state.sort = saved.sort;
    state.query = saved.query;
    box.textContent = "";
    if (!top.length) {
      var empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No headlines from the last 24 hours are in the file yet.";
      box.appendChild(empty);
      return;
    }
    box.setAttribute("aria-busy", "false");
    top.forEach(function (item) { box.appendChild(trendCard(item, true)); });
  }

  function renderRadar() {
    var list = document.getElementById("radar-list");
    var updated = document.getElementById("radar-updated");
    var feeds = document.getElementById("radar-feeds");
    if (!list || !trends) return;
    if (updated && trends.updatedAt) {
      var when = new Date(trends.updatedAt);
      updated.textContent = "Last updated " + (isNaN(when.getTime()) ? trends.updatedAt : when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
    }
    if (feeds) {
      var failed = (trends.feeds || []).filter(function (feed) { return !feed.ok; }).map(function (feed) { return feed.source; });
      feeds.textContent = failed.length ? "Some sources did not respond this run: " + failed.join(", ") + "." : "";
    }
    var items = filtered();
    list.textContent = "";
    list.setAttribute("aria-busy", "false");
    var more = document.getElementById("load-more");
    if (!items.length) {
      var empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = state.query
        ? "No headlines match that search. Try fewer words, or choose All."
        : "No headlines match these filters. Try All, or a longer time range.";
      list.appendChild(empty);
      if (more) more.hidden = true;
      return;
    }
    items.slice(0, shown).forEach(function (item) { list.appendChild(trendCard(item, false)); });
    if (more) {
      var left = items.length - shown;
      more.hidden = left <= 0;
      more.textContent = left > 0 ? "Load more (" + left + " left)" : "Load more";
    }
  }

  function revealMore() {
    var more = document.getElementById("load-more");
    if (!more || more.hidden) return;
    shown += BATCH;
    renderRadar();
  }

  function syncTopicChips() {
    document.querySelectorAll(".chip[data-topic]").forEach(function (chip) {
      chip.classList.toggle("is-on", chip.getAttribute("data-topic") === state.topic);
    });
  }

  document.querySelectorAll(".chip[data-topic]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      state.topic = chip.getAttribute("data-topic") || "";
      shown = BATCH;
      syncTopicChips();
      renderRadar();
    });
  });
  document.querySelectorAll(".chip[data-range]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      state.range = chip.getAttribute("data-range");
      shown = BATCH;
      document.querySelectorAll(".chip[data-range]").forEach(function (other) {
        other.classList.toggle("is-on", other === chip);
      });
      renderRadar();
    });
  });
  var search = document.getElementById("radar-search");
  var sort = document.getElementById("radar-sort");
  if (search) search.addEventListener("input", function () { state.query = search.value; shown = BATCH; renderRadar(); });
  if (sort) sort.addEventListener("change", function () { state.sort = sort.value; shown = BATCH; renderRadar(); });
  var sourceSelect = document.getElementById("radar-source");
  if (sourceSelect) sourceSelect.addEventListener("change", function () {
    state.source = sourceSelect.value;
    shown = BATCH;
    renderRadar();
  });
  var roundupGo = document.getElementById("roundup-go");
  var roundupClear = document.getElementById("roundup-clear");
  if (roundupGo) roundupGo.addEventListener("click", function () { queueStudio(pickedStories(), true); });
  if (roundupClear) roundupClear.addEventListener("click", function () {
    picked = [];
    updateRoundupBar();
    renderRadar();
  });
  document.querySelectorAll(".chip[data-format], .chip[data-tone]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      var group = chip.hasAttribute("data-format") ? "data-format" : "data-tone";
      document.querySelectorAll(".chip[" + group + "]").forEach(function (other) {
        other.classList.toggle("is-on", other === chip);
      });
    });
  });
  var studioOutput = document.getElementById("studio-output");
  if (studioOutput) studioOutput.addEventListener("input", updateStudioCounts);
  var studioGenerate = document.getElementById("studio-generate");
  if (studioGenerate) studioGenerate.addEventListener("click", buildStudioDraft);
  var studioCopy = document.getElementById("studio-copy");
  if (studioCopy) studioCopy.addEventListener("click", function () {
    var output = document.getElementById("studio-output");
    if (!output || !output.value.trim()) return;
    copyText(output.value, studioCopy, "Copied");
  });
  var studioDownload = document.getElementById("studio-download");
  if (studioDownload) studioDownload.addEventListener("click", function () {
    var output = document.getElementById("studio-output");
    var text = output ? output.value : "";
    if (!text.trim()) return;
    var blob = new Blob([text], { type: "text/plain" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "nextmind-script.txt";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  });
  var studioSend = document.getElementById("studio-send");
  if (studioSend) studioSend.addEventListener("click", function () {
    var output = document.getElementById("studio-output");
    sessionStorage.setItem("nextmind-script", output ? output.value : "");
    go("voiceover");
  });
  var studioSave = document.getElementById("studio-save");
  if (studioSave) studioSave.addEventListener("click", function () {
    var output = document.getElementById("studio-output");
    var text = output ? output.value.trim() : "";
    if (!text) return;
    var first = text.split("\n").filter(Boolean)[0] || "Draft";
    var drafts = readStore("nextmind-drafts");
    drafts.unshift({ id: String(Date.now()), name: first.slice(0, 48), text: output.value, updatedAt: new Date().toISOString() });
    writeStore("nextmind-drafts", drafts);
    renderDrafts();
  });
  var help = document.getElementById("help");
  document.addEventListener("keydown", function (event) {
    if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey) return;
    var tag = event.target && event.target.tagName ? event.target.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || tag === "select" || (event.target && event.target.isContentEditable)) return;
    if (!help || !help.showModal) return;
    event.preventDefault();
    help.showModal();
  });
  var moreBtn = document.getElementById("load-more");
  if (moreBtn) moreBtn.addEventListener("click", revealMore);
  var sentinel = document.getElementById("radar-sentinel");
  if (sentinel && "IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      if (entries.some(function (entry) { return entry.isIntersecting; })) revealMore();
    }, { rootMargin: "240px" }).observe(sentinel);
  }
  var toTop = document.getElementById("to-top");
  if (toTop) {
    window.addEventListener("scroll", function () {
      toTop.hidden = window.scrollY < 480;
    }, { passive: true });
    toTop.addEventListener("click", function () {
      var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    });
  }

  function wordsIn(text) {
    var trimmed = text.trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
  }

  function formatDuration(text, rate) {
    var words = wordsIn(text);
    var seconds = Math.round(words / (150 * rate) * 60);
    var mins = Math.floor(seconds / 60);
    var rest = seconds % 60;
    return {
      words: words,
      chars: text.length,
      label: "about " + mins + ":" + (rest < 10 ? "0" : "") + rest
    };
  }

  function paragraphs(text) {
    return text.split(/\n+/).map(function (part) { return part.trim(); }).filter(Boolean);
  }

  var scriptBox = document.getElementById("script");
  var rateInput = document.getElementById("voice-rate");
  var pitchInput = document.getElementById("voice-pitch");
  var rateLabel = document.getElementById("rate-label");
  var pitchLabel = document.getElementById("pitch-label");
  var counts = document.getElementById("script-counts");
  var segmentBox = document.getElementById("segments");
  var voicePicker = document.getElementById("voice-picker");
  var playBtn = document.getElementById("voice-play");
  var stopBtn = document.getElementById("voice-stop");
  var voiceStatus = document.getElementById("voice-status");

  function currentRate() { return rateInput ? Number(rateInput.value) : 1; }
  function currentPitch() { return pitchInput ? Number(pitchInput.value) : 1; }

  function updateScript() {
    var text = scriptBox ? scriptBox.value : "";
    var stats = formatDuration(text, currentRate());
    if (counts) counts.textContent = stats.chars + " characters · " + stats.words + " words · " + stats.label;
    if (rateLabel && rateInput) rateLabel.textContent = Number(rateInput.value).toFixed(1);
    if (pitchLabel && pitchInput) pitchLabel.textContent = Number(pitchInput.value).toFixed(1);
    renderSegments(paragraphs(text));
  }

  function renderSegments(parts) {
    if (!segmentBox) return;
    segmentBox.textContent = "";
    if (!parts.length) {
      var empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "Parts show up when the script has text. Each block between line breaks can be played on its own.";
      segmentBox.appendChild(empty);
      return;
    }
    parts.forEach(function (part, index) {
      var row = document.createElement("article");
      row.className = "segment";
      var heading = document.createElement("h3");
      heading.textContent = "Part " + (index + 1);
      var body = document.createElement("p");
      body.textContent = part;
      var button = document.createElement("button");
      button.type = "button";
      button.className = "btn";
      button.textContent = "Play this part";
      button.addEventListener("click", function () { speak([part], row); });
      row.appendChild(heading);
      row.appendChild(body);
      row.appendChild(button);
      segmentBox.appendChild(row);
    });
  }

  function chosenVoice() {
    if (!voicePicker || !window.speechSynthesis) return null;
    var voices = window.speechSynthesis.getVoices();
    for (var i = 0; i < voices.length; i++) {
      if (voices[i].voiceURI === voicePicker.value || voices[i].name === voicePicker.value) return voices[i];
    }
    return null;
  }

  function fillVoices() {
    if (!voicePicker || !window.speechSynthesis) return;
    var voices = window.speechSynthesis.getVoices();
    var english = voices.filter(function (voice) { return /^en([-_]|$)/i.test(voice.lang); });
    var list = english.length ? english : voices;
    var previous = voicePicker.value;
    voicePicker.textContent = "";
    if (!list.length) {
      var missing = document.createElement("option");
      missing.textContent = "No voice installed";
      voicePicker.appendChild(missing);
      voicePicker.disabled = true;
      return;
    }
    voicePicker.disabled = false;
    list.forEach(function (voice) {
      var option = document.createElement("option");
      option.value = voice.voiceURI || voice.name;
      option.textContent = voice.name + " (" + voice.lang + ")";
      voicePicker.appendChild(option);
    });
    var preferred = list.filter(function (voice) { return /en-US/i.test(voice.lang); })[0] || list[0];
    voicePicker.value = previous || preferred.voiceURI || preferred.name;
  }

  function setSpeaking(on) {
    speaking = on;
    if (playBtn) playBtn.disabled = on;
    if (stopBtn) stopBtn.disabled = !on;
    if (!on) {
      document.querySelectorAll(".segment.is-speaking").forEach(function (row) {
        row.classList.remove("is-speaking");
      });
    }
  }

  function speak(parts, highlight) {
    if (!window.speechSynthesis) {
      if (voiceStatus) voiceStatus.textContent = "This browser cannot speak. Web Speech is unavailable.";
      return;
    }
    if (voicePicker && voicePicker.disabled) {
      if (voiceStatus) voiceStatus.textContent = "This browser has no speech voice, so preview cannot play.";
      return;
    }
    var lines = parts.filter(Boolean);
    if (!lines.length) {
      if (voiceStatus) voiceStatus.textContent = "Write something first.";
      return;
    }
    window.speechSynthesis.cancel();
    setSpeaking(true);
    if (voiceStatus) voiceStatus.textContent = "Speaking…";
    var index = 0;
    var voice = chosenVoice();
    function next() {
      if (!speaking || index >= lines.length) {
        setSpeaking(false);
        if (voiceStatus && index >= lines.length) voiceStatus.textContent = "Finished.";
        return;
      }
      document.querySelectorAll(".segment.is-speaking").forEach(function (row) { row.classList.remove("is-speaking"); });
      if (highlight) highlight.classList.add("is-speaking");
      var utter = new SpeechSynthesisUtterance(lines[index]);
      utter.rate = currentRate();
      utter.pitch = currentPitch();
      if (voice) utter.voice = voice;
      utter.onend = function () {
        if (!speaking) return;
        index += 1;
        next();
      };
      utter.onerror = function () {
        if (!speaking) return;
        setSpeaking(false);
        if (voiceStatus) voiceStatus.textContent = "The voice stopped before the end.";
      };
      window.speechSynthesis.speak(utter);
    }
    window.setTimeout(next, 40);
  }

  function stopSpeaking() {
    speaking = false;
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setSpeaking(false);
    if (voiceStatus) voiceStatus.textContent = "Stopped.";
  }

  if (scriptBox) scriptBox.addEventListener("input", updateScript);
  if (rateInput) rateInput.addEventListener("input", updateScript);
  if (pitchInput) pitchInput.addEventListener("input", updateScript);
  if (playBtn) playBtn.addEventListener("click", function () { speak(paragraphs(scriptBox.value), null); });
  if (stopBtn) stopBtn.addEventListener("click", stopSpeaking);
  if (window.speechSynthesis) {
    fillVoices();
    window.speechSynthesis.addEventListener("voiceschanged", fillVoices);
  }
  updateScript();

  var quickScript = document.getElementById("quick-script");
  var quickPlay = document.getElementById("quick-play");
  var quickOpen = document.getElementById("quick-open");
  var quickStatus = document.getElementById("quick-status");
  if (quickPlay) {
    quickPlay.addEventListener("click", function () {
      var line = quickScript ? quickScript.value.trim() : "";
      if (!line) {
        if (quickStatus) quickStatus.textContent = "Write a line first.";
        return;
      }
      if (quickStatus) quickStatus.textContent = "Speaking with the device voice. This cannot be downloaded.";
      speak([line], null);
    });
  }
  var quickForm = document.getElementById("quick-voice");
  if (quickForm) quickForm.addEventListener("submit", function (event) { event.preventDefault(); });
  if (quickOpen) {
    quickOpen.addEventListener("click", function () {
      sessionStorage.setItem("nextmind-script", quickScript ? quickScript.value : "");
      go("voiceover");
    });
  }

  window.addEventListener("hashchange", function () { showAndStay(viewFromHash()); });
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  showAndStay(viewFromHash());
  window.addEventListener("load", function () { window.scrollTo(0, 0); });
  loadTrends();
})();
