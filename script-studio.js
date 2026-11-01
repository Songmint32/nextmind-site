/* Script drafts from headlines already on the page.
   generateScript(stories, opts) is the only function the page calls.
   A later serverless function can replace the body of generateScript
   and return a Promise. No key and no network call live here today.
   The draft uses only the title, source, link, and topic labels you pass in.
   It does not invent what the article says. */
(function (root) {
  var WPM = 150;
  var TARGET = { "30s": 75, "60s": 150, "3min": 450 };

  function countWords(text) {
    var trimmed = String(text || "").trim();
    if (!trimmed) return 0;
    return trimmed.split(/\s+/).length;
  }

  function summaryOf(story) {
    var given = story && story.summary ? String(story.summary).trim() : "";
    if (given) return given;
    var title = (story && story.title) || "Untitled";
    var source = (story && story.source) || "a public source";
    return "Headline from " + source + ": " + title;
  }

  function topicsOf(story) {
    var list = story && story.topics && story.topics.length ? story.topics : [];
    return list.length ? list.join(", ") : "general tech";
  }

  function toneOpen(tone) {
    if (tone === "hype") return "Stop scrolling for a second. This headline is worth opening.";
    if (tone === "explainer") return "Let us read a headline slowly, and only say what it actually says.";
    return "Here is a headline from the public feed.";
  }

  function toneClose(tone) {
    if (tone === "hype") return "Open the link, then tell people the one line you would keep.";
    if (tone === "explainer") return "Open the source, check the parts the headline does not explain, and then decide what to say.";
    return "Open the original source before you add an opinion.";
  }

  function notesFor(format) {
    if (format === "3min") {
      return " Walk through the headline once, then say what you still need to check on the source page. Leave out any number that is not written there. Restate the source name before the ending.";
    }
    if (format === "60s") {
      return " Add one sentence in your own words after you open the link. Do not guess missing details.";
    }
    return "";
  }

  function storyLines(story) {
    return {
      title: (story && story.title) || "Untitled",
      source: (story && story.source) || "Unknown source",
      url: (story && story.url) || "",
      summary: summaryOf(story),
      topics: topicsOf(story)
    };
  }

  function single(story, opts) {
    var s = storyLines(story);
    var tone = opts.tone || "neutral";
    var aim = TARGET[opts.format] || TARGET["60s"];
    var note = notesFor(opts.format);
    var hook = toneOpen(tone) + " " + s.title;
    var beat1 = "This comes from " + s.source + ". The summary we have is: " + s.summary + (s.url ? " The link is " + s.url + "." : "") + note;
    var beat2 = "Say the headline in plain words. The headline is: " + s.title + ". Topic labels on the card: " + s.topics + ".";
    var beat3 = "Add one sentence of your own only after you open the source. " + toneClose(tone);
    var takeaway = "If you keep one line, keep the headline: " + s.title;
    var cta = "Read it at " + s.source + (s.url ? ", " + s.url : "") + ", then record your version.";
    return [
      "HOOK", hook,
      "BEAT 1", beat1,
      "BEAT 2", beat2,
      "BEAT 3", beat3,
      "TAKEAWAY", takeaway,
      "CTA", cta,
      "Aim for about " + aim + " words. Add your own lines after you read the source.",
      "Template draft · AI scripts coming soon"
    ].join("\n\n");
  }

  function roundup(stories, opts) {
    var tone = opts.tone || "neutral";
    var aim = TARGET[opts.format] || TARGET["60s"];
    var lines = stories.map(storyLines);
    var hook = toneOpen(tone) + " This is a daily roundup of " + lines.length + " headline" + (lines.length === 1 ? "" : "s") + ".";
    var groups = [[], [], []];
    lines.forEach(function (s, index) { groups[index % 3].push(s); });
    function beat(group) {
      if (!group.length) return "No extra headline in this beat. Move on.";
      return group.map(function (s) {
        return "Headline: " + s.title + ". Source: " + s.source + ". " + s.summary + (s.url ? " Link: " + s.url + "." : "");
      }).join(" ") + notesFor(opts.format);
    }
    return [
      "HOOK", hook,
      "BEAT 1", beat(groups[0]),
      "BEAT 2", beat(groups[1]),
      "BEAT 3", beat(groups[2]) + " " + toneClose(tone),
      "TAKEAWAY", "Pick the one headline your audience needs today. The others can wait. Do not merge facts from different stories into one claim.",
      "CTA", "The links are the sources named above. Open them before you publish.",
      "Aim for about " + aim + " words. Add your own lines after you read each source.",
      "Template draft · AI scripts coming soon"
    ].join("\n\n");
  }

  function generateScript(stories, opts) {
    opts = opts || {};
    var list = (stories || []).filter(function (story) { return story && (story.title || story.url); }).slice(0, 5);
    if (!list.length) {
      return {
        text: "",
        words: 0,
        seconds: 0,
        label: "Template draft · AI scripts coming soon",
        error: "Choose a story first."
      };
    }
    var round = opts.roundup === true || list.length > 1;
    var text = round ? roundup(list, opts) : single(list[0], opts);
    var words = countWords(text);
    return {
      text: text,
      words: words,
      seconds: Math.round(words / WPM * 60),
      label: "Template draft · AI scripts coming soon",
      error: ""
    };
  }

  root.generateScript = generateScript;
})(window);
