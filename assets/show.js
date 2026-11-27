/* NextMind show site. Every page works without this file; it adds the
   header rule, the in-page player, link copying, and episode filtering. */

(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  function withTransition(update) {
    if (!document.startViewTransition || reduceMotion.matches) return update();
    document.startViewTransition(update);
  }

  // Header gets its hairline once the page has scrolled.
  var header = document.querySelector(".site-header");
  if (header) {
    var onScroll = function () { header.classList.toggle("is-scrolled", window.scrollY > 4); };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // maxresdefault does not exist for every video. YouTube answers with a
  // 120px grey frame instead of an error, so check the size.
  function checkThumb(img) {
    if (img.naturalWidth && img.naturalWidth <= 120 && img.dataset.fallback) {
      img.src = img.dataset.fallback;
      img.removeAttribute("data-fallback");
    }
  }
  document.querySelectorAll("img[data-fallback]").forEach(function (img) {
    if (img.complete) checkThumb(img);
    img.addEventListener("load", function () { checkThumb(img); });
  });

  /* Player */

  var player = document.querySelector("[data-player]");
  var frame = null;

  function loadPlayer(start) {
    if (!player) return;
    var params = new URLSearchParams({ autoplay: "1", rel: "0", playsinline: "1", enablejsapi: "1", modestbranding: "1" });
    if (start) params.set("start", String(start));
    frame = document.createElement("iframe");
    frame.src = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(player.dataset.id) + "?" + params;
    frame.title = player.dataset.title || "Episode";
    frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    frame.allowFullscreen = true;
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    player.replaceChildren(frame);
    player.classList.add("is-playing");
  }

  function command(func, args) {
    frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: func, args: args || [] }), "*");
  }

  function seek(seconds) {
    if (!frame) loadPlayer(seconds);
    else {
      command("seekTo", [seconds, true]);
      command("playVideo");
    }
    var rect = player.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      player.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "center" });
    }
  }

  if (player) {
    player.addEventListener("click", function (event) {
      var poster = event.target.closest(".player-poster");
      if (!poster || event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      loadPlayer(0);
    });
    document.addEventListener("click", function (event) {
      var link = event.target.closest("[data-seek]");
      if (!link || event.metaKey || event.ctrlKey || event.shiftKey) return;
      event.preventDefault();
      seek(Number(link.dataset.seek));
    });
  }

  /* Copy link */

  document.querySelectorAll("[data-share]").forEach(function (button) {
    var label = button.querySelector("[data-share-label]");
    var original = label.textContent;
    var timer;
    button.addEventListener("click", function () {
      var url = location.href.split("#")[0];
      var done = function (text) {
        label.textContent = text;
        clearTimeout(timer);
        timer = setTimeout(function () { label.textContent = original; }, 1800);
      };
      if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
        navigator.share({ title: document.title, url: url }).catch(function () {});
        return;
      }
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function () { done("Link copied"); }, function () { done("Couldn’t copy"); });
      } else {
        done("Couldn’t copy");
      }
    });
  });

  /* Table of contents follows the section in view */

  var toc = document.querySelector(".toc");
  if (toc && "IntersectionObserver" in window) {
    var links = Array.prototype.slice.call(toc.querySelectorAll("a"));
    var visible = new Map();
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) { visible.set(entry.target.id, entry.isIntersecting); });
      var current = links.find(function (link) { return visible.get(link.hash.slice(1)); });
      links.forEach(function (link) {
        if (link === current) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      });
    }, { rootMargin: "-20% 0px -55% 0px" });
    links.forEach(function (link) {
      var section = document.getElementById(link.hash.slice(1));
      if (section) observer.observe(section);
    });
  }

  /* Episodes index */

  var results = document.querySelector("[data-results]");
  var toolbar = document.querySelector("[data-toolbar]");
  if (!results || !toolbar) return;

  var cards = Array.prototype.slice.call(results.querySelectorAll(".card"));
  var chips = Array.prototype.slice.call(toolbar.querySelectorAll("[data-sector]"));
  var views = Array.prototype.slice.call(toolbar.querySelectorAll("[data-view]"));
  var search = toolbar.querySelector("[data-search]");
  var sort = toolbar.querySelector("[data-sort]");
  var count = document.querySelector("[data-episode-count]");
  var empty = document.querySelector("[data-empty]");
  var total = cards.length;

  var params = new URLSearchParams(location.search);
  var state = {
    sector: params.get("sector") || "",
    q: params.get("q") || "",
    sort: params.get("sort") || "newest",
    view: params.get("view") || readView() || "grid",
  };
  if (!chips.some(function (chip) { return chip.dataset.sector === state.sector; })) state.sector = "";
  if (!["newest", "oldest", "az"].includes(state.sort)) state.sort = "newest";
  if (!["grid", "list"].includes(state.view)) state.view = "grid";

  function readView() {
    try { return localStorage.getItem("nm-episodes-view"); } catch (error) { return null; }
  }
  function saveView(view) {
    try { localStorage.setItem("nm-episodes-view", view); } catch (error) { /* private mode */ }
  }

  function compare(a, b) {
    if (state.sort === "az") return a.dataset.title.localeCompare(b.dataset.title);
    var da = a.dataset.date;
    var db = b.dataset.date;
    // Upcoming episodes have no date and lead the newest-first list.
    if (!da || !db) {
      if (!da && !db) return Number(a.dataset.index) - Number(b.dataset.index);
      return state.sort === "newest" ? (!da ? -1 : 1) : (!da ? 1 : -1);
    }
    return state.sort === "newest" ? db.localeCompare(da) : da.localeCompare(db);
  }

  cards.forEach(function (card, index) {
    card.dataset.index = String(index);
    card.style.viewTransitionName = "card-" + index;
  });

  function render() {
    var query = state.q.trim().toLowerCase();
    var terms = query ? query.split(/\s+/) : [];
    var shown = 0;
    cards.slice().sort(compare).forEach(function (card) {
      var match = (!state.sector || card.dataset.sector === state.sector) &&
        terms.every(function (term) { return card.dataset.search.indexOf(term) !== -1; });
      card.hidden = !match;
      if (match) shown += 1;
      results.appendChild(card);
    });

    chips.forEach(function (chip) { chip.setAttribute("aria-pressed", String(chip.dataset.sector === state.sector)); });
    views.forEach(function (button) { button.setAttribute("aria-pressed", String(button.dataset.view === state.view)); });
    results.dataset.layout = state.view;
    if (search.value !== state.q) search.value = state.q;
    sort.value = state.sort;
    count.textContent = shown === total
      ? total + (total === 1 ? " episode" : " episodes")
      : shown + " of " + total;
    empty.hidden = shown !== 0;

    var next = new URLSearchParams();
    if (state.sector) next.set("sector", state.sector);
    if (state.q) next.set("q", state.q);
    if (state.sort !== "newest") next.set("sort", state.sort);
    var url = location.pathname + (next.toString() ? "?" + next : "");
    if (url !== location.pathname + location.search) history.replaceState(null, "", url);
  }

  function update(patch, animate) {
    Object.assign(state, patch);
    if (animate) withTransition(render);
    else render();
  }

  chips.forEach(function (chip) {
    chip.addEventListener("click", function () { update({ sector: chip.dataset.sector }, true); });
  });
  views.forEach(function (button) {
    button.addEventListener("click", function () {
      saveView(button.dataset.view);
      update({ view: button.dataset.view }, true);
    });
  });
  sort.addEventListener("change", function () { update({ sort: sort.value }, true); });
  search.addEventListener("input", function () { update({ q: search.value }, false); });
  search.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && search.value) {
      event.preventDefault();
      update({ q: "" }, false);
    }
  });
  document.querySelector("[data-clear]").addEventListener("click", function () {
    update({ sector: "", q: "" }, true);
    search.focus();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
    var tag = (document.activeElement && document.activeElement.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    event.preventDefault();
    search.focus();
  });

  render();
})();
