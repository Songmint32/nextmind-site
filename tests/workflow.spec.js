const { test, expect } = require("@playwright/test");

async function noErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/Failed to load resource|net::ERR/i.test(text)) return;
    errors.push(text);
  });
  return errors;
}

async function openRadar(page) {
  await page.goto("/#radar");
  await expect(page.locator("#radar-list .trend").first()).toBeVisible();
}

test("story to script to voiceover, saves, and filters", async ({ page }) => {
  const errors = await noErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openRadar(page);
  const title = (await page.locator("#radar-list h3").first().innerText()).trim();
  await expect(page.getByRole("button", { name: "Make script" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy as post" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Copy as post" }).first().click();
  await expect(page.getByRole("button", { name: "Copied" }).first()).toBeVisible();

  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await page.getByRole("link", { name: "Saved" }).click();
  await expect(page.locator("#saved-list")).toContainText(title);
  await page.getByRole("button", { name: "Remove" }).click();
  await expect(page.locator("#saved-list")).toContainText("No saved stories yet");

  await page.goto("/#radar");
  await page.getByRole("button", { name: "Make script" }).first().click();
  await expect(page.locator("#view-title")).toHaveText("Script Studio");
  await expect(page.locator("#studio-output")).toHaveValue(/HOOK/);
  await expect(page.locator("#studio-output")).toHaveValue(new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  await expect(page.locator("#studio-label")).toContainText("Template draft");
  await expect(page.locator("#studio-counts")).toContainText("words");
  const before = await page.locator("#studio-output").inputValue();
  await page.getByRole("button", { name: "Hype" }).click();
  await page.getByRole("button", { name: "Generate" }).click();
  await expect(page.locator("#studio-output")).not.toHaveValue(before);

  await page.locator("#studio-output").fill("Edited line for the voiceover.");
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download .txt" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("nextmind-script.txt");

  await page.getByRole("button", { name: "Save draft" }).click();
  const nameBox = page.getByLabel("Draft name");
  await nameBox.fill("Morning draft");
  await nameBox.dispatchEvent("change");
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page.locator("#studio-output")).toHaveValue("Edited line for the voiceover.");
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(page.locator("#draft-list")).toContainText("No drafts yet");

  await page.getByRole("button", { name: "Send to Voiceover" }).click();
  await expect(page.locator("#view-title")).toHaveText("Voiceover");
  await expect(page.locator("#script")).toHaveValue("Edited line for the voiceover.");
  await expect(page.locator("#script-counts")).toContainText("words");

  await page.goto("/#radar");
  const boxes = page.getByRole("checkbox", { name: "Select for roundup" });
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await expect(page.locator("#roundup-count")).toContainText("2 of 5");
  await page.getByRole("button", { name: "Make daily roundup" }).click();
  await expect(page.locator("#studio-output")).toHaveValue(/daily roundup/i);

  await page.goto("/#radar");
  await page.locator("#radar-search").fill("zzzz-no-such-headline");
  await expect(page.locator("#radar-list")).toContainText("No headlines match");
  await page.locator("#radar-search").fill("");
  await page.getByRole("button", { name: "7d" }).click();
  await page.locator("#radar-source").selectOption({ index: 1 });
  await expect(page.locator("#radar-list .trend, #radar-list .empty").first()).toBeVisible();
  await page.locator("#radar-source").selectOption("");
  await page.getByRole("button", { name: "6h" }).click();
  await page.getByRole("button", { name: "All", exact: true }).click();

  await page.keyboard.press("Shift+Slash");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();

  expect(errors).toEqual([]);
});

test("layouts do not overflow and a failed feed stays usable", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/#radar");
    await expect(page.locator("#radar-list .trend").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
  }
  await page.route("**/data/trends.json", (route) => route.fulfill({
    status: 500,
    contentType: "application/json",
    body: "{}"
  }));
  await page.goto("/?broken=1#radar");
  await expect(page.locator("#radar-list")).toContainText("Could not load headlines");
  await page.getByRole("link", { name: "Voiceover" }).click();
  await page.locator("#script").fill("Still here.");
  await page.getByRole("button", { name: "Play", exact: true }).click();
  expect(errors).toEqual([]);
});
