/* Writes the real current month next to the title, for example "November 2026".
   If this file does not run, the month typed in index.html stays as it is. */
(function () {
  var el = document.getElementById("month-label");
  if (!el) return;
  var label = new Date().toLocaleDateString("en-US", {
    month: "long",
    year: "numeric"
  });
  if (label) el.textContent = label;
})();
