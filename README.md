# Sound Capsule

A personal, static recreation of Spotify's retired **Sound Capsule**. It runs entirely in the browser and deploys to GitHub Pages with no build step.

- **Capsule** view: top artists, songs and genres for the last 4 weeks, 6 months and year, plus recently played, straight from the Spotify Web API (Authorization Code with PKCE, no server, no client secret).
- **History** view: drop in your Spotify *Extended Streaming History* export (ZIP or JSON) to get minutes listened, play counts, streaks, new discoveries, milestones, a listening clock, weekday and month breakdowns, a calendar heatmap, your biggest days, and per-day averages, for any rolling window, calendar month or year. Sign in and the history is decorated with artwork and genres.
- **Tempo**: average BPM weighted by listening, your fastest and slowest songs, a tempo histogram and a month-by-month tempo trend. Spotify closed its Audio Features endpoint to new apps in November 2024, so tempo comes from [ReccoBeats](https://reccobeats.com) (free, by Spotify track ID) with Deezer's ISRC lookup as a fallback. Coverage is shown on the card; results are cached in your browser.
- **Share**: every capsule card exports as a 1080×1920 PNG (or opens the native share sheet on mobile).

Nothing is uploaded anywhere. Tokens live in `localStorage`, imported history lives in IndexedDB in your browser.

## 1. Create a Spotify app

1. Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and create an app. Pick **Web API**.
2. Add a **Redirect URI**. It must match exactly, with the trailing slash:
   - GitHub Pages: `https://<your-github-user>.github.io/<repo-name>/`
   - Local testing: `http://127.0.0.1:5173/` (Spotify no longer accepts `localhost` for new apps)
3. Under **User Management**, add the email of every Spotify account that will use the page. Apps in development mode only serve allowlisted users, and new apps are limited to a handful of them.
4. Copy the app's **Client ID**. Either paste it into the Settings panel on the page (stored in your browser) or hard-code it in [js/config.js](js/config.js).

## 2. Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "Sound Capsule"
git branch -M main
git remote add origin https://github.com/<your-github-user>/<repo-name>.git
git push -u origin main
```

Then in the repository go to **Settings → Pages**, set *Source* to **Deploy from a branch**, branch `main`, folder `/ (root)`, and save. The site appears at `https://<your-github-user>.github.io/<repo-name>/` within a minute or two. That URL is the redirect URI to register in step 1.

## 3. Run locally

Any static file server works. With Python:

```bash
python -m http.server 5173 --bind 127.0.0.1
```

Open <http://127.0.0.1:5173/>.

## 4. Get your Extended Streaming History

1. Go to [spotify.com/account/privacy](https://www.spotify.com/account/privacy/).
2. Under *Download your data*, tick **Extended streaming history** and request it. Confirm the email Spotify sends you.
3. A ZIP arrives by email within a few days (Spotify quotes up to 30). Drop the ZIP, or the `Streaming_History_Audio_*.json` files inside it, onto the History view.

The older *Account data* export (`StreamingHistory_music_*.json`, last 12 months only) is also understood. Re-importing a newer export merges and de-duplicates.

## What the Web API can and cannot provide

| Shown in Sound Capsule | Live API | History import |
| --- | --- | --- |
| Top artists / songs | yes (4 weeks, 6 months, ~1 year) | yes, any window, with minutes and play counts |
| Top genres | from artist tags (sparse for some artists) | same, once signed in |
| Minutes listened | no | yes |
| Per-day listening, averages, heatmap | no | yes |
| New discoveries, streaks, milestones | no | yes |
| Tempo (BPM) | via ReccoBeats / Deezer, top 50 songs | via ReccoBeats / Deezer, up to 300 songs per period |
| Recently played | last 50 plays only | full history |

## Project layout

```
index.html        page shell
css/styles.css    styling, capsule card themes
js/config.js      Client ID and redirect URI
js/auth.js        PKCE sign-in, token refresh
js/api.js         Web API client, caching, batch lookups
js/db.js          IndexedDB key-value helper
js/history.js     export parser (ZIP/JSON), persistence
js/stats.js       pure stats engine (windows, tops, streaks, milestones, tempo summary)
js/tempo.js       BPM lookups: ReccoBeats batches, Deezer ISRC fallback, cache
js/ui.js          HTML rendering helpers, capsule card, heatmap, charts
js/share.js       PNG export / native share
js/app.js         state, views, event wiring
```

Unofficial fan project, not affiliated with Spotify.
