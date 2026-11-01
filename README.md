# NextMind site

This folder is the first version of the NextMind homepage. It is a normal website made of text files. There is nothing to install and nothing to build.

When it is published, the address should be:

https://songmint32.github.io/nextmind-site/

## What each file is

### `index.html`

The page itself. The sentences a visitor reads are in this file. To change the wording, open it, edit those words, and save. Leave the `<tags>` around the words as they are.

Search this file for `TODO`. Those notes mark links that are not ready yet: the real X (Twitter) address, and a contact link. They use `#` on purpose, so they do not send anyone to the wrong place.

The Daily Boards cards, the video slots, and the Tools cards are examples. The page says so. Do not type a real news story, a real count, or a working tool into them unless you mean to publish that.

### `styles.css`

How the page looks: colors, type, spacing, and the layout on a phone versus a wide screen. The colors are named at the top, on the lines that start with `--`. You do not need to open this file to change the words.

### `site.js`

A short script that does three things:

- Writes the real current month next to the title, such as “November 2026”.
- Shows one section at a time when you use Overview, Daily Boards, Videos, Tools, or About.
- Opens the search box when someone clicks Search or presses ⌘K (Ctrl+K on Windows).

The search box only jumps between those sections. It does not look up news. If this file does not run, every section stays on the page and the month written in `index.html` stays as it is.

### `assets/logo.png` and `assets/logo.svg`

The NextMind mark: a white angular monogram on a black square. The page uses the SVG next to the name and as the browser icon. The PNG is the same logo, kept for phones that want a PNG icon (`apple-touch-icon`). You do not need to edit these to change the words.

### `fonts/`

The lettering (Inter, and IBM Plex Mono for the small labels), so the page looks the same without loading fonts from another website. You do not need to edit this folder. `fonts/OFL.txt` is the font license, and `fonts/NOTICE.txt` says who made the fonts.

### `.github/workflows/pages.yml`

Instructions for GitHub. After a change is merged into the `main` branch, GitHub copies the page files and publishes them.

## How to edit the text

1. Open `index.html` in any text editor.
2. Change the words you want to change.
3. Save the file.
4. Refresh the page in your browser.

## See the page on your computer

In this folder, run:

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080

Opening `index.html` directly also works. The small server is a closer match to how GitHub will host the page.

## Publishing

1. Merge the change into the `main` branch.
2. GitHub runs the “Publish site” workflow.
3. One setting has to be switched on, or that run cannot finish. On GitHub, open this repository and go to **Settings → Pages → Build and deployment**. Set **Source** to **GitHub Actions**.

The workflow includes `enablement: true`, which asks GitHub to turn Pages on by itself. The token GitHub Actions uses is not allowed to create a Pages site, so that settings switch is still required the first time. After it is on, every later merge to `main` publishes the site.

If the first run fails, turn that setting on, open the **Actions** tab, and run **Publish site** again.
