#!/usr/bin/env node
// Builds the public site into _site/ from data/show.json and data/episodes.json.
//
//   node scripts/build_site.mjs              public build, placeholders hidden
//   node scripts/build_site.mjs --preview    placeholders drawn as marked boxes
//   node scripts/build_site.mjs --out dir    write somewhere other than _site/
//   node scripts/build_site.mjs --data dir   read show.json and episodes.json from dir (tests)
//
// No packages are needed. GitHub Actions runs this before publishing.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSite } from "./site/load.mjs";
import { renderEpisode, renderHome, renderIndex, renderNotFound, renderSitemap } from "./site/render.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const preview = args.includes("--preview");
const outArg = args.indexOf("--out");
const out = resolve(root, outArg >= 0 ? args[outArg + 1] : preview ? "_preview" : "_site");
const dataArg = args.indexOf("--data");
const dataDir = dataArg >= 0 ? args[dataArg + 1] : "data";

let site;
try {
  site = loadSite(root, { preview, dataDir });
} catch (error) {
  console.error(error.isDataError ? error.message : `Could not read the site data.\n${error.message}`);
  process.exit(1);
}

const assetVersion = createHash("sha1")
  .update(readFileSync(join(root, "assets/show.css")))
  .update(readFileSync(join(root, "assets/show.js")))
  .digest("hex")
  .slice(0, 8);
Object.assign(site, { assetVersion, year: new Date().getUTCFullYear() });

rmSync(out, { recursive: true, force: true });

function write(path, contents) {
  const file = join(out, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

function copy(path) {
  const from = join(root, path);
  if (!existsSync(from)) return;
  const to = join(out, path);
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

function copyDir(dir, ext = "") {
  const from = join(root, dir);
  if (!existsSync(from)) return;
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.isDirectory()) copyDir(join(dir, entry.name), ext);
    else if (entry.name.endsWith(ext)) copy(join(dir, entry.name));
  }
}

write("index.html", renderHome(site));
write("episodes/index.html", renderIndex(site));
for (const ep of site.episodes) write(`episodes/${ep.slug}/index.html`, renderEpisode(site, ep));
write("404.html", renderNotFound(site));
if (!preview) write("sitemap.xml", renderSitemap(site));

copyDir("assets");
copyDir("fonts", ".woff2");

// The earlier creator tools stay online at tools.html with their own files.
for (const file of ["tools.html", "styles.css", "site.js", "script-studio.js", "data/trends.json"]) copy(file);
copyDir("data/articles", ".json");

const published = site.episodes.filter((ep) => ep.published).length;
console.log(`Built ${site.episodes.length} episodes (${published} published) into ${out.replace(root + "/", "")}/${preview ? " with placeholders shown" : ""}.`);
for (const warning of site.warnings) console.log(`  note: ${warning}`);
