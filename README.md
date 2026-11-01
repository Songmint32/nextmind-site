# NextMind

NextMind is a small website for people who make short posts about tech. It has two tools:

- **Trend Radar** shows real headlines from public tech sites.
- **Voiceover** reads a script out loud with the voice already on your computer or phone.

There is nothing to install and nothing to build. The pages are plain files. GitHub hosts them for free.

The live address is:

https://songmint32.github.io/nextmind-site/

## What each file is

### `index.html`

The app. The sentences a visitor reads are in this file. To change wording, edit the words and leave the `<tags>` around them as they are.

Search for `TODO`. Those notes are links that are not ready yet (the real X address, and a contact link). They use `#` on purpose.

### `styles.css`

Colors, type, and layout. The space at the edge of the screen is `--gutter`. The page background is `--bg`. You do not need to open this file to change the words.

### `site.js`

Makes the sections switch, fills Trend Radar from `data/trends.json`, and runs the voice preview. The preview uses the browser's own speech. It cannot be saved as an MP3.

### `data/trends.json`

The headline list the page reads. A scheduled job rewrites this file. You can open it and look, but you do not type stories into it by hand.

### `scripts/fetch_trends.py`

The job that downloads headlines. The list of sites is near the top, in `FEEDS`. Hacker News is just above that, because it is not an RSS feed.

To run it on your own computer:

```bash
python3 scripts/fetch_trends.py
```

If one site does not answer, the script keeps the others. If every site fails and this file already exists, the script leaves the old file alone.

### `assets/logo.png` and `assets/logo.svg`

The NextMind mark. The page uses the SVG next to the name. The PNG is the icon for phones. You do not need to edit these to change the words.

### `fonts/`

The lettering (Inter, and IBM Plex Mono for the small labels). `fonts/OFL.txt` is the font license. You do not need to edit this folder.

### `.github/workflows/pages.yml`

Publishes the site after a change lands on `main`.

### `.github/workflows/trends.yml`

Every two hours, and whenever someone presses "Run workflow", GitHub runs `scripts/fetch_trends.py`, saves `data/trends.json`, and commits that file. The publish workflow then puts the new file on the live site.

## How to follow a different site

1. Open `scripts/fetch_trends.py`.
2. Find `FEEDS`.
3. Add a line with the site name and its RSS address, or delete a line you do not want.
4. Save, and run `python3 scripts/fetch_trends.py` to try it.

Topic words (AI, Chips, Space, and the others) are the `TOPICS` list in that same file.

## Heat

A brand-new story scores 100. The score falls to 0 after 48 hours. Hacker News points and comments add more. Other sites are scored only by how new they are. The Trend Radar page says this next to the list.

## Voiceover

Play uses the free voice built into the browser. Studio voices and an MP3 download are marked "coming soon" because they need a server, and this site does not have one.

## Publishing

1. Merge the change into `main`.
2. GitHub runs "Publish site".
3. The headline job needs permission to save its file. In the repository on GitHub, open **Settings → Actions → General → Workflow permissions** and choose **Read and write permissions**.

If that switch is off, the fetch can run but it cannot commit `data/trends.json`, so the live list will not refresh.

The site itself is published from **Settings → Pages → Build and deployment → Source: GitHub Actions**. That is already how this repository publishes. A commit made by the headline job does not start the publish workflow by itself, so `pages.yml` also listens for the "Update trends" job to finish.
