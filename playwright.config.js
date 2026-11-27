const { defineConfig } = require("@playwright/test");

// The creator tools live at tools.html. Their suite serves the repository
// with tools.html as the index so it can keep addressing them as "/".
// The show suite builds the site twice: once from data/ and once from a
// fixture with a published episode, since the real data has none yet.
module.exports = defineConfig({
  testDir: "tests",
  timeout: 60000,
  projects: [
    {
      name: "tools",
      testMatch: "workflow.spec.js",
      use: {
        baseURL: "http://127.0.0.1:8080",
        permissions: ["clipboard-read", "clipboard-write"]
      }
    },
    {
      name: "show",
      testMatch: "show.spec.js",
      use: {
        baseURL: "http://127.0.0.1:8081",
        permissions: ["clipboard-read", "clipboard-write"]
      }
    }
  ],
  webServer: [
    {
      command: "node scripts/serve.mjs --dir . --index tools.html --port 8080",
      port: 8080,
      reuseExistingServer: true
    },
    {
      command: "node scripts/build_site.mjs --out _test-site && node scripts/serve.mjs --dir _test-site --port 8081",
      port: 8081,
      reuseExistingServer: true
    },
    {
      command: "node scripts/build_site.mjs --data tests/fixtures/site --out _test-fixture && node scripts/serve.mjs --dir _test-fixture --port 8082",
      port: 8082,
      reuseExistingServer: true
    }
  ]
});
