#!/usr/bin/env node
// A small static server for looking at the site locally.
//
//   node scripts/serve.mjs                       serves _site/ on port 8000
//   node scripts/serve.mjs --dir _preview --port 8001
//   node scripts/serve.mjs --dir . --index tools.html --port 8080

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const dir = resolve(option("dir", "_site"));
const port = Number(option("port", 8000));
const index = option("index", "index.html");

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  let file = normalize(join(dir, path));
  if (!file.startsWith(dir)) {
    response.writeHead(403).end();
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) {
    if (!path.endsWith("/")) {
      response.writeHead(301, { Location: path + "/" }).end();
      return;
    }
    file = join(file, index);
  }
  let status = 200;
  if (!existsSync(file)) {
    status = 404;
    file = join(dir, "404.html");
    if (!existsSync(file)) {
      response.writeHead(404, { "Content-Type": types[".txt"] }).end("Not found");
      return;
    }
  }
  response.writeHead(status, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
  createReadStream(file).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`Serving ${dir} at http://127.0.0.1:${port}/`);
});
