const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "tests",
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:8080",
    permissions: ["clipboard-read", "clipboard-write"]
  },
  webServer: {
    command: "python3 -m http.server 8080",
    port: 8080,
    reuseExistingServer: true
  }
});
