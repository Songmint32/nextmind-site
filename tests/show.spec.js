const { test, expect } = require("@playwright/test");
const { execFileSync, spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, writeFileSync, cpSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const FIXTURE = "http://127.0.0.1:8082";
const ROOT = join(__dirname, "..");

function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (msg) => {
    if (msg.type() === "error" && !/Failed to load resource|net::ERR/i.test(msg.text())) errors.push(msg.text());
  });
  return errors;
}

async function stubYouTube(page) {
  await page.route(/i\.ytimg\.com/, (route) => route.fulfill({ path: join(ROOT, "assets/logo.png"), contentType: "image/png" }));
  await page.route(/youtube-nocookie\.com/, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>player</title>" }));
}

async function expectNoOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test("home leads with the show and the next episode, with no placeholder text", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("One company");
  await expect(page.locator(".feature")).toContainText("Up next");
  await expect(page.locator(".feature-title")).toHaveText("Eli Lilly");
  await expect(page.locator(".home-episodes .card")).toHaveCount(2);
  await expect(page.locator("body")).not.toContainText("PLACEHOLDER");
  // The channel URL is still a placeholder, so no subscribe link points anywhere.
  await expect(page.getByRole("link", { name: /Subscribe/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Browse episodes" })).toHaveAttribute("href", "episodes/");
  await expect(page.locator(".site-footer").getByRole("link", { name: "Tools" })).toHaveAttribute("href", "tools.html");
  expect(errors).toEqual([]);
});

test("episodes index filters by sector, searches, sorts and switches layout", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/episodes/");
  const cards = page.locator("[data-results] .card");
  const visible = page.locator("[data-results] .card:visible");
  await expect(cards).toHaveCount(3);
  await expect(page.locator("[data-episode-count]")).toHaveText("3 episodes");

  await page.getByRole("button", { name: /Healthcare/ }).click();
  await expect(visible).toHaveCount(1);
  await expect(visible.first()).toContainText("Eli Lilly");
  await expect(page.locator("[data-episode-count]")).toHaveText("1 of 3");
  await expect(page).toHaveURL(/\?sector=healthcare$/);

  await page.getByRole("button", { name: /^All/ }).click();
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox", { name: "Search episodes" })).toBeFocused();
  await page.keyboard.type("nasdaq");
  await expect(visible).toHaveCount(1);
  await expect(visible.first()).toContainText("Palantir");

  await page.getByRole("searchbox", { name: "Search episodes" }).fill("zzz");
  await expect(page.getByText("No episodes match.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(visible).toHaveCount(3);

  await page.getByLabel("Sort episodes").selectOption("az");
  await expect(cards.locator(".card-title")).toHaveText(["Eli Lilly", "Estée Lauder", "Palantir"]);

  await page.getByRole("button", { name: "List" }).click();
  await expect(page.locator("[data-results]")).toHaveAttribute("data-layout", "list");
  await expect(cards.first().locator(".card-title")).toBeVisible();
  await page.reload();
  await expect(page.locator("[data-results]")).toHaveAttribute("data-layout", "list");
  expect(errors).toEqual([]);
});

test("a sector link from an episode opens the index already filtered", async ({ page }) => {
  await page.goto("/episodes/palantir/");
  await page.locator(".crumbs").getByRole("link", { name: "Technology" }).click();
  await expect(page.getByRole("button", { name: /Technology/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-results] .card:visible")).toHaveCount(1);
});

test("a coming-soon episode shows its facts and hides every placeholder", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/episodes/estee-lauder/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Estée Lauder");
  await expect(page.locator(".ep-bar")).toContainText("Coming soon");
  await expect(page.locator(".player.is-pending .cover-symbol")).toHaveText("EL");
  await expect(page.locator(".facts")).toContainText("The Estée Lauder Companies Inc.");
  await expect(page.locator(".facts")).toContainText("Beauty");
  await expect(page.locator(".ep-section")).toHaveCount(0);
  await expect(page.locator(".related .card")).toHaveCount(2);
  await expect(page.locator("body")).not.toContainText("PLACEHOLDER");
  await expect(page.locator("[data-player]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

for (const size of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1440, height: 900 }]) {
  test(`pages fit a ${size.width}px screen without sideways scrolling`, async ({ page }) => {
    await page.setViewportSize(size);
    for (const path of ["/", "/episodes/", "/episodes/eli-lilly/", `${FIXTURE}/episodes/example-holdings/`]) {
      await stubYouTube(page);
      await page.goto(path);
      await expectNoOverflow(page);
    }
  });
}

test("a published episode plays in the page and chapters seek the video", async ({ page }) => {
  const errors = watchErrors(page);
  await stubYouTube(page);
  await page.goto(`${FIXTURE}/episodes/example-holdings/`);

  for (const id of ["summary", "numbers", "chapters", "sources", "transcript"]) {
    await expect(page.locator(`#${id}`)).toBeVisible();
  }
  await expect(page.locator(".ep-bar .meta-line")).toHaveText(/No\. 01.*January 15, 2027.*1 hr 12 min/);
  await expect(page.getByRole("link", { name: "Watch on YouTube" })).toHaveAttribute("href", "https://www.youtube.com/watch?v=AAAAAAAAAAA");
  await expect(page.locator(".site-header").getByRole("link", { name: "Subscribe" })).toHaveAttribute("href", /sub_confirmation=1/);

  await page.locator(".chapter", { hasText: "Fixture chapter two" }).click();
  const frame = page.locator(".player iframe");
  await expect(frame).toHaveAttribute("src", /youtube-nocookie\.com\/embed\/AAAAAAAAAAA\?.*start=252/);

  await page.locator(".transcript summary").click();
  await expect(page.locator(".transcript-body")).toContainText("Fixture transcript paragraph one.");
  await expect(page.locator(".transcript-speaker").first()).toHaveText("Host");

  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("button", { name: "Link copied" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("the poster loads the player when pressed", async ({ page }) => {
  await stubYouTube(page);
  await page.goto(`${FIXTURE}/episodes/example-holdings/`);
  await page.getByRole("link", { name: "Play Example Holdings" }).click();
  await expect(page.locator(".player iframe")).toHaveAttribute("src", /embed\/AAAAAAAAAAA\?autoplay=1/);
});

test("the creator tools still load from tools.html, and old links find them", async ({ page }) => {
  await page.goto("/tools.html#radar");
  await expect(page.locator("#radar-list .trend").first()).toBeVisible();
  await page.goto("/#radar");
  await expect(page).toHaveURL(/\/tools\.html#radar$/);
});

test("the build stops on broken episode data and marks placeholders in preview", () => {
  const dir = mkdtempSync(join(tmpdir(), "nextmind-data-"));
  cpSync(join(ROOT, "data/show.json"), join(dir, "show.json"));
  const episodes = JSON.parse(readFileSync(join(ROOT, "data/episodes.json"), "utf8"));
  episodes[1].slug = episodes[0].slug;
  episodes[2].status = "published";
  writeFileSync(join(dir, "episodes.json"), JSON.stringify(episodes));
  const broken = spawnSync("node", ["scripts/build_site.mjs", "--data", dir, "--out", join(dir, "out")], { cwd: ROOT, encoding: "utf8" });
  expect(broken.status).not.toBe(0);
  expect(broken.stderr).toContain('the slug "eli-lilly" is used twice');
  expect(broken.stderr).toContain('a published episode needs a "youtubeId"');

  const out = join(dir, "preview");
  execFileSync("node", ["scripts/build_site.mjs", "--preview", "--out", out], { cwd: ROOT });
  const html = readFileSync(join(out, "episodes/eli-lilly/index.html"), "utf8");
  expect(html).toContain('class="ph"');
  expect(html).toContain('name="robots" content="noindex"');
});
