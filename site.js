/* Page behavior for the NextMind dashboard.
   - Writes the real current month next to the title.
   - Switches the visible section when a nav link is used.
   - Opens the phone menu and the search box (⌘K or Ctrl+K).
   If this file does not run, every section stays on the page and the month
   typed in index.html stays as it is. */
(function () {
  var views = {
    overview: {
      crumb: "Overview",
      lede: "Explaining what's really happening in tech."
    },
    boards: {
      crumb: "Daily Boards",
      lede: "Example cards only. A later version can place the day's image boards here."
    },
    videos: {
      crumb: "Videos",
      lede: "Empty slots for short videos. Nothing on this page plays."
    },
    tools: {
      crumb: "Tools",
      lede: "Placeholder tools. Each one is marked coming soon because it is not built."
    },
    about: {
      crumb: "About",
      lede: "Who NextMind is, and the links that are not filled in yet."
    }
  };

  var month = document.getElementById("month-label");
  var crumb = document.getElementById("crumb");
  var lede = document.getElementById("lede");
  var note = document.getElementById("boards-note");
  var sidebar = document.getElementById("sidebar");
  var menuBtn = document.querySelector(".menu-btn");
  var palette = document.getElementById("palette");
  var paletteInput = document.getElementById("palette-input");
  var defaultNote = note ? note.textContent : "";
  var topic = "";

  if (month) {
    var label = new Date().toLocaleDateString("en-US", {
      month: "long",
      year: "numeric"
    });
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
    if (note) {
      note.textContent = topic
        ? "Example view for " + topic + ". These cards are not posts about that topic."
        : defaultNote;
    }
    setMenu(false);
  }

  function go(name) {
    if (!views[name]) name = "overview";
    if (location.hash !== "#" + name) location.hash = name;
    else showAndStay(name);
  }

  document.querySelectorAll("[data-view]").forEach(function (el) {
    el.addEventListener("click", function (event) {
      var name = el.getAttribute("data-view");
      if (!name || el.closest("#palette")) return;
      if (el.closest(".nav") || el.classList.contains("stat")) {
        topic = "";
        document.querySelectorAll("[data-topic]").forEach(function (btn) {
          btn.setAttribute("aria-pressed", "false");
        });
      }
      event.preventDefault();
      go(name);
    });
  });

  document.querySelectorAll("[data-topic]").forEach(function (btn) {
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", function () {
      topic = btn.getAttribute("data-topic") || "";
      document.querySelectorAll("[data-topic]").forEach(function (other) {
        other.setAttribute("aria-pressed", other === btn ? "true" : "false");
      });
      go("boards");
    });
  });

  if (menuBtn) {
    menuBtn.addEventListener("click", function () {
      setMenu(sidebar && !sidebar.classList.contains("is-open"));
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
      var match = btn.textContent.toLowerCase().indexOf(query) !== -1;
      btn.hidden = !match;
    });
  }

  if (paletteInput) {
    paletteInput.addEventListener("input", function () {
      filterPalette(paletteInput.value);
    });
  }

  document.querySelectorAll("#palette-list button").forEach(function (btn) {
    btn.addEventListener("click", function () {
      topic = "";
      document.querySelectorAll("[data-topic]").forEach(function (other) {
        other.setAttribute("aria-pressed", "false");
      });
      if (palette.close) palette.close();
      go(btn.getAttribute("data-view"));
    });
  });

  function showAndStay(name) {
    show(name);
    requestAnimationFrame(function () {
      window.scrollTo(0, 0);
    });
  }

  window.addEventListener("hashchange", function () {
    showAndStay(viewFromHash());
  });

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  showAndStay(viewFromHash());
})();
