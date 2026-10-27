import { getClientId, setClientId, redirectUri } from "./config.js";
import { login, logout, isLoggedIn, handleRedirect, AuthError } from "./auth.js";
import { getMe, getTop, getRecentlyPlayed, getTracks, getArtists, slimArtist, slimTrack, trackIdFromUri, clearCache } from "./api.js";
import { loadStoredHistory, clearStoredHistory, parseFiles, addToHistory } from "./history.js";
import { RANGES, yearsIn, monthsIn, isMonthId, isYearId, windowFor, computeStats, listenerType, genreBreakdown, tempoSummary, monthlyTempo } from "./stats.js";
import { esc, fmt, fmtMinutes, fmtDate, monthLabel, monthName, WEEKDAYS, hourLabel, artistGrid, trackList, genreBars, columns, capsuleCard, heatmap, lineChart, dayTable, toast } from "./ui.js";
import { shareCard } from "./share.js";
import { lookupTempos, hasUnresolvedMisses } from "./tempo.js";

const LIVE_RANGES = [
  { id: "short_term", label: "Last 4 weeks" },
  { id: "medium_term", label: "Last 6 months" },
  { id: "long_term", label: "Last year" },
];
const THEMES = ["theme-sunset", "theme-grape", "theme-mint", "theme-ocean", "theme-sand"];

const state = {
  view: localStorage.getItem("sc_view") || "capsule",
  me: null,
  liveRange: localStorage.getItem("sc_live_range") || "short_term",
  live: {}, // range -> { artists, tracks, genres }
  recent: null,
  history: { records: [], meta: { sources: [] } },
  histRange: localStorage.getItem("sc_hist_range") || "4w",
  stats: null,
  enriched: null, // { artists: Map name->slim, tracks: Map id->slim }
  tempo: {}, // histRange -> tempo summary
  tempoLoading: false,
  busy: false,
  settingsOpen: false,
};

const $ = (sel, root = document) => root.querySelector(sel);
const main = $("#main");

// ---------------------------------------------------------------------------
// Boot

async function boot() {
  bindTopbar();
  try {
    if (await handleRedirect()) toast("Signed in to Spotify.");
  } catch (e) {
    toast(e.message, { error: true, duration: 6000 });
  }
  if (!getClientId()) state.settingsOpen = true;
  renderAccount();
  render();

  const tasks = [];
  if (isLoggedIn()) tasks.push(loadMe());
  tasks.push(
    loadStoredHistory().then((h) => {
      state.history = h;
      if (h.records.length) recomputeStats();
      if (state.view === "history") render();
    }),
  );
  await Promise.allSettled(tasks);
}

function bindTopbar() {
  document.querySelectorAll(".views button").forEach((b) =>
    b.addEventListener("click", () => {
      state.view = b.dataset.view;
      localStorage.setItem("sc_view", state.view);
      render();
    }),
  );
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-action=open-settings]");
    if (a) {
      e.preventDefault();
      state.settingsOpen = true;
      state.view = "capsule";
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
}

async function loadMe() {
  try {
    const me = await getMe();
    state.me = { name: me.display_name || me.id, image: me.images?.[0]?.url || null, url: me.external_urls?.spotify };
    renderAccount();
    if (state.view === "capsule") render();
    else if (state.stats) enrichHistory();
  } catch (e) {
    handleError(e);
  }
}

function handleError(e) {
  console.error(e);
  if (e instanceof AuthError) {
    state.me = null;
    renderAccount();
    render();
  }
  toast(e.message || String(e), { error: true, duration: 6000 });
}

// ---------------------------------------------------------------------------
// Account chip

function renderAccount() {
  const el = $("#account");
  if (isLoggedIn()) {
    const me = state.me;
    el.innerHTML = `
      <span class="chip">
        ${me?.image ? `<img src="${esc(me.image)}" alt="" />` : `<span class="avatar-fallback"></span>`}
        <span>${esc(me?.name || "…")}</span>
      </span>
      <button class="btn btn-ghost btn-sm" data-action="logout">Sign out</button>`;
    $("[data-action=logout]", el).onclick = () => {
      logout();
      clearCache();
      state.me = null;
      state.live = {};
      state.recent = null;
      state.enriched = null;
      renderAccount();
      render();
    };
  } else {
    el.innerHTML = `<button class="btn btn-primary btn-sm" data-action="login" ${getClientId() ? "" : "disabled title='Add a Client ID in Settings first'"}>Sign in with Spotify</button>`;
    const b = $("[data-action=login]", el);
    if (b) b.onclick = () => login().catch(handleError);
  }
}

// ---------------------------------------------------------------------------
// Render dispatch

function render() {
  document.querySelectorAll(".views button").forEach((b) => b.classList.toggle("active", b.dataset.view === state.view));
  if (state.view === "history") renderHistoryView();
  else renderCapsuleView();
}

// ---------------------------------------------------------------------------
// Settings panel

function settingsPanel() {
  const uri = redirectUri();
  return `
  <section class="card setup" id="settings">
    <div class="card-head"><h2>Connect your Spotify app</h2>
      ${getClientId() ? `<button class="btn btn-ghost btn-sm" data-action="close-settings">Close</button>` : ""}</div>
    <ol>
      <li>Open the <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">Spotify Developer Dashboard</a> and create an app (any name, select <em>Web API</em>).</li>
      <li>Add this exact Redirect URI to the app:
        <div class="copy-row"><code id="redirect-uri">${esc(uri)}</code><button class="btn btn-ghost btn-sm" data-action="copy-uri">Copy</button></div>
      </li>
      <li>Under <em>User Management</em>, add the Spotify account(s) that will use this page (apps in development mode only serve allowlisted users).</li>
      <li>Paste the app's <strong>Client ID</strong> below. It is stored only in this browser.</li>
    </ol>
    <form class="field" data-action="save-client">
      <input name="clientId" placeholder="Client ID" value="${esc(getClientId())}" autocomplete="off" spellcheck="false" />
      <button class="btn btn-primary" type="submit">Save</button>
      ${getClientId() ? `<button class="btn btn-ghost" type="button" data-action="forget-client">Forget</button>` : ""}
    </form>
  </section>`;
}

function bindSettings(root) {
  $("[data-action=copy-uri]", root)?.addEventListener("click", async () => {
    await navigator.clipboard.writeText(redirectUri());
    toast("Redirect URI copied.");
  });
  $("[data-action=save-client]", root)?.addEventListener("submit", (e) => {
    e.preventDefault();
    const id = new FormData(e.target).get("clientId").trim();
    if (!/^[a-f0-9]{32}$/i.test(id)) {
      toast("That does not look like a Spotify Client ID (32 hex characters).", { error: true });
      return;
    }
    setClientId(id);
    state.settingsOpen = false;
    toast("Client ID saved. You can sign in now.");
    renderAccount();
    render();
  });
  $("[data-action=forget-client]", root)?.addEventListener("click", () => {
    setClientId("");
    logout();
    state.me = null;
    renderAccount();
    render();
  });
  $("[data-action=close-settings]", root)?.addEventListener("click", () => {
    state.settingsOpen = false;
    render();
  });
}

// ---------------------------------------------------------------------------
// Capsule view (live Web API)

function renderCapsuleView() {
  if (!isLoggedIn()) {
    main.innerHTML = `
      <section class="hero">
        <div>
          <h1>Your <span>Sound Capsule</span>, back again.</h1>
          <p>A personal recreation of Spotify's Sound Capsule. See your top artists, songs and genres for the last 4 weeks, 6 months and year, then import your Extended Streaming History for minutes, streaks, discoveries and milestones.</p>
          <div class="actions">
            <button class="btn btn-primary" data-action="login" ${getClientId() ? "" : "disabled"}>Sign in with Spotify</button>
            <button class="btn btn-ghost" data-action="goto-history">Import listening history</button>
          </div>
        </div>
        <div class="capsule-wrap">
          ${capsuleCard({
            id: "demo-capsule",
            theme: "theme-sunset",
            eyebrow: "Last 4 weeks",
            title: "Your Sound Capsule",
            stat: { value: "2,418", label: "minutes listened" },
            artist: { name: "Your top artist", sub: "will appear here" },
            track: { name: "Your top song", sub: "with artwork from Spotify" },
            artists: ["Artist one", "Artist two", "Artist three", "Artist four", "Artist five"],
            tracks: ["Song one", "Song two", "Song three", "Song four", "Song five"],
            footer: "soundcapsule",
          })}
        </div>
      </section>
      ${state.settingsOpen || !getClientId() ? settingsPanel() : ""}`;
    $("[data-action=login]", main)?.addEventListener("click", () => login().catch(handleError));
    $("[data-action=goto-history]", main)?.addEventListener("click", () => {
      state.view = "history";
      render();
    });
    bindSettings(main);
    return;
  }

  const range = LIVE_RANGES.find((r) => r.id === state.liveRange) || LIVE_RANGES[0];
  const data = state.live[range.id];
  main.innerHTML = `
    ${state.settingsOpen ? settingsPanel() : ""}
    <div class="toolbar">
      <div class="tabs">${LIVE_RANGES.map((r) => `<button data-range="${r.id}" class="${r.id === state.liveRange ? "active" : ""}">${r.label}</button>`).join("")}</div>
      <span class="note">Spotify's API only offers these rolling windows. Calendar months live in History.</span>
    </div>
    <div id="live-content">${data ? liveContent(range, data) : `<p class="empty"><span class="spinner"></span> Loading your capsule…</p>`}</div>`;
  bindSettings(main);
  main.querySelectorAll("[data-range]").forEach((b) =>
    b.addEventListener("click", () => {
      state.liveRange = b.dataset.range;
      localStorage.setItem("sc_live_range", state.liveRange);
      render();
    }),
  );
  if (data) bindLive();
  else loadLive(range.id);
}

async function loadLive(rangeId) {
  const [artistsRes, tracksRes] = await Promise.allSettled([getTop("artists", rangeId, 50), getTop("tracks", rangeId, 50)]);
  const failures = [artistsRes, tracksRes].filter((r) => r.status === "rejected").map((r) => r.reason);
  const auth = failures.find((e) => e instanceof AuthError);
  if (auth) return handleError(auth);
  if (failures.length === 2) {
    handleError(failures[0]);
    const el = $("#live-content");
    if (!el) return;
    el.innerHTML = `<p class="empty">${esc(failures[0].message)}<br /><br /><button class="btn btn-ghost btn-sm" data-action="retry-live">Try again</button></p>`;
    $("[data-action=retry-live]", el).addEventListener("click", () => render());
    return;
  }
  const items = (res) => (res.status === "fulfilled" ? (res.value?.items || []).filter(Boolean) : []);
  const artists = items(artistsRes).map((a, i) => ({ ...slimArtist(a), ms: 50 - i }));
  const tracks = items(tracksRes)
    .map(slimTrack)
    .map((t) => ({ ...t, artist: t.artists.map((a) => a.name).join(", ") }));
  state.live[rangeId] = { artists, tracks, genres: genreBreakdown(artists, 8), errors: failures.map((e) => e.message) };
  loadLiveTempo(rangeId);
  if (!state.recent) {
    getRecentlyPlayed(50)
      .then((r) => {
        state.recent = (r?.items || []).filter((i) => i && i.track);
        if (state.view === "capsule" && state.liveRange === rangeId) render();
      })
      .catch((e) => console.warn("Recently played unavailable", e));
  }
  if (state.view === "capsule" && state.liveRange === rangeId) {
    try {
      render();
    } catch (e) {
      handleError(e);
    }
  }
}

function liveContent(range, { artists, tracks, genres, errors, tempo, tempoLoading }) {
  const theme = THEMES[LIVE_RANGES.indexOf(range) % THEMES.length];
  const top = artists[0];
  const topTrack = tracks[0];
  const recent = state.recent;
  const recentTracks = recent
    ? recent.map((i) => ({ ...slimTrack(i.track), artist: i.track.artists.map((a) => a.name).join(", "), played_at: i.played_at }))
    : null;
  const recentArtists = recentTracks ? new Set(recentTracks.map((t) => t.artists[0]?.id)).size : 0;
  const topGenre = genres[0] ? titleCase(genres[0].name) : null;
  const albums = albumsFromTracks(tracks);
  const topAlbum = albums[0] || null;
  const stat = topGenre
    ? { value: topGenre, label: "your top genre", text: true }
    : topAlbum
      ? { value: topAlbum.name, label: "your top album", text: true }
      : null;

  return `
  ${errors?.length ? `<p class="notice">Part of your capsule could not be loaded. ${esc(errors.join(" "))}</p>` : ""}
  <div class="grid">
    <div class="col-4">
      <div class="capsule-wrap">
        ${capsuleCard({
          id: "live-capsule",
          theme,
          eyebrow: range.label,
          title: "Your Sound Capsule",
          stat,
          artist: top ? { name: top.name, image: top.image, sub: top.genres.slice(0, 2).join(" · ") } : null,
          track: topTrack ? { name: topTrack.name, image: topTrack.image, sub: topTrack.artist } : null,
          artists: artists.map((a) => a.name),
          tracks: tracks.map((t) => t.name),
          footer: state.me?.name || "Sound Capsule",
        })}
        <button class="btn btn-light" data-action="share" data-card="live-capsule">Share this capsule</button>
      </div>
    </div>
    <div class="col-8">
      <div class="tiles">
        ${tile(top?.name || "–", "Top artist", top?.genres?.[0] ? titleCase(top.genres[0]) : "", { text: true })}
        ${tile(topTrack?.name || "–", "Top song", topTrack?.artist || "", { text: true })}
        ${
          topGenre
            ? tile(topGenre, "Top genre", "", { text: true })
            : tile(topAlbum?.name || "–", "Top album", topAlbum ? `${topAlbum.count} of your top ${tracks.length} songs` : "", { text: true })
        }
        ${tile(recentTracks ? recentArtists : "…", "Artists in your last 50 plays", recentTracks ? `${recentTracks.length} plays loaded` : "")}
      </div>
      <section class="card">
        <h2>Top artists <small>${esc(range.label.toLowerCase())}</small></h2>
        ${artistGrid(artists, { limit: 10 })}
      </section>
    </div>
    <section class="card col-6">
      <h2>Top songs <small>${esc(range.label.toLowerCase())}</small></h2>
      ${trackList(tracks, { limit: 10 })}
    </section>
    ${
      genres.length
        ? `<section class="card col-6">
      <h2>Top genres <small>weighted across your top 50 artists</small></h2>
      ${genreBars(genres)}
    </section>`
        : `<section class="card col-6">
      <h2>Top albums <small>from your top ${tracks.length} songs</small></h2>
      ${trackList(albums, { limit: 10, subText: (a) => a.artist, valueText: (a) => `${a.count} song${a.count === 1 ? "" : "s"}` })}
      <p class="sources">Spotify's API no longer returns genre tags for most artists, so albums are shown instead.</p>
    </section>`
    }
    ${tempoCard(tempo, { loading: tempoLoading, periodLabel: `your top ${tracks.length} songs, ${range.label.toLowerCase()}` })}
    <section class="card col-6">
      <h2>Recently played <small>your last 50 plays, the most the API exposes</small></h2>
      ${recentTracks ? trackList(recentTracks, { limit: 12, valueText: (t) => relTime(t.played_at) }) : `<p class="empty"><span class="spinner"></span></p>`}
    </section>
  </div>`;
}

// ---------------------------------------------------------------------------
// Tempo (BPM)

function patchTempoProgress(message) {
  const el = document.getElementById("tempo-progress");
  if (el) el.textContent = message;
}

// Swap the rendered tempo card for its loading state without re-rendering the whole view.
function showTempoLoading(periodLabel) {
  const el = document.getElementById("tempo-card");
  if (el) el.outerHTML = tempoCard(null, { loading: true, periodLabel });
}

function tempoCard(summary, { loading, periodLabel }) {
  const open = `<section class="card col-6" id="tempo-card">`;
  const head = `<h2>Tempo <small>${esc(periodLabel)}</small></h2>`;
  if (!summary && loading) {
    return `${open}${head}<p class="empty"><span class="spinner"></span> <span id="tempo-progress">Looking up tempo…</span></p></section>`;
  }
  if (!summary) return `${open}${head}<p class="empty">Tempo will load in a moment.</p></section>`;
  if (summary.error) return `${open}${head}<p class="empty">${esc(summary.error)}</p></section>`;
  if (!summary.avg) {
    return `${open}${head}<p class="empty">No tempo data was found for these songs.${summary.hint ? ` ${esc(summary.hint)}` : ""}</p></section>`;
  }

  const avgIdx = Math.min(summary.histogram.length - 1, Math.max(0, Math.floor((summary.avg - 60) / 10)));
  const totalWeight = summary.histogram.reduce((a, b) => a + b.weight, 0) || 1;
  const picks = [
    { ...summary.fastest, tag: "Fastest" },
    { ...summary.slowest, tag: "Slowest" },
  ].filter((p) => p.id);
  const monthly = summary.monthly?.length >= 3 ? summary.monthly.map((m) => ({ label: monthLabel(m.key), value: m.bpm })) : null;
  return `${open}
    ${head}
    <div class="tempo-head">
      <div class="tempo-avg"><div class="n">${Math.round(summary.avg)}</div><div class="l">average BPM, weighted by how much you played each song</div></div>
      <div class="tempo-cover">Based on ${fmt(summary.matchedCount)} of ${fmt(summary.total)} songs, covering ${Math.round(summary.coverage * 100)}% of your listening</div>
    </div>
    ${columns(
      summary.histogram.map((b) => b.weight),
      {
        peak: avgIdx,
        tip: (i) => `${summary.histogram[i].from}–${summary.histogram[i].to} BPM · ${Math.round((summary.histogram[i].weight / totalWeight) * 100)}% · ${summary.histogram[i].count} song${summary.histogram[i].count === 1 ? "" : "s"}`,
        labels: ["60", "100", "140", "180+"],
      },
    )}
    <div style="height:14px"></div>
    ${trackList(picks, { limit: 2, valueText: (t) => `${Math.round(t.tempo)} BPM`, subText: (t) => `${t.tag} · ${t.artist}` })}
    ${monthly ? `<div style="height:14px"></div>${lineChart(monthly, { format: (v) => `${Math.round(v)} BPM` })}` : ""}
    <p class="sources">Tempo from ReccoBeats, with Deezer as a fallback. Spotify's API no longer provides it.${summary.hint ? ` ${esc(summary.hint)}` : ""}</p>
  </section>`;
}

async function loadLiveTempo(rangeId) {
  const data = state.live[rangeId];
  if (!data || data.tempo || data.tempoLoading || !data.tracks.length) return;
  data.tempoLoading = true;
  const range = LIVE_RANGES.find((r) => r.id === rangeId) || LIVE_RANGES[0];
  showTempoLoading(`your top ${data.tracks.length} songs, ${range.label.toLowerCase()}`);
  const items = data.tracks.map((t, i) => ({
    id: t.id,
    name: t.name,
    artist: t.artists[0]?.name || t.artist,
    isrc: t.isrc,
    image: t.image,
    weight: data.tracks.length - i,
    plays: 1,
  }));
  try {
    const tempos = await lookupTempos(items, { loggedIn: true, onProgress: patchTempoProgress, fallbackLimit: 15 });
    data.tempo = tempoSummary(
      items.map((it) => ({ ...it, tempo: tempos.get(it.id) })),
      { minPlays: 1 },
    );
  } catch (e) {
    console.warn(e);
    data.tempo = { error: "Tempo lookup failed. Reload the page to try again." };
  } finally {
    data.tempoLoading = false;
    if (state.view === "capsule" && state.liveRange === rangeId) render();
  }
}

async function loadHistoryTempo() {
  const key = state.histRange;
  const s = state.stats;
  const records = state.history.records;
  if (!s || state.tempo[key] || state.tempoLoading) return;
  const pool = s.allTracks.filter((t) => t.uri).slice(0, 300);
  if (!pool.length) {
    state.tempo[key] = { avg: null, matchedCount: 0, total: 0, coverage: 0, histogram: [] };
    return;
  }
  state.tempoLoading = true;
  showTempoLoading(`up to 300 most-played songs, ${windowFor(key, records).label.toLowerCase()}`);
  try {
    const items = pool.map((t) => {
      const id = trackIdFromUri(t.uri);
      return { id, name: t.name, artist: t.artist, weight: t.ms, plays: t.plays, image: state.enriched?.tracks.get(id)?.image || null };
    });
    const tempos = await lookupTempos(items, { loggedIn: isLoggedIn(), onProgress: patchTempoProgress, fallbackLimit: 25 });
    const totalWeight = s.allTracks.reduce((a, t) => a + t.ms, 0);
    const summary = tempoSummary(
      items.map((it) => ({ ...it, tempo: tempos.get(it.id) })),
      { minPlays: 3, totalWeight },
    );
    summary.monthly = monthlyTempo(records, tempos, { start: s.start, end: s.end });
    if (!isLoggedIn() && (await hasUnresolvedMisses(items.map((it) => it.id)))) {
      summary.hint = "Sign in with Spotify to look up the songs ReccoBeats did not know.";
    }
    if (isLoggedIn() && summary.fastest) {
      try {
        const imgs = await getTracks([summary.fastest.id, summary.slowest.id]);
        summary.fastest.image = imgs.get(summary.fastest.id)?.image || summary.fastest.image;
        summary.slowest.image = imgs.get(summary.slowest.id)?.image || summary.slowest.image;
      } catch {
        // artwork is optional
      }
    }
    if (state.history.records === records) state.tempo[key] = summary;
  } catch (e) {
    console.warn(e);
    state.tempo[key] = { error: "Tempo lookup failed. Reload the page to try again." };
  } finally {
    state.tempoLoading = false;
    if (state.view === "history") render();
  }
}

function bindLive() {
  bindShare(main);
}

function bindShare(root) {
  root.querySelectorAll("[data-action=share]").forEach((b) =>
    b.addEventListener("click", () => {
      const card = document.getElementById(b.dataset.card);
      if (card) shareCard(card, `${b.dataset.card}.png`);
    }),
  );
}

// ---------------------------------------------------------------------------
// History view (Extended Streaming History import)

function renderHistoryView() {
  const { records, meta } = state.history;
  if (!records.length) {
    main.innerHTML = `
      ${dropzone(false)}
      <section class="howto">
        <details open>
          <summary>How to get your Extended Streaming History</summary>
          <ol>
            <li>Go to <a href="https://www.spotify.com/account/privacy/" target="_blank" rel="noopener">spotify.com/account/privacy</a>.</li>
            <li>Under <em>Download your data</em>, tick <strong>Extended streaming history</strong> and request it. Confirm the email Spotify sends.</li>
            <li>Spotify emails a ZIP within a few days (up to 30). Drop the ZIP, or the <code>Streaming_History_Audio_*.json</code> files inside it, here.</li>
            <li>The older <em>Account data</em> export (<code>StreamingHistory_music_*.json</code>, last year only) also works.</li>
          </ol>
          Files are parsed in your browser and kept in this browser's local database. Nothing is uploaded.
        </details>
      </section>`;
    bindDropzone(main);
    return;
  }

  const years = yearsIn(records);
  const months = monthsIn(records);
  const monthIdx = months.indexOf(state.histRange);
  const win = windowFor(state.histRange, records);
  const s = state.stats;
  const enr = state.enriched;
  const tempo = state.tempo[state.histRange];
  const themeIndex = isMonthId(state.histRange)
    ? Number(state.histRange.slice(5))
    : isYearId(state.histRange)
      ? Number(state.histRange)
      : RANGES.findIndex((r) => r.id === state.histRange);
  const theme = THEMES[Math.abs(themeIndex) % THEMES.length];
  const decorateArtist = (a) => ({ ...a, image: enr?.artists.get(a.name)?.image || null, genres: enr?.artists.get(a.name)?.genres || [] });
  const decorateTrack = (t) => ({ ...t, image: enr?.tracks.get(trackIdFromUri(t.uri))?.image || null });
  const topArtists = s.topArtists.map(decorateArtist);
  const topTracks = s.topTracks.map(decorateTrack);
  const topAlbums = s.topAlbums.map(decorateTrack);
  const discoveries = s.discoveries.map(decorateArtist);
  const genres = enr ? genreBreakdown(topArtists.slice(0, 30), 8) : [];
  const type = listenerType(s.peakHour);
  const first = records[0].t;
  const last = records[records.length - 1].t;
  const periodLabel = win.label;

  main.innerHTML = `
    <div class="toolbar">
      <div class="tabs">
        ${RANGES.map((r) => `<button data-hrange="${r.id}" class="${r.id === state.histRange ? "active" : ""}">${r.label}</button>`).join("")}
        ${years.map((y) => `<button data-hrange="${y}" class="${String(y) === state.histRange ? "active" : ""}">${y}</button>`).join("")}
      </div>
      <div class="month-picker">
        <button class="btn btn-ghost" data-month-step="-1" aria-label="Previous month" ${monthIdx < 0 || monthIdx >= months.length - 1 ? "disabled" : ""}>&lsaquo;</button>
        <select class="select${monthIdx >= 0 ? " active" : ""}" data-month aria-label="Calendar month">
          <option value="">Pick a month…</option>
          ${months.map((m) => `<option value="${m}" ${m === state.histRange ? "selected" : ""}>${esc(monthName(m))}</option>`).join("")}
        </select>
        <button class="btn btn-ghost" data-month-step="1" aria-label="Next month" ${monthIdx <= 0 ? "disabled" : ""}>&rsaquo;</button>
      </div>
      <span class="note">${fmt(records.length)} plays · ${fmtDate(first)} to ${fmtDate(last)}</span>
    </div>

    <div class="tiles">
      ${tile(fmt(s.minutes), "minutes listened", s.hours ? `${fmt(s.hours)} hours` : "")}
      ${tile(fmt(s.streams), "songs played", `${fmt(s.trackCount)} different songs`)}
      ${tile(fmt(s.artistCount), "artists", `${fmt(s.discoveryCount)} discovered for the first time`)}
      ${tile(fmt(s.avgPerDay), "minutes per day", `${fmt(s.avgPerActiveDay)} on days you listened`)}
      ${tile(fmt(s.activeDays), "days with music", `of ${fmt(s.calendarDays)} days in this period`)}
      ${tile(`${s.streak.longest}`, "day streak", s.streak.current > 1 ? `${s.streak.current} days running at the end` : "longest run in this period")}
      ${s.topDay ? tile(fmt(s.topDay.minutes), "minutes on your biggest day", fmtDate(s.topDay.date + "T12:00:00")) : ""}
      ${tempo?.avg ? tile(fmt(tempo.avg), "average BPM", tempo.fastest ? `fastest: ${tempo.fastest.name}` : "") : ""}
    </div>

    <div class="grid">
      <div class="col-4">
        <div class="capsule-wrap">
          ${capsuleCard({
            id: "history-capsule",
            theme,
            eyebrow: periodLabel,
            title: "Your Sound Capsule",
            stat: { value: fmt(s.minutes), label: "minutes listened" },
            artist: topArtists[0] ? { name: topArtists[0].name, image: topArtists[0].image, sub: `${fmt(topArtists[0].ms / 60000)} minutes` } : null,
            track: topTracks[0] ? { name: topTracks[0].name, image: topTracks[0].image, sub: `${topTracks[0].artist} · ${topTracks[0].plays} plays` } : null,
            artists: topArtists.map((a) => a.name),
            tracks: topTracks.map((t) => t.name),
            footer: state.me?.name || "Sound Capsule",
          })}
          <button class="btn btn-light" data-action="share" data-card="history-capsule">Share this capsule</button>
          ${!isLoggedIn() ? `<p class="sources">Sign in with Spotify to add artwork and genres to your history.</p>` : ""}
        </div>
      </div>
      <div class="col-8">
        <section class="card">
          <h2>Top artists <small>by minutes</small></h2>
          ${artistGrid(topArtists, { limit: 10, valueText: (a) => `${fmtMinutes(a.ms / 60000)} · ${a.plays} plays` })}
        </section>
        <div style="height:20px"></div>
        <section class="card">
          <h2>Listening clock <small>${esc(type.title)}. ${esc(type.blurb)}</small></h2>
          ${columns(s.byHour, { peak: s.peakHour, tip: (i, v) => `${hourLabel(i)} · ${fmt(v / 60000)} min`, labels: ["12am", "6am", "12pm", "6pm", "11pm"] })}
        </section>
      </div>

      <section class="card col-6">
        <h2>Top songs <small>by minutes</small></h2>
        ${trackList(topTracks, { limit: 10, valueText: (t) => `${t.plays} plays · ${fmtMinutes(t.ms / 60000)}` })}
      </section>
      <section class="card col-6">
        <h2>Top albums</h2>
        ${trackList(topAlbums, { limit: 10, valueText: (t) => fmtMinutes(t.ms / 60000) })}
      </section>

      <section class="card col-6">
        <h2>New discoveries <small>${fmt(s.discoveryCount)} artists you heard for the first time</small></h2>
        ${trackList(discoveries, { limit: 8, round: true, subText: (a) => `${a.plays} plays`, valueText: (a) => fmtMinutes(a.ms / 60000) })}
      </section>
      <section class="card col-6">
        <h2>Milestones <small>crossed in this period</small></h2>
        ${milestones(s.milestones)}
      </section>

      <section class="card col-6">
        <h2>Top genres <small>${enr ? "from your top 30 artists" : "sign in to load"}</small></h2>
        ${genreBars(genres)}
      </section>
      <section class="card col-6">
        <h2>Days of the week <small>busiest: ${WEEKDAYS[s.peakWeekday]}</small></h2>
        ${columns(s.byWeekday, { peak: s.peakWeekday, tip: (i, v) => `${WEEKDAYS[i]} · ${fmt(v / 60000)} min`, labels: WEEKDAYS })}
      </section>

      <section class="card col-6">
        <h2>Biggest days <small>top 10 by minutes</small></h2>
        ${dayTable(s.biggestDays)}
      </section>
      ${tempoCard(tempo, { loading: state.tempoLoading, periodLabel: `up to 300 most-played songs, ${periodLabel.toLowerCase()}` })}

      ${
        s.byDay
          ? ""
          : `<section class="card col-12">
        <h2>Every day <small>${esc(periodLabel)} · darker means more minutes</small></h2>
        ${heatmap(s.dayTotals, s.start, s.end)}
      </section>`
      }

      <section class="card col-12">
        <h2>${s.byDay ? "Day by day" : "Month by month"} <small>${esc(periodLabel)}</small></h2>
        ${s.byDay ? dayChart(s.byDay) : monthChart(s.byMonth)}
      </section>

      <section class="col-12">
        ${dropzone(true)}
        <p class="sources">Imported: ${meta.sources.map((f) => `${esc(f.name)} (${fmt(f.count)})`).join(", ")}
          · <a href="#" data-action="clear-history">Remove all history from this browser</a></p>
      </section>
    </div>`;

  main.querySelectorAll("[data-hrange]").forEach((b) => b.addEventListener("click", () => setHistRange(b.dataset.hrange)));
  $("[data-month]", main).addEventListener("change", (e) => {
    if (e.target.value) setHistRange(e.target.value);
  });
  main.querySelectorAll("[data-month-step]").forEach((b) =>
    b.addEventListener("click", () => {
      // months are newest-first, so stepping forward in time means a lower index
      const next = months[monthIdx - Number(b.dataset.monthStep)];
      if (next) setHistRange(next);
    }),
  );
  $("[data-action=clear-history]", main).addEventListener("click", async (e) => {
    e.preventDefault();
    if (!confirm("Remove all imported listening history from this browser?")) return;
    await clearStoredHistory();
    state.history = { records: [], meta: { sources: [] } };
    state.stats = null;
    state.enriched = null;
    state.tempo = {};
    render();
  });
  bindDropzone(main);
  bindShare(main);
  if (isLoggedIn() && !enr && !state.busy) enrichHistory();
  if (!tempo && !state.tempoLoading) loadHistoryTempo();
}

// `value` is pre-formatted HTML for numbers; pass text: true for names so they wrap and clamp.
const tile = (value, label, sub, { text = false } = {}) =>
  `<div class="tile"><div class="value${text ? " text" : ""}"${text ? ` title="${esc(value)}"` : ""}>${text ? esc(value) : value}</div><div class="label">${esc(label)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ""}</div>`;

// Group the top 50 songs by album; the album with the most entries wins, ties go to the higher-ranked one.
function albumsFromTracks(tracks) {
  const map = new Map();
  tracks.forEach((t, i) => {
    if (!t.album) return;
    const artist = t.artists[0]?.name || t.artist || "";
    const key = `${artist}|${t.album}`;
    const entry = map.get(key) || { name: t.album, artist, image: t.image, url: t.url, count: 0, rank: i };
    entry.count++;
    map.set(key, entry);
  });
  return [...map.values()].sort((a, b) => b.count - a.count || a.rank - b.rank);
}

function milestones(list) {
  if (!list.length) return `<p class="empty">No milestones in this period. Keep listening.</p>`;
  return `<div class="milestones">${list
    .slice(0, 8)
    .map(
      (m) => `
      <div class="milestone">
        <div class="badge ${m.kind}">${m.value >= 1000 ? `${m.value / 1000}k` : m.value}</div>
        <div class="text">
          <b title="${esc(m.name)}">${esc(m.name)}</b>
          <span>${m.kind === "track" ? `${esc(m.artist)} · ` : ""}passed ${fmt(m.value)} ${m.unit}${m.kind !== "total" ? ` (now ${fmt(m.total)})` : ""}</span>
        </div>
      </div>`,
    )
    .join("")}</div>`;
}

function setHistRange(id) {
  state.histRange = id;
  localStorage.setItem("sc_hist_range", id);
  recomputeStats();
  render();
}

function dayChart(days) {
  const values = days.map((d) => d.ms);
  const peak = values.indexOf(Math.max(...values));
  const labels = days.filter((_, i) => i % 5 === 0).map((d) => fmtDate(d.key + "T12:00:00", { day: "numeric", month: "short" }));
  return columns(values, { peak, tip: (i, v) => `${fmtDate(days[i].key + "T12:00:00")} · ${fmt(v / 60000)} min`, labels });
}

function monthChart(months) {
  if (!months.length) return `<p class="empty">No data.</p>`;
  const values = months.map((m) => m.ms);
  const peak = values.indexOf(Math.max(...values));
  const step = Math.max(1, Math.ceil(months.length / 12));
  const labels = months.filter((_, i) => i % step === 0).map((m) => monthLabel(m.key));
  return `<div class="scroll-x" style="min-width:0"><div style="min-width:${Math.max(0, months.length * 14)}px">
    ${columns(values, { peak, tip: (i, v) => `${monthLabel(months[i].key)} · ${fmt(v / 60000)} min`, labels })}
  </div></div>`;
}

function dropzone(compact) {
  return `
  <label class="dropzone${compact ? " compact" : ""}" id="dropzone">
    <div>
      <h3>${compact ? "Add more history files" : "Drop your Spotify data export here"}</h3>
      <p>${compact ? "Newer exports are merged and de-duplicated." : "The ZIP Spotify emails you, or the Streaming_History_Audio_*.json files inside it."}</p>
    </div>
    <span class="btn ${compact ? "btn-ghost btn-sm" : "btn-primary"}">Choose files</span>
    <input type="file" multiple accept=".json,.zip,application/json,application/zip" />
  </label>`;
}

function bindDropzone(root) {
  const zone = $("#dropzone", root);
  if (!zone) return;
  const input = $("input", zone);
  input.addEventListener("change", () => importFiles(input.files));
  ["dragenter", "dragover"].forEach((ev) =>
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.add("drag");
    }),
  );
  ["dragleave", "drop"].forEach((ev) =>
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.remove("drag");
    }),
  );
  zone.addEventListener("drop", (e) => importFiles(e.dataTransfer.files));
  // Whole-page drop convenience
  document.body.ondragover = (e) => e.preventDefault();
  document.body.ondrop = (e) => {
    e.preventDefault();
    if (state.view === "history") importFiles(e.dataTransfer.files);
  };
}

async function importFiles(files) {
  if (!files?.length || state.busy) return;
  state.busy = true;
  try {
    const parsed = await parseFiles(files, (msg) => toast(msg, { duration: 10000 }));
    if (!parsed.records.length) throw new Error("No listening records found in those files.");
    toast("Merging and saving…", { duration: 10000 });
    const result = await addToHistory(parsed.records, parsed.sources);
    state.history = { records: result.records, meta: result.meta };
    state.enriched = null;
    state.tempo = {};
    recomputeStats();
    toast(`Imported ${fmt(result.added)} plays${result.duplicates ? ` (${fmt(result.duplicates)} duplicates skipped)` : ""}.`);
    state.view = "history";
    render();
  } catch (e) {
    toast(e.message, { error: true, duration: 6000 });
  } finally {
    state.busy = false;
  }
}

function recomputeStats() {
  const { records } = state.history;
  if (!records.length) return;
  const valid =
    RANGES.some((r) => r.id === state.histRange) ||
    (isYearId(state.histRange) && yearsIn(records).includes(Number(state.histRange))) ||
    (isMonthId(state.histRange) && monthsIn(records).includes(state.histRange));
  if (!valid) state.histRange = "4w";
  state.stats = computeStats(records, windowFor(state.histRange, records));
  state.enriched = null;
}

// Fetch artwork and genres for the current history window from the Web API.
async function enrichHistory() {
  const s = state.stats;
  if (!s || !isLoggedIn()) return;
  state.busy = true;
  const rangeAtStart = state.histRange;
  try {
    const uris = [
      ...s.topTracks.slice(0, 10).map((t) => t.uri),
      ...s.topArtists.slice(0, 20).map((a) => a.topTrackUri),
      ...s.discoveries.slice(0, 8).map((a) => a.topTrackUri),
      ...s.topAlbums.slice(0, 10).map((a) => a.uri),
      ...s.topArtists.slice(20, 30).map((a) => a.topTrackUri),
    ];
    const ids = [...new Set(uris.map(trackIdFromUri).filter(Boolean))].slice(0, 50);
    const tracks = await getTracks(ids);
    const nameToId = new Map();
    for (const t of tracks.values()) for (const a of t.artists) if (!nameToId.has(a.name)) nameToId.set(a.name, a.id);
    const wanted = [...s.topArtists.slice(0, 30), ...s.discoveries.slice(0, 8)].map((a) => nameToId.get(a.name)).filter(Boolean);
    const artistsById = await getArtists(wanted);
    const artists = new Map();
    for (const [name, id] of nameToId) if (artistsById.has(id)) artists.set(name, artistsById.get(id));
    if (state.histRange !== rangeAtStart) return; // user moved on
    state.enriched = { tracks, artists };
    if (state.view === "history") render();
  } catch (e) {
    if (e instanceof AuthError) handleError(e);
    else console.warn("Enrichment failed", e);
  } finally {
    state.busy = false;
  }
}

// ---------------------------------------------------------------------------
// Utils

const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

function relTime(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return `${Math.floor(diff / 86400)} d ago`;
}

boot();
