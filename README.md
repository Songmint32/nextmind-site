# NextMind

NextMind is a YouTube series of long-form deep dives on companies. This repository is its website: a home page, an index of every episode, and one page per episode with the video, a summary, chapters, key numbers, sources, and an optional transcript.

The live address is:

https://songmint32.github.io/nextmind-site/

Episodes come from one file, `data/episodes.json`. Adding an episode never means touching the layout. See **Adding an episode** at the end of this file.

The earlier creator tools (Trend Radar, Script Studio, Voiceover) are still online at `tools.html`, linked as **Tools** in the footer. Their files are described below.

## What each file is

### `tools.html`

The creator tools app. It used to be the home page. Old links such as `/#radar` are sent here. The sentences a visitor reads are in this file. To change wording, edit the words and leave the `<tags>` around them as they are.

### `styles.css`

Colors, type, and layout. The space at the edge of the screen is `--gutter`. The page background is `--bg`. You do not need to open this file to change the words.

### `script-studio.js`

Builds the spoken draft. The page calls `generateScript(stories, opts)`. Today that function fills in a template from the headline, the source, and the link. A later server could replace the inside of that function. It must not add facts that are not in the story you pass in.

### `site.js`

Switches sections, fills Trend Radar, and saves stories and drafts in this browser. Voiceover sends the script to ElevenLabs. The API key stays in `localStorage` on your machine. It is not uploaded and it is not in this repository.

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

Publishes the site after a change lands on `main`. It runs `node scripts/build_site.mjs`, which writes the pages into `_site/`, and uploads that folder.

### `.github/workflows/trends.yml`

Every two hours, and whenever someone presses "Run workflow", GitHub runs `scripts/fetch_trends.py`, saves `data/trends.json`, and commits that file. The publish workflow then puts the new file on the live site.

## How to follow a different site

1. Open `scripts/fetch_trends.py`.
2. Find `FEEDS`.
3. Add a line with the site name and its RSS address, or delete a line you do not want.
4. Save, and run `python3 scripts/fetch_trends.py` to try it.

Topic words (AI, Chips, Space, and the others) are the `TOPICS` list in that same file.

The script also saves a picture address when the feed includes one. If a story has no picture, it opens the article page (a limited number each run) and reads the sharing image. It remembers the result in `imageCache` inside `data/trends.json`, so the next run does not ask again. Cards without a picture show a colored tile instead.

## Heat

A brand-new story scores 100. The score falls to 0 after 48 hours. Hacker News points and comments add more. Other sites are scored only by how new they are.

## Script Studio

On a headline, press **Make script**. Script Studio fills in a hook, three beats, a takeaway, and a call to action from that headline. You can edit the text, copy it, download a `.txt` file, or press **Send to Voiceover**. Select up to five stories and press **Make daily roundup** for one combined draft. **Save** keeps a story, and **Save draft** keeps a script, only in this browser.

## Voiceover

Open **Settings** and paste an ElevenLabs API key. It is saved only in this browser. Pick Rachel, Adam, Bella, Josh, or Daniel, then press **Play**. **Download mp3** saves the last take. Without a key, Voiceover stays usable and tells you to add one. The key is sent only to ElevenLabs, from your browser. There is no server in this repository.

## Publishing

1. Merge the change into `main`.
2. GitHub runs "Publish site".
3. The headline job needs permission to save its file. In the repository on GitHub, open **Settings → Actions → General → Workflow permissions** and choose **Read and write permissions**.

If that switch is off, the fetch can run but it cannot commit `data/trends.json`, so the live list will not refresh.

The site itself is published from **Settings → Pages → Build and deployment → Source: GitHub Actions**. That is already how this repository publishes. A commit made by the headline job does not start the publish workflow by itself, so `pages.yml` also listens for the "Update trends" job to finish.

## The episode site

### `data/show.json`

The show itself: the headline on the home page (`*stars*` set a phrase in italics), the short intro, the about text, and the YouTube channel address. While `youtube` starts with `PLACEHOLDER`, the subscribe buttons stay hidden. Paste the channel address (for example `https://www.youtube.com/@yourhandle`) and they appear everywhere.

### `data/episodes.json`

One entry per episode. The list order is the order upcoming episodes appear in. Published episodes sort by `releaseDate`, newest first.

| Field | What it is |
| --- | --- |
| `slug` | The address: `eli-lilly` becomes `/episodes/eli-lilly/`. Lowercase words and hyphens. Do not change it after release, or old links break. |
| `status` | `coming-soon` or `published`. |
| `number` | Episode number, or `null`. |
| `title`, `company`, `ticker` | `ticker` looks like `NYSE: LLY`. It is drawn on the cover when there is no artwork. |
| `sector`, `category` | `sector` drives the filters on the episodes page. Keep the names consistent (`Healthcare`, not `Health care`). |
| `releaseDate` | `2027-03-14`. Required when published. |
| `duration` | `1:24:10`. |
| `youtubeId` | The 11 characters after `v=` in the video address. Required when published. |
| `logline` | One sentence under the title. |
| `summary` | A list of short paragraphs. |
| `chapters` | `{ "time": "12:04", "title": "…" }`. Times match the YouTube chapters. On the page they seek the video. |
| `keyNumbers` | `{ "value": "…", "label": "…", "source": "…", "sourceUrl": "…" }`. Only figures that are said in the episode and that you can source. |
| `sources` | `{ "group": "Company filings", "title": "…", "publisher": "…", "url": "https://…" }`. Items with the same `group` are listed together. |
| `cover.color` | Background of the drawn cover, as a hex color. |
| `artwork` | Optional 16:9 image: a file such as `assets/episodes/eli-lilly.jpg`, or a full address. Without it the page uses the YouTube thumbnail, and before release a drawn cover. |

Any text that starts with `PLACEHOLDER` is treated as empty: the public site hides it, and a list item that still holds one is left out. The three seeded episodes (Eli Lilly, Estée Lauder, Palantir) are mostly placeholders on purpose. Nothing in them is a real date, video, number or quote yet.

### `data/transcripts/`

Optional. Save a transcript as `data/transcripts/<slug>.md` and it appears at the bottom of that episode page, folded. Separate paragraphs with a blank line. A paragraph may start with a timestamp and a speaker:

```
[12:04] Host: The paragraph text.
```

### `scripts/build_site.mjs`

Turns the two data files into pages. It needs Node, nothing else.

```bash
node scripts/build_site.mjs             # the public site, in _site/
node scripts/build_site.mjs --preview   # placeholders shown as marked boxes, in _preview/
node scripts/serve.mjs                  # look at _site/ on http://127.0.0.1:8000/
node scripts/serve.mjs --dir _preview --port 8001
```

The build stops with a plain message if the data is wrong (a repeated slug, a published episode with no video, a date in the wrong shape). It also lists every placeholder that is left. The templates are in `scripts/site/render.mjs`. The look is `assets/show.css`. `assets/show.js` adds the in-page player, chapter seeking, link copying, and the filters on the episodes page. Every page still reads fine without it.

## Adding an episode

1. Copy an entry in `data/episodes.json` and change the `slug`.
2. Fill in what you have. Leave the rest as `PLACEHOLDER` or delete the field.
3. On release day, set `status` to `published` and add `releaseDate` and `youtubeId`.
4. Optional: run `node scripts/build_site.mjs` to check the data, then commit to `main`. The publish workflow builds and deploys.

## Tests

```bash
npm ci
npx playwright install chromium
npx playwright test
```

`tests/workflow.spec.js` covers the tools. `tests/show.spec.js` covers the episode site. It also builds `tests/fixtures/site/`, a made-up published episode, because the real data has none yet.
