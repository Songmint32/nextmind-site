# NextMind

NextMind is a small website for people who make short posts about tech. It has two tools:

- **Trend Radar** shows real headlines from public tech sites.
- **Script Studio** turns a headline into a spoken draft you can edit. The draft is a template. It does not call an AI service.
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

### `script-studio.js`

Builds the spoken draft. The page calls `generateScript(stories, opts)`. Today that function fills in a template from the headline, the source, and the link. A later server could replace the inside of that function. It must not add facts that are not in the story you pass in.

### `site.js`

Switches sections, fills Trend Radar, saves stories and drafts in this browser, and runs the voice preview. The preview uses the browser's own speech. It cannot be saved as an MP3. Saved stories and drafts stay in `localStorage` on your machine. They are not uploaded.

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

The script also saves a picture address when the feed includes one. If a story has no picture, it opens the article page (a limited number each run) and reads the sharing image. It remembers the result in `imageCache` inside `data/trends.json`, so the next run does not ask again. Cards without a picture show a colored tile instead.

## Heat

A brand-new story scores 100. The score falls to 0 after 48 hours. Hacker News points and comments add more. Other sites are scored only by how new they are. The Trend Radar page says this next to the list.

## Script Studio

On a headline, press **Make script**. Script Studio fills in a hook, three beats, a takeaway, and a call to action from that headline, its source, and its link. It is marked "Template draft · AI scripts coming soon" because it does not call an AI service. You can edit the text, copy it, download a `.txt` file, or send it to Voiceover. Select up to five stories and press **Make daily roundup** for one combined draft. **Save** keeps a story, and **Save draft** keeps a script, only in this browser.

## Voiceover

Play uses the free voice built into the browser. Studio voices and an MP3 download are marked "coming soon" because they need a server, and this site does not have one.

## Publishing

1. Merge the change into `main`.
2. GitHub runs "Publish site".
3. The headline job needs permission to save its file. In the repository on GitHub, open **Settings → Actions → General → Workflow permissions** and choose **Read and write permissions**.

If that switch is off, the fetch can run but it cannot commit `data/trends.json`, so the live list will not refresh.

The site itself is published from **Settings → Pages → Build and deployment → Source: GitHub Actions**. That is already how this repository publishes. A commit made by the headline job does not start the publish workflow by itself, so `pages.yml` also listens for the "Update trends" job to finish.
