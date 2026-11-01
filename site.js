/* NextMind app behavior.
   Trend Radar reads data/trends.json, which a scheduled job refreshes.
   Voiceover uses the browser's own speech, not a paid voice service.
   If this file does not run, the sections stay on the page but the tools do not. */
(function () {
  var views = {
    overview: { crumb: "Overview", lede: "Find what's moving in tech, then voice the post." },
    radar: { crumb: "Trend Radar", lede: "Public headlines from tech sites and Hacker News. Open the original to read it." },
    voiceover: { crumb: "Voiceover", lede: "Preview a script with an English voice on this device. Nothing is uploaded." },
    pricing: { crumb: "Pricing", lede: "Placeholder tiers. Nothing here is for sale." },
    about: { crumb: "About", lede: "What this app does, and what it does not do." }
  };

  var HEAT_HN = "Heat starts at 100 when a story is new and falls to 0 after 48 hours. This one also adds Hacker News points and comments.";
  var HEAT_TIME = "Heat starts at 100 when a story is new and falls to 0 after 48 hours. This source has no points, so the score is recency only.";

  var state = { topic: "", range: "24h", sort: "heat", query: "" };
  var trends = null;
  var speaking = false;

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

  function viewFromHash() {
    var name = location.hash.replace("#", "");
    return views[name] ? name : "overview";
  }

  function setMenu(open) {
    if (!sidebar || !menuBtn) return;
    sidebar.classList.toggle("is-open", open);
    menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function show(name) {
    var info = views[name] || views.overview;
    document.querySelectorAll("[data-view-panel]").forEach(function (panel) {
      panel.classList.toggle("is-active", panel.getAttribute("data-view-panel") === name);
    });
    document.querySelectorAll(".nav a[data-view]").forEach(function (link) {
      if (link.getAttribute("data-view") === name) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    if (crumb) crumb.textContent = info.crumb;
    if (lede) lede.textContent = info.lede;
    setMenu(false);
    if (name === "radar") renderRadar();
    if (name === "overview") renderOverview();
    if (name === "voiceover") {
      var saved = sessionStorage.getItem("nextmind-script");
      var script = document.getElementById("script");
      if (saved && script && !script.value) {
        script.value = saved;
        sessionStorage.removeItem("nextmind-script");
        updateScript();
      }
    }
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
    }
    if (event.key === "Escape") setMenu(false);
  });

  function openSearch() {
    if (!palette || !palette.showModal) return;
    setMenu(false);
    if (paletteInput) {
      paletteInput.value = "";
      filterPalette("");
    }
    palette.showModal();
    if (paletteInput) paletteInput.focus();
  }
  document.querySelectorAll("[data-open-search]").forEach(function (btn) {
    btn.addEventListener("click", openSearch);
  });
  function filterPalette(value) {
    var query = value.trim().toLowerCase();
    document.querySelectorAll("#palette-list button").forEach(function (btn) {
      btn.hidden = btn.textContent.toLowerCase().indexOf(query) === -1;
    });
  }
  if (paletteInput) {
    paletteInput.addEventListener("input", function () { filterPalette(paletteInput.value); });
  }
  document.querySelectorAll("#palette-list button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (palette.close) palette.close();
      go(btn.getAttribute("data-view"));
    });
  });

  function loadTrends() {
    return fetch("data/trends.json", { cache: "no-cache" })
      .then(function (response) {
        if (!response.ok) throw new Error("Could not load headlines (" + response.status + ").");
        return response.json();
      })
      .then(function (data) {
        trends = data && Array.isArray(data.items) ? data : { updatedAt: "", feeds: [], items: [] };
        renderOverview();
        renderRadar();
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

  function trendCard(item) {
    var card = document.createElement("article");
    card.className = "trend";
    var top = document.createElement("div");
    top.className = "trend-top";
    var source = document.createElement("p");
    source.className = "meta";
    source.textContent = item.source + " · " + timeAgo(item.publishedAt);
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

    var title = document.createElement("h3");
    title.textContent = item.title;
    card.appendChild(top);
    card.appendChild(title);

    if (item.topics && item.topics.length) {
      var tags = document.createElement("div");
      tags.className = "topics-inline";
      item.topics.forEach(function (topic) {
        var tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = topic;
        tags.appendChild(tag);
      });
      card.appendChild(tags);
    }

    var actions = document.createElement("div");
    actions.className = "trend-actions";
    var link = document.createElement("a");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = "Read source";
    var copy = document.createElement("button");
    copy.type = "button";
    copy.className = "mini";
    copy.textContent = "Copy as post idea";
    copy.addEventListener("click", function () { copyIdea(item, copy); });
    actions.appendChild(link);
    actions.appendChild(copy);
    card.appendChild(actions);
    return card;
  }

  function renderOverview() {
    var box = document.getElementById("overview-trends");
    if (!box || !trends) return;
    var saved = { topic: state.topic, range: state.range, sort: state.sort, query: state.query };
    state.topic = "";
    state.range = "24h";
    state.sort = "heat";
    state.query = "";
    var top = filtered().slice(0, 4);
    state.topic = saved.topic;
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
    top.forEach(function (item) { box.appendChild(trendCard(item)); });
  }

  function renderRadar() {
    var list = document.getElementById("radar-list");
    var updated = document.getElementById("radar-updated");
    var feeds = document.getElementById("radar-feeds");
    if (!list || !trends) return;
    if (updated && trends.updatedAt) {
      var when = new Date(trends.updatedAt);
      updated.textContent = "Last updated " + (isNaN(when.getTime()) ? trends.updatedAt : when.toLocaleString());
    }
    if (feeds) {
      var failed = (trends.feeds || []).filter(function (feed) { return !feed.ok; }).map(function (feed) { return feed.source; });
      feeds.textContent = failed.length ? "Some sources did not respond this run: " + failed.join(", ") + "." : "";
    }
    var items = filtered();
    list.textContent = "";
    if (!items.length) {
      var empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "No headlines match these filters. Try All, or a longer time range.";
      list.appendChild(empty);
      return;
    }
    items.forEach(function (item) { list.appendChild(trendCard(item)); });
  }

  function syncTopicChips() {
    document.querySelectorAll(".chip[data-topic]").forEach(function (chip) {
      chip.classList.toggle("is-on", chip.getAttribute("data-topic") === state.topic);
    });
  }

  document.querySelectorAll(".chip[data-topic]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      state.topic = chip.getAttribute("data-topic") || "";
      syncTopicChips();
      renderRadar();
    });
  });
  document.querySelectorAll(".chip[data-range]").forEach(function (chip) {
    chip.addEventListener("click", function () {
      state.range = chip.getAttribute("data-range");
      document.querySelectorAll(".chip[data-range]").forEach(function (other) {
        other.classList.toggle("is-on", other === chip);
      });
      renderRadar();
    });
  });
  var search = document.getElementById("radar-search");
  var sort = document.getElementById("radar-sort");
  if (search) search.addEventListener("input", function () { state.query = search.value; renderRadar(); });
  if (sort) sort.addEventListener("change", function () { state.sort = sort.value; renderRadar(); });

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
